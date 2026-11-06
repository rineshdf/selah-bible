/**
 * Tab 2: Date-sorted highlights.
 *
 * Loads every row from the `highlights` table (created_date DESC, id DESC).
 * A top bar carries the Sun/Moon theme toggle, a color filter row, and a
 * date filter bar powered by the PremiumCalendarModal (year selector + a
 * one-tap "All Dates" reset). Highlights group under human date headers and
 * every verse carries a day-wise serial number badge (1. 2. 3. ...) plus a
 * `Language • Version` pill resolved from the on-device version registry.
 * Rows can be deleted (with confirmation) or tapped to open the full chapter
 * in a full-screen reader (auto-scrolled to the highlighted verse).
 * `EmptyHighlightsSvg` shows when nothing matches.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/constants/ThemeContext';
import { HIGHLIGHT_COLORS, getHighlightStyle, type AppTheme } from '@/constants/colors';
import { deleteHighlight, getAllHighlights, type HighlightRow } from '@/db/database';
import SerialBadge from '@/components/SerialBadge';
import { ScalePressable } from '@/components/ScalePressable';
import {
  DEFAULT_TAMIL_BSI_META,
  TAMIL_BSI_ID,
  downloadBibleVersion,
  getInstalledVersions,
  getVersionBookNames,
  isVersionDownloaded,
  loadChapterVerses,
  normalizeVersionId,
  type BibleVersionMeta,
  type ChapterVerse,
} from '@/db/bibleLoader';
import {
  DEFAULT_VERSIONS,
  getMergedCatalogVersions,
  languageDisplayLabel,
} from '@/constants/versionCatalog';
import {
  BIBLE_BOOKS,
  getLocalizedBookName,
  type BookLanguageVersionMeta,
} from '@/constants/books';
import AppHeader from '@/components/AppHeader';
import AnimatedCard from '@/components/AnimatedCard';
import PremiumCalendarModal, { todayIsoDate } from '@/components/PremiumCalendarModal';
import { CalendarSvg, EmptyHighlightsSvg } from '@/components/SvgIcons';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** 'YYYY-MM-DD' minus/plus N days, keeping the same local calendar. */
function isoDateShifted(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map((part) => Number(part));
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Human header for a highlight day: "Today — Nov 3, 2026", etc. */
function dateHeaderLabel(isoDate: string): string {
  const today = todayIsoDate();
  const parts = isoDate.split('-');
  const monthIndex = Number(parts[1]) - 1;
  const formatted = monthIndex >= 0 && monthIndex <= 11
    ? `${MONTH_NAMES[monthIndex]} ${Number(parts[2])}, ${parts[0]}`
    : isoDate;
  if (isoDate === today) return `Today — ${formatted}`;
  if (isoDate === isoDateShifted(today, -1)) return `Yesterday — ${formatted}`;
  return formatted;
}

interface HighlightSection {
  key: string;
  title: string;
  data: { row: HighlightRow; serial: number }[];
  dateIso: string;
}

/** Group the (already newest-first) rows into contiguous date sections. */
function groupByDate(rows: HighlightRow[]): HighlightSection[] {
  const counters = new Map<string, number>();
  const sections: HighlightSection[] = [];
  for (const row of rows) {
    const next = (counters.get(row.created_date) ?? 0) + 1;
    counters.set(row.created_date, next);
    const last = sections[sections.length - 1];
    if (last && last.dateIso === row.created_date) {
      last.data.push({ row, serial: next });
    } else {
      sections.push({
        key: row.created_date,
        title: dateHeaderLabel(row.created_date),
        dateIso: row.created_date,
        data: [{ row, serial: next }],
      });
    }
  }
  return sections;
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

/** Everything the pill / reader subtitle needs about one bible version. */
interface VersionIdentity {
  id: string;
  name: string;
  shortName: string;
  languageLabel: string;
  /** "Language • short name" — the per-card pill text. */
  pillLabel: string;
  /** "Language • full name" — the reader subtitle text. */
  fullLabel: string;
}

const FALLBACK_IDENTITY: VersionIdentity = {
  id: TAMIL_BSI_ID,
  name: DEFAULT_TAMIL_BSI_META.name,
  shortName: DEFAULT_TAMIL_BSI_META.shortName,
  languageLabel: DEFAULT_TAMIL_BSI_META.language,
  pillLabel: `${DEFAULT_TAMIL_BSI_META.language} • ${DEFAULT_TAMIL_BSI_META.shortName}`,
  fullLabel: `${DEFAULT_TAMIL_BSI_META.language} • ${DEFAULT_TAMIL_BSI_META.name}`,
};

/**
 * Last-resort identity: derive a clean label from the raw stored version key
 * instead of wrongly falling back to the Tamil BSI identity. Downloaded or
 * migrated rows still show their own version name this way.
 */
function identityFromRawKey(rawKey: string): VersionIdentity {
  const normalized = normalizeVersionId(rawKey) || rawKey;
  const humanized = rawKey.replace(/[\s_-]+/g, ' ').trim() || normalized;
  return {
    id: normalized,
    name: humanized,
    shortName: humanized,
    languageLabel: '',
    pillLabel: `— • ${humanized}`,
    fullLabel: humanized,
  };
}

interface HighlightCardProps {
  /** One `{ row, serial }` datum from the rendered SectionList section. */
  item: { row: HighlightRow; serial: number };
  styles: ReturnType<typeof makeStyles>;
  isDark: boolean;
  /** Row-body surface color from the active theme (primitive prop). */
  surfaceColor: string;
  /** Stable helpers resolved once per row render inside the card. */
  identityFor: (row: HighlightRow) => VersionIdentity;
  labelFor: (row: HighlightRow | null) => string;
  onPress: (row: HighlightRow) => void;
  onDelete: (row: HighlightRow) => void;
}

/**
 * Memoized highlight card: every prop except `item` is a stable reference or
 * primitive, so opening the reader / editing a row only re-renders the rows
 * whose data changed instead of the whole virtualized list.
 */
const HighlightCard = memo(function HighlightCard({
  item,
  styles,
  isDark,
  surfaceColor,
  identityFor,
  labelFor,
  onPress,
  onDelete,
}: HighlightCardProps) {
  const { row, serial } = item;
  const identity = identityFor(row);
  const bookLabel = labelFor(row);
  // 3px left accent border in the highlight's palette color.
  const accent = getHighlightStyle(row.color_hex, isDark);
  return (
    <View style={styles.rowCard}>
      <ScalePressable
        style={[
          styles.rowBody,
          {
            backgroundColor: surfaceColor,
            borderLeftWidth: 3,
            borderLeftColor: accent.borderColor,
          },
        ]}
        onPress={() => onPress(row)}
        accessibilityRole="button"
        accessibilityLabel={`Read ${bookLabel} ${row.chapter}:${row.verse} in the full chapter reader`}
      >
        <View style={styles.rowTopLine}>
          <SerialBadge number={serial} color={row.color_hex} />
          <Text style={styles.rowReference}>
            {bookLabel} {row.chapter}:{row.verse}
          </Text>
          <Text style={styles.rowJumpHint}>Read →</Text>
        </View>
        <View style={styles.versionPill}>
          <Text style={styles.versionPillText}>
            {identity.pillLabel}
          </Text>
        </View>
        <Text numberOfLines={3} style={styles.rowText}>
          {row.verse_text}
        </Text>
      </ScalePressable>
      <Pressable
        style={styles.rowDelete}
        hitSlop={8}
        onPress={() => onDelete(row)}
        accessibilityRole="button"
        accessibilityLabel={`Delete highlight ${bookLabel} ${row.chapter}:${row.verse}`}
      >
        <Text style={styles.rowDeleteIcon}>✕</Text>
      </Pressable>
    </View>
  );
});

interface ReaderVerseProps {
  verseNumber: number;
  verseText: string;
  highlightBg: string | null;
  highlightBorder: string | null;
  highlightText: string | null;
  isTarget: boolean;
  isDark: boolean;
  styles: ReturnType<typeof makeStyles>;
}

/**
 * Reader chapter row — memoized on primitives so long chapters scroll fast.
 * FIX 1: unhighlighted verses render with explicit slates (light `#F1F5F9`
 * text on dark, deep `#0F172A` on light) instead of the raw default, which is
 * pitch black and invisible on the dark reader background.
 */
const ReaderVerseRow = memo(function ReaderVerseRow({
  verseNumber,
  verseText,
  highlightBg,
  highlightBorder,
  highlightText,
  isTarget,
  isDark,
  styles,
}: ReaderVerseProps) {
  // Plain-verse palette (FIX 1): never black in Dark Mode.
  const baseTextColor = isDark ? '#F1F5F9' : '#0F172A';
  const numberBadgeColor = isDark ? '#94A3B8' : '#475569';
  const numberBadgeBg = isDark ? '#1E293B' : '#F1F5F9';
  return (
    <View
      style={[
        styles.readerVerse,
        highlightBg ? { backgroundColor: highlightBg } : null,
        highlightBorder ? { borderLeftWidth: 3, borderLeftColor: highlightBorder } : null,
        isTarget ? styles.readerVerseTarget : null,
        isTarget && isDark ? styles.readerVerseTargetDark : null,
      ]}
    >
      <View
        style={[
          styles.readerVerseNumberBadge,
          { backgroundColor: highlightBg ?? numberBadgeBg },
        ]}
      >
        <Text
          style={[
            styles.readerVerseNumber,
            { color: highlightBorder ?? numberBadgeColor },
          ]}
        >
          {verseNumber}
        </Text>
      </View>
      <Text
        style={[styles.readerVerseText, { color: highlightText ?? baseTextColor }]}
      >
        {verseText}
      </Text>
      {isTarget ? (
        <View style={[styles.readerTargetPill, isDark ? styles.readerTargetPillDark : null]}>
          <Text style={styles.readerTargetPillText}>★ Highlighted Verse</Text>
        </View>
      ) : null}
    </View>
  );
});

export default function HighlightsScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  const [highlights, setHighlights] = useState<HighlightRow[]>([]);
  const [installedMetas, setInstalledMetas] = useState<BibleVersionMeta[]>([]);
  const [filterColorHex, setFilterColorHex] = useState<string | null>(null);
  /** null = All Dates; otherwise a 'YYYY-MM-DD' filter. */
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [contextHighlight, setContextHighlight] = useState<HighlightRow | null>(null);
  const [contextVerses, setContextVerses] = useState<ChapterVerse[]>([]);
  const [contextIdentity, setContextIdentity] = useState<VersionIdentity | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextProgress, setContextProgress] = useState<number | null>(null);
  const [contextAvailable, setContextAvailable] = useState(false);

  /** Reader chapter list — drives scrollToIndex for the highlighted verse. */
  const chapterListRef = useRef<FlatList<ChapterVerse> | null>(null);

  const reload = useCallback(() => {
    setHighlights(getAllHighlights());
    void getInstalledVersions()
      .then((metas) => setInstalledMetas(metas))
      .catch(() => undefined);
  }, []);

  // Re-read the table every time the tab regains focus (rows change when the
  // user highlights verses in the reader).
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  /**
   * Every identity the tab can resolve: on-device registry metas first, then
   * the bundled catalog entries so older numeric hashes still find a label.
   */
  const versionIdentities = useMemo<VersionIdentity[]>(() => {
    const identities: VersionIdentity[] = [];
    const pushIdentity = (
      id: string,
      name: string,
      shortName: string,
      languageLabel: string,
    ) => {
      const normalized = normalizeVersionId(id) || id;
      if (identities.some((identity) => identity.id === normalized)) return;
      identities.push({
        id: normalized,
        name,
        shortName,
        languageLabel,
        pillLabel: `${languageLabel || '—'} • ${shortName}`,
        fullLabel: `${languageLabel || '—'} • ${name}`,
      });
    };
    for (const meta of installedMetas) {
      pushIdentity(meta.id, meta.name, meta.shortName, meta.language);
    }
    for (const version of DEFAULT_VERSIONS) {
      pushIdentity(
        version.id,
        version.name,
        version.shortName,
        languageDisplayLabel(version.languageName, version.languageCode),
      );
    }
    return identities;
  }, [installedMetas]);

  /** Resolve a highlight row's version identity: version_key first, then the id hash. */
  const identityForRow = useCallback(
    (row: HighlightRow): VersionIdentity => {
      if (row.version_key) {
        const byKey = versionIdentities.find(
          (identity) => identity.id === normalizeVersionId(row.version_key),
        );
        if (byKey) return byKey;
        // The stored key is not one of the known versions — never brand it
        // "Tamil BSI"; derive its own label instead.
        return identityFromRawKey(row.version_key);
      }
      const byHash = versionIdentities.find((identity) => (
        numericVersionId(identity.id) === row.version_id ||
        numericVersionId(identity.id.trim().toLowerCase()) === row.version_id
      ));
      return byHash ?? FALLBACK_IDENTITY;
    },
    [versionIdentities],
  );

  /**
   * Version id used for localized book names of one highlight row: the stored
   * `version_key` when present, otherwise the identity hash-matched registry
   * id, and finally the bundled Tamil BSI.
   */
  const resolveRowVersionId = useCallback(
    (row: HighlightRow): string => {
      if (row.version_key) {
        return normalizeVersionId(row.version_key) || row.version_key;
      }
      const byHash = versionIdentities.find((identity) => (
        numericVersionId(identity.id) === row.version_id ||
        numericVersionId(identity.id.trim().toLowerCase()) === row.version_id
      ));
      return byHash?.id ?? TAMIL_BSI_ID;
    },
    [versionIdentities],
  );

  /** Native book-name maps per resolved version id ('eng_kjv' → {1: 'Genesis'}). */
  const [customBookNames, setCustomBookNames] = useState<Record<string, Record<number, string>>>({});
  /** De-dupes in-flight loads so re-renders never spawn an effect loop. */
  const pendingBookNamesRef = useRef(new Set<string>());

  /**
   * Load `getVersionBookNames` for every version referenced by the loaded
   * highlights (and by the open reader). Bundled Tamil BSI resolves to an
   * empty map — its names come from `@/constants/books` directly.
   */
  useEffect(() => {
    const wanted = new Set<string>();
    for (const row of highlights) wanted.add(resolveRowVersionId(row));
    if (contextHighlight) wanted.add(resolveRowVersionId(contextHighlight));
    const missing = [...wanted].filter(
      (id) => !(id in customBookNames) && !pendingBookNamesRef.current.has(id),
    );
    if (missing.length === 0) return;
    for (const id of missing) pendingBookNamesRef.current.add(id);
    let cancelled = false;
    void Promise.all(
      missing.map(async (id) => {
        try {
          return [id, await getVersionBookNames(id)] as const;
        } catch {
          return [id, {} as Record<number, string>] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setCustomBookNames((previous) => {
        const next = { ...previous };
        for (const [id, names] of entries) next[id] = names;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [contextHighlight, customBookNames, highlights, resolveRowVersionId]);

  /** Language metadata for `getLocalizedBookName` from registry / catalog. */
  const versionMetaForRow = useCallback(
    (versionId: string): BookLanguageVersionMeta => {
      const installed = installedMetas.find((meta) => meta.id === versionId);
      if (installed) {
        return { id: installed.id, language: installed.language, languageCode: installed.languageCode };
      }
      const catalog = DEFAULT_VERSIONS.find((item) => normalizeVersionId(item.id) === versionId);
      if (catalog) {
        return { id: versionId, language: catalog.languageName, languageCode: catalog.languageCode };
      }
      return { id: versionId, language: '' };
    },
    [installedMetas],
  );

  /**
   * Localized primary book name for a highlight row: the native name of the
   * row's own version language (Tamil → தமிழ், English → English, others →
   * the version JSON's native names or the built-in IRV dictionaries).
   */
  const localizedBookNameFor = useCallback(
    (row: HighlightRow | null): string => {
      if (!row) return '';
      const book = BIBLE_BOOKS[row.book_id - 1];
      if (!book) return row.book_name;
      const versionId = resolveRowVersionId(row);
      const localized = getLocalizedBookName(
        row.book_id,
        versionMetaForRow(versionId),
        customBookNames[versionId] ?? null,
      );
      return localized.primaryName || book.englishName;
    },
    [customBookNames, resolveRowVersionId, versionMetaForRow],
  );
  const applyColorFilter = useCallback(
    (hex: string | null) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setFilterColorHex(hex);
    },
    [setFilterColorHex],
  );

  /** Apply the date filter with a smooth native layout transition. */
  const applyDateFilter = useCallback(
    (iso: string | null) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setFilterDate(iso);
    },
    [setFilterDate],
  );

  const filtered = useMemo(() => highlights.filter((row) => (
    (filterColorHex === null || row.color_hex === filterColorHex) &&
    (filterDate === null || row.created_date === filterDate)
  )), [filterColorHex, filterDate, highlights]);

  const sections = useMemo(() => groupByDate(filtered), [filtered]);

  /**
   * Every highlight saved on the SAME date in the SAME chapter — used by the
   * full-chapter reader so all multi-verse highlights of that day render
   * together with the adaptive highlight style.
   */
  const contextChapterHighlights = useMemo(() => {
    const rows = new Map<number, HighlightRow>();
    if (!contextHighlight) return rows;
    for (const row of highlights) {
      if (
        row.book_id === contextHighlight.book_id &&
        row.chapter === contextHighlight.chapter &&
        row.created_date === contextHighlight.created_date
      ) {
        rows.set(row.verse, row);
      }
    }
    return rows;
  }, [contextHighlight, highlights]);

  const handleJumpToVerse = useCallback(async (row: HighlightRow) => {
    const identity = identityForRow(row);
    setContextHighlight(row);
    setContextVerses([]);
    setContextError(null);
    setContextIdentity(identity);
    setContextLoading(true);
    const resolvedVersionId = row.version_key || identity.id || TAMIL_BSI_ID;
    const resolvedId = normalizeVersionId(resolvedVersionId);
    try {
      const installed = await isVersionDownloaded(resolvedId);
      if (installed) {
        setContextAvailable(true);
        // Partial versions redirect missing books/chapters — the reader shows
        // exactly what the version actually serves.
        const loaded = await loadChapterVerses(resolvedId, row.book_id, row.chapter);
        setContextVerses(loaded.verses);
      } else {
        setContextAvailable(false);
        setContextError('This Bible version is not on this device. Download it to read the full chapter.');
      }
    } catch (error) {
      setContextAvailable(false);
      setContextError(
        error instanceof Error
          ? error.message
          : 'Could not open this chapter.',
      );
    } finally {
      setContextLoading(false);
    }
  }, [identityForRow]);

  /** Once the reader is ready, scroll the highlighted verse into view (22% from top). */
  useEffect(() => {
    if (!contextHighlight || !contextAvailable || contextVerses.length === 0) return;
    const index = contextVerses.findIndex((verse) => verse.verse === contextHighlight.verse);
    if (index < 0) return;
    const timer = setTimeout(() => {
      try {
        chapterListRef.current?.scrollToIndex({ index, viewPosition: 0.22, animated: false });
      } catch {
        // Estimation failures are non-fatal: the chapter itself is open.
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [contextAvailable, contextHighlight, contextVerses]);

  /** FlatList frame-estimation fallback: land near the verse, then let the
   *  effect retry positioning when the target row finishes measuring. */
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      chapterListRef.current?.scrollToOffset({
        offset: Math.max(0, info.index * info.averageItemLength),
        animated: false,
      });
    },
    [],
  );

  const handleRedownloadContext = useCallback(async () => {
    if (!contextHighlight) return;
    const identity = contextIdentity ?? FALLBACK_IDENTITY;
    let version = DEFAULT_VERSIONS.find((item) => normalizeVersionId(item.id) === identity.id);
    if (!version && contextHighlight.version_key) {
      try {
        const merged = await getMergedCatalogVersions();
        version = merged.find(
          (item) => normalizeVersionId(item.id) === normalizeVersionId(contextHighlight.version_key),
        );
      } catch {
        // Keep the message below if the catalog is unreachable.
      }
    }
    if (!version) {
      setContextError('This Bible version is not available to download.');
      return;
    }
    setContextProgress(0);
    try {
      await downloadBibleVersion(version, (event) => setContextProgress(event.percent));
      const loaded = await loadChapterVerses(identity.id, contextHighlight.book_id, contextHighlight.chapter);
      setContextVerses(loaded.verses);
      setContextAvailable(true);
      setContextError(null);
    } catch (error) {
      setContextError(error instanceof Error ? error.message : 'Download failed. Try again.');
    } finally {
      setContextProgress(null);
    }
  }, [contextHighlight, contextIdentity]);

  const handleDelete = useCallback((row: HighlightRow) => {
    Alert.alert(
      'Delete highlight?',
      `${localizedBookNameFor(row)} ${row.chapter}:${row.verse}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            deleteHighlight(row.id);
            setHighlights((previous) => previous.filter((item) => item.id !== row.id));
          },
        },
      ],
    );
  }, [localizedBookNameFor]);

  /** Rows feed the memoized `HighlightCard`; all callback props stay stable. */
  const renderHighlightRow = useCallback(
    ({ item }: { item: { row: HighlightRow; serial: number } }) => (
      <HighlightCard
        item={item}
        styles={styles}
        isDark={theme.isDark}
        surfaceColor={theme.surface}
        identityFor={identityForRow}
        labelFor={localizedBookNameFor}
        onPress={handleJumpToVerse}
        onDelete={handleDelete}
      />
    ),
    [handleDelete, handleJumpToVerse, identityForRow, localizedBookNameFor, styles, theme.isDark, theme.surface],
  );

  /** Stable date-group header so SectionList never re-aligns rows needlessly. */
  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => (
      <Text style={styles.sectionHeader}>{section.title}</Text>
    ),
    [styles],
  );

  /** Stable row keys for the SectionList reconciliation. */
  const highlightKey = useCallback((item: { row: HighlightRow }) => `${item.row.id}`, []);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {/* Compact top bar with the global theme toggle on the right */}
      <AppHeader
        title="Highlights"
        right={
          <Text style={styles.headerCount}>
            {filtered.length} {filtered.length === 1 ? 'verse' : 'verses'}
          </Text>
        }
      />

      {/* Date & color filter bar */}
      <View style={styles.filterBar}>
        <ScalePressable
          style={[
            styles.dateFilterButton,
            filterDate ? styles.dateFilterButtonActive : null,
          ]}
          onPress={() => setCalendarOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Filter highlights by date"
        >
          <CalendarSvg
            size={16}
            color={filterDate ? theme.primaryForeground : theme.primary}
          />
          <Text
            numberOfLines={1}
            style={[
              styles.dateFilterText,
              filterDate ? styles.dateFilterTextActive : null,
            ]}
          >
            {filterDate ?? 'All Dates'}
          </Text>
        </ScalePressable>
        {filterDate ? (
          <ScalePressable
            style={styles.allDatesButton}
            onPress={() => applyDateFilter(null)}
            accessibilityRole="button"
            accessibilityLabel="Show all dates"
          >
            <Text style={styles.allDatesText}>All Dates</Text>
          </ScalePressable>
        ) : null}
        <View style={styles.filterControls}>
          {HIGHLIGHT_COLORS.map((color) => {
            const active = filterColorHex === color.hex;
            return (
              <ScalePressable
                key={color.key}
                style={[
                  styles.filterColorDot,
                  { backgroundColor: color.hex },
                  active ? styles.filterColorDotActive : null,
                ]}
                onPress={() => applyColorFilter(active ? null : color.hex)}
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${color.englishName} highlights`}
              />
            );
          })}
        </View>
      </View>

      <SectionList
        style={styles.sectionList}
        contentContainerStyle={styles.sectionListContent}
        sections={sections}
        keyExtractor={highlightKey}
        renderItem={renderHighlightRow}
        renderSectionHeader={renderSectionHeader}
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={5}
        removeClippedSubviews={Platform.OS === 'android'}
        ListEmptyComponent={
          <AnimatedCard>
            <View style={styles.emptyCard}>
              <EmptyHighlightsSvg size={72} color={theme.textMuted} />
              <Text style={styles.emptyTitle}>
                {filterColorHex || filterDate ? 'Nothing matches this filter' : 'No highlights yet'}
              </Text>
              <Text style={styles.emptyMessage}>
                Open the Bible tab, tap a verse and pick one of the five colors
                to save it here.
              </Text>
            </View>
          </AnimatedCard>
        }
        stickySectionHeadersEnabled={false}
      />

      {/* Full-screen chapter reader over the highlighted verse — 100% of the
          screen, zero dead band above the header. `statusBarTranslucent={false}`
          (the default, stated explicitly) makes the OS position the modal
          window BELOW the status bar on Android, so the header only needs
          tight padding — the old `topModalInset` band painted a blank
          36-46px dark gap above `Close ✕` / `Genesis 1`. */}
      <Modal
        visible={contextHighlight !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent={false}
        onRequestClose={() => setContextHighlight(null)}
      >
        <View style={[styles.readerScreen, { backgroundColor: theme.background }]}>
          {/* Reader header — clean, tight vertical padding (no nested wrapper
              view above the header applies any extra paddingTop/margin). */}
          <View
            style={[
              styles.readerHeader,
              {
                paddingTop: Platform.OS === 'android' ? 12 : Math.max(insets.top, 12),
                paddingBottom: 12,
              },
            ]}
          >
            <ScalePressable
              style={styles.readerClose}
              onPress={() => setContextHighlight(null)}
              accessibilityRole="button"
              accessibilityLabel="Close full chapter reader"
            >
              <Text style={styles.readerCloseText}>Close ✕</Text>
            </ScalePressable>
            <View style={styles.readerHeaderMeta}>
              <Text style={styles.readerTitle}>
                {contextHighlight
                  ? `${localizedBookNameFor(contextHighlight)} ${contextHighlight.chapter}`
                  : 'Chapter'}
              </Text>
              <View style={styles.readerSubtitlePill}>
                <Text style={styles.readerSubtitlePillText}>
                  {contextIdentity?.fullLabel ?? contextHighlight?.version_key ?? FALLBACK_IDENTITY.fullLabel}
                </Text>
              </View>
            </View>
          </View>

          {contextLoading ? <ActivityIndicator style={styles.readerSpinner} size="large" color={theme.primary} /> : null}

          {!contextLoading && contextError ? (
            <ScrollView contentContainerStyle={styles.readerMessage}>
              <Text style={styles.readerError}>{contextError}</Text>
              {!contextAvailable && contextProgress !== null ? (
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${contextProgress}%` }]} />
                </View>
              ) : null}
              {!contextAvailable && contextProgress === null ? (
                <ScalePressable
                  style={styles.downloadButton}
                  onPress={() => void handleRedownloadContext()}
                  accessibilityRole="button"
                >
                  <Text style={styles.downloadButtonText}>Download Bible</Text>
                </ScalePressable>
              ) : null}
            </ScrollView>
          ) : null}

          {Boolean(contextAvailable && contextHighlight && !contextLoading) ? (
            <FlatList
              ref={chapterListRef}
              data={contextVerses}
              keyExtractor={(verse) => String(verse.verse)}
              renderItem={({ item }) => {
                // ALL verses highlighted (in any palette color) on this date
                // in this chapter get their adaptive highlight style.
                const chapterHighlight = contextChapterHighlights.get(item.verse);
                const highlightStyle = chapterHighlight
                  ? getHighlightStyle(chapterHighlight.color_hex, theme.isDark)
                  : null;
                return (
                  <ReaderVerseRow
                    verseNumber={item.verse}
                    verseText={item.text}
                    highlightBg={highlightStyle?.backgroundColor ?? null}
                    highlightBorder={highlightStyle?.borderColor ?? null}
                    highlightText={highlightStyle?.textColor ?? null}
                    isTarget={contextHighlight ? item.verse === contextHighlight.verse : false}
                    isDark={theme.isDark}
                    styles={styles}
                  />
                );
              }}
              extraData={`${contextHighlight?.verse ?? 0}|${theme.isDark}`}
              contentContainerStyle={styles.readerVerses}
              onScrollToIndexFailed={handleScrollToIndexFailed}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
            />
          ) : null}
        </View>
      </Modal>

      <PremiumCalendarModal
        visible={calendarOpen}
        selectedDate={filterDate ?? todayIsoDate()}
        onSelectDate={(iso) => applyDateFilter(iso)}
        onClose={() => setCalendarOpen(false)}
        markedDates={highlights.map((row) => row.created_date)}
        title="Filter Highlights by Date"
      />
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1 },
    headerCount: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    filterBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: theme.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    dateFilterButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 38,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: theme.surfaceMuted,
      flexShrink: 1,
    },
    dateFilterButtonActive: {
      backgroundColor: theme.primary,
    },
    dateFilterText: {
      color: theme.primary,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 22,
    },
    dateFilterTextActive: { color: theme.primaryForeground },
    allDatesButton: {
      minHeight: 38,
      justifyContent: 'center',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    allDatesText: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 22,
    },
    filterControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginLeft: 'auto',
    },
    filterColorDot: {
      width: 24,
      height: 24,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    filterColorDotActive: {
      borderColor: theme.text,
      borderWidth: 2,
    },
    sectionList: { flex: 1 },
    sectionListContent: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 32,
    },
    sectionHeader: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 22,
      paddingTop: 12,
      paddingBottom: 6,
    },
    rowCard: {
      flexDirection: 'row',
      alignItems: 'stretch',
      marginBottom: 8,
      gap: 4,
    },
    rowBody: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 12,
      gap: 7,
    },
    rowTopLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    versionPill: {
      alignSelf: 'flex-start',
      maxWidth: '100%',
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      paddingHorizontal: 9,
      paddingVertical: 3,
    },
    versionPillText: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '600',
      lineHeight: 16,
    },
    readerScreen: { flex: 1 },
    readerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      backgroundColor: theme.surface,
    },
    readerClose: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 12,
      paddingVertical: 7,
      minHeight: 38,
      justifyContent: 'center',
    },
    readerCloseText: {
      color: theme.primary,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 22,
    },
    readerHeaderMeta: { flex: 1, gap: 5 },
    readerTitle: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '700',
      lineHeight: 24,
    },
    readerSubtitlePill: {
      alignSelf: 'flex-start',
      maxWidth: '100%',
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      paddingHorizontal: 9,
      paddingVertical: 3,
    },
    readerSubtitlePillText: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '600',
      lineHeight: 16,
    },
    readerSpinner: { marginTop: 32 },
    readerMessage: { padding: 20, gap: 12 },
    readerError: { color: theme.textMuted, fontSize: 14, lineHeight: 21 },
    downloadButton: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: theme.primary, paddingHorizontal: 16, paddingVertical: 10 },
    downloadButtonText: { color: theme.primaryForeground, fontWeight: '700', fontSize: 14 },
    progressTrack: { height: 8, borderRadius: 99, overflow: 'hidden', backgroundColor: theme.surfaceMuted },
    progressFill: { height: '100%', backgroundColor: theme.primary },
    readerVerses: {
      paddingHorizontal: 18,
      paddingVertical: 12,
      paddingBottom: 48,
      gap: 6,
    },
    readerVerse: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingVertical: 7,
      paddingHorizontal: 8,
      borderRadius: 8,
      overflow: 'visible',
    },
    /** Target verse: 2px accent ring so it stands out from palette tints. */
    readerVerseTarget: {
      borderWidth: 2,
      borderColor: theme.primary,
      paddingVertical: 5,
      paddingHorizontal: 6,
    },
    readerVerseTargetDark: { borderColor: theme.primary },
    readerTargetPill: {
      position: 'absolute',
      top: -10,
      right: 8,
      borderRadius: 999,
      backgroundColor: theme.primary,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    readerTargetPillDark: { backgroundColor: theme.primary },
    readerTargetPillText: {
      color: theme.primaryForeground,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.2,
    },
    /** FIX 1 — verse number badge: visible in both themes on a solid capsule. */
    readerVerseNumberBadge: {
      minWidth: 26,
      minHeight: 22,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 7,
      alignItems: 'flex-end',
      justifyContent: 'center',
      marginTop: 6,
    },
    readerVerseNumber: {
      fontSize: 12,
      fontWeight: '800',
      textAlign: 'right',
    },
    readerVerseText: {
      flex: 1,
      fontSize: 17,
      lineHeight: 30,
    },
    rowReference: {
      flex: 1,
      color: theme.text,
      fontSize: 14,
      fontWeight: '700',
    },
    rowJumpHint: {
      color: theme.primary,
      fontSize: 12,
      fontWeight: '600',
    },
    rowText: {
      color: theme.text,
      fontSize: 15,
      lineHeight: 22,
    },
    rowDelete: {
      width: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowDeleteIcon: {
      color: theme.textMuted,
      fontSize: 14,
      fontWeight: '600',
    },
    emptyCard: {
      marginTop: 48,
      marginHorizontal: 8,
      alignItems: 'center',
      gap: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 24,
    },
    emptyTitle: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '700',
      textAlign: 'center',
    },
    emptyMessage: {
      color: theme.textMuted,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
  });
}
