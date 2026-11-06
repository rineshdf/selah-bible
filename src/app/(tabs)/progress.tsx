/**
 * Tab 5: Reading progress.
 *
 * The tab tracks ONE Bible version at a time:
 *  - On every focus it follows the Home reader's active version, unless the
 *    user explicitly picked a tracking version here (persisted under
 *    `@progress_selected_version` + `@progress_version_locked`; a legacy
 *    stored non-BSI id is still honored without the lock flag).
 *  - A version pill row (Language + shortName from `getInstalledVersions()`)
 *    ending in a "+ Download Version" pill that opens an in-tab downloader
 *    backed by the merged catalog.
 *  - A summary card with the ProgressTrophySvg: total %, Old Testament %, New
 *    Testament % (each with its own bar), and days read this month.
 *  - A grid of the version's OWN books in two flat column cards per testament
 *    via FlatList `numColumns={2}`. Percentages are verse-weighted: fully-read
 *    chapters count as 1 and partially-read chapters count as their read verse
 *    fraction, so the Home reader's verse-level mark-read state advances this
 *    tab. Book names resolve through `getLocalizedBookName()` in the tracked
 *    version's own language, and all totals use that version's true chapter
 *    counts (a 4-Gospel Bible totals 89 chapters, never 1,189).
 *  - Tapping a card opens a modal chapter grid (verse-aware: a chapter is
 *    read when every verse is read) toggled through `toggleChapterRead()`.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/constants/ThemeContext';
import type { AppTheme } from '@/constants/colors';
import {
  getBookById,
  getLocalizedBookName,
  type BibleBook,
  type BookLanguageVersionMeta,
  type Testament,
} from '@/constants/books';
import {
  getAllReadingProgress,
  getVersionProgressSummary,
  notifyProgressUpdated,
  rebuildReadChapterIndex,
  toggleChapterRead,
  onProgressUpdated,
  type BookProgressSummary,
  type ReadingProgressRow,
} from '@/db/database';
import {
  DEFAULT_TAMIL_BSI_META,
  TAMIL_BSI_ID,
  getActiveVersionId,
  getBookChapterVerseCounts,
  getInstalledVersions,
  getVersionBooksManifest,
  getVersionBookNames,
  normalizeVersionId,
  type BibleVersionMeta,
  type VersionBookManifestEntry,
} from '@/db/bibleLoader';
import AppHeader from '@/components/AppHeader';
import { ScalePressable } from '@/components/ScalePressable';
import { ProgressTrophySvg } from '@/components/SvgIcons';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const PROGRESS_VERSION_KEY = '@progress_selected_version';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Device-local day, 'YYYY-MM-DD' (matches the DB date format). */
function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function percentLabel(weight: number, total: number): string {
  if (total <= 0) return '0.0%';
  return `${((weight / total) * 100).toFixed(1)}%`;
}

/** Clamp a read-verse fraction; guards rows whose total_verses is missing. */
function partialChapterWeight(readVerses: number, totalVerses: number): number {
  if (totalVerses <= 0) return 0;
  return Math.min(readVerses / totalVerses, 1);
}

/** Verse-weighted progress of ONE book against its version's own chapter count. */
function bookWeight(
  chapters: number,
  summary: BookProgressSummary | undefined,
): { fullChapters: number; weight: number } {
  if (!summary) return { fullChapters: 0, weight: 0 };
  let partialWeight = 0;
  for (const [chapterKey, readVerses] of Object.entries(summary.partialVerseCounts)) {
    const chapter = Number(chapterKey);
    if (!(chapter >= 1 && chapter <= chapters)) continue;
    partialWeight += partialChapterWeight(readVerses, summary.partialTotalVerseCounts[chapter] ?? 0);
  }
  const fullChapters = summary.readChapters.length;
  return { fullChapters, weight: fullChapters + partialWeight };
}

/** FIX 4 — one progress grid row: canonical book + the version's manifest. */
type ProgressBookRow = {
  book: BibleBook;
  manifest: VersionBookManifestEntry;
};

interface BookGridCardProps {
  book: BibleBook;
  styles: ReturnType<typeof makeStyles>;
  cardWidth: number;
  /** Localized primary book name (primitive prop keeps memo compares cheap). */
  name: string;
  /** The tracked version's TRUE chapter count for this book. */
  chapters: number;
  /** Live verse-weighted read summary for THIS book (stable reference). */
  summary: BookProgressSummary | undefined;
  onPress: (book: BibleBook) => void;
}

/**
 * Memoized two-column grid card: only the pressed book or a real progress
 * change re-renders it; the parent's 66-row grids never re-render as a block.
 */
const BookGridCard = memo(function BookGridCard({
  book,
  styles,
  cardWidth,
  name,
  chapters,
  summary,
  onPress,
}: BookGridCardProps) {
  const { fullChapters, weight } = bookWeight(chapters, summary);
  const percent = chapters > 0 ? (weight / chapters) * 100 : 0;
  const complete = percent >= 100;
  return (
    <ScalePressable
      style={[
        styles.bookTile,
        { width: cardWidth },
        complete ? styles.bookTileComplete : null,
      ]}
      onPress={() => onPress(book)}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${fullChapters} of ${chapters} chapters read`}
    >
      <Text numberOfLines={2} style={styles.bookTileName}>
        {name}
      </Text>
      <View style={styles.bookTileCountRow}>
        <Text style={styles.bookTileCount}>
          {`${fullChapters} / ${chapters} chapters`}
        </Text>
        <Text style={styles.bookTilePercent}>{`${Math.round(percent)}%`}</Text>
      </View>
      <View style={styles.tileBarTrack}>
        <View style={[styles.tileBarFill, { width: `${Math.min(percent, 100)}%` }]} />
      </View>
    </ScalePressable>
  );
});

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ProgressScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();

  // FIX 1: dynamic 5-column chapter grid inside the chapter-toggling modal.
  const gridPadding = 16;
  const gridGap = 10;
  const gridCols = 5;
  const tileWidth = Math.floor(
    (screenWidth - gridPadding * 2 - gridGap * (gridCols - 1)) / gridCols,
  );
  /**
   * Guaranteed top inset for every full-screen <Modal> header. Android
   * edge-to-edge renders modal windows behind the status bar and camera
   * cutout, so `insets.top` alone is not enough: take the platform status bar
   * height too and enforce a 36px floor so the ✕ Close, book titles, and
   * Mark All/Clear pills always sit safely below the clock, center cutout,
   * and battery icon.
   */
  const topModalInset = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 36) : 0,
    36,
  );

  // FIX 4: exact 2-column book-card width — two cards plus the 12 gap fill
  // the full row between the 16 side insets with no leftover space.
  const cardWidth = Math.floor((screenWidth - 32 - 12) / 2);

  /** The version the Progress tab is tracking right now. */
  const [progressVersionId, setProgressVersionId] = useState(TAMIL_BSI_ID);
  const [installedMetas, setInstalledMetas] = useState<BibleVersionMeta[]>([]);
  /** Per-book chapter/verse read state for the tracked version. */
  const [progressSummary, setProgressSummary] = useState<Record<number, BookProgressSummary>>({});
  /** Raw rows (for the "days read this month" stat, which needs read dates). */
  const [readDates, setReadDates] = useState<ReadingProgressRow[]>([]);
  /** Native custom book names parsed from the version's own JSON. */
  const [customBookNames, setCustomBookNames] = useState<Record<number, string>>({});
  /**
   * FIX 4 — the tracked version's EXACT book manifest: only books it carries,
   * each with its true chapter count. The grid and all percentages use this,
   * so a 4-Gospel version shows 4 books and 89 chapters — never 66 fillers.
   *
   * Tagged with its version id so switching the tracked version can never
   * render the previous version's books/percentages for even one frame.
   */
  const [versionBooksState, setVersionBooksState] = useState<{
    versionId: string;
    books: VersionBookManifestEntry[];
  } | null>(null);
  const versionBooks = useMemo(
    () => (versionBooksState &&
      versionBooksState.versionId === normalizeVersionId(progressVersionId)
      ? versionBooksState.books
      : []),
    [progressVersionId, versionBooksState],
  );
  /** Chapter-toggling modal. */
  const [openBook, setOpenBook] = useState<BibleBook | null>(null);
  const [openBookReadChapters, setOpenBookReadChapters] = useState<ReadonlySet<number>>(new Set());
  /** Verse totals per chapter (`[31, 25, ...]`) for verse-aware toggling. */
  const [openBookVerseTotals, setOpenBookVerseTotals] = useState<number[]>([]);
  /** Top-right version pill: clean installed-version picker modal. */
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);

  /** Metadata of the tracked version (bundled fallback for the BSI). */
  const progressMeta = useMemo(() => {
    const id = progressVersionId;
    return (
      installedMetas.find((meta) => normalizeVersionId(meta.id) === id) ??
      (id === TAMIL_BSI_ID ? DEFAULT_TAMIL_BSI_META : undefined)
    );
  }, [installedMetas, progressVersionId]);

  /** Language metadata driving localized book names for the tracked version. */
  const namesMeta = useMemo<BookLanguageVersionMeta>(() => ({
    id: progressVersionId,
    language: progressMeta?.language ?? '',
    languageCode: progressMeta?.languageCode ?? '',
  }), [progressMeta, progressVersionId]);

  const localizedBook = useCallback(
    (bookId: number) => getLocalizedBookName(bookId, namesMeta, customBookNames),
    [namesMeta, customBookNames],
  );

  /** Bilingual section titles resolved in the tracked version's language. */
  const testamentLabels = useMemo(() => {
    const labels = getLocalizedBookName(1, namesMeta, customBookNames);
    return { OT: labels.otLabel, NT: labels.ntLabel };
  }, [namesMeta, customBookNames]);

  /** FIX 4 — only the books this version actually carries, canonical order. */
  const progressBookRows = useMemo<ProgressBookRow[]>(() => {
    const rows: ProgressBookRow[] = [];
    versionBooks.forEach((manifest) => {
      const book = getBookById(manifest.bookId);
      if (book) rows.push({ book, manifest });
    });
    return rows;
  }, [versionBooks]);

  /** Load the per-book read state + native book names for one version. */
  const loadProgressData = useCallback((id: string) => {
    void getVersionProgressSummary(id).then(setProgressSummary).catch(() => setProgressSummary({}));
    setReadDates(getAllReadingProgress(id));
    void getVersionBookNames(id).then(setCustomBookNames).catch(() => undefined);
    void getVersionBooksManifest(id)
      .then((books) => setVersionBooksState({ versionId: normalizeVersionId(id), books }))
      .catch(() => setVersionBooksState({ versionId: normalizeVersionId(id), books: [] }));
    // Pre-index read chapters in memory so readCount is O(1) on every tap.
    rebuildReadChapterIndex(id);
  }, []);

  const refreshInstalled = useCallback(async () => {
    try {
      setInstalledMetas(await getInstalledVersions());
    } catch {
      // Keep whatever list is currently rendered.
    }
  }, []);

  /**
   * Focus reload: synchronizes with the active Bible version selected on the
   * Home screen or the explicitly selected progress version, and refreshes
   * all canonical reading progress stats.
   */
  const reload = useCallback(() => {
    void (async () => {
      const [activeId, storedRaw] = await Promise.all([
        getActiveVersionId(),
        AsyncStorage.getItem(PROGRESS_VERSION_KEY).catch(() => null),
      ]);
      void refreshInstalled();

      const active = normalizeVersionId(activeId);
      const storedId = storedRaw ? normalizeVersionId(storedRaw) : '';
      const id = storedId || active || TAMIL_BSI_ID;
      setProgressVersionId(id);
      loadProgressData(id);
    })();
  }, [loadProgressData, refreshInstalled]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  /** Cross-screen sync: when the Home reader writes progress, reload so
   * percentages and counts refresh without a tab switch. */
  useEffect(() => {
    const unsubscribe = onProgressUpdated(() => {
      void loadProgressData(progressVersionId);
    });
    return () => unsubscribe();
  }, [progressVersionId, loadProgressData]);

  /** Pick the version the Progress tab tracks. */
  const handleSelectProgressVersion = useCallback(
    (meta: BibleVersionMeta) => {
      const id = normalizeVersionId(meta.id);
      setProgressVersionId(id);
      void AsyncStorage.setItem(PROGRESS_VERSION_KEY, id).catch(() => undefined);
      loadProgressData(id);
      setVersionPickerOpen(false);
    },
    [loadProgressData],
  );

  /** Weighted counters for the summary card — strictly this version's books. */
  const summaryStats = useMemo(() => {
    let otWeight = 0;
    let ntWeight = 0;
    let otTotal = 0;
    let ntTotal = 0;
    for (const { manifest } of progressBookRows) {
      const { weight } = bookWeight(manifest.chapters, progressSummary[manifest.bookId]);
      if (manifest.testament === 'OT') {
        otWeight += weight;
        otTotal += manifest.chapters;
      } else {
        ntWeight += weight;
        ntTotal += manifest.chapters;
      }
    }
    const month = todayIsoDate().slice(0, 7); // 'YYYY-MM'
    const daysThisMonth = new Set(
      readDates.filter((row) => row.read_date.startsWith(month)).map((row) => row.read_date),
    ).size;
    return {
      totalWeight: otWeight + ntWeight,
      totalChapters: otTotal + ntTotal,
      otWeight,
      otTotal,
      ntWeight,
      ntTotal,
      daysThisMonth,
    };
  }, [progressBookRows, progressSummary, readDates]);

  /** True chapter count of the book open in the chapter modal. */
  const openBookChapterCount = useMemo(
    () => (openBook
      ? versionBooks.find((entry) => entry.bookId === openBook.id)?.chapters ?? 0
      : 0),
    [openBook, versionBooks],
  );

  /** Every chapter of the open book is read → the pill shows `Clear`. */
  const openBookAllRead = openBookChapterCount > 0 && openBookReadChapters.size >= openBookChapterCount;

  /** Open the chapter modal: verse-aware state + verse totals per chapter. */
  const openBookModal = useCallback((book: BibleBook) => {
    setOpenBook(book);
    setOpenBookReadChapters(new Set(progressSummary[book.id]?.readChapters ?? []));
    setOpenBookVerseTotals([]);
    void getBookChapterVerseCounts(progressVersionId, book.id).then((counts) => {
      setOpenBookVerseTotals(counts);
    });
  }, [progressSummary, progressVersionId]);

  /**
   * Toggle one chapter inside the modal optimistically: local state flips
   * synchronously so the cell repaints instantly, then the SQLite write runs
   * async in a try/catch (rolling back on failure) without a full
   * loadProgressData() scan on every tap.
   */
  const toggleOpenBookChapter = useCallback((chapter: number) => {
    const book = openBook;
    if (!book) return;
    const id = normalizeVersionId(progressVersionId);
    const totalVerses = openBookVerseTotals[chapter - 1] ?? 0;

    // Capture whether it was read inside the functional updater so we don't
    // read `openBookReadChapters` directly here (keeps the dep list minimal).
    let wasRead = false;
    // Optimistic update — repaint immediately, before SQLite lands.
    setOpenBookReadChapters((previous) => {
      wasRead = previous.has(chapter);
      const next = new Set(previous);
      if (wasRead) next.delete(chapter);
      else next.add(chapter);
      return next;
    });

    void (async () => {
      try {
        await toggleChapterRead(id, book.id, chapter, totalVerses);
      } catch {
        // Roll back the optimistic change if the write failed.
        setOpenBookReadChapters((previous) => {
          const next = new Set(previous);
          if (wasRead) next.add(chapter);
          else next.delete(chapter);
          return next;
        });
      }
    })();
  }, [openBook, openBookVerseTotals, progressVersionId]);

  /** Grid rows feed the memoized `BookGridCard`; deps stay minimal. */
  const renderBookCard = useCallback(
    ({ item }: { item: ProgressBookRow }) => (
      <BookGridCard
        book={item.book}
        styles={styles}
        cardWidth={cardWidth}
        name={localizedBook(item.book.id).primaryName}
        chapters={item.manifest.chapters}
        summary={progressSummary[item.book.id]}
        onPress={openBookModal}
      />
    ),
    [cardWidth, localizedBook, openBookModal, progressSummary, styles],
  );

  /** Stable book-grid keys. */
  const bookGridKey = useCallback((row: ProgressBookRow) => String(row.book.id), []);

  /** Two-column grid of one testament; hidden when the version has none. */
  const renderBookGrid = useCallback(
    (testament: Testament) => {
      const rows = progressBookRows.filter((row) => row.manifest.testament === testament);
      if (rows.length === 0) return null;
      return (
        <View style={styles.testamentSection}>
          <Text style={styles.testamentTitle}>{testamentLabels[testament]}</Text>
          <FlatList
            numColumns={2}
            scrollEnabled={false}
            style={styles.gridList}
            data={rows}
            keyExtractor={bookGridKey}
            renderItem={renderBookCard}
            columnWrapperStyle={{
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              marginBottom: 12,
            }}
            // Nested non-scrolling grid: render the whole testament up front.
            initialNumToRender={rows.length}
            maxToRenderPerBatch={rows.length}
            windowSize={2}
            removeClippedSubviews={Platform.OS === 'android'}
          />
        </View>
      );
    },
    [bookGridKey, progressBookRows, renderBookCard, styles.gridList, styles.testamentSection, styles.testamentTitle, testamentLabels],
  );

  /** Bulk Mark All / Clear for the open book (optimistic, then SQLite). */
  const toggleAllOpenBookChapters = useCallback(() => {
    const book = openBook;
    if (!book || openBookChapterCount <= 0) return;
    const id = normalizeVersionId(progressVersionId);
    const totals = openBookVerseTotals;
    const allChapters = Array.from({ length: openBookChapterCount }, (_, index) => index + 1);
    const unreadChapters = allChapters.filter((chapter) => !openBookReadChapters.has(chapter));
    // Every chapter read → Clear (unmark the read ones). Otherwise → Mark All.
    const clearing = unreadChapters.length === 0;
    const targets = clearing ? [...openBookReadChapters] : unreadChapters;

    // Optimistic repaint, then the writes land without scanning all books.
    setOpenBookReadChapters(clearing ? new Set() : new Set(allChapters));
    void (async () => {
      for (const chapter of targets) {
        try {
          await toggleChapterRead(id, book.id, chapter, totals[chapter - 1] ?? 0);
        } catch {
          // Keep the optimistic state; the next modal open re-syncs from DB.
        }
      }
      // Bulk change: announce so the summary card + grids refresh on tab focus.
      notifyProgressUpdated();
    })();
  }, [openBook, openBookChapterCount, openBookReadChapters, openBookVerseTotals, progressVersionId]);

  const openBookNames = openBook ? localizedBook(openBook.id) : null;

  /**
   * Version code shown in the top-right pill. Rendered as its own <Text>
   * next to a separate ▾ chevron <Text>, so 4-letter codes (TOJB / NEB)
   * can never squeeze the dropdown arrow out of the pill.
   */
  const progressVersionShortName = progressMeta?.shortName || '—';

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <AppHeader
        title="Reading Progress"
        right={
          <ScalePressable
            style={styles.versionBadge}
            onPress={() => setVersionPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Progress version ${progressVersionShortName}. Change version`}
          >
            <Text numberOfLines={1} style={styles.versionBadgeText}>
              {progressVersionShortName}
            </Text>
            <Text style={styles.versionBadgeChevron}>▾</Text>
          </ScalePressable>
        }
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Padded band for the pills + summary card (the book grids manage
            their own 16 side insets so cards cover the full row width). */}
        <View style={styles.contentInner}>
        {/* Independent per-tab version row (explicit selection locks tracking) */}
        <Text style={styles.versionRowLabel}>Reading Progress Version</Text>
        <View style={styles.versionPickerRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.versionRowContent}
          >
            {installedMetas.map((meta) => {
              const active = normalizeVersionId(meta.id) === progressVersionId;
              return (
                <ScalePressable
                  key={meta.id}
                  style={[styles.versionPill, active ? styles.versionPillActive : null]}
                  onPress={() => handleSelectProgressVersion(meta)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Track reading progress with ${meta.shortName}`}
                >
                  <Text
                    style={[styles.versionPillLang, active ? styles.versionPillLangActive : null]}
                  >
                    {meta.language}
                  </Text>
                  <Text
                    style={[styles.versionPillName, active ? styles.versionPillNameActive : null]}
                  >
                    {meta.shortName}
                  </Text>
                </ScalePressable>
              );
            })}
            <ScalePressable
              style={[styles.versionPill, styles.addVersionPill]}
              onPress={() => {
                // Route to the full Bible Library tab: no duplicate in-tab
                // downloader anymore.
                router.push('/(tabs)/bibles');
              }}
              accessibilityRole="button"
              accessibilityLabel="Download a version to track"
            >
              <Text numberOfLines={1} style={styles.addVersionPillText}>+ Download Versions</Text>
            </ScalePressable>
          </ScrollView>
        </View>

        {/* Summary card with trophy */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeaderRow}>
            <ProgressTrophySvg size={28} color={theme.primary} />
            <Text style={styles.summaryTitle}>Bible Reading Progress</Text>
            <Text style={styles.summaryCount}>
              {Math.round(summaryStats.totalWeight)}/{summaryStats.totalChapters} chapters
            </Text>
          </View>
          <View>
            <Text style={styles.barCaption}>
              Total Bible · {percentLabel(summaryStats.totalWeight, summaryStats.totalChapters)}
            </Text>
            <View style={styles.totalBarTrack}>
              <View
                style={[
                  styles.totalBarFill,
                  {
                    width: `${Math.min(
                      (summaryStats.totalWeight / Math.max(summaryStats.totalChapters, 1)) * 100,
                      100,
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>
          <View>
            <Text style={styles.barCaption}>
              Old Testament · {percentLabel(summaryStats.otWeight, summaryStats.otTotal)}
            </Text>
            <View style={styles.totalBarTrack}>
              <View
                style={[
                  styles.otBarFill,
                  {
                    width: `${Math.min(
                      (summaryStats.otWeight / Math.max(summaryStats.otTotal, 1)) * 100,
                      100,
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>
          <View>
            <Text style={styles.barCaption}>
              New Testament · {percentLabel(summaryStats.ntWeight, summaryStats.ntTotal)}
            </Text>
            <View style={styles.totalBarTrack}>
              <View
                style={[
                  styles.ntBarFill,
                  {
                    width: `${Math.min(
                      (summaryStats.ntWeight / Math.max(summaryStats.ntTotal, 1)) * 100,
                      100,
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>
          <View style={styles.statGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {percentLabel(summaryStats.totalWeight, summaryStats.totalChapters)}
              </Text>
              <Text numberOfLines={2} style={styles.statLabel}>Total Bible</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{summaryStats.daysThisMonth}</Text>
              <Text numberOfLines={2} style={styles.statLabel}>Days read this month</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValueVersion}>
                {progressMeta?.shortName ?? '—'}
              </Text>
              <Text style={styles.statLabel}>Progress version</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {progressMeta?.language || '—'}
              </Text>
              <Text style={styles.statLabel}>Book names in this language</Text>
            </View>
          </View>
        </View>
        </View>

        {/* The tracked version's own books, grouped by testament */}
        {renderBookGrid('OT')}
        {renderBookGrid('NT')}
      </ScrollView>

      {/* Chapter toggle modal (verse-aware read state) */}
      <Modal
        visible={openBook !== null}
        animationType="slide"
        statusBarTranslucent={true}
        onRequestClose={() => setOpenBook(null)}
      >
        {openBook ? (
          <View style={[styles.modalScreen, { backgroundColor: theme.background }]}>
            <View
              style={[
                styles.modalHeader,
                {
                  // Edge-to-edge: draw under the status bar and pad the header
                  // by the measured status bar / notch height + a 10px breath.
                  paddingTop: topModalInset + 10,
                  paddingBottom: 12,
                },
              ]}
            >
              {/* Left — round 40x40 ✕ Close button */}
              <ScalePressable
                style={styles.modalIconButton}
                onPress={() => setOpenBook(null)}
                accessibilityRole="button"
                accessibilityLabel="Close chapter tracker"
              >
                <Text style={styles.modalClose}>✕</Text>
              </ScalePressable>
              {/* Center — book title + read-progress subtitle */}
              <View style={styles.modalHeaderCenter}>
                <Text numberOfLines={1} style={styles.modalTitle}>
                  {openBookNames?.primaryName || openBook.englishName}
                </Text>
                <Text numberOfLines={1} style={styles.modalSubtitle}>
                  {`${openBookReadChapters.size}/${openBookChapterCount} read • tap to toggle • ${progressMeta?.shortName ?? '—'}`}
                </Text>
              </View>
              {/* Right — Mark All / Clear toggle pill */}
              <ScalePressable
                style={styles.modalHeaderPill}
                onPress={toggleAllOpenBookChapters}
                accessibilityRole="button"
                accessibilityLabel={
                  openBookAllRead ? 'Clear all read chapters' : 'Mark all chapters as read'
                }
              >
                <Text numberOfLines={1} style={styles.modalHeaderPillText}>
                  {openBookAllRead ? 'Clear' : 'Mark All'}
                </Text>
              </ScalePressable>
            </View>
            <ScrollView contentContainerStyle={styles.chapterWrap}>
              <View style={styles.chapterGrid}>
                {Array.from({ length: openBookChapterCount }, (_, index) => index + 1).map(
                  (chapter) => {
                    const isRead = openBookReadChapters.has(chapter);
                    const partiallyRead = (progressSummary[openBook.id]?.partialVerseCounts[chapter] ?? 0) > 0;
                    return (
                      <ScalePressable
                        key={chapter}
                        style={[
                          styles.chapterCell,
                          { width: tileWidth, height: 50, borderRadius: 14 },
                          isRead ? styles.chapterCellRead : null,
                          !isRead && partiallyRead ? styles.chapterCellPartial : null,
                        ]}
                        onPress={() => toggleOpenBookChapter(chapter)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isRead }}
                        accessibilityLabel={`${openBookNames?.secondaryName || openBook.englishName} chapter ${chapter}${isRead ? ', read' : ', unread'}`}
                      >
                        <Text
                          style={[
                            styles.chapterCellText,
                            isRead ? styles.chapterCellTextRead : null,
                          ]}
                        >
                          {chapter}
                        </Text>
                      </ScalePressable>
                    );
                  },
                )}
              </View>
            </ScrollView>
          </View>
        ) : null}
      </Modal>

      {/* Version picker modal: ALL installed versions with their true names */}
      <Modal
        visible={versionPickerOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setVersionPickerOpen(false)}
      >
        <View style={[styles.pickerBackdrop, { paddingTop: Math.max(22, topModalInset) }]}>
          <Pressable
            style={styles.pickerBackdropTouch}
            onPress={() => setVersionPickerOpen(false)}
          />
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <Text numberOfLines={1} style={styles.pickerTitle}>Choose Progress Version</Text>
              <Pressable
                onPress={() => setVersionPickerOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close version picker"
              >
                <Text style={styles.pickerClose}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
              {installedMetas.map((meta) => {
                const active = normalizeVersionId(meta.id) === progressVersionId;
                return (
                  <ScalePressable
                    key={meta.id}
                    style={[styles.pickerRow, active ? styles.pickerRowActive : null]}
                    onPress={() => handleSelectProgressVersion(meta)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Track reading progress with ${meta.name}`}
                  >
                    <View style={styles.pickerLanguageBadge}>
                      <Text style={styles.pickerLanguageText}>
                        {meta.language || '—'}
                      </Text>
                    </View>
                    <View style={styles.pickerMeta}>
                      <Text numberOfLines={1} style={styles.pickerName}>
                        {meta.name}
                      </Text>
                      <Text numberOfLines={1} style={styles.pickerSub}>
                        {meta.shortName}
                      </Text>
                    </View>
                    <Text style={styles.pickerTag}>{active ? 'Active ✓' : 'Use'}</Text>
                  </ScalePressable>
                );
              })}
              {installedMetas.length === 0 ? (
                <Text style={styles.pickerEmpty}>
                  No installed versions found yet. Download one below.
                </Text>
              ) : null}
            </ScrollView>
            <ScalePressable
              style={styles.pickerDownloadButton}
              onPress={() => {
                // Close any open modal and route straight to the full Bible
                // Library tab (the standalone in-tab downloader is gone).
                setVersionPickerOpen(false);
                router.push('/(tabs)/bibles');
              }}
              accessibilityRole="button"
              accessibilityLabel="Download more Bible versions"
            >
              <Text style={styles.pickerDownloadText}>+ Download More Versions</Text>
            </ScalePressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1 },
    versionBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      height: 38,
      minWidth: 78,
      borderRadius: 19,
      gap: 5,
      flexShrink: 0,
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.surface,
    },
    versionBadgeText: { color: theme.primary, fontSize: 13.5, fontWeight: '800' },
    versionBadgeChevron: {
      color: theme.primary,
      fontSize: 12,
      fontWeight: '900',
      flexShrink: 0,
      includeFontPadding: false,
    },    content: {
      paddingTop: 16,
      paddingBottom: 40,
      gap: 14,
    },
    // horizontal inset band for pills + summary; book grids inset themselves
    contentInner: {
      paddingHorizontal: 16,
      gap: 14,
    },
    versionRowLabel: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '800',
      marginTop: 2,
    },
    versionPickerRow: { marginBottom: 2 },
    versionRowContent: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 8,
      paddingVertical: 4,
      paddingHorizontal: 2,
    },
    versionPill: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 12,
      paddingVertical: 8,
      minHeight: 56,
      flexShrink: 1,
      justifyContent: 'center',
    },
    versionPillActive: {
      borderColor: theme.primary,
      backgroundColor: theme.surfaceMuted,
    },
    versionPillLang: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '600',
      lineHeight: 16,
    },
    versionPillLangActive: { color: theme.primary },
    versionPillName: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 22,
    },
    versionPillNameActive: { color: theme.primary },
    addVersionPill: {
      paddingHorizontal: 16,
      minWidth: 156,
      height: 60,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      borderColor: theme.primary,
      borderStyle: 'dashed',
    },
    addVersionPillText: {
      color: theme.primary,
      fontSize: 13.5,
      fontWeight: '800',
      flexShrink: 0,
    },
    // Summary card
    summaryCard: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 14,
      gap: 10,
    },
    summaryHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    summaryTitle: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '700',
      flexShrink: 1,
      flex: 1,
    },
    summaryCount: { color: theme.textMuted, fontSize: 12, fontWeight: '600' },
    barCaption: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '700',
      marginBottom: 3,
    },
    totalBarTrack: {
      height: 8,
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
      overflow: 'hidden',
    },
    totalBarFill: { height: '100%', borderRadius: 999, backgroundColor: theme.primary },
    otBarFill: { height: '100%', borderRadius: 999, backgroundColor: theme.accent },
    ntBarFill: { height: '100%', borderRadius: 999, backgroundColor: '#16A34A' },
    statGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    statBox: {
      width: '48.5%',
      borderRadius: 10,
      backgroundColor: theme.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      padding: 10,
      gap: 2,
    },
    statValue: { color: theme.primary, fontSize: 20, fontWeight: '800' },
    statValueVersion: { color: theme.primary, fontSize: 16, fontWeight: '800' },
    statLabel: { color: theme.textMuted, fontSize: 12, fontWeight: '600' },
    // Book grid — two exact-width cards per row via FlatList numColumns=2
    testamentSection: { gap: 8 },
    testamentTitle: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 22,
      paddingHorizontal: 16,
    },
    gridList: { flexGrow: 0 },
    bookTile: {
      minHeight: 96,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 14,
      justifyContent: 'space-between',
      gap: 6,
    },
    bookTileComplete: {
      borderColor: theme.primary,
      backgroundColor: theme.surfaceMuted,
    },
    bookTileName: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '700',
      lineHeight: 21,
    },
    bookTileCountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
    },
    bookTileCount: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
      flexShrink: 1,
    },
    bookTilePercent: {
      color: theme.primary,
      fontSize: 12,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    tileBarTrack: {
      height: 6,
      borderRadius: 3,
      width: '100%',
      backgroundColor: theme.surfaceMuted,
      overflow: 'hidden',
    },
    tileBarFill: { height: '100%', borderRadius: 3, backgroundColor: theme.primary },
    // Chapter modal — unified 3-column non-overlapping modal header
    modalScreen: { flex: 1 },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      backgroundColor: theme.surface,
    },
    modalIconButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    modalClose: { color: theme.text, fontSize: 17, fontWeight: '700', lineHeight: 20 },
    modalHeaderCenter: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    modalTitle: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '800',
      textAlign: 'center',
    },
    modalSubtitle: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '600',
      textAlign: 'center',
      marginTop: 2,
    },
    modalHeaderPill: {
      minWidth: 78,
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
    modalHeaderPillText: {
      color: theme.primary,
      fontSize: 13,
      fontWeight: '800',
    },
    chapterWrap: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
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
    chapterCellRead: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    chapterCellPartial: {
      borderColor: theme.primary,
    },
    chapterCellText: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '600',
      includeFontPadding: false,
      fontVariant: ['tabular-nums'],
    },
    chapterCellTextRead: { color: '#FFFFFF', fontWeight: '800' },
    // Version picker modal
    pickerBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 22,
    },
    pickerBackdropTouch: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    pickerCard: {
      width: '100%',
      maxWidth: 420,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 12,
      maxHeight: '74%',
    },
    pickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
      paddingBottom: 8,
    },
    pickerTitle: {
      flex: 1,
      flexShrink: 1,
      color: theme.text,
      fontSize: 16,
      fontWeight: '700',
    },
    pickerClose: { color: theme.textMuted, fontSize: 16, fontWeight: '700', padding: 4, flexShrink: 0 },
    pickerList: { flexGrow: 0 },
    pickerListContent: { paddingBottom: 8 },
    pickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      padding: 10,
      marginTop: 6,
    },
    pickerRowActive: { borderColor: theme.primary },
    pickerLanguageBadge: {
      alignSelf: 'flex-start',
      flexShrink: 1,
      borderRadius: 6,
      backgroundColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      paddingHorizontal: 6,
      paddingVertical: 3,
    },
    pickerLanguageText: { color: theme.textMuted, fontSize: 11, fontWeight: '600' },
    pickerMeta: { flex: 1, gap: 2 },
    pickerName: { color: theme.text, fontSize: 14, fontWeight: '700' },
    pickerSub: { color: theme.textMuted, fontSize: 12 },
    pickerTag: { color: theme.primary, fontSize: 12, fontWeight: '700' },
    pickerEmpty: { color: theme.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 16 },
    pickerDownloadButton: {
      marginTop: 8,
      minHeight: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    pickerDownloadText: { color: theme.primary, fontSize: 14, fontWeight: '700' },
  });
}
