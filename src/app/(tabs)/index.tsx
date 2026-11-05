/**
 * Tab 1: Front-page Bible viewer.
 *
 * On launch a full-screen setup overlay runs the native first-launch Tamil BSI
 * installer (bundled asset -> `bibles/TAMIL_BSI.json`) with a 0-100% bar and
 * a Retry option before the reader appears.
 *
 * Top bar: version+language pill (`TAM • BSI ▾`, opens the offline version
 * switcher), a read-status pill that understands verse-level selection, and
 * the dark/light toggle. Row 2 carries `< Prev`, a live book/chapter/verse
 * selector (`2 Samuel 5:4 ▾` / `Verse 4 of 31`) and `Next >`, with a thin
 * progress bar underneath fed by scroll position + marked-read verses.
 *
 * Verses render from `loadChapterVerses()` inside a windowed FlatList; the
 * verse row is a `React.memo` component driven by primitive props so scrolling
 * a large chapter never stalls. Book names resolve through
 * `getLocalizedBookName()` in the active version's own language (Tamil BSI
 * names for TAMIL_BSI, English for eng_*, native JSON/dictionary names for
 * Malayalam, Hindi, Telugu, Kannada...).
 *
 * Reading progress: verse-level mark-read state machine over
 * `reading_progress_v2` (`read_verses`, `total_verses`, `is_read`) so single
 * verses, multi selections, and whole chapters all advance the Progress tab.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/constants/ThemeContext';
import { HIGHLIGHT_COLORS, getHighlightStyle, type AppTheme } from '@/constants/colors';
import {
  BIBLE_BOOKS,
  getBookById,
  getLocalizedBookName,
  type BibleBook,
  type BookLanguageVersionMeta,
  type VersionBookMeta,
} from '@/constants/books';
import { Svg, Path } from 'react-native-svg';
import { ScalePressable } from '@/components/ScalePressable';
import { SunMoonSvg } from '@/components/SvgIcons';
import SelahAppIconSvg from '@/components/SelahAppIconSvg';
import {
  DEFAULT_TAMIL_BSI_META,
  ensureDefaultTamilBsiInstalled,
  getActiveVersionId,
  getInstalledVersions,
  getVersionBookNames,
  getVersionBooksById,
  getVersionBooksManifest,
  isBundledVersionId,
  isTamilBsiDiskReady,
  loadChapterVerses,
  normalizeVersionId,
  setActiveVersionId,
  TAMIL_BSI_ID,
  type BibleVersionMeta,
  type ChapterVerse,
  type VersionBookManifestEntry,
} from '@/db/bibleLoader';
import {
  addHighlight,
  deleteHighlight,
  getChapterReadState,
  getHighlightsForPassage,
  getVersionProgressSummary,
  markVersesRead,
  toggleChapterRead,
  unmarkVersesRead,
  updateHighlightColor,
  notifyProgressUpdated,
  type ChapterReadState,
  type HighlightRow,
} from '@/db/database';

const LAST_POSITION_KEY = 'bible.reader.lastPosition';
const FIRST_BOOK_ID = 1;
const LAST_BOOK_ID = 66;
const INITIAL_BOOK_ID = 1;
const INITIAL_CHAPTER = 1;
const CHAPTER_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 30 };

/** FIX 4 — one picker row: canonical book + the version's manifest entry. */
type PickerBookItem = {
  book: BibleBook;
  manifest: VersionBookManifestEntry;
};

/** Device-local day, 'YYYY-MM-DD' (matches the DB date format). */
function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * `highlights.version_id` is an INTEGER column while version ids are strings
 * ('TAMIL_BSI', 'eng_kjv'...). Fold the string into a stable positive number
 * so highlights stay per-version without a schema change.
 */
function numericVersionId(versionId: string): number {
  let hash = 5381;
  for (let index = 0; index < versionId.length; index += 1) {
    hash = ((hash * 33) ^ versionId.charCodeAt(index)) >>> 0;
  }
  return hash % 2147483647 || 1;
}

/** Router params can arrive as string | string[]; normalize to one string. */
function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

const NO_READ_STATE: ChapterReadState = { isChapterRead: false, readVerses: [] };

export default function BibleReaderScreen() {
  const { theme, themeMode, toggleTheme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // FIX 1: dynamic 5-column chapter grid — tiles stretch exactly from the left
  // content inset to the right content inset with zero wasted side space.
  const { width: screenWidth } = useWindowDimensions();
  const gridPadding = 16;
  const gridGap = 10;
  const gridCols = 5;
  const tileWidth = Math.floor(
    (screenWidth - gridPadding * 2 - gridGap * (gridCols - 1)) / gridCols,
  );
  // FIX 2 — exact pixel widths for Row 2: fixed Prev/Next sides plus two exact
  // gaps guarantee the center pill can never push `Next >` off-screen.
  const sideBtnWidth = 66;
  const rowPadding = 12;
  const rowGap = 8;
  const centerPillWidth =
    screenWidth - rowPadding * 2 - sideBtnWidth * 2 - rowGap * 2;
  /**
   * Guaranteed top inset for every full-screen <Modal> header. Android
   * edge-to-edge renders modal windows behind the status bar and camera
   * cutout, so `insets.top` alone is not enough: take the platform status bar
   * height too and enforce a 36px floor so the ✕ Close, book titles, and
   * `< Back` buttons always sit safely below the clock, center cutout, and
   * battery icon.
   */
  const topModalInset = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 36) : 0,
    36,
  );

  // -----------------------------------------------------------------------
  // Native first-launch setup: `bibles/TAMIL_BSI.json` is materialized from
  // the bundled asset (or the network mirror as fallback) before the reader
  // shows. `ensureDefaultTamilBsiInstalled` keeps ONE shared install promise
  // behind a module ref, so multiple callers share one run and every
  // onProgress listener receives the same 0-100 stream.
  // -----------------------------------------------------------------------
  const [setupState, setSetupState] = useState<'checking' | 'running' | 'ready' | 'error'>('checking');
  const [setupPct, setSetupPct] = useState(0);
  const [setupError, setSetupError] = useState<string | null>(null);

  const runSetup = useCallback(() => {
    setSetupState('running');
    setSetupError(null);
    setSetupPct(0);
    void ensureDefaultTamilBsiInstalled((pct) => {
      setSetupPct(Math.min(100, Math.max(0, Math.round(pct))));
    })
      .then(() => setSetupState('ready'))
      .catch((error: unknown) => {
        setSetupError(
          error instanceof Error
            ? error.message
            : 'Could not finish setting up the Tamil BSI Bible. Check your connection and retry.',
        );
        setSetupState('error');
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ready = await isTamilBsiDiskReady();
      if (cancelled) return;
      if (ready) {
        setSetupState('ready');
        return;
      }
      runSetup();
    })();
    return () => {
      cancelled = true;
    };
  }, [runSetup]);

  const [versionId, setVersionId] = useState(TAMIL_BSI_ID);
  const [bookId, setBookId] = useState(INITIAL_BOOK_ID);
  const [chapter, setChapter] = useState(INITIAL_CHAPTER);
  const [verses, setVerses] = useState<ChapterVerse[]>([]);
  /**
   * FIX 3: dedicated chapter-load flag. It flips true the moment the reader's
   * coordinates change and only flips false when verses (or a hard error)
   * land, so the "Chapter unavailable" card can never flash mid-load or
   * mid-redirect.
   */
  const [isLoadingChapter, setIsLoadingChapter] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<HighlightRow[]>([]);
  const [readState, setReadState] = useState<ChapterReadState>(NO_READ_STATE);
  /** First verse visible in the list — the live "reading position". */
  const [currentVisibleVerse, setCurrentVisibleVerse] = useState(1);
  const [selectedVerses, setSelectedVerses] = useState<number[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerStage, setPickerStage] = useState<'books' | 'chapters'>('books');
  const [pickerBook, setPickerBook] = useState<BibleBook | null>(null);
  const [bookSearchQuery, setBookSearchQuery] = useState('');
  /** Bumped on every tab focus so returning from Bibles refreshes chapter data. */
  const [refreshTick, setRefreshTick] = useState(0);
  /** Quick version switcher (top-left pill): every version on this device. */
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [installedVersions, setInstalledVersions] = useState<BibleVersionMeta[]>([]);

  /**
   * FIX 3: request id for in-flight chapter loads. Each coordinate change
   * bumps it; a stale response whose id no longer matches is dropped.
   */
  const loadRequestIdRef = useRef(0);
  const listRef = useRef<FlatList<ChapterVerse> | null>(null);
  /**
   * FIX 4 — the active version's real book manifest (canonical ids, the
   * version's own native names, true chapter counts). `null` while loading;
   * `[]` when the version has no readable local file. Pickers never fall back
   * to the canonical 66-book fillers.
   *
   * Stored together with its version id so switching versions can never show
   * the previous version's books for even one frame.
   */
  const [versionManifestState, setVersionManifestState] = useState<{
    versionId: string;
    books: VersionBookManifestEntry[];
  } | null>(null);
  const versionManifest = useMemo(
    () => (versionManifestState &&
      versionManifestState.versionId === normalizeVersionId(versionId)
      ? versionManifestState.books
      : null),
    [versionId, versionManifestState],
  );
  /** Chapter count of the book open in the picker, from the manifest. */
  const [pickerChapterCount, setPickerChapterCount] = useState(0);
  /**
   * Fully-read chapter count per canonical book id (verse-aware, canonical).
   * Loads lazily whenever a book opens in the picker so the unified modal
   * header can show `{readCount}/{totalChapters} read` with zero extra scans.
   */
  const [pickerReadCounts, setPickerReadCounts] = useState<Record<number, number>>({});

  const currentBook = getBookById(bookId) ?? BIBLE_BOOKS[0];

  /** Active version metadata + language + native book names (per version). */
  const activeMeta = useMemo(() => {
    const id = normalizeVersionId(versionId);
    return (
      installedVersions.find((entry) => entry.id === id) ??
      (isBundledVersionId(id) ? DEFAULT_TAMIL_BSI_META : undefined)
    );
  }, [installedVersions, versionId]);

  const bookNamesMeta = useMemo<BookLanguageVersionMeta>(() => ({
    id: normalizeVersionId(versionId),
    language: activeMeta?.language ?? '',
    languageCode: activeMeta?.languageCode ?? '',
  }), [activeMeta, versionId]);

  const [customBookNames, setCustomBookNames] = useState<Record<number, string>>({});
  useEffect(() => {
    let cancelled = false;
    void getVersionBookNames(versionId).then((names) => {
      if (!cancelled) setCustomBookNames(names);
    });
    return () => {
      cancelled = true;
    };
  }, [versionId]);

  /**
   * Version books keyed by canonical id with USFM-derived native/common names.
   * Feeds `getLocalizedBookName` so book names come from the version's own
   * JSON even when the file's array order differs from the canonical grid.
   */
  const [versionBooksById, setVersionBooksById] = useState<Record<number, VersionBookMeta>>({});
  useEffect(() => {
    let cancelled = false;
    void getVersionBooksById(versionId).then((lookup) => {
      if (!cancelled) setVersionBooksById(lookup);
    });
    return () => {
      cancelled = true;
    };
  }, [versionId]);

  // FIX 4 — load the version's true manifest. Only books the version
  // actually carries come back (BTD → the four Gospels), with the version's
  // own names and real chapter counts.
  useEffect(() => {
    let cancelled = false;
    const normalized = normalizeVersionId(versionId);
    void getVersionBooksManifest(normalized).then((manifest) => {
      if (!cancelled) setVersionManifestState({ versionId: normalized, books: manifest });
    });
    return () => {
      cancelled = true;
    };
  }, [versionId]);

  /** Localized resolver for THIS active version (primary/secondary names). */
  const localizedBook = useCallback(
    (id: number) => getLocalizedBookName(id, bookNamesMeta, customBookNames, versionBooksById),
    [bookNamesMeta, customBookNames, versionBooksById],
  );

  const activeBookNames = localizedBook(bookId);
  const primaryBookName = activeBookNames.primaryName;
  const secondaryBookName = activeBookNames.secondaryName;

  /** Top-left pill: `{LanguageName} • {VersionShortName} ▾`, e.g. `Tamil • BSI ▾`. */
  const activeShortName = useMemo(() => {
    const id = normalizeVersionId(versionId);
    const meta = installedVersions.find((entry) => (entry.id ?? '') === id || entry.id === versionId);
    if (meta) return meta.shortName;
    if (isBundledVersionId(id)) return DEFAULT_TAMIL_BSI_META.shortName;
    return id;
  }, [installedVersions, versionId]);

  const activeLanguageName = useMemo(() => {
    const raw = activeMeta?.language || (isBundledVersionId(versionId) ? 'Tamil' : '');
    const base = raw.split('(')[0]?.trim() || raw.trim();
    return base.split(/\s+/)[0] || 'Tamil';
  }, [activeMeta?.language, versionId]);

  const versionBadgeLabel = `${activeLanguageName} • ${activeShortName} ▾`;

  // -----------------------------------------------------------------------
  // Jump support: the Highlights tab navigates here with jumpBook /
  // jumpChapter / jumpVerse query params; consume them once and open the
  // passage with the verse selected so the highlight bar is shown.
  // -----------------------------------------------------------------------
  const jumpParams = useLocalSearchParams<{
    jumpBook?: string;
    jumpChapter?: string;
    jumpVerse?: string;
  }>();
  const handledJumpKeyRef = useRef('');
  const [pendingJumpVerse, setPendingJumpVerse] = useState<number | null>(null);

  useEffect(() => {
    const bookRaw = firstParam(jumpParams.jumpBook);
    const chapterRaw = firstParam(jumpParams.jumpChapter);
    const verseRaw = firstParam(jumpParams.jumpVerse);
    const jumpKey = `${bookRaw}|${chapterRaw}|${verseRaw}`;
    if (jumpKey === '||' || handledJumpKeyRef.current === jumpKey) return;

    const jumpedBookId = Number(bookRaw);
    const jumpedChapter = Number(chapterRaw);
    const jumpedVerse = Number(verseRaw);
    const targetBook = Number.isInteger(jumpedBookId) ? getBookById(jumpedBookId) : undefined;
    if (
      !targetBook ||
      !Number.isInteger(jumpedChapter) ||
      jumpedChapter < 1 ||
      jumpedChapter > targetBook.chaptersCount
    ) {
      handledJumpKeyRef.current = jumpKey;
      return;
    }

    // Deferred like the chapter loader: keeps setState out of the effect body.
    const timer = setTimeout(() => {
      handledJumpKeyRef.current = jumpKey;
      setBookId(targetBook.id);
      setChapter(jumpedChapter);
      setPendingJumpVerse(
        Number.isInteger(jumpedVerse) && jumpedVerse >= 1 ? jumpedVerse : null,
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [jumpParams.jumpBook, jumpParams.jumpChapter, jumpParams.jumpVerse]);

  // Once the jumped-to chapter has loaded, scroll to the verse and open the
  // highlight bar over it.
  useEffect(() => {
    if (pendingJumpVerse === null || isLoadingChapter || verses.length === 0) return;
    const timer = setTimeout(() => {
      const verseIndex = verses.findIndex((verse) => verse.verse === pendingJumpVerse);
      if (verseIndex >= 0) {
        try {
          listRef.current?.scrollToIndex({ index: verseIndex, viewPosition: 0.3 });
        } catch {
          // Estimation failures are non-fatal: the chapter itself is open.
        }
        setSelectedVerses([pendingJumpVerse]);
      }
      setPendingJumpVerse(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingJumpVerse, isLoadingChapter, verses]);

  // -----------------------------------------------------------------------
  // FIX 3: chapter loading driven by request ids, no stale-response races.
  //
  // Whenever version/book/chapter (or a focus-refresh tick) changes:
  //   1. bump `loadRequestIdRef` and show the loading spinner immediately,
  //   2. await `loadChapterVerses`,
  //   3. drop the response entirely if a newer request started,
  //   4. on redirect, commit verses + corrected book/chapter + spinner-off in
  //      ONE state batch so the header pill (`Genesis 1` vs `Matthew 1`) and
  //      the verse list never disagree on an intermediate render.
  //
  // The body runs in a 0ms timer so the effect never flips state
  // synchronously (react-hooks/set-state-in-effect).
  // -----------------------------------------------------------------------
  useEffect(() => {
    const timer = setTimeout(() => {
      const reqId = ++loadRequestIdRef.current;

      setIsLoadingChapter(true);
      setError(null);
      setSelectedVerses([]);
      setCurrentVisibleVerse(1);

      void (async () => {
        const normalizedId = normalizeVersionId(versionId);
        try {
          const result = await loadChapterVerses(normalizedId, bookId, chapter);
          if (reqId !== loadRequestIdRef.current) return;

          if (result.actualBookId !== bookId || result.actualChapter !== chapter) {
            // Partial version (NT-only, ...) redirect: atomic batch update.
            setVerses(result.verses);
            setBookId(result.actualBookId);
            setChapter(result.actualChapter);
            setIsLoadingChapter(false);
          } else {
            setVerses(result.verses);
            setIsLoadingChapter(false);
          }

          const numericId = numericVersionId(normalizedId);
          const chapterHighlights = getHighlightsForPassage(
            numericId,
            result.actualBookId,
            result.actualChapter,
          );
          const nextReadState = await getChapterReadState(
            normalizedId,
            result.actualBookId,
            result.actualChapter,
          );
          if (reqId !== loadRequestIdRef.current) return;
          setHighlights(chapterHighlights);
          setReadState(nextReadState);
        } catch (err) {
          if (reqId !== loadRequestIdRef.current) return;
          setError(
            err instanceof Error ? err.message : 'Could not load this chapter. Try another version.',
          );
          setHighlights([]);
          setReadState(NO_READ_STATE);
          setIsLoadingChapter(false);
        }
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, [versionId, bookId, chapter, refreshTick]);

  // Restore the last reading position once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const savedRaw = await AsyncStorage.getItem(LAST_POSITION_KEY);
        if (!savedRaw || cancelled) return;
        const saved = JSON.parse(savedRaw) as { versionId?: unknown; bookId?: unknown; chapter?: unknown };
        const savedVersionId = typeof saved.versionId === 'string' ? saved.versionId : null;
        const savedBookId = typeof saved.bookId === 'number' ? saved.bookId : 0;
        const savedChapter = typeof saved.chapter === 'number' ? saved.chapter : 0;
        if (savedVersionId) setVersionId(normalizeVersionId(savedVersionId));
        const savedBook = getBookById(savedBookId);
        if (savedBook && savedChapter >= 1 && savedChapter <= savedBook.chaptersCount) {
          setBookId(savedBookId);
          setChapter(savedChapter);
        }
      } catch {
        // Corrupted/unreadable save: keep the default Genesis 1.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Bibles tab may switch versions — pick that up on focus and refresh both
  // the reading version and the on-device version list for the switcher.
  useFocusEffect(
    useCallback(() => {
      // Bumping the tick re-runs the chapter-load effect even when the
      // coordinates are unchanged (the Bibles tab may have re-downloaded the
      // same chapter).
      setRefreshTick((tick) => tick + 1);
      void getActiveVersionId().then((id) => {
        setVersionId((previous) => (previous === id ? previous : id));
      });
      void getInstalledVersions().then((metas) => {
        setInstalledVersions(metas);
      }).catch(() => undefined);
    }, []),
  );

  /** Quick-switch to another on-device version from the top-left pill.
   *
   * FIX 3 — the switch is SYNCHRONOUS on the very first tap: any in-flight
   * load for the old version is invalidated (`loadRequestIdRef` bump), the
   * old chapter/selection is cleared immediately, the new id is committed to
   * state before returning, and persistence happens fire-and-forget in the
   * background. The chapter-load effect then runs with the NEW version id in
   * its closure, so `loadChapterVerses` is always called with the tapped
   * version — never a stale Tamil-BSI closure — and no repeat-tap is needed.
   */
  const handleSwitchVersion = useCallback(
    (meta: BibleVersionMeta) => {
      setSwitcherOpen(false);
      const newVersionId = normalizeVersionId(meta.id);
      const activeId = normalizeVersionId(versionId);
      // Same version tapped again: nothing to reload — keep the open chapter.
      if (newVersionId === activeId) return;
      loadRequestIdRef.current += 1;
      setVerses([]);
      setSelectedVerses([]);
      setHighlights([]);
      setReadState(NO_READ_STATE);
      setCurrentVisibleVerse(1);
      setError(null);
      setIsLoadingChapter(true);
      setVersionId(newVersionId);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      void setActiveVersionId(newVersionId).catch(() => undefined);
      void AsyncStorage.setItem('@progress_selected_version', newVersionId).catch(() => undefined);
    },
    [versionId],
  );

  // Persist the reading position so the app reopens where the user left off.
  useEffect(() => {
    void AsyncStorage
      .setItem(LAST_POSITION_KEY, JSON.stringify({ versionId, bookId, chapter }))
      .catch(() => undefined);
  }, [versionId, bookId, chapter]);

  // Fresh chapter list starts scrolled to the top with a clean slate (the
  // chapter loader also resets verse state; this only scrolls the window).
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [bookId, chapter, versionId]);

  /**
   * FIX 4 — the current book's chapter count comes from the ACTIVE version's
   * manifest when it is known (BTD John = 21, not a canonical filler), so the
   * reader's Next/Prev edges line up with the text that version really has.
   */
  const currentChapterCount = useMemo(() => {
    const entry = versionManifest?.find((item) => item.bookId === bookId);
    return entry && entry.chapters > 0 ? entry.chapters : currentBook.chaptersCount;
  }, [bookId, currentBook.chaptersCount, versionManifest]);

  /** Neighbour books INSIDE the version's manifest (skips books it lacks). */
  const manifestNeighbours = useMemo(() => {
    if (!versionManifest || versionManifest.length === 0) return { previous: null, next: null };
    const index = versionManifest.findIndex((item) => item.bookId === bookId);
    return {
      previous: index > 0 ? versionManifest[index - 1] : null,
      next: index >= 0 && index < versionManifest.length - 1 ? versionManifest[index + 1] : null,
    };
  }, [bookId, versionManifest]);

  const canGoPrevious = chapter > 1 ||
    Boolean(manifestNeighbours.previous) ||
    (versionManifest === null && bookId > FIRST_BOOK_ID);
  const canGoNext = chapter < currentChapterCount ||
    Boolean(manifestNeighbours.next) ||
    (versionManifest === null && bookId < LAST_BOOK_ID);

  const goToPreviousChapter = useCallback(() => {
    if (chapter > 1) {
      setChapter(chapter - 1);
      return;
    }
    const previous = manifestNeighbours.previous;
    if (previous) {
      setBookId(previous.bookId);
      setChapter(Math.max(1, previous.chapters));
      return;
    }
    const previousBook = getBookById(bookId - 1);
    if (previousBook && versionManifest === null) {
      setBookId(previousBook.id);
      setChapter(previousBook.chaptersCount);
    }
  }, [bookId, chapter, manifestNeighbours.previous, versionManifest]);

  const goToNextChapter = useCallback(() => {
    if (chapter < currentChapterCount) {
      setChapter(chapter + 1);
      return;
    }
    const next = manifestNeighbours.next;
    if (next) {
      setBookId(next.bookId);
      setChapter(1);
      return;
    }
    const nextBook = getBookById(bookId + 1);
    if (nextBook && versionManifest === null) {
      setBookId(nextBook.id);
      setChapter(1);
    }
  }, [bookId, chapter, currentChapterCount, manifestNeighbours.next, versionManifest]);

  /** Picker rows: canonical book object paired with the manifest entry. */
  const pickerBooks = useMemo<PickerBookItem[]>(() => {
    if (!versionManifest) return [];
    const items: PickerBookItem[] = [];
    versionManifest.forEach((manifest) => {
      const book = getBookById(manifest.bookId);
      if (book) items.push({ book, manifest });
    });
    return items;
  }, [versionManifest]);

  /**
   * One canonical SQLite scan per opened book keeps the picker header's
   * `{readCount}/{totalChapters} read` line live (verse-aware, any version).
   */
  const loadPickerReadCount = useCallback((id: number) => {
    const normalizedId = normalizeVersionId(versionId);
    void getVersionProgressSummary(normalizedId)
      .then((summary) => {
        setPickerReadCounts((previous) => ({
          ...previous,
          [id]: summary[id]?.readChapters.length ?? 0,
        }));
      })
      .catch(() => undefined);
  }, [versionId]);

  const openPicker = useCallback(() => {
    setPickerBook(currentBook);
    const entry = versionManifest?.find((item) => item.bookId === currentBook.id);
    const chapterCount = entry?.chapters ?? 0;
    // FIX 4 — open on the chapter grid, but never on an empty one: if the
    // manifest is still loading (or the current book is not in this version)
    // start on the version's own book list instead.
    setPickerChapterCount(chapterCount);
    setPickerStage(chapterCount > 0 ? 'chapters' : 'books');
    setBookSearchQuery('');
    setPickerOpen(true);
    loadPickerReadCount(currentBook.id);
  }, [currentBook, loadPickerReadCount, versionManifest]);

  const filteredBooks = useMemo(() => {
    const q = bookSearchQuery.trim().toLowerCase();
    if (!q) return null;
    return pickerBooks.filter(({ book, manifest }) => {
      const names = localizedBook(book.id);
      return (
        names.primaryName.toLowerCase().includes(q) ||
        names.secondaryName.toLowerCase().includes(q) ||
        manifest.nativeName.toLowerCase().includes(q) ||
        manifest.englishName.toLowerCase().includes(q) ||
        book.englishName.toLowerCase().includes(q) ||
        book.shortEnglishName?.toLowerCase().includes(q)
      );
    });
  }, [bookSearchQuery, localizedBook, pickerBooks]);

  /**
   * FIX 4 — strict testament split driven by the manifest itself. A version
   * with only Gospels renders NO Old Testament section, and the UI never
   * paints 66 English fillers for a version that carries four books.
   */
  const oldTestamentBooks = useMemo(
    () => pickerBooks.filter((item) => item.manifest.testament === 'OT'),
    [pickerBooks],
  );
  const newTestamentBooks = useMemo(
    () => pickerBooks.filter((item) => item.manifest.testament === 'NT'),
    [pickerBooks],
  );

  const selectChapter = useCallback((selectedBookId: number, selectedChapter: number) => {
    setPickerOpen(false);
    setBookId(selectedBookId);
    setChapter(selectedChapter);
  }, []);

  const toggleVerseSelection = useCallback((verse: number) => {
    setSelectedVerses((previous) => previous.includes(verse)
      ? previous.filter((value) => value !== verse)
      : [...previous, verse].sort((a, b) => a - b));
  }, []);

  const findVerseHighlight = useCallback(
    (verse: number): HighlightRow | undefined =>
      highlights.find((highlight) => highlight.verse === verse),
    [highlights],
  );

  /** Apply one palette color to every selected verse in the open chapter. */
  const handleHighlightColor = useCallback((colorHex: string) => {
    if (selectedVerses.length === 0) return;
    const normalizedId = normalizeVersionId(versionId);
    const numericId = numericVersionId(normalizedId);
    const next = [...highlights];
    for (const verse of selectedVerses) {
      const existing = next.find((row) => row.verse === verse);
      if (existing) {
        if (existing.color_hex === colorHex) {
          deleteHighlight(existing.id);
          const index = next.findIndex((row) => row.id === existing.id);
          if (index >= 0) next.splice(index, 1);
        } else {
          updateHighlightColor(existing.id, colorHex);
          const index = next.findIndex((row) => row.id === existing.id);
          if (index >= 0) next[index] = { ...existing, color_hex: colorHex };
        }
        continue;
      }
      const verseText = verses.find((item) => item.verse === verse)?.text ?? '';
      addHighlight({
        version_id: numericId,
        version_key: normalizedId,
        book_id: bookId,
        book_name: currentBook.englishName,
        chapter,
        verse,
        verse_text: verseText,
        color_hex: colorHex,
        created_date: todayIsoDate(),
      });
    }
    setHighlights(getHighlightsForPassage(numericId, bookId, chapter));
    setSelectedVerses([]);
  }, [bookId, chapter, currentBook, highlights, selectedVerses, versionId, verses]);

  // --- Verse-level Mark-Read state machine --------------------------------

  const totalVerses = verses.length;
  const { isChapterRead, readVerses } = readState;

  /** Static chapter read completion progress: 100% if marked read, or proportion of read verses. Never changes on scroll. */
  const progressPercent = useMemo(() => {
    if (isChapterRead) return 100;
    if (totalVerses === 0) return 0;
    return Math.min((readVerses.length / totalVerses) * 100, 100);
  }, [isChapterRead, readVerses.length, totalVerses]);

  /** Label shown by the top-right read pill (concise, overflow-safe). */
  const markReadLabel = useMemo(() => {
    if (selectedVerses.length === 0) {
      return isChapterRead ? '✓ Read' : 'Mark Read';
    }
    const alreadyReadCount = selectedVerses.filter((verse) => readVerses.includes(verse)).length;
    if (selectedVerses.length === 1) {
      return readVerses.includes(selectedVerses[0]) ? '✓ Read' : 'Mark Read';
    }
    if (alreadyReadCount === selectedVerses.length) {
      return '✓ Read';
    }
    return `Mark Read (${selectedVerses.length})`;
  }, [isChapterRead, readVerses, selectedVerses]);

  /** Re-read the persisted verse state after any write. */
  const reloadReadState = useCallback(async () => {
    const normalizedId = normalizeVersionId(versionId);
    setReadState(await getChapterReadState(normalizedId, bookId, chapter));
  }, [bookId, chapter, versionId]);

  const handleMarkReadPress = useCallback(() => {
    void (async () => {
      const normalizedId = normalizeVersionId(versionId);

      // Whole chapter (nothing selected): toggle the chapter itself.
      if (selectedVerses.length === 0) {
        await toggleChapterRead(normalizedId, bookId, chapter, totalVerses);
        setSelectedVerses([]);
        await reloadReadState();
        notifyProgressUpdated();
        return;
      }

      const targets = [...selectedVerses];
      const alreadyRead = targets.filter((verse) => readVerses.includes(verse));

      // Every selected verse is read -> unmark them (deselect afterwards).
      if (alreadyRead.length === targets.length) {
        await unmarkVersesRead(normalizedId, bookId, chapter, targets);
        await reloadReadState();
        setSelectedVerses([]);
        notifyProgressUpdated();
        return;
      }

      await markVersesRead(normalizedId, bookId, chapter, targets, totalVerses);
      await reloadReadState();
      setSelectedVerses([]);
      notifyProgressUpdated();
    })();
  }, [bookId, chapter, readVerses, reloadReadState, selectedVerses, totalVerses, versionId]);

  // --- Scroll tracking ------------------------------------------------------

  /** Stable viewability callback for current visible verse indicator. */
  const viewableItemsHandler = useCallback(
    ({ viewableItems }: { viewableItems: { item: ChapterVerse }[] }) => {
      const visibleVerses = viewableItems
        .map(({ item }) => item.verse)
        .filter((verse) => Number.isInteger(verse) && verse >= 1);
      if (visibleVerses.length === 0) return;
      const first = Math.min(...visibleVerses);
      setCurrentVisibleVerse(first);
    },
    [],
  );

  // --- Memoized verse row primitives ---------------------------------------

  const getVerseRead = useCallback(
    (verse: number) => readVerses.includes(verse),
    [readVerses],
  );

  const renderVerse = useCallback(
    ({ item }: { item: ChapterVerse }) => (
      <VerseRow
        verseNumber={item.verse}
        verseText={item.text}
        isSelected={selectedVerses.includes(item.verse)}
        isRead={getVerseRead(item.verse)}
        highlightColor={findVerseHighlight(item.verse)?.color_hex ?? null}
        isDark={theme.isDark}
        styles={styles}
        onPress={toggleVerseSelection}
      />
    ),
    [findVerseHighlight, getVerseRead, selectedVerses, styles, theme.isDark, toggleVerseSelection],
  );

  /** Stable row key so FlatList reconciles verse rows without remounting. */
  const verseKey = useCallback((item: ChapterVerse) => String(item.verse), []);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {/* Row 1 — Top Header: language+version pill (left) · read status + theme toggle (right).
          The version pill is STATIC: identical text whether or not verses are
          selected, single-line with tail ellipsis, fixed 40px height. */}
      <View style={[styles.headerRow, { paddingTop: insets.top + 6 }]}>
        <ScalePressable
          style={[styles.versionBadge, { maxWidth: Math.floor(screenWidth * 0.55) }]}
          onPress={() => setSwitcherOpen(true)}
          onLongPress={() => router.navigate('/bibles')}
          android_ripple={null}
          accessibilityRole="button"
          accessibilityLabel={`Reading ${versionBadgeLabel}. Change Bible version`}
        >
          <SelahAppIconSvg size={18} color={theme.primary} />
          {/* FIX 2 — one single-line Text directly inside the row. No nested,
              un-sized View that can collapse to 0px on Android. */}
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={styles.versionBadgeText}
          >
            {versionBadgeLabel}
          </Text>
        </ScalePressable>
        <View style={styles.headerRightControls}>
          <ScalePressable
            style={[styles.readChip, markReadLabel === '✓ Read' ? styles.readChipDone : null]}
            onPress={handleMarkReadPress}
            android_ripple={null}
            accessibilityRole="button"
            accessibilityLabel={markReadLabel === '✓ Read' ? 'Mark as unread' : 'Mark as read'}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.readChipText,
                markReadLabel === '✓ Read' ? styles.readChipTextDone : null,
              ]}
            >
              {markReadLabel}
            </Text>
          </ScalePressable>
          <ScalePressable
            style={styles.themeToggle}
            onPress={toggleTheme}
            android_ripple={null}
            accessibilityRole="button"
            accessibilityLabel="Toggle dark or light theme"
          >
            <SunMoonSvg isDark={themeMode === 'dark'} size={20} color={theme.primary} />
          </ScalePressable>
        </View>
      </View>

      {/* Row 2 — Chapter Navigation Bar: `< Prev` · live selector · `Next >` */}
      <View style={styles.chapterNavBar}>
        <ScalePressable
          style={[styles.navButton, !canGoPrevious && styles.navButtonDisabled]}
          onPress={goToPreviousChapter}
          disabled={!canGoPrevious}
          android_ripple={null}
          accessibilityRole="button"
          accessibilityLabel="Previous chapter"
        >
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={styles.navButtonLabel}
          >
            {'< Prev'}
          </Text>
        </ScalePressable>
        <ScalePressable
          style={[styles.selectorButton, { width: centerPillWidth, maxWidth: centerPillWidth }]}
          onPress={openPicker}
          android_ripple={null}
          accessibilityRole="button"
          accessibilityLabel="Choose book and chapter"
        >
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.selectorText, { width: centerPillWidth - 20 }]}
          >
            {primaryBookName} {chapter}:{Math.min(currentVisibleVerse, Math.max(totalVerses, 1))}{' '}
            <Text style={styles.selectorCaret}>▾</Text>
          </Text>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.selectorSubText, { width: centerPillWidth - 20 }]}
          >
            {totalVerses > 0
              ? `Verse ${Math.min(currentVisibleVerse, totalVerses)} of ${totalVerses}${
                  secondaryBookName ? ` · ${secondaryBookName}` : ''
                }`
              : `${secondaryBookName || currentBook.englishName} ${chapter}`}
          </Text>
        </ScalePressable>
        <ScalePressable
          style={[styles.navButton, !canGoNext && styles.navButtonDisabled]}
          onPress={goToNextChapter}
          disabled={!canGoNext}
          android_ripple={null}
          accessibilityRole="button"
          accessibilityLabel="Next chapter"
        >
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={styles.navButtonLabel}
          >
            {'Next >'}
          </Text>
        </ScalePressable>
      </View>

      {/* Thin progress bar: advances on scroll AND on mark-read */}
      <View style={styles.chapterProgressTrack}>
        <View style={[styles.chapterProgressFill, { width: `${progressPercent}%` }]} />
      </View>

      <FlatList
        ref={listRef}
        style={styles.verseList}
        contentContainerStyle={styles.verseListContent}
        data={verses}
        keyExtractor={verseKey}
        renderItem={renderVerse}
        onViewableItemsChanged={viewableItemsHandler}
        viewabilityConfig={CHAPTER_VIEWABILITY_CONFIG}
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={5}
        removeClippedSubviews={Platform.OS === 'android'}
        ListEmptyComponent={
          isLoadingChapter ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text style={styles.loadingText}>Loading scripture...</Text>
            </View>
          ) : error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Chapter unavailable</Text>
              <Text style={styles.errorMessage}>Try another Bible version or check your connection.</Text>
              <ScalePressable
                style={styles.errorButton}
                onPress={() => router.navigate('/bibles')}
                accessibilityRole="button"
              >
                <Text style={styles.errorButtonText}>Browse Bible Library</Text>
              </ScalePressable>
            </View>
          ) : undefined
        }
        ListFooterComponent={
          !isLoadingChapter && totalVerses > 0 ? (
            <Text style={styles.listEndNote}>
              {secondaryBookName || currentBook.englishName} {chapter} • {totalVerses} verses
            </Text>
          ) : undefined
        }
      />

      {/* FIX 4 — Floating highlight palette in a centered overlay: count ·
          5 evenly-distributed color dots · clear, edge to edge. */}
      {selectedVerses.length > 0 ? (
        <View style={[styles.highlightBarOverlay, { bottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.highlightBar}>
            <View style={styles.barCountBadge}>
              <Text numberOfLines={1} style={styles.barCountText}>
                {selectedVerses.length}
              </Text>
            </View>
            <View style={styles.highlightColors}>
              {HIGHLIGHT_COLORS.map((color) => {
                const active = selectedVerses.every(
                  (verse) => findVerseHighlight(verse)?.color_hex === color.hex,
                );
                return (
                  <ScalePressable
                    key={color.key}
                    style={[styles.colorDot, { backgroundColor: color.hex }, active ? styles.colorDotActive : null]}
                    onPress={() => handleHighlightColor(color.hex)}
                    accessibilityRole="button"
                    accessibilityLabel={`${color.englishName} highlight`}
                  >
                    <Text style={styles.colorDotCheck}>{active ? '✓' : ''}</Text>
                  </ScalePressable>
                );
              })}
            </View>
            <Pressable
              style={styles.highlightBarCloseBtn}
              onPress={() => setSelectedVerses([])}
              accessibilityRole="button"
              accessibilityLabel="Close highlight palette"
            >
              <Text style={styles.highlightBarClose}>{'✕'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Book & chapter selector — no dead black gap above the header */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={[styles.pickerScreen, { backgroundColor: theme.background }]}>
          <View
            style={[
              styles.pickerHeader,
              {
                paddingTop: topModalInset + 10,
                paddingBottom: 12,
                paddingHorizontal: 16,
              },
            ]}
          >
            {/* Left — round 40x40 ✕ Close button */}
            <ScalePressable
              style={styles.pickerIconButton}
              onPress={() => setPickerOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close book selector"
            >
              <Text style={styles.pickerClose}>✕</Text>
            </ScalePressable>
            {/* Center — book title + read-progress subtitle */}
            <View style={styles.pickerHeaderCenter}>
              <Text numberOfLines={1} style={styles.pickerTitle}>
                {pickerStage === 'books'
                  ? 'Select a Book'
                  : localizedBook(pickerBook?.id ?? bookId).primaryName}
              </Text>
              <Text numberOfLines={1} style={styles.pickerHeaderSubtitle}>
                {pickerStage === 'books'
                  ? `${pickerBooks.length} books • ${activeShortName}`
                  : `${pickerReadCounts[pickerBook?.id ?? bookId] ?? 0}/${pickerChapterCount} read • tap to toggle • ${activeShortName}`}
              </Text>
            </View>
            {/* Right — `< Back` pill (chapter grid stage only) */}
            {pickerStage === 'chapters' && pickerBook ? (
              <ScalePressable
                style={styles.pickerHeaderPill}
                onPress={() => setPickerStage('books')}
                accessibilityRole="button"
                accessibilityLabel="Back to book list"
              >
                <Text style={styles.pickerBack}>{'< Back'}</Text>
              </ScalePressable>
            ) : (
              <View style={styles.pickerHeaderPillSpacer} />
            )}
          </View>

          {pickerStage === 'books' || pickerBook === null ? (
            <View style={{ flex: 1 }}>
              <View style={styles.bookSearchRow}>
                <TextInput
                  style={styles.bookSearchInput}
                  placeholder="Search books..."
                  placeholderTextColor={theme.isDark ? '#8E8E93' : '#687076'}
                  value={bookSearchQuery}
                  onChangeText={setBookSearchQuery}
                  autoCorrect={false}
                />
                {bookSearchQuery.length > 0 ? (
                  <Pressable
                    style={styles.searchClearBtn}
                    onPress={() => setBookSearchQuery('')}
                    accessibilityRole="button"
                    accessibilityLabel="Clear book search"
                  >
                    <Text style={styles.searchClearText}>✕</Text>
                  </Pressable>
                ) : null}
              </View>
              <ScrollView contentContainerStyle={styles.pickerBookList}>
                {filteredBooks ? (
                  filteredBooks.map(({ book, manifest }) => {
                    const isCurrent = book.id === bookId;
                    return (
                      <ScalePressable
                        key={book.id}
                        style={[styles.pickerBookRow, isCurrent ? styles.pickerBookRowActive : null]}
                        onPress={() => {
                          setPickerBook(book);
                          setPickerChapterCount(manifest.chapters);
                          setPickerStage('chapters');
                          loadPickerReadCount(book.id);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${manifest.englishName || manifest.nativeName}, ${manifest.chapters} chapters`}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.pickerBookPrimary,
                            isCurrent ? styles.pickerBookTextActive : null,
                          ]}
                        >
                          {manifest.nativeName}
                        </Text>
                        {/* FIX 4 — the version's own native name on the left,
                            canonical English name on the right. */}
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.pickerBookSecondary,
                            isCurrent ? styles.pickerBookTextActive : null,
                          ]}
                        >
                          {manifest.englishName}
                        </Text>
                      </ScalePressable>
                    );
                  })
                ) : (
                  ([
                    { key: 'ot', label: activeBookNames.otLabel, books: oldTestamentBooks },
                    { key: 'nt', label: activeBookNames.ntLabel, books: newTestamentBooks },
                  ] as const).map((section) => {
                    // FIX 4 — render each testament section only when the
                    // active version actually carries books in that range.
                    if (section.books.length === 0) return null;
                    return (
                      <View key={section.key}>
                        <Text style={styles.pickerSectionLabel}>{section.label}</Text>
                        {section.books.map(({ book, manifest }) => {
                          const isCurrent = book.id === bookId;
                          return (
                            <ScalePressable
                              key={book.id}
                              style={[styles.pickerBookRow, isCurrent ? styles.pickerBookRowActive : null]}
                              onPress={() => {
                                setPickerBook(book);
                                setPickerChapterCount(manifest.chapters);
                                setPickerStage('chapters');
                                loadPickerReadCount(book.id);
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={`${manifest.englishName || manifest.nativeName}, ${manifest.chapters} chapters`}
                            >
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.pickerBookPrimary,
                                  isCurrent ? styles.pickerBookTextActive : null,
                                ]}
                              >
                                {manifest.nativeName}
                              </Text>
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.pickerBookSecondary,
                                  isCurrent ? styles.pickerBookTextActive : null,
                                ]}
                              >
                                {manifest.englishName}
                              </Text>
                            </ScalePressable>
                          );
                        })}
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.pickerChapterWrap}>
              <View style={styles.chapterGrid}>
                {Array.from({ length: pickerChapterCount }, (_, index) => index + 1).map(
                  (chapterNumber) => {
                    const isCurrent = pickerBook.id === bookId && chapterNumber === chapter;
                    const names = localizedBook(pickerBook.id);
                    return (
                      <ScalePressable
                        key={chapterNumber}
                        style={[
                          styles.chapterCell,
                          { width: tileWidth, height: 50, borderRadius: 14 },
                          isCurrent ? styles.chapterCellActive : null,
                        ]}
                        onPress={() => selectChapter(pickerBook.id, chapterNumber)}
                        accessibilityRole="button"
                        accessibilityLabel={`${names.secondaryName || names.primaryName} chapter ${chapterNumber}`}
                      >
                        <Text style={[styles.chapterCellText, isCurrent ? styles.chapterCellTextActive : null]}>
                          {chapterNumber}
                        </Text>
                      </ScalePressable>
                    );
                  },
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Quick version switcher (top-left pill): every version on this device */}
      <Modal visible={switcherOpen} transparent animationType="fade" onRequestClose={() => setSwitcherOpen(false)}>
        <View style={[styles.switcherOverlay, { paddingTop: topModalInset }]}>
          <Pressable style={styles.switcherTouch} onPress={() => setSwitcherOpen(false)} />
          <View style={styles.switcherCard}>
            <View style={styles.switcherHeader}>
              <Text style={styles.switcherTitle}>Choose Version</Text>
              <Pressable
                onPress={() => {
                  setSwitcherOpen(false);
                  router.push('/(tabs)/bibles');
                }}
                accessibilityRole="button"
                accessibilityLabel="Open full version manager"
              >
                <Text style={styles.switcherManageText}>Manage</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.switcherList} contentContainerStyle={styles.switcherListContent}>
              {installedVersions.map((meta) => {
                const active = meta.id === normalizeVersionId(versionId);
                return (
                  <ScalePressable
                    key={meta.id}
                    style={[styles.switcherRow, active ? styles.versionRowActive : null]}
                    onPress={() => handleSwitchVersion(meta)}
                    accessibilityRole="button"
                    accessibilityLabel={active ? `Already reading ${meta.shortName}` : `Read with ${meta.shortName}`}
                  >
                    <View style={styles.switcherLanguageBadge}>
                      <Text style={styles.switcherLanguageText}>
                        {meta.language || '—'}
                      </Text>
                    </View>
                    <View style={styles.switcherMeta}>
                      <Text numberOfLines={1} style={styles.switcherName}>
                        {meta.name}
                      </Text>
                      <Text numberOfLines={1} style={styles.switcherSub}>
                        {meta.shortName}
                      </Text>
                    </View>
                    <Text style={styles.switcherTag}>
                      {active ? 'Active ✓' : 'Use'}
                    </Text>
                  </ScalePressable>
                );
              })}
            </ScrollView>
            <ScalePressable
              style={styles.switcherDownloadRow}
              onPress={() => {
                setSwitcherOpen(false);
                router.push('/(tabs)/bibles');
              }}
              accessibilityRole="button"
              accessibilityLabel="Download more Bible versions"
            >
              <Text style={styles.switcherDownloadText}>+ Download More Versions</Text>
            </ScalePressable>
          </View>
        </View>
      </Modal>

      {/* First-launch setup overlay: materializes the 66-book Tamil BSI offline */}
      {setupState !== 'ready' ? (
        <View style={[styles.setupOverlay, { backgroundColor: theme.background, paddingTop: Math.max(insets.top, 28) + 8, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <SelahAppIconSvg size={84} color={theme.primary} />
          <Text style={[styles.setupTitle, { color: theme.text }]}>
            Setting up Tamil BSI Bible (66 Books) for Offline Reading...
          </Text>
          {setupState === 'error' ? (
            <View style={styles.setupErrorCard}>
              <Text style={styles.setupErrorText}>
                {setupError ?? 'Something went wrong while setting up the Bible.'}
              </Text>
              <ScalePressable
                style={styles.setupRetryButton}
                onPress={runSetup}
                accessibilityRole="button"
                accessibilityLabel="Retry Tamil BSI setup"
              >
                <Text style={styles.setupRetryText}>Retry</Text>
              </ScalePressable>
            </View>
          ) : (
            <>
              <View style={styles.setupProgressTrack}>
                <View style={[styles.setupProgressFill, { width: `${setupPct}%` }]} />
              </View>
              <View style={styles.setupMetaRow}>
                <Text style={styles.setupPctText}>{setupPct}%</Text>
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// VerseRow — memoized verse item driven ONLY by primitive props (plus stable
// callbacks), so the big scripture FlatList re-renders the two or three rows
// that changed instead of the whole chapter (fixes the VirtualizedList
// "large list that is slow to update" warning).
// ---------------------------------------------------------------------------

interface VerseRowProps {
  verseNumber: number;
  verseText: string;
  isSelected: boolean;
  isRead: boolean;
  highlightColor: string | null;
  isDark: boolean;
  styles: ReturnType<typeof makeStyles>;
  onPress: (verse: number) => void;
}

const VerseRow = memo(function VerseRow({
  verseNumber,
  verseText,
  isSelected,
  isRead,
  highlightColor,
  isDark,
  styles,
  onPress,
}: VerseRowProps) {
  const highlightStyle = highlightColor ? getHighlightStyle(highlightColor, isDark) : null;
  return (
    <Pressable
      style={[
        styles.verseRow,
        highlightStyle
          ? {
              backgroundColor: highlightStyle.backgroundColor,
              borderLeftWidth: 3,
              borderLeftColor: highlightStyle.borderColor,
            }
          : null,
        isSelected ? styles.verseRowSelected : null,
      ]}
      onPress={() => onPress(verseNumber)}
      accessibilityRole="button"
      accessibilityLabel={`Verse ${verseNumber}${isSelected ? ', selected' : ''}${isRead ? ', read' : ''}`}
      accessibilityState={{ selected: isSelected }}
    >
      <View style={styles.verseLine}>
        {/* Symmetric 32x28 badge wrap: the 28x28 verse badge never resizes, and
            the read check sits outside it so digits keep their position. */}
        <View style={styles.verseBadgeWrap}>
          <View style={[styles.verseBadge, isRead ? styles.verseBadgeRead : null]}>
            <Text style={[styles.verseNumber, isRead ? styles.verseNumberRead : null]}>
              {verseNumber}
            </Text>
          </View>
          {isRead ? (
            <View style={[styles.verseReadCheckBadge, isDark ? styles.verseReadCheckBadgeDark : null]}>
              <Svg width={7} height={7} viewBox="0 0 12 12">
                <Path
                  d="M2.5 6L5 8.5L9.5 3.5"
                  stroke="#FFFFFF"
                  strokeWidth={1.8}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
          ) : null}
        </View>
        <Text
          style={[styles.verseText, highlightStyle ? { color: highlightStyle.textColor } : null]}
        >
          {verseText}
        </Text>
      </View>
    </Pressable>
  );
});

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1 },
    // Row 1 — Top Header (status-bar inset is the inline paddingTop)
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      minHeight: 48,
      paddingHorizontal: 14,
      paddingBottom: 6,
      backgroundColor: theme.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    headerRightControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 0,
    },
    versionBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 40,
      minWidth: 135,
      paddingHorizontal: 12,
      borderRadius: 20,
      gap: 7,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    versionBadgeText: {
      fontSize: 13.5,
      fontWeight: '700',
      color: theme.text,
      flexShrink: 1,
    },
    readChip: {
      height: 36,
      paddingHorizontal: 12,
      borderRadius: 18,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.surfaceMuted,
    },
    readChipDone: { backgroundColor: theme.surfaceMuted, borderColor: theme.border },
    readChipText: { color: theme.primary, fontSize: 12, fontWeight: '700' },
    readChipTextDone: { color: '#16A34A' },
    themeToggle: {
      width: 36,
      height: 36,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Row 2 — Chapter Navigation Bar (FIX 2): the bar adds up to exactly
    // `sideBtnWidth + gap + centerPillWidth + gap + sideBtnWidth + rowPadding`
    // because every child is sized with explicit pixels, so `Next >` can never
    // be pushed off-screen.
    chapterNavBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      paddingHorizontal: 12,
      paddingVertical: 6,
      gap: 8,
      backgroundColor: theme.surface,
    },
    navButton: {
      width: 66,
      height: 42,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      backgroundColor: theme.surfaceMuted,
    },
    navButtonDisabled: { opacity: 0.35 },
    navButtonLabel: {
      color: theme.text,
      fontSize: 13,
      lineHeight: 16,
      fontWeight: '700',
      textAlign: 'center',
    },
    selectorButton: {
      height: 44,
      borderRadius: 14,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: theme.surfaceMuted,
    },
    selectorText: {
      color: theme.text,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '700',
      textAlign: 'center',
    },
    selectorSubText: {
      color: theme.textMuted,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: '600',
      textAlign: 'center',
    },
    selectorCaret: { color: theme.textMuted, fontSize: 12 },
    // Thin static progress bar under Row 2
    chapterProgressTrack: {
      height: 3,
      width: '100%',
      borderRadius: 99,
      overflow: 'hidden',
      backgroundColor: theme.surfaceMuted,
      marginTop: 6,
      marginBottom: 6,
    },
    chapterProgressFill: {
      height: '100%',
      borderRadius: 99,
      backgroundColor: theme.primary,
    },
    bookSearchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 16,
      marginTop: 8,
      marginBottom: 10,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 12,
    },
    bookSearchInput: {
      flex: 1,
      height: 40,
      fontSize: 14,
      color: theme.text,
    },
    searchClearBtn: {
      padding: 6,
      justifyContent: 'center',
      alignItems: 'center',
    },
    searchClearText: {
      fontSize: 14,
      color: theme.textMuted,
      fontWeight: '600',
    },
    switcherOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'flex-start',
      padding: 16,
    },
    switcherTouch: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    switcherCard: {
      width: '100%',
      maxWidth: 380,
      borderRadius: 14,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 10,
      maxHeight: '70%',
    },
    switcherHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
      paddingBottom: 8,
    },
    switcherTitle: { color: theme.text, fontSize: 15, fontWeight: '700', lineHeight: 22 },
    switcherManageText: { color: theme.primary, fontSize: 13, fontWeight: '700' },
    switcherList: { flexGrow: 0 },
    switcherListContent: { paddingBottom: 8 },
    switcherRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      padding: 10,
      marginTop: 6,
    },
    versionRowActive: { borderColor: theme.primary },
    switcherLanguageBadge: {
      alignSelf: 'flex-start',
      flexShrink: 1,
      borderRadius: 6,
      backgroundColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      paddingHorizontal: 6,
      paddingVertical: 3,
    },
    switcherLanguageText: { color: theme.textMuted, fontSize: 11, fontWeight: '600' },
    switcherMeta: { flex: 1, gap: 2 },
    switcherName: { color: theme.text, fontSize: 14, fontWeight: '700' },
    switcherSub: { color: theme.textMuted, fontSize: 12 },
    switcherTag: { color: theme.primary, fontSize: 12, fontWeight: '700' },
    switcherDownloadRow: {
      marginTop: 8,
      minHeight: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    switcherDownloadText: { color: theme.primary, fontSize: 14, fontWeight: '700' },
    verseList: { flex: 1 },
    verseListContent: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 96 },
    loadingCard: {
      marginTop: 32,
      alignItems: 'center',
      gap: 12,
    },
    loadingText: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    listEndNote: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '600',
      textAlign: 'center',
      paddingTop: 10,
    },
    verseRow: {
      paddingVertical: 7,
      paddingHorizontal: 6,
      borderRadius: 8,
    },
    verseRowSelected: { backgroundColor: theme.surfaceMuted },
    verseLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
    // Fixed 32x28 wrap so the digit badge never resizes; check floats outside.
    verseBadgeWrap: {
      width: 32,
      height: 28,
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
      marginRight: 12,
      marginTop: 2,
    },
    verseBadge: {
      width: 28,
      height: 28,
      borderRadius: 9,
      backgroundColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    verseBadgeRead: {
      backgroundColor: theme.isDark ? 'rgba(16,185,129,0.18)' : '#D1FAE5',
      borderWidth: 1.5,
      borderColor: '#10B981',
    },
    verseNumber: { color: theme.primary, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
    verseNumberRead: { color: '#059669' },
    verseReadCheckBadge: {
      position: 'absolute',
      top: -4,
      right: -4,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: '#10B981',
      borderWidth: 1,
      borderColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    verseReadCheckBadgeDark: { borderColor: theme.background },
    verseText: { flex: 1, fontSize: 17, lineHeight: 28, color: theme.text },
    errorCard: {
      marginTop: 24,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 16,
      gap: 8,
    },
    errorTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
    errorMessage: { color: theme.textMuted, fontSize: 14, lineHeight: 20 },
    errorButton: {
      marginTop: 4,
      alignSelf: 'flex-start',
      borderRadius: 10,
      backgroundColor: theme.primary,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    errorButtonText: { color: theme.primaryForeground, fontWeight: '600', fontSize: 14 },
    // FIX 4 — full-width overlay wrapper; the pill inside is centered and
    // distributes count · dots · clear evenly from edge to edge.
    highlightBarOverlay: {
      position: 'absolute',
      left: 16,
      right: 16,
      alignItems: 'center',
    },
    highlightBar: {
      width: '100%',
      maxWidth: 420,
      height: 56,
      paddingHorizontal: 18,
      borderRadius: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      elevation: 6,
      shadowColor: '#000',
      shadowOpacity: 0.14,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    barCountBadge: {
      minWidth: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingHorizontal: 6,
    },
    barCountText: {
      color: theme.primaryForeground,
      fontSize: 13,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    highlightColors: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-evenly',
      flex: 1,
      marginHorizontal: 12,
    },
    colorDot: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
    },
    colorDotActive: {
      borderColor: theme.text,
      borderWidth: 2,
    },
    colorDotCheck: { fontSize: 14, fontWeight: '800', color: '#1B1F27' },
    highlightBarCloseBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    highlightBarClose: { color: theme.textMuted, fontSize: 15, fontWeight: '700' },
    pickerScreen: { flex: 1 },
    // Unified 3-column non-overlapping modal header (✕ · title · `< Back`)
    pickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      backgroundColor: theme.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    pickerIconButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    pickerHeaderCenter: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    pickerHeaderSubtitle: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '600',
      textAlign: 'center',
      marginTop: 2,
    },
    pickerHeaderPill: {
      minWidth: 64,
      height: 36,
      paddingHorizontal: 12,
      borderRadius: 18,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    pickerHeaderPillSpacer: { minWidth: 64, height: 36, flexShrink: 0 },
    pickerClose: { color: theme.text, fontSize: 17, fontWeight: '700', lineHeight: 20 },
    pickerTitle: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '800',
      textAlign: 'center',
    },
    pickerBack: { color: theme.primary, fontSize: 14, fontWeight: '600' },
    pickerBookList: { paddingHorizontal: 16, paddingBottom: 32 },
    pickerSectionLabel: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '700',
      marginTop: 12,
      marginBottom: 4,
    },
    pickerBookRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderRadius: 8,
    },
    pickerBookRowActive: { backgroundColor: theme.surfaceMuted },
    pickerBookPrimary: { flex: 1, color: theme.text, fontSize: 16, fontWeight: '600' },
    pickerBookSecondary: {
      flex: 1,
      color: theme.textMuted,
      fontSize: 14,
      textAlign: 'right',
    },
    pickerBookTextActive: { color: theme.primary, fontWeight: '700' },
    pickerChapterWrap: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
    // Rounded squircle 5-column chapter tiles (unified with Progress tab)
    chapterGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    chapterCell: {
      borderWidth: 1.5,
      borderColor: theme.isDark ? '#283548' : '#E2E8F0',
      backgroundColor: theme.isDark ? '#172033' : '#F1F5F9',
      alignItems: 'center',
      justifyContent: 'center',
    },
    chapterCellActive: { backgroundColor: theme.primary, borderColor: theme.primary },
    chapterCellText: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    chapterCellTextActive: { color: '#FFFFFF', fontWeight: '800' },
    setupOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 18,
      paddingHorizontal: 28,
    },
    setupTitle: {
      fontSize: 16,
      fontWeight: '700',
      lineHeight: 24,
      textAlign: 'center',
    },
    setupProgressTrack: {
      width: '86%',
      maxWidth: 320,
      height: 8,
      borderRadius: 99,
      overflow: 'hidden',
      backgroundColor: theme.surfaceMuted,
    },
    setupProgressFill: {
      height: '100%',
      borderRadius: 99,
      backgroundColor: theme.primary,
    },
    setupMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    setupPctText: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      minWidth: 42,
    },
    setupErrorCard: {
      width: '100%',
      maxWidth: 320,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 16,
      gap: 12,
    },
    setupErrorText: { color: theme.textMuted, fontSize: 13, lineHeight: 19 },
    setupRetryButton: {
      minHeight: 44,
      borderRadius: 10,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
    },
    setupRetryText: { color: theme.primaryForeground, fontSize: 15, fontWeight: '700' },
  });
}
