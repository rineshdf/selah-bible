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
 *  - A 66-book grid in two flat column cards per testament via FlatList
 *    `numColumns={2}`. Percentages are verse-weighted: fully-read chapters
 *    count as 1 and partially-read chapters count as their read verse
 *    fraction, so the Home reader's verse-level mark-read state advances this
 *    tab. Book names resolve through `getLocalizedBookName()` in the tracked
 *    version's own language.
 *  - Tapping a card opens a modal chapter grid (verse-aware: a chapter is
 *    read when every verse is read) toggled through `toggleChapterRead()`.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/constants/ThemeContext';
import type { AppTheme } from '@/constants/colors';
import {
  BIBLE_BOOKS,
  getBooksByTestament,
  getLocalizedBookName,
  type BibleBook,
  type BookLanguageVersionMeta,
  type Testament,
} from '@/constants/books';
import {
  getAllReadingProgress,
  getVersionProgressSummary,
  toggleChapterRead,
  type BookProgressSummary,
  type ReadingProgressRow,
} from '@/db/database';
import {
  DEFAULT_TAMIL_BSI_META,
  TAMIL_BSI_ID,
  downloadBibleVersion,
  getActiveVersionId,
  getBookChapterVerseCounts,
  getInstalledVersions,
  getVersionBookNames,
  isVersionDownloaded,
  normalizeVersionId,
  type BibleVersionMeta,
} from '@/db/bibleLoader';
import {
  getMergedCatalogVersions,
  groupVersionsByLanguage,
  type DownloadableVersion,
} from '@/constants/versionCatalog';
import AppHeader from '@/components/AppHeader';
import { ScalePressable } from '@/components/ScalePressable';
import { ProgressTrophySvg } from '@/components/SvgIcons';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const PROGRESS_VERSION_KEY = '@progress_selected_version';
/** Set to '1' when the user explicitly picked a tracking version here. */
const PROGRESS_VERSION_LOCK_KEY = '@progress_version_locked';

const TOTAL_CHAPTERS = BIBLE_BOOKS.reduce((sum, book) => sum + book.chaptersCount, 0);

const TESTAMENT_TOTALS: Record<Testament, number> = (['OT', 'NT'] as const).reduce(
  (totals, testament) => {
    totals[testament] = getBooksByTestament(testament).reduce(
      (sum, book) => sum + book.chaptersCount,
      0,
    );
    return totals;
  },
  { OT: 0, NT: 0 },
);

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

/** Verse-weighted progress of ONE book: fully-read chapters + partial fraction. */
function bookWeight(
  book: BibleBook,
  summary: BookProgressSummary | undefined,
): { fullChapters: number; weight: number } {
  if (!summary) return { fullChapters: 0, weight: 0 };
  let partialWeight = 0;
  for (const [chapterKey, readVerses] of Object.entries(summary.partialVerseCounts)) {
    const chapter = Number(chapterKey);
    if (!(chapter >= 1 && chapter <= book.chaptersCount)) continue;
    partialWeight += partialChapterWeight(readVerses, summary.partialTotalVerseCounts[chapter] ?? 0);
  }
  const fullChapters = summary.readChapters.length;
  return { fullChapters, weight: fullChapters + partialWeight };
}

type DownloaderRow =
  | { kind: 'group'; key: string; label: string }
  | { kind: 'version'; key: string; version: DownloadableVersion };

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ProgressScreen() {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();

  /** The version the Progress tab is tracking right now. */
  const [progressVersionId, setProgressVersionId] = useState(TAMIL_BSI_ID);
  const [installedMetas, setInstalledMetas] = useState<BibleVersionMeta[]>([]);
  /** Per-book chapter/verse read state for the tracked version. */
  const [progressSummary, setProgressSummary] = useState<Record<number, BookProgressSummary>>({});
  /** Raw rows (for the "days read this month" stat, which needs read dates). */
  const [readDates, setReadDates] = useState<ReadingProgressRow[]>([]);
  /** Native custom book names parsed from the version's own JSON. */
  const [customBookNames, setCustomBookNames] = useState<Record<number, string>>({});
  /** Chapter-toggling modal. */
  const [openBook, setOpenBook] = useState<BibleBook | null>(null);
  const [openBookReadChapters, setOpenBookReadChapters] = useState<ReadonlySet<number>>(new Set());
  /** Verse totals per chapter (`[31, 25, ...]`) for verse-aware toggling. */
  const [openBookVerseTotals, setOpenBookVerseTotals] = useState<number[]>([]);
  /** Top-right version pill: clean installed-version picker modal. */
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);
  const [downloaderOpen, setDownloaderOpen] = useState(false);
  const [downloaderRows, setDownloaderRows] = useState<DownloaderRow[]>([]);
  const [downloaderLoading, setDownloaderLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

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

  /** Load the per-book read state + native book names for one version. */
  const loadProgressData = useCallback((id: string) => {
    void getVersionProgressSummary(id).then(setProgressSummary).catch(() => setProgressSummary({}));
    setReadDates(getAllReadingProgress(id));
    void getVersionBookNames(id).then(setCustomBookNames).catch(() => undefined);
  }, []);

  const refreshInstalled = useCallback(async () => {
    try {
      setInstalledMetas(await getInstalledVersions());
    } catch {
      // Keep whatever list is currently rendered.
    }
  }, []);

  /**
   * Focus reload: follow the Home reader's active version unless the user
   * explicitly locked a tracking version here. A legacy stored non-BSI id is
   * still honored (it can only come from an explicit old-build switch), but
   * never used when the version is no longer on the device.
   */
  const reload = useCallback(() => {
    void (async () => {
      const [activeId, storedRaw, lockRaw] = await Promise.all([
        getActiveVersionId(),
        AsyncStorage.getItem(PROGRESS_VERSION_KEY).catch(() => null),
        AsyncStorage.getItem(PROGRESS_VERSION_LOCK_KEY).catch(() => null),
      ]);
      void refreshInstalled();

      const active = normalizeVersionId(activeId);
      const storedId = storedRaw ? normalizeVersionId(storedRaw) : '';
      // No explicit switch yet (and no legacy non-default id stored) tracks
      // whatever the Home reader is on right now.
      const followReader = lockRaw !== '1' && (storedId === '' || storedId === TAMIL_BSI_ID);
      const storedAvailable =
        storedId !== '' && storedId === TAMIL_BSI_ID
          ? true
          : storedId !== '' && (await isVersionDownloaded(storedId));
      const id = followReader || !storedAvailable ? active : storedId;
      setProgressVersionId(id);
      loadProgressData(id);
    })();
  }, [loadProgressData, refreshInstalled]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  /** Pick the version the Progress tab tracks (explicit lock). */
  const handleSelectProgressVersion = useCallback(
    (meta: BibleVersionMeta) => {
      const id = normalizeVersionId(meta.id);
      setProgressVersionId(id);
      void AsyncStorage
        .multiSet([[PROGRESS_VERSION_KEY, id], [PROGRESS_VERSION_LOCK_KEY, '1']])
        .catch(() => undefined);
      loadProgressData(id);
      setVersionPickerOpen(false);
    },
    [loadProgressData],
  );

  /** In-tab downloader: load the grouped merged catalog when it opens. */
  const openDownloader = useCallback(() => {
    setDownloaderOpen(true);
    setDownloaderLoading(true);
    void getMergedCatalogVersions()
      .then((versions) => {
        const installedIds = new Set(installedMetas.map((meta) => normalizeVersionId(meta.id)));
        const available = versions.filter((version) => !installedIds.has(normalizeVersionId(version.id)));
        const rows: DownloaderRow[] = [];
        for (const group of groupVersionsByLanguage(available)) {
          rows.push({ kind: 'group', key: `group:${group.language}`, label: group.label });
          for (const version of group.versions) {
            rows.push({ kind: 'version', key: `version:${version.id}`, version });
          }
        }
        if (rows.length === 0) {
          rows.push({ kind: 'group', key: 'group:none', label: 'Everything in the catalog is already on this device.' });
        }
        setDownloaderRows(rows);
      })
      .catch(() => {
        setDownloaderRows([
          { kind: 'group', key: 'group:error', label: 'Could not load the catalog. Check your connection.' },
        ]);
      })
      .finally(() => setDownloaderLoading(false));
  }, [installedMetas]);

  const handleDownloadForProgress = useCallback(async (version: DownloadableVersion) => {
    if (downloadProgress[version.id] !== undefined) return;
    setDownloadProgress((previous) => ({ ...previous, [version.id]: 0 }));
    try {
      await downloadBibleVersion(version, (event) => {
        setDownloadProgress((previous) => ({
          ...previous,
          [version.id]: Math.max(previous[version.id] ?? 0, event.percent),
        }));
      });
      // The new version is installed: refresh the pill row + tracked reads.
      await refreshInstalled();
      setDownloaderRows((previous) => previous.filter(
        (row) => !(row.kind === 'version' && row.version.id === version.id),
      ));
      setDownloadProgress((previous) => {
        const next = { ...previous };
        delete next[version.id];
        return next;
      });
      // If the just-downloaded version is the one being tracked, reload.
      if (normalizeVersionId(version.id) === progressVersionId) {
        loadProgressData(progressVersionId);
      }
    } catch (error) {
      Alert.alert(
        'Download failed',
        error instanceof Error ? error.message : `Could not download ${version.shortName}.`,
      );
      setDownloadProgress((previous) => {
        const next = { ...previous };
        delete next[version.id];
        return next;
      });
    }
  }, [downloadProgress, loadProgressData, progressVersionId, refreshInstalled]);

  /** Weighted app-wide counters for the summary card. */
  const summaryStats = useMemo(() => {
    let otWeight = 0;
    let ntWeight = 0;
    for (const book of BIBLE_BOOKS) {
      const { weight } = bookWeight(book, progressSummary[book.id]);
      if (book.testament === 'OT') otWeight += weight;
      else ntWeight += weight;
    }
    const month = todayIsoDate().slice(0, 7); // 'YYYY-MM'
    const daysThisMonth = new Set(
      readDates.filter((row) => row.read_date.startsWith(month)).map((row) => row.read_date),
    ).size;
    return { totalWeight: otWeight + ntWeight, otWeight, ntWeight, daysThisMonth };
  }, [progressSummary, readDates]);

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
   * Toggle one chapter inside the modal through the shared verse-level state
   * machine (`toggleChapterRead`), then refresh the whole-tab summary so the
   * cards and the summary stay consistent.
   */
  const toggleOpenBookChapter = useCallback((chapter: number) => {
    const book = openBook;
    if (!book) return;
    void (async () => {
      const id = normalizeVersionId(progressVersionId);
      const totalVerses = openBookVerseTotals[chapter - 1] ?? 0;
      const becameRead = await toggleChapterRead(id, book.id, chapter, totalVerses);
      setOpenBookReadChapters((previous) => {
        const next = new Set(previous);
        if (becameRead) next.add(chapter);
        else next.delete(chapter);
        return next;
      });
      void getVersionProgressSummary(id).then(setProgressSummary).catch(() => undefined);
    })();
  }, [openBook, openBookVerseTotals, progressVersionId]);

  /** One two-column book card (grid item). */
  const renderBookCard = useCallback(
    ({ item }: { item: BibleBook }) => {
      const { fullChapters, weight } = bookWeight(item, progressSummary[item.id]);
      const percent = item.chaptersCount > 0 ? (weight / item.chaptersCount) * 100 : 0;
      const names = localizedBook(item.id);
      const complete = percent >= 100;
      return (
        <ScalePressable
          style={[styles.bookTile, complete ? styles.bookTileComplete : null]}
          onPress={() => openBookModal(item)}
          accessibilityRole="button"
          accessibilityLabel={`${names.secondaryName || names.primaryName}, ${fullChapters} of ${item.chaptersCount} chapters read`}
        >
          <Text numberOfLines={2} style={styles.bookTileName}>
            {names.primaryName}
          </Text>
          <View style={styles.bookTileCountRow}>
            <Text numberOfLines={1} style={styles.bookTileCount}>
              {`${fullChapters} / ${item.chaptersCount} ch`}
            </Text>
            <Text style={styles.bookTilePercent}>{`${Math.round(percent)}%`}</Text>
          </View>
          <View style={styles.tileBarTrack}>
            <View style={[styles.tileBarFill, { width: `${Math.min(percent, 100)}%` }]} />
          </View>
        </ScalePressable>
      );
    },
    [localizedBook, openBookModal, progressSummary, styles],
  );

  /** Two-column grid of one testament, laid out by FlatList for perf. */
  const renderBookGrid = useCallback(
    (testament: Testament) => {
      const books = getBooksByTestament(testament);
      return (
        <View style={styles.testamentSection}>
          <Text style={styles.testamentTitle}>{testamentLabels[testament]}</Text>
          <FlatList
            numColumns={2}
            scrollEnabled={false}
            style={styles.gridList}
            data={books}
            keyExtractor={(book) => String(book.id)}
            renderItem={renderBookCard}
            columnWrapperStyle={styles.gridColumn}
            initialNumToRender={books.length}
            maxToRenderPerBatch={books.length}
            windowSize={2}
          />
        </View>
      );
    },
    [renderBookCard, styles.gridColumn, styles.gridList, styles.testamentSection, styles.testamentTitle, testamentLabels],
  );

  /** From the version picker: open the catalog downloader after closing. */
  const openDownloaderFromPicker = useCallback(() => {
    setVersionPickerOpen(false);
    openDownloader();
  }, [openDownloader]);

  const openBookNames = openBook ? localizedBook(openBook.id) : null;

  const renderDownloaderRow = useCallback(
    ({ item }: { item: DownloaderRow }) => {
      if (item.kind === 'group') {
        return <Text style={styles.downloaderGroupLabel}>{item.label}</Text>;
      }
      const version = item.version;
      const percent = downloadProgress[version.id];
      return (
        <View style={styles.downloaderRow}>
          <View style={styles.downloaderMeta}>
            <Text numberOfLines={1} style={styles.downloaderName}>{version.name}</Text>
            <Text numberOfLines={1} style={styles.downloaderSub}>
              {version.languageName} · {version.shortName}
            </Text>
          </View>
          <ScalePressable
            style={[styles.downloaderButton, percent !== undefined ? styles.downloaderButtonBusy : null]}
            onPress={() => void handleDownloadForProgress(version)}
            disabled={percent !== undefined}
            accessibilityRole="button"
            accessibilityLabel={`Download ${version.shortName}`}
          >
            {percent !== undefined ? <ActivityIndicator size="small" color={theme.primaryForeground} /> : null}
            <Text style={styles.downloaderButtonText}>
              {percent !== undefined ? `${Math.round(percent)}%` : 'Download'}
            </Text>
          </ScalePressable>
        </View>
      );
    },
    [downloadProgress, handleDownloadForProgress, styles, theme.primaryForeground],
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <AppHeader
        title="Reading Progress"
        right={
          <ScalePressable
            style={styles.versionBadge}
            onPress={() => setVersionPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Progress version ${progressMeta?.shortName ?? ''}. Change version`}
          >
            <Text numberOfLines={1} style={styles.versionBadgeText}>
              {progressMeta?.shortName || '—'} ▾
            </Text>
          </ScalePressable>
        }
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
                    numberOfLines={1}
                    style={[styles.versionPillLang, active ? styles.versionPillLangActive : null]}
                  >
                    {meta.language}
                  </Text>
                  <Text
                    numberOfLines={1}
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
                openDownloader();
              }}
              accessibilityRole="button"
              accessibilityLabel="Download a version to track"
            >
              <Text style={styles.addVersionPillText}>+ Download Version</Text>
            </ScalePressable>
          </ScrollView>
        </View>

        {/* Summary card with trophy */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeaderRow}>
            <ProgressTrophySvg size={28} color={theme.primary} />
            <Text style={styles.summaryTitle}>Bible Reading Progress</Text>
            <Text style={styles.summaryCount}>
              {Math.round(summaryStats.totalWeight)}/{TOTAL_CHAPTERS} chapters
            </Text>
          </View>
          <View>
            <Text style={styles.barCaption}>
              Total Bible · {percentLabel(summaryStats.totalWeight, TOTAL_CHAPTERS)}
            </Text>
            <View style={styles.totalBarTrack}>
              <View
                style={[
                  styles.totalBarFill,
                  { width: `${Math.min((summaryStats.totalWeight / TOTAL_CHAPTERS) * 100, 100)}%` },
                ]}
              />
            </View>
          </View>
          <View>
            <Text style={styles.barCaption}>
              Old Testament · {percentLabel(summaryStats.otWeight, TESTAMENT_TOTALS.OT)}
            </Text>
            <View style={styles.totalBarTrack}>
              <View
                style={[
                  styles.otBarFill,
                  { width: `${Math.min((summaryStats.otWeight / TESTAMENT_TOTALS.OT) * 100, 100)}%` },
                ]}
              />
            </View>
          </View>
          <View>
            <Text style={styles.barCaption}>
              New Testament · {percentLabel(summaryStats.ntWeight, TESTAMENT_TOTALS.NT)}
            </Text>
            <View style={styles.totalBarTrack}>
              <View
                style={[
                  styles.ntBarFill,
                  { width: `${Math.min((summaryStats.ntWeight / TESTAMENT_TOTALS.NT) * 100, 100)}%` },
                ]}
              />
            </View>
          </View>
          <View style={styles.statGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{percentLabel(summaryStats.totalWeight, TOTAL_CHAPTERS)}</Text>
              <Text numberOfLines={2} style={styles.statLabel}>Total Bible</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{summaryStats.daysThisMonth}</Text>
              <Text numberOfLines={2} style={styles.statLabel}>Days read this month</Text>
            </View>
            <View style={styles.statBox}>
              <Text numberOfLines={1} style={styles.statValueVersion}>
                {progressMeta?.shortName ?? '—'}
              </Text>
              <Text numberOfLines={2} style={styles.statLabel}>Progress version</Text>
            </View>
            <View style={styles.statBox}>
              <Text numberOfLines={1} style={styles.statValue}>
                {progressMeta?.language || '—'}
              </Text>
              <Text numberOfLines={2} style={styles.statLabel}>Book names in this language</Text>
            </View>
          </View>
        </View>

        {/* 66-book grid, grouped by testament (localized names) */}
        {renderBookGrid('OT')}
        {renderBookGrid('NT')}
      </ScrollView>

      {/* Chapter toggle modal (verse-aware read state) */}
      <Modal visible={openBook !== null} animationType="slide" onRequestClose={() => setOpenBook(null)}>
        {openBook ? (
          <View style={[styles.modalScreen, { backgroundColor: theme.background }]}>
            <View style={styles.modalHeader}>
              <ScalePressable
                onPress={() => setOpenBook(null)}
                accessibilityRole="button"
                accessibilityLabel="Close chapter tracker"
              >
                <Text style={styles.modalClose}>✕</Text>
              </ScalePressable>
              <View style={styles.modalHeaderText}>
                <Text numberOfLines={1} style={styles.modalTitle}>
                  {openBookNames?.secondaryName || openBookNames?.primaryName || openBook.englishName}
                </Text>
                <Text numberOfLines={1} style={styles.modalSubtitle}>
                  {openBookReadChapters.size}/{openBook.chaptersCount} read · tap to toggle ·{' '}
                  {progressMeta?.shortName ?? '—'}
                </Text>
              </View>
              <View style={styles.modalHeaderSpacer} />
            </View>
            <ScrollView contentContainerStyle={styles.chapterWrap}>
              <View style={styles.chapterGrid}>
                {Array.from({ length: openBook.chaptersCount }, (_, index) => index + 1).map(
                  (chapter) => {
                    const isRead = openBookReadChapters.has(chapter);
                    const partiallyRead = (progressSummary[openBook.id]?.partialVerseCounts[chapter] ?? 0) > 0;
                    return (
                      <ScalePressable
                        key={chapter}
                        style={[
                          styles.chapterCell,
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
        <View style={styles.pickerBackdrop}>
          <Pressable
            style={styles.pickerBackdropTouch}
            onPress={() => setVersionPickerOpen(false)}
          />
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Choose Progress Version</Text>
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
                      <Text numberOfLines={1} style={styles.pickerLanguageText}>
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
              onPress={openDownloaderFromPicker}
              accessibilityRole="button"
              accessibilityLabel="Download more Bible versions"
            >
              <Text style={styles.pickerDownloadText}>+ Download More Versions</Text>
            </ScalePressable>
          </View>
        </View>
      </Modal>

      {/* In-tab downloader modal */}
      <Modal
        visible={downloaderOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setDownloaderOpen(false)}
      >
        <View style={[styles.downloaderScreen, { backgroundColor: theme.background, paddingTop: insets.top }]}>
          <View style={styles.downloaderHeader}>
            <ScalePressable
              style={styles.downloaderClose}
              onPress={() => setDownloaderOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close version downloader"
            >
              <Text style={styles.downloaderCloseText}>Close ✕</Text>
            </ScalePressable>
            <Text numberOfLines={1} style={styles.downloaderTitle}>Download Version</Text>
            <View style={styles.downloaderHeaderSpacer} />
          </View>
          {downloaderLoading ? (
            <ActivityIndicator style={styles.downloaderSpinner} size="large" color={theme.primary} />
          ) : null}
          {!downloaderLoading ? (
            <FlatList
              style={styles.downloaderList}
              contentContainerStyle={styles.downloaderListContent}
              data={downloaderRows}
              keyExtractor={(item) => item.key}
              renderItem={renderDownloaderRow}
            />
          ) : null}
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
      maxWidth: 150,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 10,
      paddingVertical: 6,
      minHeight: 38,
      justifyContent: 'center',
    },
    versionBadgeText: { color: theme.primary, fontSize: 13, fontWeight: '700', lineHeight: 22 },
    content: {
      padding: 16,
      paddingBottom: 40,
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
      maxWidth: 200,
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
      minWidth: 150,
      alignItems: 'center',
      justifyContent: 'center',
      borderColor: theme.primary,
      borderStyle: 'dashed',
    },
    addVersionPillText: {
      color: theme.primary,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 22,
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
    // 66-book grid — two flat columns per testament via FlatList numColumns=2
    testamentSection: { gap: 8 },
    testamentTitle: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 22,
      paddingHorizontal: 2,
    },
    gridList: { flexGrow: 0 },
    gridColumn: { justifyContent: 'space-between', marginBottom: 10 },
    bookTile: {
      width: '48.5%',
      minHeight: 88,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 12,
      justifyContent: 'space-between',
      gap: 6,
    },
    bookTileComplete: {
      borderColor: theme.primary,
      backgroundColor: theme.surfaceMuted,
    },
    bookTileName: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 20,
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
    // Chapter modal
    modalScreen: { flex: 1 },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      backgroundColor: theme.surface,
    },
    modalClose: { color: theme.text, fontSize: 18, fontWeight: '700' },
    modalHeaderText: { flex: 1, gap: 1 },
    modalTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
    modalSubtitle: { color: theme.textMuted, fontSize: 12, fontWeight: '600' },
    modalHeaderSpacer: { width: 18 },
    chapterWrap: { padding: 12, paddingBottom: 40 },
    chapterGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chapterCell: {
      width: '17%',
      aspectRatio: 1,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
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
    chapterCellText: { color: theme.text, fontSize: 15, fontWeight: '700' },
    chapterCellTextRead: { color: theme.primaryForeground },
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
    pickerTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
    pickerClose: { color: theme.textMuted, fontSize: 16, fontWeight: '700', padding: 4 },
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
      maxWidth: 108,
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
    // Downloader modal
    downloaderScreen: { flex: 1 },
    downloaderHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      backgroundColor: theme.surface,
    },
    downloaderClose: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 12,
      paddingVertical: 7,
      minHeight: 38,
      justifyContent: 'center',
    },
    downloaderCloseText: {
      color: theme.primary,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 22,
    },
    downloaderTitle: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '700',
      flex: 1,
      textAlign: 'center',
    },
    downloaderHeaderSpacer: { width: 74 },
    downloaderSpinner: { marginTop: 32 },
    downloaderList: { flex: 1 },
    downloaderListContent: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 32,
      gap: 10,
    },
    downloaderGroupLabel: {
      color: theme.primary,
      fontSize: 13,
      fontWeight: '800',
      lineHeight: 22,
      marginTop: 8,
    },
    downloaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 12,
    },
    downloaderMeta: { flex: 1, gap: 2 },
    downloaderName: { color: theme.text, fontSize: 14, fontWeight: '700' },
    downloaderSub: { color: theme.textMuted, fontSize: 12 },
    downloaderButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 10,
      backgroundColor: theme.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      minHeight: 38,
    },
    downloaderButtonBusy: { opacity: 0.75 },
    downloaderButtonText: { color: theme.primaryForeground, fontSize: 13, fontWeight: '700' },
  });
}
