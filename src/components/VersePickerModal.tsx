/**
 * Universal 4-step verse picker (Step 4).
 *
 * Step 1 — Select Bible Version: installed and available versions, with
 *          search and download support; defaults to the active one.
 * Step 2 — Select Book: searchable list of the version's OWN books, native
 *          name left / English name right, with empty testaments hidden.
 * Step 3 — Select Chapter: numeric grid for the chosen book.
 * Step 4 — Select Verse(s): tap to pick any combination of verses (tapping a
 *          nearby verse ±10 grabs the whole range), preview the scripture,
 *          optionally add a sub-note, and tap "Insert N Selected Verse(s)".
 *
 * Returns a `VersePickResult` to the caller via `onInsert`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/constants/ThemeContext';
import {
  getBookById,
  getLocalizedBookName,
  type BibleBook,
  type VersionBookMeta,
} from '@/constants/books';
import {
  getActiveVersionId,
  getDownloadedVersionSummaries,
  getVersionBooksById,
  getVersionBooksManifest,
  loadChapterVerses,
  searchDownloadedVersionsFuzzy,
  downloadBibleVersion,
  normalizeVersionId,
  type ChapterVerse,
  type DownloadedVersionSummary,
  type VersionBookManifestEntry,
} from '@/db/bibleLoader';
import { DEFAULT_VERSIONS, dropFailingVersions, filterVersions, searchOnlineTranslations, type DownloadableVersion } from '@/constants/versionCatalog';
import { PlusVerseSvg } from '@/components/SvgIcons';
import { ScalePressable } from '@/components/ScalePressable';
import { isRtlVersionMeta } from '@/constants/books';
import type { AppTheme } from '@/constants/colors';

export interface VersePickResult {
  versionId: string;
  versionShortName: string;
  /** Display language label of the chosen version, e.g. "Tamil (தமிழ்)". */
  languageName: string;
  bookId: number;
  bookName: string;
  chapter: number;
  /** '16' for a single verse, '16-18' for a range, '16-18, 20' for gaps. */
  verse: string;
  /** Scripture text of the selected verse or range. */
  text: string;
  /** Structured per-verse payload in ascending verse order. */
  verses: { verse: number; text: string }[];
  /** Optional quick sub-note typed in step 4. */
  note: string;
}

export interface VersePickerModalProps {
  visible: boolean;
  onInsert: (result: VersePickResult) => void;
  onClose: () => void;
}

type Stage = 'version' | 'books' | 'chapters' | 'verses';

/**
 * Combine picked verse numbers into a compact display label:
 * {16,17,18,20} → "16-18, 20". Keeps the `VersePickResult.verse` shape.
 */
function combineVerseNumbers(selected: Set<number>): string {
  const sorted = [...selected].sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const groups: string[] = [];
  let runStart = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const verse = sorted[i];
    if (verse === prev + 1) {
      prev = verse;
      continue;
    }
    groups.push(runStart === prev ? String(runStart) : `${runStart}-${prev}`);
    runStart = verse;
    prev = verse;
  }
  groups.push(runStart === prev ? String(runStart) : `${runStart}-${prev}`);
  return groups.join(', ');
}

/** FIX 4 — one book row: canonical book object + the version's manifest entry. */
type PickerBookRow = {
  book: BibleBook;
  manifest: VersionBookManifestEntry;
};

export default function VersePickerModal({
  visible,
  onInsert,
  onClose,
}: VersePickerModalProps) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {visible ? <VersePickerBody onInsert={onInsert} onClose={onClose} /> : null}
    </Modal>
  );
}

/**
 * The interactive picker. Mounted only while the modal is visible, so every
 * piece of step state initializes straight to its starting value at mount —
 * no sync-in-effect resets when the modal reopens.
 */
function VersePickerBody({
  onInsert,
  onClose,
}: Pick<VersePickerModalProps, 'onInsert' | 'onClose'>) {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // FIX 1: dynamic 5-column chapter grid spanning the full content width.
  const { width: screenWidth } = useWindowDimensions();
  const gridPadding = 16;
  const gridGap = 10;
  const gridCols = 5;
  const tileWidth = Math.floor(
    (screenWidth - gridPadding * 2 - gridGap * (gridCols - 1)) / gridCols,
  );

  const [stage, setStage] = useState<Stage>('version');
  const [versions, setVersions] = useState<DownloadedVersionSummary[]>([]);
  const [searchResults, setSearchResults] = useState<DownloadableVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState('tamil_bsi');
  const [versionQuery, setVersionQuery] = useState('');
  const [searchCompletedQuery, setSearchCompletedQuery] = useState('');
  const [versionSearchError, setVersionSearchError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<DownloadedVersionSummary | null>(null);
  const [bookQuery, setBookQuery] = useState('');
  const [selectedBook, setSelectedBook] = useState<BibleBook | null>(null);
  const [selectedChapter, setSelectedChapter] = useState(1);
  const [verses, setVerses] = useState<ChapterVerse[]>([]);
  const [loadingVerses, setLoadingVerses] = useState(false);
  const [verseError, setVerseError] = useState<string | null>(null);
  const [selectedVerses, setSelectedVerses] = useState<Set<number>>(new Set());
  const [note, setNote] = useState('');

  const loadTokenRef = useRef(0);
  /**
   * FIX 4 — the picked version's EXACT book manifest (`null` while loading):
   * only books the version actually carries, with its own native names and
   * true chapter counts. No canonical 66-book fillers.
   *
   * Tagged with its version id so picking another version can never render the
   * previous version's books for even one frame.
   */
  const [bookManifestState, setBookManifestState] = useState<{
    versionId: string;
    books: VersionBookManifestEntry[];
  } | null>(null);
  const bookManifest = useMemo(
    () => (selectedVersion && bookManifestState &&
      bookManifestState.versionId === normalizeVersionId(selectedVersion.id)
      ? bookManifestState.books
      : null),
    [bookManifestState, selectedVersion],
  );
  /**
   * FIX 2 — the picked version's books keyed by TRUE canonical id (USFM or
   * testament-count derived), so the book list always shows the version's own
   * native names paired with the matching canonical English names.
   */
  const [versionBooksById, setVersionBooksById] = useState<Record<number, VersionBookMeta>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const vid = selectedVersion?.id;
      if (!vid) {
        if (!cancelled) setBookManifestState(null);
        return;
      }
      const manifest = await getVersionBooksManifest(vid);
      if (!cancelled) {
        setBookManifestState({ versionId: normalizeVersionId(vid), books: manifest });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedVersion?.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const vid = selectedVersion?.id;
      if (!vid) {
        if (!cancelled) setVersionBooksById({});
        return;
      }
      const lookup = await getVersionBooksById(vid);
      if (!cancelled) setVersionBooksById(lookup);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedVersion?.id]);

  // Load the offline version library once per open. All state updates happen
  // inside the async continuation, never synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [summaries, activeId] = await Promise.all([
          getDownloadedVersionSummaries(),
          getActiveVersionId(),
        ]);
        if (cancelled) return;
        setVersions(summaries);
        setActiveVersionId(activeId);
        setSelectedVersion(
          summaries.find((item) => item.id === activeId) ?? summaries[0] ?? null,
        );
      } catch {
        if (!cancelled) setVersions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredInstalledVersions = useMemo(() => {
    const query = versionQuery.trim();
    return query ? searchDownloadedVersionsFuzzy(query, versions) : versions;
  }, [versionQuery, versions]);

  const visibleVersions = versionQuery.trim().length < 2 ? DEFAULT_VERSIONS : searchResults;
  const versionSearchBusy = versionQuery.trim().length >= 2 && searchCompletedQuery !== versionQuery.trim();

  const filteredAvailableVersions = useMemo(() => {
    const query = versionQuery.trim();
    const installedIds = new Set(versions.map((item) => normalizeVersionId(item.id)));
    const candidates = query ? filterVersions(query, visibleVersions) : visibleVersions;
    return candidates
      .filter((item) => !installedIds.has(normalizeVersionId(item.id)))
      .map((item) => ({
        id: item.id,
        versionName: item.name,
        shortName: item.shortName,
        englishName: item.englishName,
        languageName: item.languageName,
        languageCode: item.languageCode,
        isBundledStyle: item.source === 'bundled',
      }));
  }, [visibleVersions, versionQuery, versions]);

  useEffect(() => {
    const query = versionQuery.trim();
    if (query.length < 2) return;
    let cancelled = false;
    searchOnlineTranslations(query)
      .then(async (online) => {
        // Health probe before render: dead helloao ids are health-checked in
        // order, auto-recorded in `@selah_invalid_versions`, and dropped so
        // broken translations never reach the result list.
        const verified = await dropFailingVersions(online);
        if (cancelled) return;
        const combined = [...DEFAULT_VERSIONS, ...verified];
        const unique = new Map(combined.map((version) => [version.id, version]));
        setSearchResults([...unique.values()]);
        setSearchCompletedQuery(query);
        setVersionSearchError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSearchResults(DEFAULT_VERSIONS);
        setSearchCompletedQuery(query);
        setVersionSearchError(error instanceof Error ? error.message : 'Search is unavailable right now.');
      });
    return () => { cancelled = true; };
  }, [versionQuery]);

  const localizedBook = useCallback(
    (bookId: number) => {
      const meta = selectedVersion
        ? {
            id: selectedVersion.id,
            language: selectedVersion.languageName ?? '',
            languageCode: selectedVersion.languageCode,
          }
        : null;
      // FIX 2 — native names resolved from the version's own parsed JSON
      // (keyed by canonical id), so an Odia NT-only Bible shows its `Hebrews`
      // name for book 58, never an English `Psalms` fallback for position 19.
      return getLocalizedBookName(bookId, meta, null, versionBooksById);
    },
    [selectedVersion, versionBooksById],
  );

  const pickedBooks = useMemo<PickerBookRow[]>(() => {
    if (!bookManifest) return [];
    const rows: PickerBookRow[] = [];
    bookManifest.forEach((manifest) => {
      const book = getBookById(manifest.bookId);
      if (book) rows.push({ book, manifest });
    });
    return rows;
  }, [bookManifest]);

  const filteredBooks = useMemo<PickerBookRow[]>(() => {
    const q = bookQuery.trim().toLowerCase();
    return pickedBooks.filter(({ book, manifest }) => {
      if (!q) return true;
      const names = localizedBook(book.id);
      return (
        names.primaryName.toLowerCase().includes(q) ||
        names.secondaryName.toLowerCase().includes(q) ||
        manifest.nativeName.toLowerCase().includes(q) ||
        manifest.englishName.toLowerCase().includes(q) ||
        book.englishName.toLowerCase().includes(q) ||
        book.tamilName.includes(bookQuery.trim())
      );
    });
  }, [bookQuery, localizedBook, pickedBooks]);

  // FIX 4 — strict testament split driven by the manifest itself; a version
  // with only Gospels renders NO Old Testament section.
  const oldTestamentBooks = useMemo(
    () => filteredBooks.filter((row) => row.manifest.testament === 'OT'),
    [filteredBooks],
  );
  const newTestamentBooks = useMemo(
    () => filteredBooks.filter((row) => row.manifest.testament === 'NT'),
    [filteredBooks],
  );

  const selectedBookManifest = useMemo(
    () => (selectedBook && bookManifest
      ? bookManifest.find((entry) => entry.bookId === selectedBook.id)
      : undefined),
    [bookManifest, selectedBook],
  );
  const selectedBookChapterCount = selectedBookManifest?.chapters
    ?? selectedBook?.chaptersCount
    ?? 0;

  /** Load the chosen chapter from the chosen offline version. */
  const openChapter = useCallback(async (version: DownloadedVersionSummary, book: BibleBook, chapter: number) => {
    const token = ++loadTokenRef.current;
    setLoadingVerses(true);
    setVerseError(null);
    setVerses([]);
    setSelectedVerses(new Set());
    try {
      // Partial versions redirect an unavailable book/chapter to the first one
      // the version actually carries — sync the picker state to what was served.
      const loaded = await loadChapterVerses(version.id, book.id, chapter);
      if (loadTokenRef.current !== token) return;
      setVerses(loaded.verses);
      if (loaded.actualBookId !== book.id || loaded.actualChapter !== chapter) {
        const servedBook = getBookById(loaded.actualBookId);
        if (servedBook) setSelectedBook(servedBook);
        setSelectedChapter(loaded.actualChapter);
      }
    } catch (err) {
      if (loadTokenRef.current !== token) return;
      setVerseError(
        err instanceof Error ? err.message : 'Could not load this chapter.',
      );
    } finally {
      if (loadTokenRef.current === token) setLoadingVerses(false);
    }
  }, []);

  const chooseVersion = useCallback((summary: DownloadedVersionSummary) => {
    if (versions.some((item) => normalizeVersionId(item.id) === normalizeVersionId(summary.id))) {
      const installed = versions.find((item) => normalizeVersionId(item.id) === normalizeVersionId(summary.id));
      setSelectedVersion(installed ?? summary);
      // A new version means a new book list: drop the previous selection and
      // search so the step cannot show a book this version does not carry.
      setSelectedBook(null);
      setSelectedChapter(1);
      setBookQuery('');
      setStage('books');
      return;
    }
    const version = visibleVersions.find((item) => normalizeVersionId(item.id) === normalizeVersionId(summary.id));
    if (!version || downloadingId) return;
    setDownloadingId(version.id);
    setDownloadProgress((previous) => ({ ...previous, [version.id]: 0 }));
    void downloadBibleVersion(version, (event) => {
      setDownloadProgress((previous) => ({ ...previous, [version.id]: event.percent }));
    }).then(async () => {
      const summaries = await getDownloadedVersionSummaries();
      const installed = summaries.find((item) => normalizeVersionId(item.id) === normalizeVersionId(version.id));
      if (!installed) return;
      setVersions(summaries);
      setSelectedVersion(installed);
      setSelectedBook(null);
      setSelectedChapter(1);
      setBookQuery('');
      setStage('books');
    }).catch((error: unknown) => {
      setVersionSearchError(error instanceof Error ? error.message : 'Could not download this Bible.');
    }).finally(() => {
      setDownloadingId(null);
      setDownloadProgress((previous) => {
        const next = { ...previous };
        delete next[version.id];
        return next;
      });
    });
  }, [downloadingId, versions, visibleVersions]);

  const chooseBook = useCallback((book: BibleBook) => {
    setSelectedBook(book);
    setSelectedChapter(1);
    setStage('chapters');
  }, []);

  const chooseChapter = useCallback(
    (chapter: number) => {
      if (!selectedVersion || !selectedBook) return;
      setSelectedChapter(chapter);
      setStage('verses');
      void openChapter(selectedVersion, selectedBook, chapter);
    },
    [openChapter, selectedBook, selectedVersion],
  );

  /**
   * Multi-select: tap toggles one verse in or out — any combination without
   * range grabbing.
   */
  const toggleVerseSelection = useCallback((verse: number) => {
    setSelectedVerses((current) => {
      const next = new Set(current);
      if (next.has(verse)) {
        next.delete(verse);
      } else {
        next.add(verse);
      }
      return next;
    });
  }, []);

  const verseLabel = useMemo(() => combineVerseNumbers(selectedVerses), [selectedVerses]);

  /** Hebrew codices (WLC / Aleppo / Modern) read Right-to-Left automatically. */
  const pickedVersionIsRtl = useMemo(
    () => isRtlVersionMeta(selectedVersion),
    [selectedVersion],
  );

  const previewVerses = useMemo(
    () =>
      verses
        .filter((item) => selectedVerses.has(item.verse))
        .map((item) => ({ verse: item.verse, text: item.text })),
    [selectedVerses, verses],
  );

  const previewText = useMemo(() => previewVerses.map((item) => item.text).join(' '), [previewVerses]);

  const insertVerse = useCallback(() => {
    if (!selectedVersion || !selectedBook || selectedVerses.size === 0) return;
    onInsert({
      versionId: selectedVersion.id,
      versionShortName: selectedVersion.shortName,
      languageName: selectedVersion.languageName ?? '',
      bookId: selectedBook.id,
      bookName: selectedBook.englishName,
      chapter: selectedChapter,
      verse: verseLabel,
      text: previewText,
      verses: previewVerses,
      note: note.trim(),
    });
  }, [
    note,
    onInsert,
    previewText,
    previewVerses,
    selectedBook,
    selectedChapter,
    selectedVerses.size,
    selectedVersion,
    verseLabel,
  ]);

  const stageLabels: Record<Stage, string> = {
    version: 'Step 1 • Choose Version',
    books: 'Step 2 • Choose Book',
    chapters: selectedBook ? `Step 3 • ${selectedBook.englishName} Chapters` : 'Step 3 • Chapters',
    verses: selectedBook ? `Step 4 • ${selectedBook.englishName} ${selectedChapter}` : 'Step 4 • Verses',
  };

  const backTargets: Record<Stage, Stage | null> = {
    version: null,
    books: 'version',
    chapters: 'books',
    verses: 'chapters',
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {/* Header — 3-column layout so the title is 100% geometrically centered:
          LEFT (minWidth 80, flex-start): the ✕ close (root step) or the ‹ Back
          pill (sub-steps) with a `numberOfLines={1}` label that can NEVER wrap
          ("< Bac" / "k"); CENTER: the stage title; RIGHT: an invisible 80px
          spacer that optically balances the left column. */}
      <View
        style={[
          styles.header,
          {
            // The <Modal> is NOT statusBarTranslucent → Android already
            // positions it below the status bar. Padding past the status bar
            // again would paint a dead dark band above the header.
            paddingTop: Platform.OS === 'android' ? 12 : insets.top + 8,
            paddingBottom: 12,
          },
        ]}
      >
        {/* LEFT column — close or back, never narrower than 80px */}
        <View style={styles.headerSide}>
          {stage === 'version' ? (
            <Pressable
              style={styles.headerIconButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close verse picker"
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.headerBackPill}
              onPress={() => {
                const target = backTargets[stage];
                if (stage === 'verses') {
                  setVerses([]);
                  setSelectedVerses(new Set());
                }
                if (target) setStage(target);
              }}
              accessibilityRole="button"
              accessibilityLabel="Go back one step"
            >
              <Text numberOfLines={1} style={styles.backText}>‹ Back</Text>
            </Pressable>
          )}
        </View>
        {/* CENTER column — title */}
        <Text numberOfLines={1} style={styles.stageTitle}>{stageLabels[stage]}</Text>
        {/* RIGHT column — invisible balance spacer */}
        <View style={styles.headerSide} />
      </View>

      {/* Step 1 — version chooser */}
      {stage === 'version' ? (
        <>
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search Bible versions…"
              placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
              value={versionQuery}
              onChangeText={setVersionQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {versionQuery.length > 0 ? (
              <Pressable
                style={styles.searchClearBtn}
                onPress={() => setVersionQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear version search"
              >
                <Text style={styles.searchClearText}>✕</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.versionSearchStatus}>
            {versionSearchBusy ? <ActivityIndicator size="small" color={theme.primary} /> : null}
          </View>
          {versionSearchError ? <Text style={styles.searchError}>{versionSearchError}</Text> : null}
          <ScrollView contentContainerStyle={styles.listContent}>
            <Text style={styles.versionListLabel}>On This Device</Text>
            {filteredInstalledVersions.map((summary) => {
              const active = normalizeVersionId(summary.id) === normalizeVersionId(activeVersionId);
              const picked = normalizeVersionId(selectedVersion?.id) === normalizeVersionId(summary.id);
              return (
                <Pressable
                  key={summary.id}
                  style={[styles.versionRow, picked ? styles.versionRowPicked : null]}
                  onPress={() => chooseVersion(summary)}
                  disabled={downloadingId !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${summary.versionName}`}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text numberOfLines={1} style={styles.versionName}>{summary.versionName}</Text>
                    <Text numberOfLines={1} style={styles.versionSub}>
                      {summary.languageName || '—'}{active ? ' · Active' : ''}
                    </Text>
                  </View>
                  {active ? <Text style={styles.activeTag}>Active ✓</Text> : null}
                </Pressable>
              );
            })}
            {/* Available Bibles appear only while actively searching. */}
            {versionQuery.trim().length > 0 ? (
              <>
                <Text style={styles.versionListLabel}>Available Bibles</Text>
                {filteredAvailableVersions.map((summary) => {
                  const progress = downloadProgress[summary.id];
                  return (
                    <Pressable
                      key={summary.id}
                      style={styles.versionRow}
                      onPress={() => chooseVersion(summary)}
                      disabled={downloadingId !== null}
                      accessibilityRole="button"
                      accessibilityLabel={`Download ${summary.versionName}`}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text numberOfLines={1} style={styles.versionName}>{summary.versionName}</Text>
                        <Text numberOfLines={1} style={styles.versionSub}>{summary.languageName} · {summary.shortName}</Text>
                        {progress !== undefined ? (
                          <View style={styles.downloadProgressTrack}>
                            <View style={[styles.downloadProgressFill, { width: `${progress}%` }]} />
                          </View>
                        ) : null}
                      </View>
                      {downloadingId === summary.id ? <ActivityIndicator size="small" color={theme.primary} /> : <Text style={styles.activeTag}>Download</Text>}
                    </Pressable>
                  );
                })}
              </>
            ) : null}
            {filteredInstalledVersions.length === 0 &&
            (versionQuery.trim().length === 0 || filteredAvailableVersions.length === 0) ? (
              <Text style={styles.emptyText}>No Bible versions found.</Text>
            ) : null}
          </ScrollView>
        </>
      ) : null}

      {/* Step 2 — searchable list of the version's own books */}
      {stage === 'books' ? (
        <>
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search books…"
              placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
              value={bookQuery}
              onChangeText={setBookQuery}
              autoCorrect={false}
            />
            {bookQuery.length > 0 ? (
              <Pressable
                style={styles.searchClearBtn}
                onPress={() => setBookQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear book search"
              >
                <Text style={styles.searchClearText}>✕</Text>
              </Pressable>
            ) : null}
          </View>
          <ScrollView contentContainerStyle={styles.listContent}>
            {([
              {
                key: 'ot',
                label: localizedBook(1).otLabel,
                books: oldTestamentBooks,
              },
              {
                key: 'nt',
                label: localizedBook(40).ntLabel,
                books: newTestamentBooks,
              },
            ] as const).map((section) => {
              // FIX 2 — render each testament section ONLY when the picked
              // version actually carries books in that canonical range: NT-only
              // Bibles hide the Old Testament, OT-only Hebrew Bibles hide the
              // New Testament.
              if (section.books.length === 0) return null;
              return (
                <View key={section.key}>
                  <Text style={styles.sectionLabel}>{section.label}</Text>
                  {section.books.map(({ book, manifest }) => (
                    <Pressable
                      key={book.id}
                      style={[styles.bookRow, selectedBook?.id === book.id ? styles.versionRowPicked : null]}
                      onPress={() => chooseBook(book)}
                      accessibilityRole="button"
                      accessibilityLabel={`${manifest.englishName || manifest.nativeName}, ${manifest.chapters} chapters`}
                    >
                      <Text numberOfLines={1} style={styles.bookTamil}>{manifest.nativeName}</Text>
                      <Text numberOfLines={1} style={styles.bookEnglish}>
                        {manifest.englishName}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              );
            })}
          </ScrollView>
        </>
      ) : null}

      {/* Step 3 — chapter grid for the chosen book (full-width 5 columns) */}
      {stage === 'chapters' && selectedBook ? (
        <ScrollView contentContainerStyle={styles.listContent}>
          <View style={styles.chapterGrid}>
            {Array.from({ length: selectedBookChapterCount }, (_, index) => index + 1).map(
              (chapter) => (
                <ScalePressable
                  key={chapter}
                  style={[styles.chapterCell, { width: tileWidth, height: 50 }]}
                  onPress={() => chooseChapter(chapter)}
                  accessibilityRole="button"
                  accessibilityLabel={`${selectedBook.englishName} chapter ${chapter}`}
                >
                  <Text style={styles.chapterCellText}>{chapter}</Text>
                </ScalePressable>
              ),
            )}
          </View>
        </ScrollView>
      ) : null}

      {/* Step 4 — verse selection with preview + note + insert */}
      {stage === 'verses' && selectedBook ? (
        <>
          <View style={styles.verseSubHeader}>
            <Text numberOfLines={1} style={styles.verseSubHeaderTitle}>
              {`${selectedVersion?.versionName ?? selectedVersion?.shortName ?? ''} • ${localizedBook(selectedBook.id).primaryName} ${selectedChapter}`}
            </Text>
            <Text numberOfLines={1} style={styles.verseSubHeaderCount}>
              {selectedVerses.size > 0 ? `${selectedVerses.size} selected` : 'Tap verses to select'}
            </Text>
          </View>
          <ScrollView contentContainerStyle={[styles.listContent, styles.versesListContent]}>
            {loadingVerses ? (
              <ActivityIndicator style={styles.spinner} size="large" color={theme.primary} />
            ) : verseError ? (
              <Text style={styles.errorText}>{verseError}</Text>
            ) : (
              <>
                {verses.length === 0 ? (
                  <Text style={styles.emptyText}>No verses found for this chapter.</Text>
                ) : (
                  verses.map((item) => {
                    const picked = selectedVerses.has(item.verse);
                    return (
                      <Pressable
                        key={item.verse}
                        style={[styles.verseRow, picked ? styles.verseRowPicked : null]}
                        onPress={() => toggleVerseSelection(item.verse)}
                        accessibilityRole="button"
                        accessibilityLabel={`Select verse ${item.verse}`}
                      >
                        <Text
                          style={[styles.verseText, pickedVersionIsRtl ? styles.verseTextRtl : null]}
                        >
                          <Text style={styles.verseNumber}>{item.verse} </Text>
                          {item.text}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
                {selectedVerses.size > 0 ? (
                  <View style={styles.previewCard}>
                    <View style={styles.previewHeader}>
                      <PlusVerseSvg size={16} color={theme.primary} />
                      <Text numberOfLines={1} style={styles.previewRef}>
                        {`${localizedBook(selectedBook.id).primaryName} ${selectedChapter}:${verseLabel}`}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.previewText,
                        pickedVersionIsRtl ? styles.previewTextRtl : null,
                      ]}
                    >
                      {previewText}
                    </Text>
                    <TextInput
                      style={styles.noteInput}
                      placeholder="Quick sub-note (optional)…"
                      placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
                      value={note}
                      onChangeText={setNote}
                      multiline
                    />
                  </View>
                ) : (
                  <Text style={styles.hint}>
                    Tap verses to select any combination.
                  </Text>
                )}
              </>
            )}
          </ScrollView>
          <View style={[styles.insertBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Pressable
              style={[styles.insertButton, selectedVerses.size === 0 ? styles.insertButtonDisabled : null]}
              onPress={insertVerse}
              disabled={selectedVerses.size === 0}
              accessibilityRole="button"
              accessibilityLabel="Insert selected verses"
            >
              <Text style={styles.insertButtonText}>
                {selectedVerses.size === 0
                  ? 'Insert Verse'
                  : `Insert ${selectedVerses.size} Selected Verse${selectedVerses.size > 1 ? 's' : ''}`}
              </Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      backgroundColor: theme.surface,
    },
    // LEFT/RIGHT columns: 80px min keeps a truly centered title while giving
    // the ‹ Back pill all the width it needs without wrapping.
    headerSide: {
      minWidth: 80,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    headerIconButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    headerBackPill: {
      height: 36,
      borderRadius: 18,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      flexShrink: 0,
    },
    backText: {
      color: theme.primary,
      fontSize: 14,
      fontWeight: '700',
      flexShrink: 0,
    },
    stageTitle: {
      flex: 1,
      color: theme.text,
      fontSize: 16,
      fontWeight: '700',
      textAlign: 'center',
      paddingHorizontal: 4,
    },
    closeText: { color: theme.textMuted, fontSize: 17, fontWeight: '700', lineHeight: 20 },
    searchBar: {
      marginHorizontal: 14,
      marginTop: 8,
      marginBottom: 6,
      height: 42,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.isDark ? '#334155' : '#CBD5E1',
      backgroundColor: theme.isDark ? '#1E293B' : '#F1F5F9',
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
    },
    searchInput: {
      flex: 1,
      height: 44,
      color: theme.isDark ? '#F8FAFC' : '#0F172A',
      fontSize: 14,
      textAlign: 'center',
    },
    searchClearBtn: {
      padding: 6,
      justifyContent: 'center',
      alignItems: 'center',
    },
    searchClearText: {
      color: theme.textMuted,
      fontSize: 14,
      fontWeight: '600',
    },
    listContent: {
      paddingHorizontal: 16,
      paddingTop: 2,
      paddingBottom: 28,
    },
    // Keep the first verse row from crowding the subheader divider.
    versesListContent: { paddingTop: 10 },
    versionSearchStatus: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 4,
    },
    versionListLabel: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '800',
      marginTop: 6,
      paddingTop: 10,
      paddingBottom: 6,
    },
    searchError: { color: '#DC2626', fontSize: 13, paddingHorizontal: 16, paddingTop: 6 },
    downloadProgressTrack: {
      height: 5,
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
      overflow: 'hidden',
      marginTop: 4,
    },
    downloadProgressFill: { height: 5, borderRadius: 999, backgroundColor: theme.primary },
    sectionLabel: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 4,
      marginBottom: 6,
    },
    versionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 12,
      marginTop: 8,
    },
    versionRowPicked: {
      borderColor: theme.primary,
      backgroundColor: theme.surfaceMuted,
    },
    versionName: { color: theme.text, fontSize: 15, fontWeight: '700', lineHeight: 22 },
    versionSub: { color: theme.textMuted, fontSize: 12, fontWeight: '600', lineHeight: 18 },
    activeTag: { color: '#16A34A', fontSize: 12, fontWeight: '700' },
    bookRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderRadius: 8,
    },
    bookTamil: { flex: 1, color: theme.text, fontSize: 15 },
    bookEnglish: { flex: 1, color: theme.textMuted, fontSize: 13, textAlign: 'right' },
    chapterGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      paddingTop: 16,
      paddingBottom: 32,
    },
    // Rounded squircle 5-column chapter tiles (unified with Home & Progress)
    chapterCell: {
      borderWidth: 1.5,
      borderColor: theme.isDark ? '#283548' : '#E2E8F0',
      backgroundColor: theme.isDark ? '#172033' : '#F1F5F9',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
    },
    chapterCellActive: { backgroundColor: '#10B981', borderColor: '#10B981' },
    chapterCellText: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    chapterCellTextActive: { color: '#FFFFFF', fontWeight: '800' },
    verseRow: {
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderRadius: 8,
    },
    verseRowPicked: { backgroundColor: theme.surfaceMuted },
    verseText: { color: theme.text, fontSize: 15, lineHeight: 23 },
    verseTextRtl: {
      textAlign: 'right',
      writingDirection: 'rtl',
    },
    verseNumber: { color: theme.textMuted, fontSize: 13, fontWeight: '700' },
    previewCard: {
      marginTop: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.surface,
      padding: 12,
      gap: 8,
    },
    previewHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    previewRef: { flex: 1, color: theme.primary, fontSize: 13, fontWeight: '700' },
    previewText: { color: theme.text, fontSize: 14, lineHeight: 22 },
    previewTextRtl: { textAlign: 'right', writingDirection: 'rtl' },
    noteInput: {
      minHeight: 40,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.isDark ? '#334155' : '#CBD5E1',
      backgroundColor: theme.isDark ? '#1E293B' : '#F1F5F9',
      color: theme.isDark ? '#F8FAFC' : '#0F172A',
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 13,
    },
    hint: { color: theme.textMuted, fontSize: 13, marginTop: 12 },
    // Step 4 subheader — version • book • chapter on the left, live selection
    // count on the right ("N selected" / "Tap verses to select").
    verseSubHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    verseSubHeaderTitle: {
      flex: 1,
      flexShrink: 1,
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '700',
    },
    verseSubHeaderCount: {
      flexShrink: 0,
      marginLeft: 10,
      color: theme.primary,
      fontSize: 12.5,
      fontWeight: '600',
    },
    spinner: { marginTop: 32 },
    errorText: { color: '#DC2626', fontSize: 13, marginTop: 16 },
    emptyText: { color: theme.textMuted, fontSize: 14, marginTop: 20 },
    insertBar: {
      padding: 12,
      paddingBottom: 20,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
      backgroundColor: theme.surface,
    },
    insertButton: {
      borderRadius: 12,
      backgroundColor: theme.primary,
      alignItems: 'center',
      paddingVertical: 12,
      minHeight: 44,
      justifyContent: 'center',
    },
    insertButtonDisabled: { opacity: 0.4 },
    insertButtonText: {
      color: theme.primaryForeground,
      fontSize: 15,
      fontWeight: '700',
      lineHeight: 22,
    },
  });
}
