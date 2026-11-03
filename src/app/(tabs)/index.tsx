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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/constants/ThemeContext';
import { HIGHLIGHT_COLORS, getHighlightStyle, type AppTheme } from '@/constants/colors';
import {
  BIBLE_BOOKS,
  getBooksByTestament,
  getBookById,
  getLocalizedBookName,
  type BibleBook,
  type BookLanguageVersionMeta,
} from '@/constants/books';
import { ScalePressable } from '@/components/ScalePressable';
import { SunMoonSvg } from '@/components/SvgIcons';
import SelahAppIconSvg from '@/components/SelahAppIconSvg';
import {
  DEFAULT_TAMIL_BSI_META,
  ensureDefaultTamilBsiInstalled,
  getActiveVersionId,
  getInstalledVersions,
  getVersionBookNames,
  isBundledVersionId,
  isTamilBsiDiskReady,
  languageShortCode,
  loadChapterVerses,
  normalizeVersionId,
  setActiveVersionId,
  TAMIL_BSI_ID,
  type BibleVersionMeta,
  type ChapterVerse,
} from '@/db/bibleLoader';
import {
  addHighlight,
  deleteHighlight,
  getChapterReadState,
  getHighlightsForPassage,
  markVersesRead,
  toggleChapterRead,
  unmarkVersesRead,
  updateHighlightColor,
  type ChapterReadState,
  type HighlightRow,
} from '@/db/database';

const LAST_POSITION_KEY = 'bible.reader.lastPosition';
const FIRST_BOOK_ID = 1;
const LAST_BOOK_ID = 66;
const INITIAL_BOOK_ID = 1;
const INITIAL_CHAPTER = 1;
const CHAPTER_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 30 };

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
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<HighlightRow[]>([]);
  const [readState, setReadState] = useState<ChapterReadState>(NO_READ_STATE);
  /** First verse visible in the list — the live "reading position". */
  const [currentVisibleVerse, setCurrentVisibleVerse] = useState(1);
  /** Highest verse the user has scrolled to / marked read in this chapter. */
  const [chapterProgress, setChapterProgress] = useState(0);
  const [selectedVerses, setSelectedVerses] = useState<number[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerStage, setPickerStage] = useState<'books' | 'chapters'>('books');
  const [pickerBook, setPickerBook] = useState<BibleBook | null>(null);
  /** Bumped on every tab focus so returning from Bibles refreshes chapter data. */
  const [refreshTick, setRefreshTick] = useState(0);
  /** Quick version switcher (top-left pill): every version on this device. */
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [installedVersions, setInstalledVersions] = useState<BibleVersionMeta[]>([]);

  const loadTokenRef = useRef(0);
  const listRef = useRef<FlatList<ChapterVerse> | null>(null);

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

  /** Localized resolver for THIS active version (primary/secondary names). */
  const localizedBook = useCallback(
    (id: number) => getLocalizedBookName(id, bookNamesMeta, customBookNames),
    [bookNamesMeta, customBookNames],
  );

  const activeBookNames = localizedBook(bookId);
  const primaryBookName = activeBookNames.primaryName;
  const secondaryBookName = activeBookNames.secondaryName;

  /** Top-left pill: `[LANG] • [SHORT_NAME] ▾`, e.g. `TAM • BSI ▾`. */
  const activeShortName = useMemo(() => {
    const id = normalizeVersionId(versionId);
    const meta = installedVersions.find((entry) => (entry.id ?? '') === id || entry.id === versionId);
    if (meta) return meta.shortName;
    if (isBundledVersionId(id)) return DEFAULT_TAMIL_BSI_META.shortName;
    return id;
  }, [installedVersions, versionId]);
  const activeLanguageCode = languageShortCode(activeMeta);
  const versionBadgeLabel = `${activeLanguageCode} • ${activeShortName}`;

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
    if (pendingJumpVerse === null || loading || verses.length === 0) return;
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
  }, [pendingJumpVerse, loading, verses]);

  /** Load verses + per-chapter highlights/read state; token guards races. */
  const refreshChapter = useCallback(async (vid: string, bid: number, chap: number) => {
    const normalizedId = normalizeVersionId(vid);
    const token = ++loadTokenRef.current;
    // Yield before touching state so effect bodies never render cascade.
    await Promise.resolve();
    if (loadTokenRef.current !== token) return;

    setLoading(true);
    setError(null);
    setVerses([]);
    setSelectedVerses([]);
    setCurrentVisibleVerse(1);
    setChapterProgress(0);

    try {
      const loaded = await loadChapterVerses(normalizedId, bid, chap);
      if (loadTokenRef.current !== token) return;
      setVerses(loaded);
    } catch (err) {
      if (loadTokenRef.current !== token) return;
      setError(
        err instanceof Error ? err.message : 'Could not load this chapter. Try another version.',
      );
    } finally {
      if (loadTokenRef.current === token) setLoading(false);
    }

    const numericId = numericVersionId(normalizedId);
    setHighlights(getHighlightsForPassage(numericId, bid, chap));
    setReadState(await getChapterReadState(normalizedId, bid, chap));
  }, []);

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

  // Reload whenever the version, book, chapter changes or the tab refocuses.
  // Deferred via timer so the effect body never flips state synchronously.
  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshChapter(versionId, bookId, chapter);
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshChapter, versionId, bookId, chapter, refreshTick]);

  // Bibles tab may switch versions — pick that up on focus and refresh both
  // the reading version and the on-device version list for the switcher.
  useFocusEffect(
    useCallback(() => {
      setRefreshTick((tick) => tick + 1);
      void getActiveVersionId().then((id) => {
        setVersionId((previous) => (previous === id ? previous : id));
      });
      void getInstalledVersions().then((metas) => {
        setInstalledVersions(metas);
      }).catch(() => undefined);
    }, []),
  );

  /** Quick-switch to another on-device version from the top-left pill. */
  const handleSwitchVersion = useCallback(
    (meta: BibleVersionMeta) => {
      setSwitcherOpen(false);
      void setActiveVersionId(meta.id).then(() => {
        setVersionId(normalizeVersionId(meta.id));
      });
    },
    [],
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

  const canGoPrevious = bookId > FIRST_BOOK_ID || chapter > 1;
  const canGoNext = bookId < LAST_BOOK_ID || chapter < currentBook.chaptersCount;

  const goToPreviousChapter = useCallback(() => {
    if (chapter > 1) {
      setChapter(chapter - 1);
      return;
    }
    const previousBook = getBookById(bookId - 1);
    if (previousBook) {
      setBookId(previousBook.id);
      setChapter(previousBook.chaptersCount);
    }
  }, [bookId, chapter]);

  const goToNextChapter = useCallback(() => {
    if (chapter < currentBook.chaptersCount) {
      setChapter(chapter + 1);
      return;
    }
    const nextBook = getBookById(bookId + 1);
    if (nextBook) {
      setBookId(nextBook.id);
      setChapter(1);
    }
  }, [bookId, chapter, currentBook]);

  const openPicker = useCallback(() => {
    setPickerBook(currentBook);
    setPickerStage('chapters');
    setPickerOpen(true);
  }, [currentBook]);

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

  const handleRemoveHighlight = useCallback(() => {
    if (selectedVerses.length === 0) return;
    const selected = new Set(selectedVerses);
    for (const highlight of highlights) {
      if (selected.has(highlight.verse)) deleteHighlight(highlight.id);
    }
    setHighlights((previous) => previous.filter((row) => !selected.has(row.verse)));
    setSelectedVerses([]);
  }, [highlights, selectedVerses]);

  // --- Verse-level Mark-Read state machine --------------------------------

  const totalVerses = verses.length;
  const { isChapterRead, readVerses } = readState;

  /** Live chapter progress: max(first visible verse, verses marked read). */
  const progressPercent = useMemo(() => {
    if (totalVerses === 0) return 0;
    const farthest = Math.max(chapterProgress, readVerses.length);
    return Math.min((farthest / totalVerses) * 100, 100);
  }, [chapterProgress, readVerses.length, totalVerses]);

  /** Label + state shown by the top-right read pill and the selection bar. */
  const { markReadLabel, markReadHandled } = useMemo(() => {
    if (selectedVerses.length === 0) {
      return { markReadLabel: isChapterRead ? '✓ Read' : 'Mark Read', markReadHandled: isChapterRead };
    }
    const alreadyReadCount = selectedVerses.filter((verse) => readVerses.includes(verse)).length;
    if (selectedVerses.length === 1) {
      const target = selectedVerses[0];
      const isRead = readVerses.includes(target);
      return { markReadLabel: isRead ? '✓ Read' : 'Mark Read', markReadHandled: isRead };
    }
    if (alreadyReadCount === selectedVerses.length) {
      return { markReadLabel: '✓ Read', markReadHandled: true };
    }
    if (alreadyReadCount === 0) {
      return { markReadLabel: `Mark Read (${selectedVerses.length})`, markReadHandled: false };
    }
    return { markReadLabel: 'Mark Read All Selected', markReadHandled: false };
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
        const next = await toggleChapterRead(normalizedId, bookId, chapter, totalVerses);
        setSelectedVerses([]);
        await reloadReadState();
        if (next) setChapterProgress(totalVerses);
        return;
      }

      const targets = [...selectedVerses];
      const alreadyRead = targets.filter((verse) => readVerses.includes(verse));

      // Every selected verse is read -> unmark them (deselect afterwards).
      if (alreadyRead.length === targets.length) {
        await unmarkVersesRead(normalizedId, bookId, chapter, targets);
        await reloadReadState();
        setSelectedVerses([]);
        return;
      }

      await markVersesRead(normalizedId, bookId, chapter, targets, totalVerses);
      await reloadReadState();
      const farthest = targets[targets.length - 1] ?? 0;
      setChapterProgress((previous) => Math.max(previous, farthest));
      setSelectedVerses([]);
    })();
  }, [bookId, chapter, readVerses, reloadReadState, selectedVerses, totalVerses, versionId]);

  // --- Scroll tracking ------------------------------------------------------

  /** Stable viewability callback — dependency-free useCallback so the
   *  FlatList prop stays constant across renders (state setters are stable). */
  const viewableItemsHandler = useCallback(
    ({ viewableItems }: { viewableItems: { item: ChapterVerse }[] }) => {
      const visibleVerses = viewableItems
        .map(({ item }) => item.verse)
        .filter((verse) => Number.isInteger(verse) && verse >= 1);
      if (visibleVerses.length === 0) return;
      const first = Math.min(...visibleVerses);
      setCurrentVisibleVerse(first);
      setChapterProgress((previous) => Math.max(previous, first));
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

  return (
    <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      {/* Row 1 — Top Header: language+version pill (left) · read status + theme toggle (right) */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <ScalePressable
            style={styles.versionBadge}
            onPress={() => setSwitcherOpen(true)}
            onLongPress={() => router.navigate('/bibles')}
            accessibilityRole="button"
            accessibilityLabel={`Reading ${versionBadgeLabel}. Change Bible version`}
          >
            <SelahAppIconSvg size={18} color={theme.primary} />
            <Text numberOfLines={1} style={styles.versionBadgeText}>
              {versionBadgeLabel}
            </Text>
            <Text style={styles.versionBadgeCaret}>▾</Text>
          </ScalePressable>
        </View>
        <View style={styles.headerRightControls}>
          <ScalePressable
            style={[styles.readChip, markReadLabel === '✓ Read' ? styles.readChipDone : null]}
            onPress={handleMarkReadPress}
            accessibilityRole="button"
            accessibilityLabel={markReadLabel === '✓ Read' ? 'Mark as unread' : 'Mark as read'}
          >
            <Text
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
            accessibilityRole="button"
            accessibilityLabel="Toggle dark or light theme"
          >
            <SunMoonSvg isDark={themeMode === 'dark'} size={20} color={theme.primary} />
          </ScalePressable>
        </View>
      </View>

      {/* Row 2 — Chapter Navigation Bar: prev · live book/chapter/verse · next */}
      <View style={styles.chapterNavBar}>
        <ScalePressable
          style={[styles.navButton, !canGoPrevious && styles.navButtonDisabled]}
          onPress={goToPreviousChapter}
          disabled={!canGoPrevious}
          accessibilityRole="button"
          accessibilityLabel="Previous chapter"
        >
          <Text style={styles.navButtonGlyph}>{'‹'}</Text>
          <Text style={styles.navButtonLabel}>Prev</Text>
        </ScalePressable>
        <ScalePressable
          style={styles.selectorButton}
          onPress={openPicker}
          accessibilityRole="button"
          accessibilityLabel="Choose book and chapter"
        >
          <Text numberOfLines={1} style={styles.selectorText}>
            {primaryBookName} {chapter}:{Math.min(currentVisibleVerse, Math.max(totalVerses, 1))}{' '}
            <Text style={styles.selectorCaret}>▾</Text>
          </Text>
          <Text numberOfLines={1} style={styles.selectorSubText}>
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
          accessibilityRole="button"
          accessibilityLabel="Next chapter"
        >
          <Text style={styles.navButtonGlyph}>{'›'}</Text>
          <Text style={styles.navButtonLabel}>Next</Text>
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
        keyExtractor={(item) => String(item.verse)}
        renderItem={renderVerse}
        onViewableItemsChanged={viewableItemsHandler}
        viewabilityConfig={CHAPTER_VIEWABILITY_CONFIG}
        initialNumToRender={16}
        maxToRenderPerBatch={12}
        windowSize={5}
        removeClippedSubviews={false}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.spinner} size="large" color={theme.primary} />
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
          !loading && totalVerses > 0 ? (
            <Text style={styles.listEndNote}>
              {secondaryBookName || currentBook.englishName} {chapter} • {totalVerses} verses
            </Text>
          ) : undefined
        }
      />

      {/* Floating minimal highlight palette + inline mark-read action */}
      {selectedVerses.length > 0 ? (
        <View style={[styles.highlightBar, { bottom: insets.bottom + 12 }]}>
          <ScalePressable
            style={[styles.barReadChip, markReadHandled ? styles.barReadChipDone : null]}
            onPress={handleMarkReadPress}
            accessibilityRole="button"
            accessibilityLabel={markReadHandled ? 'Unmark selected verses read' : 'Mark selected verses read'}
          >
            <Text
              style={[
                styles.barReadChipText,
                markReadHandled ? styles.barReadChipTextDone : null,
              ]}
            >
              {markReadLabel}
            </Text>
          </ScalePressable>
          <Text numberOfLines={1} style={styles.highlightBarLabel}>
            {primaryBookName} {chapter}:{selectedVerses.join(', ')}
          </Text>
          <View style={styles.highlightColors}>
            {HIGHLIGHT_COLORS.map((color) => {
              const active = selectedVerses.length > 0 && selectedVerses.every(
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
            {selectedVerses.some((verse) => findVerseHighlight(verse)) ? (
              <ScalePressable
                style={styles.removeButton}
                onPress={handleRemoveHighlight}
                accessibilityRole="button"
                accessibilityLabel="Remove highlights from selected verses"
              >
                <Text style={styles.removeButtonText}>Remove</Text>
              </ScalePressable>
            ) : null}
          </View>
          <Pressable
            onPress={() => setSelectedVerses([])}
            accessibilityRole="button"
            accessibilityLabel="Close highlight palette"
          >
            <Text style={styles.highlightBarClose}>{'✕'}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Book & chapter selector */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={[styles.pickerScreen, { backgroundColor: theme.background }]}>
          <View style={styles.pickerHeader}>
            <ScalePressable
              onPress={() => setPickerOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close book selector"
            >
              <Text style={styles.pickerClose}>✕</Text>
            </ScalePressable>
            <Text numberOfLines={1} style={styles.pickerTitle}>
              {pickerStage === 'books'
                ? 'Select a Book'
                : (() => {
                    const names = localizedBook(pickerBook?.id ?? bookId);
                    return `${names.primaryName} ${
                      names.secondaryName ? `(${names.secondaryName})` : ''
                    }`;
                  })()}
            </Text>
            {pickerStage === 'chapters' && pickerBook ? (
              <ScalePressable
                onPress={() => setPickerStage('books')}
                accessibilityRole="button"
                accessibilityLabel="Back to book list"
              >
                <Text style={styles.pickerBack}>{'‹ Back'}</Text>
              </ScalePressable>
            ) : (
              <View style={styles.pickerHeaderSpacer} />
            )}
          </View>

          {pickerStage === 'books' || pickerBook === null ? (
            <ScrollView contentContainerStyle={styles.pickerBookList}>
              {(['OT', 'NT'] as const).map((testament) => (
                <View key={testament}>
                  <Text style={styles.pickerSectionLabel}>
                    {testament === 'OT' ? activeBookNames.otLabel : activeBookNames.ntLabel}
                  </Text>
                  {getBooksByTestament(testament).map((book) => {
                    const isCurrent = book.id === bookId;
                    const names = localizedBook(book.id);
                    return (
                      <ScalePressable
                        key={book.id}
                        style={[styles.pickerBookRow, isCurrent ? styles.pickerBookRowActive : null]}
                        onPress={() => {
                          setPickerBook(book);
                          setPickerStage('chapters');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${names.secondaryName || names.primaryName}, ${book.chaptersCount} chapters`}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.pickerBookPrimary,
                            isCurrent ? styles.pickerBookTextActive : null,
                          ]}
                        >
                          {names.primaryName}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.pickerBookSecondary,
                            isCurrent ? styles.pickerBookTextActive : null,
                          ]}
                        >
                          {names.secondaryName}
                        </Text>
                      </ScalePressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.pickerChapterWrap}>
              <View style={styles.chapterGrid}>
                {Array.from({ length: pickerBook.chaptersCount }, (_, index) => index + 1).map(
                  (chapterNumber) => {
                    const isCurrent = pickerBook.id === bookId && chapterNumber === chapter;
                    const names = localizedBook(pickerBook.id);
                    return (
                      <ScalePressable
                        key={chapterNumber}
                        style={[styles.chapterCell, isCurrent ? styles.chapterCellActive : null]}
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
        <View style={styles.switcherOverlay}>
          <Pressable style={styles.switcherTouch} onPress={() => setSwitcherOpen(false)} />
          <View style={styles.switcherCard}>
            <View style={styles.switcherHeader}>
              <Text style={styles.switcherTitle}>Choose Version</Text>
              <Pressable
                onPress={() => {
                  setSwitcherOpen(false);
                  router.navigate('/bibles');
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
                      <Text numberOfLines={1} style={styles.switcherLanguageText}>
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
                router.navigate('/bibles');
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
        <View style={[styles.setupOverlay, { backgroundColor: theme.background }]}>
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
        <View style={styles.verseNumberBadge}>
          <Text style={styles.verseNumber}>{verseNumber}</Text>
          {isRead ? <Text style={styles.verseReadCheck}>✓</Text> : null}
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
    // Row 1 — Top Header
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      minHeight: 44,
      backgroundColor: theme.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    headerLeft: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minWidth: 0,
    },
    headerRightControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0,
    },
    versionBadge: {
      minWidth: 115,
      maxWidth: '48%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 10,
      paddingVertical: 6,
      minHeight: 38,
    },
    versionBadgeText: {
      color: theme.primary,
      fontSize: 13,
      lineHeight: 20,
      fontWeight: '800',
      flexShrink: 1,
    },
    versionBadgeCaret: { color: theme.primary, fontSize: 11, fontWeight: '700' },
    readChip: {
      minHeight: 34,
      justifyContent: 'center',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 12,
      paddingVertical: 5,
    },
    readChipDone: { backgroundColor: theme.surfaceMuted, borderColor: theme.border },
    readChipText: { color: theme.primary, fontSize: 12, fontWeight: '700' },
    readChipTextDone: { color: '#16A34A' },
    themeToggle: {
      width: 34,
      height: 34,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Row 2 — Chapter Navigation Bar
    chapterNavBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 6,
      gap: 8,
      backgroundColor: theme.surface,
    },
    navButton: {
      width: 40,
      height: 44,
      borderRadius: 12,
      backgroundColor: theme.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0,
    },
    navButtonDisabled: { opacity: 0.35 },
    navButtonGlyph: { color: theme.text, fontSize: 17, lineHeight: 20, fontWeight: '700' },
    navButtonLabel: { color: theme.textMuted, fontSize: 10, lineHeight: 12, fontWeight: '700' },
    selectorButton: {
      flex: 1,
      marginHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 0,
      minHeight: 40,
      borderRadius: 10,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 12,
      paddingVertical: 5,
    },
    selectorText: { color: theme.text, fontSize: 16, lineHeight: 22, fontWeight: '700' },
    selectorSubText: {
      color: theme.textMuted,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: '600',
    },
    selectorCaret: { color: theme.textMuted, fontSize: 12 },
    // Thin always-visible progress bar under Row 2
    chapterProgressTrack: {
      height: 3,
      borderRadius: 99,
      overflow: 'hidden',
      backgroundColor: theme.surfaceMuted,
      marginHorizontal: 10,
      marginTop: 4,
    },
    chapterProgressFill: {
      height: '100%',
      borderRadius: 99,
      backgroundColor: theme.primary,
    },
    switcherOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingTop: 60,
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
      maxWidth: 96,
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
    spinner: { marginTop: 32 },
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
    verseNumberBadge: {
      minWidth: 24,
      height: 24,
      borderRadius: 8,
      backgroundColor: theme.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
      paddingHorizontal: 4,
      gap: 1,
    },
    verseText: { flex: 1, fontSize: 17, lineHeight: 28, color: theme.text },
    verseNumber: { color: theme.primary, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
    verseReadCheck: {
      color: '#16A34A',
      fontSize: 9,
      lineHeight: 10,
      fontWeight: '800',
    },
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
    highlightBar: {
      position: 'absolute',
      left: 12,
      right: 12,
      borderRadius: 14,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      paddingVertical: 10,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    barReadChip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    barReadChipDone: { borderColor: theme.border },
    barReadChipText: { color: theme.primary, fontSize: 12, fontWeight: '800' },
    barReadChipTextDone: { color: '#16A34A' },
    highlightBarLabel: { flex: 1, color: theme.text, fontSize: 13, fontWeight: '600' },
    highlightColors: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    colorDot: {
      width: 30,
      height: 30,
      borderRadius: 999,
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
    removeButton: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    removeButtonText: { color: '#DC2626', fontWeight: '700', fontSize: 12 },
    highlightBarClose: { color: theme.textMuted, fontSize: 16, fontWeight: '600' },
    pickerScreen: { flex: 1, paddingTop: 12 },
    pickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 10,
    },
    pickerClose: { color: theme.text, fontSize: 18, fontWeight: '600' },
    pickerTitle: { flex: 1, color: theme.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    pickerBack: { color: theme.primary, fontSize: 14, fontWeight: '600' },
    pickerHeaderSpacer: { width: 44 },
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
    pickerChapterWrap: { padding: 16 },
    chapterGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chapterCell: {
      width: 56,
      height: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chapterCellActive: { backgroundColor: theme.primary, borderColor: theme.primary },
    chapterCellText: { color: theme.text, fontSize: 15, fontWeight: '600' },
    chapterCellTextActive: { color: theme.primaryForeground },
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
