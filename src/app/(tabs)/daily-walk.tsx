/**
 * Tab 4: Daily walk — redesigned for simplicity and clean alignment.
 *
 * A two-row header feeds the day: Row 1 shows `Daily Walk • Today, Nov 3`
 * (weekday + month variants on other dates) with the dark/light toggle; Row 2
 * carries the `↺ Rewind` and `🗓 Calendar` pills plus a compact `Today` chip
 * when viewing another date. Under it sits the compact 7-day strip, feeding
 * four collapsible accordion cards (one open at a time, animated with
 * LayoutAnimation):
 *
 *   1. Rhema — Word from God           (sparkle icon + 5 pastel color dots)
 *   2. Daily Devotion — What I Understood (Bible/book icon)
 *   3. Prayer & Worship — Heart to God (worship hands icon)
 *   4. Prayer Points — Requests & Answers (checklist icon + Answered toggle)
 *
 * Every section holds serial-numbered points (1, 2, 3 …). Under each point
 * sits a `+ Attach Bible Verse` chip — a subtle `📖 + Add supporting Bible
 * verse to Point #N` prompt appears for every point still without one — and
 * an attached verse renders in an indented scripture box ("Book Chapter:Verse
 * (Version)" + text + note box) directly beneath its point.
 *
 * `↺ Rewind` opens a Highlights-style full-screen archive: a count badge, a
 * calendar date filter, live search over Rhema/devotion/prayer notes, and a
 * date-grouped SectionList whose cards carry `SerialBadge`, `✨ Rhema /
 * 📖 Devotion / 🙌 Worship / 🙏 Prayer` tags, highlight-tinted verse blocks
 * and an `Open Day ›` shortcut on every date header.
 *
 * Storage: `daily_entries` (serial points, with point-level verse columns)
 * + `daily_verses` (legacy section verse cards) + `prayer_points` (requests
 * with verse promise columns); legacy `daily_devotions` free-text is imported
 * once, then cleared.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutAnimation,
  Modal,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/constants/ThemeContext';
import { getHighlightStyle, HIGHLIGHT_COLORS, type AppTheme } from '@/constants/colors';
import {
  addDailyEntry,
  addPrayerPoint,
  deleteDailyEntry,
  deleteDailyVerse,
  deletePrayerPoint,
  getDailyDevotion,
  getDailyEntriesForDate,
  getDailyVersesForDate,
  getPrayerPointsForDate,
  getSavedDailyWalkDates,
  setPrayerPointAnswered,
  updateDailyDevotionFields,
  updateDailyEntry,
  updateDailyVerseNote,
  updatePrayerPoint,
  type DailyEntryRow,
  type DailyEntrySection,
  type DailyVerseRow,
  type PrayerPointRow,
} from '@/db/database';
import AnimatedCard from '@/components/AnimatedCard';
import PremiumCalendarModal, {
  dateToIso,
  isoToDate,
  todayIsoDate,
} from '@/components/PremiumCalendarModal';
import VersePickerModal, { type VersePickResult } from '@/components/VersePickerModal';
import SerialBadge from '@/components/SerialBadge';
import { ScalePressable } from '@/components/ScalePressable';
import {
  BibleBookSvg,
  ChecklistSvg,
  PlusVerseSvg,
  PrayerHandsSvg,
  SparkleRhemaSvg,
  SunMoonSvg,
} from '@/components/SvgIcons';

// ---------------------------------------------------------------------------
// Date helpers (device-local, 'YYYY-MM-DD' — matches the DB date format)
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' shifted by N days on the same local calendar. */
function isoShifted(iso: string, days: number): string {
  const date = isoToDate(iso);
  date.setDate(date.getDate() + days);
  return dateToIso(date);
}

/** Monday-based start of the week containing `iso`. */
function startOfWeek(iso: string): string {
  const date = isoToDate(iso);
  const backToMonday = (date.getDay() + 6) % 7;
  return isoShifted(iso, -backToMonday);
}

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Full weekday names for Rewind date headers, e.g. `Tuesday, Nov 3, 2026`. */
const WEEKDAY_FULL_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];
/** Month abbreviations for header titles and Rewind date headers. */
const MONTH_ABBRS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Days of the week containing `weekStartIso` (Monday-first, 7 entries). */
function weekDates(weekStartIso: string): string[] {
  return Array.from({ length: 7 }, (_, index) => isoShifted(weekStartIso, index));
}

/** Accordion card keys — strictly one card open at a time. */
type CardKey = DailyEntrySection | 'prayer';

type PrayerFilter = 'all' | 'answered';

/** One pending verse-insert target: a serial entry point or a prayer point. */
type VerseTarget =
  | { kind: 'entry'; entryId: number }
  | { kind: 'prayer'; pointId: number }
  /** Verse-first composer of the Rhema card (before Save Rhema). */
  | { kind: 'rhema-new' }
  /** Verse that will be attached when the next prayer request is added. */
  | { kind: 'new-prayer' }
  /** Thanksgiving verse attached while marking a prayer answered. */
  | { kind: 'answered-verse'; pointId: number };

/** Animate the next layout change (expand/collapse, add/remove rows). */
function animateLayout(): void {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

/** Display label persisted in `verse_version_id` for every picker result. */
function versionLabelFor(result: VersePickResult): string {
  return `${result.languageName || '—'} • ${result.versionShortName}`;
}

/** One archive row inside a Rewind Past Days date group. */
type RewindItem = {
  kind: 'entry' | 'verse' | 'prayer';
  id: number;
  tag: string;
  text: string;
  verseRef: string | null;
  verseText: string | null;
  verseVersion: string | null;
  highlightColor: string | null;
};

/** One Rewind section: all matching notes saved on one date. */
type RewindSection = {
  date: string;
  dateLabel: string;
  data: RewindItem[];
};

/** Section emoji tags shown next to every Rewind serial badge. */
const REWIND_TAGS: Record<DailyEntrySection | 'prayer', string> = {
  rhema: '✨ Rhema',
  devotion: '📖 Devotion',
  worship: '🙌 Worship',
  prayer: '🙏 Prayer',
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function DailyWalkScreen() {
  const { theme, themeMode, toggleTheme } = useAppTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();

  const today = todayIsoDate();
  const [selectedDate, setSelectedDate] = useState<string>(() => todayIsoDate());
  const [weekStart, setWeekStart] = useState<string>(() => startOfWeek(todayIsoDate()));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [rewindOpen, setRewindOpen] = useState(false);
  const [savedDates, setSavedDates] = useState<string[]>([]);
  /** Rewind archive live-search + optional single-date filter. */
  const [rewindSearch, setRewindSearch] = useState('');
  const [rewindDateFilter, setRewindDateFilter] = useState<string | null>(null);
  const [rewindCalendarOpen, setRewindCalendarOpen] = useState(false);

  /** Which accordion card is expanded (single-open at a time). */
  const [openCard, setOpenCard] = useState<CardKey | null>('rhema');

  const [entries, setEntries] = useState<DailyEntryRow[]>([]);
  const [verseRows, setVerseRows] = useState<DailyVerseRow[]>([]);
  const [points, setPoints] = useState<PrayerPointRow[]>([]);
  const [hydrated, setHydrated] = useState(false);

  /** Draft verse picked in the Rhema card's "1. Select Word of God" step. */
  const [rhemaVerse, setRhemaVerse] = useState<VersePickResult | null>(null);
  const [rhemaReflection, setRhemaReflection] = useState('');
  const [rhemaColor, setRhemaColor] = useState<string | null>(null);
  /** Verse pending attachment to the next prayer request the user adds. */
  const [pendingPrayerVerse, setPendingPrayerVerse] = useState<VersePickResult | null>(null);
  /** Prayer intercepted by the "Mark Prayer as Answered" modal. */
  const [answeredPoint, setAnsweredPoint] = useState<PrayerPointRow | null>(null);

  const [prayerFilter, setPrayerFilter] = useState<PrayerFilter>('all');
  const [newSectionText, setNewSectionText] = useState<Record<DailyEntrySection, string>>({
    rhema: '',
    devotion: '',
    worship: '',
  });
  const [newRequest, setNewRequest] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [verseTarget, setVerseTarget] = useState<VerseTarget | null>(null);

  // --- Day loading ---------------------------------------------------------

  /** One-time legacy import: move `daily_devotions` text into serial entries. */
  const importLegacyDraft = useCallback((dateIso: string): DailyEntryRow[] => {
    const devotion = getDailyDevotion(dateIso);
    let rows = getDailyEntriesForDate(dateIso);
    const has = (section: DailyEntrySection) => rows.some((row) => row.section === section);
    if (devotion) {
      if (devotion.god_spoke_word?.trim() && !has('rhema')) {
        addDailyEntry({
          entry_date: dateIso,
          section: 'rhema',
          content: devotion.god_spoke_word,
          highlight_color: devotion.god_spoke_color,
        });
      }
      if (devotion.understanding_today?.trim() && !has('devotion')) {
        addDailyEntry({
          entry_date: dateIso,
          section: 'devotion',
          content: devotion.understanding_today,
        });
      }
      if (devotion.worship_prayer?.trim() && !has('worship')) {
        addDailyEntry({
          entry_date: dateIso,
          section: 'worship',
          content: devotion.worship_prayer,
        });
      }
      // Clear the legacy text so the import never repeats after a user delete.
      updateDailyDevotionFields(dateIso, {
        god_spoke_word: '',
        understanding_today: '',
        worship_prayer: '',
      });
      rows = getDailyEntriesForDate(dateIso);
    }
    return rows;
  }, []);

  const loadDay = useCallback(
    (dateIso: string) => {
      setEntries(importLegacyDraft(dateIso));
      setVerseRows(getDailyVersesForDate(dateIso));
      setPoints(getPrayerPointsForDate(dateIso));
      setSelectedEntryId(null);
    },
    [importLegacyDraft, setEntries, setPoints, setSelectedEntryId, setVerseRows],
  );

  const refreshSavedDates = useCallback(() => {
    setSavedDates(getSavedDailyWalkDates());
  }, []);

  /** Switching dates (chip tap / calendar): load the new day synchronously. */
  const changeDate = useCallback(
    (dateIso: string) => {
      setWeekStart(startOfWeek(dateIso));
      setSelectedDate(dateIso);
      loadDay(dateIso);
      setCalendarOpen(false);
      setRewindOpen(false);
    },
    [loadDay, setCalendarOpen, setSelectedDate, setWeekStart, setRewindOpen],
  );

  // First paint: hydrate rows for today (deferred so the effect body never
  // synchronously cascades into another render).
  useEffect(() => {
    if (hydrated) return;
    const timer = setTimeout(() => {
      setHydrated(true);
      loadDay(todayIsoDate());
    }, 0);
    return () => clearTimeout(timer);
  }, [hydrated, loadDay]);

  // Re-read rows every time the tab regains focus (deferred via timer; the
  // callback body never cascades synchronously). Memoized on primitive deps.
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => {
        refreshSavedDates();
        setEntries(getDailyEntriesForDate(selectedDate));
        setVerseRows(getDailyVersesForDate(selectedDate));
        setPoints(getPrayerPointsForDate(selectedDate));
      }, 0);
      return () => clearTimeout(timer);
    }, [refreshSavedDates, selectedDate, setEntries, setPoints, setVerseRows]),
  );

  // --- Accordion -------------------------------------------------------------

  /** Expand one card and collapse the others, animated natively. */
  const toggleCard = useCallback(
    (key: CardKey) => {
      animateLayout();
      setOpenCard((current) => (current === key ? null : key));
    },
    [setOpenCard],
  );

  // --- Serial section points (Rhema / Devotion / Worship) --------------------

  const addSectionEntry = useCallback(
    (section: DailyEntrySection) => {
      const text = newSectionText[section].trim();
      if (!text) return;
      animateLayout();
      addDailyEntry({ entry_date: selectedDate, section, content: text });
      setNewSectionText((previous) => ({ ...previous, [section]: '' }));
      setEntries(getDailyEntriesForDate(selectedDate));
    },
    [newSectionText, selectedDate, setEntries, setNewSectionText],
  );

  const changeEntryContent = useCallback(
    (entry: DailyEntryRow, content: string) => {
      setEntries((previous) => previous.map((row) => (
        row.id === entry.id ? { ...row, content } : row
      )));
      updateDailyEntry(entry.id, { content });
    },
    [setEntries],
  );

  const toggleEntryColor = useCallback(
    (entry: DailyEntryRow, hex: string) => {
      const next = entry.highlight_color === hex ? null : hex;
      setEntries((previous) => previous.map((row) => (
        row.id === entry.id ? { ...row, highlight_color: next } : row
      )));
      updateDailyEntry(entry.id, { highlight_color: next });
    },
    [setEntries],
  );

  const removeEntry = useCallback(
    (entry: DailyEntryRow) => {
      animateLayout();
      deleteDailyEntry(entry.id, entry.entry_date, entry.section);
      setEntries(getDailyEntriesForDate(selectedDate));
      setSelectedEntryId(null);
    },
    [selectedDate, setEntries, setSelectedEntryId],
  );

  // --- Point-level verse attachment (all sections) ---------------------------

  const handleInsertVerse = useCallback(
    (result: VersePickResult) => {
      if (!verseTarget) return;
      const ref = `${result.bookName} ${result.chapter}:${result.verse}`;
      const fields = {
        verse_ref: ref,
        verse_text: result.text,
        verse_note: result.note,
        verse_version_id: versionLabelFor(result),
      };
      if (verseTarget.kind === 'entry') {
        updateDailyEntry(verseTarget.entryId, fields);
        setEntries(getDailyEntriesForDate(selectedDate));
      } else if (verseTarget.kind === 'prayer') {
        updatePrayerPoint(verseTarget.pointId, fields);
        setPoints(getPrayerPointsForDate(selectedDate));
      } else if (verseTarget.kind === 'rhema-new') {
        setRhemaVerse(result);
      } else if (verseTarget.kind === 'new-prayer') {
        setPendingPrayerVerse(result);
      } else if (verseTarget.kind === 'answered-verse') {
        // Attach the thanksgiving verse AND stamp the prayer as answered.
        updatePrayerPoint(verseTarget.pointId, fields);
        setPrayerPointAnswered(verseTarget.pointId, true);
        setPoints(getPrayerPointsForDate(selectedDate));
      }
      setVerseTarget(null);
    },
    [selectedDate, setEntries, setPoints, setRhemaVerse, setPendingPrayerVerse, setVerseTarget, verseTarget],
  );

  /** Save Rhema: needs a verse (step 1) + non-empty reflection (step 2). */
  const handleSaveRhema = useCallback(() => {
    if (!rhemaVerse || !rhemaReflection.trim()) return;
    animateLayout();
    addDailyEntry({
      entry_date: selectedDate,
      section: 'rhema',
      content: rhemaReflection.trim(),
      highlight_color: rhemaColor,
      verse_ref: `${rhemaVerse.bookName} ${rhemaVerse.chapter}:${rhemaVerse.verse}`,
      verse_text: rhemaVerse.text,
      verse_note: rhemaVerse.note || null,
      verse_version_id: versionLabelFor(rhemaVerse),
    });
    setRhemaVerse(null);
    setRhemaReflection('');
    setRhemaColor(null);
    setSelectedEntryId(null);
    setEntries(getDailyEntriesForDate(selectedDate));
  }, [rhemaColor, rhemaReflection, rhemaVerse, selectedDate, setEntries, setSelectedEntryId]);

  const detachEntryVerse = useCallback(
    (entry: DailyEntryRow) => {
      animateLayout();
      updateDailyEntry(entry.id, {
        verse_ref: null,
        verse_text: null,
        verse_note: null,
        verse_version_id: null,
      });
      setEntries(getDailyEntriesForDate(selectedDate));
    },
    [selectedDate, setEntries],
  );

  const changeEntryVerseNote = useCallback(
    (entry: DailyEntryRow, note: string) => {
      setEntries((previous) => previous.map((row) => (
        row.id === entry.id ? { ...row, verse_note: note } : row
      )));
      updateDailyEntry(entry.id, { verse_note: note });
    },
    [setEntries],
  );

  // --- Legacy section-level verse cards (daily_verses rows) ------------------

  const changeVerseNote = useCallback((verse: DailyVerseRow, note: string) => {
    setVerseRows((previous) => previous.map((row) => (
      row.id === verse.id ? { ...row, note } : row
    )));
    updateDailyVerseNote(verse.id, note);
  }, [setVerseRows]);

  const removeVerseRow = useCallback(
    (verse: DailyVerseRow) => {
      animateLayout();
      deleteDailyVerse(verse.id);
      setVerseRows(getDailyVersesForDate(selectedDate));
    },
    [selectedDate, setVerseRows],
  );

  // --- Prayer points -----------------------------------------------------------

  const filteredPoints = prayerFilter === 'answered'
    ? points.filter((point) => point.is_answered === 1)
    : points;

  const answeredCount = points.filter((point) => point.is_answered === 1).length;

  const handleAddPoint = useCallback(() => {
    const trimmed = newRequest.trim();
    if (!trimmed) return;
    animateLayout();
    addPrayerPoint({
      entry_date: selectedDate,
      request_text: trimmed,
      answered_date: null,
      ...(pendingPrayerVerse ? {
        verse_ref: `${pendingPrayerVerse.bookName} ${pendingPrayerVerse.chapter}:${pendingPrayerVerse.verse}`,
        verse_text: pendingPrayerVerse.text,
        verse_note: pendingPrayerVerse.note || null,
        verse_version_id: versionLabelFor(pendingPrayerVerse),
      } : {}),
    });
    setNewRequest('');
    setPendingPrayerVerse(null);
    setPoints(getPrayerPointsForDate(selectedDate));
  }, [newRequest, pendingPrayerVerse, selectedDate, setNewRequest, setPendingPrayerVerse, setPoints]);

  const handleTogglePoint = useCallback(
    (point: PrayerPointRow) => {
      // Toggling ON asks about a thanksgiving verse first; OFF clears the stamp.
      if (point.is_answered !== 1) {
        setAnsweredPoint(point);
        return;
      }
      setPrayerPointAnswered(point.id, false);
      setPoints(getPrayerPointsForDate(selectedDate));
    },
    [selectedDate, setAnsweredPoint, setPoints],
  );

  /** "Skip & Mark Answered" — answer without attaching a verse. */
  const handleSkipAnswered = useCallback(() => {
    if (answeredPoint) {
      setPrayerPointAnswered(answeredPoint.id, true);
      setPoints(getPrayerPointsForDate(selectedDate));
    }
    setAnsweredPoint(null);
  }, [answeredPoint, selectedDate, setAnsweredPoint, setPoints]);

  /** "📖 + Add Bible Verse & Mark Answered" — open the picker for the verse. */
  const handleAttachAnsweredVerse = useCallback(() => {
    const point = answeredPoint;
    setAnsweredPoint(null);
    if (point) setVerseTarget({ kind: 'answered-verse', pointId: point.id });
  }, [answeredPoint, setAnsweredPoint, setVerseTarget]);

  const handleDeletePoint = useCallback(
    (point: PrayerPointRow) => {
      animateLayout();
      deletePrayerPoint(point.id);
      setPoints(getPrayerPointsForDate(selectedDate));
    },
    [selectedDate, setPoints],
  );

  const detachPointVerse = useCallback(
    (point: PrayerPointRow) => {
      animateLayout();
      updatePrayerPoint(point.id, {
        verse_ref: null,
        verse_text: null,
        verse_note: null,
        verse_version_id: null,
      });
      setPoints(getPrayerPointsForDate(selectedDate));
    },
    [selectedDate, setPoints],
  );

  const changePointVerseNote = useCallback(
    (point: PrayerPointRow, note: string) => {
      setPoints((previous) => previous.map((row) => (
        row.id === point.id ? { ...row, verse_note: note } : row
      )));
      updatePrayerPoint(point.id, { verse_note: note });
    },
    [setPoints],
  );

  const changePointText = useCallback(
    (point: PrayerPointRow, requestText: string) => {
      setPoints((previous) => previous.map((row) => (
        row.id === point.id ? { ...row, request_text: requestText } : row
      )));
      updatePrayerPoint(point.id, { request_text: requestText });
    },
    [setPoints],
  );

  // --- Week strip -----------------------------------------------------------

  /** Fixed compact 7-day row for the week containing the selected date. */

  const selectedEntries = (section: DailyEntrySection) =>
    entries.filter((entry) => entry.section === section);
  const legacyVersesOf = (section: DailyEntrySection) =>
    verseRows.filter((row) => row.section === section);

  const placeholders: Record<DailyEntrySection, string> = {
    rhema: 'Write the promise or word God placed on your heart today...',
    devotion: "What stood out in today's reading, and how will you apply it?",
    worship: 'Write your personal prayer, thanksgiving, or worship note...',
  };

  // --- Rewind Past Days archive + two-row header title -----------------------

  /** `Daily Walk • Today, Nov 3` (weekday + month variants on other dates). */
  const headerTitle = useMemo(() => {
    const date = isoToDate(selectedDate);
    const label = selectedDate === today
      ? `Today, ${MONTH_ABBRS[date.getMonth()]} ${date.getDate()}`
      : `${WEEKDAY_FULL_NAMES[date.getDay()]}, ${MONTH_ABBRS[date.getMonth()]} ${date.getDate()}`;
    return `Daily Walk • ${label}`;
  }, [selectedDate, today]);

  /**
   * Date-grouped archive backing Rewind Past Days: every saved day holds its
   * serial points, legacy verse cards and prayer points, filtered by the live
   * search (content/verse_ref) and the optional calendar date filter.
   */
  const rewindSections = useMemo<RewindSection[]>(() => {
    const query = rewindSearch.trim().toLowerCase();
    const sections: RewindSection[] = [];
    const dates = savedDates
      .filter((date) => !rewindDateFilter || date === rewindDateFilter)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    for (const date of dates) {
      const items: RewindItem[] = [];
      for (const entry of getDailyEntriesForDate(date)) {
        items.push({
          kind: 'entry',
          id: entry.id,
          tag: REWIND_TAGS[entry.section],
          text: entry.content,
          verseRef: entry.verse_ref,
          verseText: entry.verse_text,
          verseVersion: entry.verse_version_id,
          highlightColor: entry.highlight_color,
        });
      }
      for (const verse of getDailyVersesForDate(date)) {
        items.push({
          kind: 'verse',
          id: verse.id,
          tag: REWIND_TAGS[verse.section],
          text: verse.verse_text ?? '',
          verseRef: verse.verse_ref,
          verseText: verse.verse_text,
          verseVersion: verse.version_short_name ?? null,
          highlightColor: null,
        });
      }
      for (const point of getPrayerPointsForDate(date)) {
        items.push({
          kind: 'prayer',
          id: point.id,
          tag: REWIND_TAGS.prayer,
          text: point.request_text,
          verseRef: point.verse_ref,
          verseText: point.verse_text,
          verseVersion: point.verse_version_id,
          highlightColor: null,
        });
      }
      const matches = query
        ? items.filter(
            (item) =>
              item.text.toLowerCase().includes(query) ||
              (item.verseRef ?? '').toLowerCase().includes(query),
          )
        : items;
      if (matches.length === 0) continue;
      const dateObj = isoToDate(date);
      sections.push({
        date,
        dateLabel: `${WEEKDAY_FULL_NAMES[dateObj.getDay()]}, ${MONTH_ABBRS[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`,
        data: matches,
      });
    }
    return sections;
  }, [savedDates, rewindDateFilter, rewindSearch]);
  const rewindItemTotal = rewindSections.reduce((sum, section) => sum + section.data.length, 0);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      {/* Row 1: `Daily Walk • Today, Nov 3` title + theme toggle */}
      <View style={styles.headerRowTop}>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <ScalePressable
          style={styles.themeToggle}
          onPress={toggleTheme}
          accessibilityRole="button"
          accessibilityLabel="Toggle dark or light theme"
        >
          <SunMoonSvg isDark={themeMode === 'dark'} size={20} color={theme.primary} />
        </ScalePressable>
      </View>
      {/* Row 2: Rewind + Calendar pills, and a Today chip when off today */}
      <View style={styles.headerRowNav}>
        <ScalePressable
          style={styles.headerPillPrimary}
          onPress={() => {
            refreshSavedDates();
            setRewindOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Open saved past days"
        >
          <Text style={styles.headerPillPrimaryText}>↺ Rewind</Text>
        </ScalePressable>
        <ScalePressable
          style={styles.headerPillSecondary}
          onPress={() => setCalendarOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open calendar"
        >
          <Text style={styles.headerPillSecondaryText}>🗓 Calendar</Text>
        </ScalePressable>
        {selectedDate !== today ? (
          <ScalePressable
            style={styles.todayChip}
            onPress={() => changeDate(todayIsoDate())}
            accessibilityRole="button"
            accessibilityLabel="Jump back to today"
          >
            <Text style={styles.todayChipText}>Today</Text>
          </ScalePressable>
        ) : null}
      </View>

      {/* Compact horizontal 7-day strip — fixed height, no tall vertical bars */}
      <View style={styles.strip}>
        <View style={styles.stripRow}>
          {weekDates(weekStart).map((dateIso) => {
            const active = dateIso === selectedDate;
            const isToday = dateIso === today;
            const date = isoToDate(dateIso);
            return (
              <ScalePressable
                key={dateIso}
                style={[styles.dayChip, active ? styles.dayChipActive : null]}
                onPress={() => changeDate(dateIso)}
                accessibilityRole="button"
                accessibilityLabel={`Select date ${dateIso}`}
              >
                <Text
                  style={[
                    styles.dayChipWeekday,
                    active ? styles.dayChipTextActive : null,
                    !active && isToday ? styles.dayChipWeekdayToday : null,
                  ]}
                >
                  {WEEKDAY_NAMES[(date.getDay() + 6) % 7]}
                </Text>
                <Text
                  style={[
                    styles.dayChipNumber,
                    active ? styles.dayChipTextActive : null,
                    !active && isToday ? styles.dayChipNumberToday : null,
                  ]}
                >
                  {date.getDate()}
                </Text>
              </ScalePressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.cards}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Card 1: Rhema — sparkle icon + 5 pastel color dots */}
        <AccordionCard
          key="rhema"
          delay={0}
          styles={styles}
          open={openCard === 'rhema'}
          onToggle={() => toggleCard('rhema')}
          icon={<SparkleRhemaSvg size={18} color={theme.primary} />}
          title="Rhema — Word from God"
          badge={selectedEntries('rhema').length}
        >
        {/* Verse-first rhema composer: 1. Select Word → 2. What God Spoke → Save */}
        <View style={styles.rhemaComposer}>
          {rhemaVerse ? (
            <View style={styles.scriptureBox}>
              <View style={styles.scriptureHeader}>
                <Text numberOfLines={1} style={styles.scriptureRef}>
                  📖 {rhemaVerse.bookName} {rhemaVerse.chapter}:{rhemaVerse.verse}
                </Text>
                <Pressable
                  hitSlop={6}
                  onPress={() => setRhemaVerse(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove selected Word of God verse"
                >
                  <Text style={styles.scriptureRemove}>✕</Text>
                </Pressable>
              </View>
              <Text style={styles.scriptureText}>{rhemaVerse.text}</Text>
              {rhemaVerse.note ? (
                <Text numberOfLines={2} style={styles.scriptureDraftNote}>{rhemaVerse.note}</Text>
              ) : null}
              <View style={styles.languageBadge}>
                <Text numberOfLines={1} style={styles.languageBadgeText}>
                  {rhemaVerse.languageName || '—'} • {rhemaVerse.versionShortName}
                </Text>
              </View>
            </View>
          ) : (
            <ScalePressable
              style={styles.attachChipPrompt}
              onPress={() => setVerseTarget({ kind: 'rhema-new' })}
              accessibilityRole="button"
              accessibilityLabel="Select Word of God — add a Bible verse first"
            >
              <Text numberOfLines={1} style={styles.attachChipPromptText}>
                📖 1. Select Word of God (Add Bible Verse First)
              </Text>
            </ScalePressable>
          )}

          <Text style={styles.rhemaStepLabel}>
            2. What God Spoke to Me Through This Word
          </Text>
          <TextInput
            style={styles.reflectionInput}
            placeholder="Write the promise, instruction, or revelation God gave you from this verse..."
            placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
            value={rhemaReflection}
            onChangeText={setRhemaReflection}
            multiline
          />
          <View style={styles.colorRow}>
            {HIGHLIGHT_COLORS.map((color) => {
              const active = rhemaColor === color.hex;
              return (
                <ScalePressable
                  key={color.key}
                  style={[
                    styles.colorDot,
                    { backgroundColor: color.hex },
                    active ? styles.colorDotActive : null,
                  ]}
                  onPress={() => setRhemaColor(active ? null : color.hex)}
                  accessibilityRole="button"
                  accessibilityLabel={`${color.englishName} highlight for this word${active ? ' (selected)' : ''}`}
                />
              );
            })}
          </View>
          <ScalePressable
            style={[
              styles.addButton,
              !rhemaVerse || !rhemaReflection.trim() ? styles.addButtonDisabled : null,
            ]}
            onPress={handleSaveRhema}
            disabled={!rhemaVerse || !rhemaReflection.trim()}
            accessibilityRole="button"
            accessibilityLabel="Save Rhema"
          >
            <Text style={styles.addButtonText}>Save Rhema</Text>
          </ScalePressable>
        </View>
        <EntrySectionBody
          theme={theme}
          styles={styles}
          section="rhema"
          entries={selectedEntries('rhema')}
          legacyVerses={legacyVersesOf('rhema')}
          newEntryText={newSectionText.rhema}
          placeholder={placeholders.rhema}
          selectedEntryId={selectedEntryId}
          onSelectEntry={(id) => setSelectedEntryId(id)}
          onAddEntry={addSectionEntry}
          onNewEntryTextChange={(text) =>
            setNewSectionText((previous) => ({ ...previous, rhema: text }))}
          onEntryContentChange={changeEntryContent}
          onEntryColorToggle={toggleEntryColor}
          onRemoveEntry={removeEntry}
          onAttachVerse={(entry) => setVerseTarget({ kind: 'entry', entryId: entry.id })}
          onDetachEntryVerse={detachEntryVerse}
          onEntryVerseNoteChange={changeEntryVerseNote}
          onNoteChange={changeVerseNote}
          onRemoveVerse={removeVerseRow}
          hideComposer
        />
        </AccordionCard>

        {/* Card 2: Daily Devotion */}
        <AccordionCard
          key="devotion"
          delay={50}
          styles={styles}
          open={openCard === 'devotion'}
          onToggle={() => toggleCard('devotion')}
          icon={<BibleBookSvg size={18} color={theme.primary} />}
          title="Daily Devotion — What I Understood"
          badge={selectedEntries('devotion').length}
        >
          <EntrySectionBody
            theme={theme}
            styles={styles}
            section="devotion"
            entries={selectedEntries('devotion')}
            legacyVerses={legacyVersesOf('devotion')}
            newEntryText={newSectionText.devotion}
            placeholder={placeholders.devotion}
            selectedEntryId={selectedEntryId}
            onSelectEntry={(id) => setSelectedEntryId(id)}
            onAddEntry={addSectionEntry}
            onNewEntryTextChange={(text) =>
              setNewSectionText((previous) => ({ ...previous, devotion: text }))}
            onEntryContentChange={changeEntryContent}
            onEntryColorToggle={toggleEntryColor}
            onRemoveEntry={removeEntry}
            onAttachVerse={(entry) => setVerseTarget({ kind: 'entry', entryId: entry.id })}
            onDetachEntryVerse={detachEntryVerse}
            onEntryVerseNoteChange={changeEntryVerseNote}
            onNoteChange={changeVerseNote}
            onRemoveVerse={removeVerseRow}
          />
        </AccordionCard>

        {/* Card 3: Prayer & Worship — heart to God */}
        <AccordionCard
          key="worship"
          delay={100}
          styles={styles}
          open={openCard === 'worship'}
          onToggle={() => toggleCard('worship')}
          icon={<PrayerHandsSvg size={18} color={theme.primary} />}
          title="Prayer & Worship — Heart to God"
          badge={selectedEntries('worship').length}
        >
          <EntrySectionBody
            theme={theme}
            styles={styles}
            section="worship"
            entries={selectedEntries('worship')}
            legacyVerses={legacyVersesOf('worship')}
            newEntryText={newSectionText.worship}
            placeholder={placeholders.worship}
            selectedEntryId={selectedEntryId}
            onSelectEntry={(id) => setSelectedEntryId(id)}
            onAddEntry={addSectionEntry}
            onNewEntryTextChange={(text) =>
              setNewSectionText((previous) => ({ ...previous, worship: text }))}
            onEntryContentChange={changeEntryContent}
            onEntryColorToggle={toggleEntryColor}
            onRemoveEntry={removeEntry}
            onAttachVerse={(entry) => setVerseTarget({ kind: 'entry', entryId: entry.id })}
            onDetachEntryVerse={detachEntryVerse}
            onEntryVerseNoteChange={changeEntryVerseNote}
            onNoteChange={changeVerseNote}
            onRemoveVerse={removeVerseRow}
          />
        </AccordionCard>

        {/* Card 4: Prayer Points — Requests & Answers (checklist + Answered) */}
        <AccordionCard
          key="prayer"
          delay={150}
          styles={styles}
          open={openCard === 'prayer'}
          onToggle={() => toggleCard('prayer')}
          icon={<ChecklistSvg size={18} color={theme.primary} />}
          title="Prayer Points — Requests & Answers"
          badge={points.length}
        >
          {/* Add a request for this date (optional verse attached at add time) */}
          {pendingPrayerVerse ? (
            <View style={styles.scriptureBox}>
              <View style={styles.scriptureHeader}>
                <Text numberOfLines={1} style={styles.scriptureRef}>
                  📖 {pendingPrayerVerse.bookName} {pendingPrayerVerse.chapter}:{pendingPrayerVerse.verse}
                </Text>
                <Pressable
                  hitSlop={6}
                  onPress={() => setPendingPrayerVerse(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove the verse attached to this new prayer"
                >
                  <Text style={styles.scriptureRemove}>✕</Text>
                </Pressable>
              </View>
              <Text numberOfLines={2} style={styles.scriptureText}>{pendingPrayerVerse.text}</Text>
              <View style={styles.languageBadge}>
                <Text numberOfLines={1} style={styles.languageBadgeText}>
                  {pendingPrayerVerse.languageName || '—'} • {pendingPrayerVerse.versionShortName}
                </Text>
              </View>
            </View>
          ) : null}
          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              placeholder="Add a prayer request (e.g., Family health, wisdom, exams)..."
              placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
              value={newRequest}
              onChangeText={setNewRequest}
              onSubmitEditing={handleAddPoint}
              returnKeyType="done"
            />
            <ScalePressable
              style={[styles.addButton, newRequest.trim() ? null : styles.addButtonDisabled]}
              onPress={handleAddPoint}
              accessibilityRole="button"
              accessibilityLabel={pendingPrayerVerse ? 'Add prayer request with attached verse' : 'Add prayer request'}
            >
              <Text style={styles.addButtonText}>{pendingPrayerVerse ? 'Add + Verse' : 'Add'}</Text>
            </ScalePressable>
          </View>
          <ScalePressable
            style={styles.attachChip}
            onPress={() => setVerseTarget({ kind: 'new-prayer' })}
            accessibilityRole="button"
            accessibilityLabel={pendingPrayerVerse ? 'Change the verse attached to this new prayer' : 'Attach a Bible verse to this new prayer'}
          >
            <PlusVerseSvg size={13} color={theme.primary} />
            <Text style={styles.attachChipText}>
              {pendingPrayerVerse ? 'Change Verse' : '+ Attach Bible Verse (optional)'}
            </Text>
          </ScalePressable>

          {/* All / Answered filter */}
          <View style={styles.filterRow}>
            <ScalePressable
              style={[styles.filterPill, prayerFilter === 'all' ? styles.filterPillActive : null]}
              onPress={() => setPrayerFilter('all')}
              accessibilityRole="button"
              accessibilityLabel="Show all prayer points"
            >
              <Text style={[styles.filterPillText, prayerFilter === 'all' ? styles.filterPillTextActive : null]}>
                All ({points.length})
              </Text>
            </ScalePressable>
            <ScalePressable
              style={[styles.filterPill, prayerFilter === 'answered' ? styles.filterPillActive : null]}
              onPress={() => setPrayerFilter('answered')}
              accessibilityRole="button"
              accessibilityLabel="Show answered prayer points"
            >
              <Text
                style={[
                  styles.filterPillText,
                  prayerFilter === 'answered' ? styles.filterPillTextActive : null,
                ]}
              >
                Answered ({answeredCount})
              </Text>
            </ScalePressable>
          </View>

          {filteredPoints.length === 0 ? (
            <Text style={styles.emptyPoints}>
              {prayerFilter === 'answered'
                ? 'No answered prayers for this day yet.'
                : 'No prayer points for this day yet.'}
            </Text>
          ) : (
            filteredPoints.map((point, index) => {
              const answered = point.is_answered === 1;
              return (
                <View key={point.id} style={styles.pointStack}>
                  <View
                    style={[
                      styles.pointBlock,
                      answered ? styles.pointBlockAnswered : null,
                    ]}
                  >
                    <View style={styles.pointTopRow}>
                      <SerialBadge number={index + 1} />
                      <TextInput
                        style={styles.pointInput}
                        value={point.request_text}
                        onChangeText={(text) => changePointText(point, text)}
                        placeholder="Add a prayer request (e.g., Family health, wisdom, exams)..."
                        placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
                        multiline
                      />
                      <ScalePressable
                        style={[styles.checkBox, answered ? styles.checkBoxActive : null]}
                        onPress={() => handleTogglePoint(point)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: answered }}
                        accessibilityLabel={`Mark "${point.request_text}" as ${answered ? 'pending' : 'answered'}`}
                      >
                        {answered ? <Text style={styles.checkMark}>✓</Text> : null}
                      </ScalePressable>
                      <Pressable
                        style={styles.pointRemove}
                        hitSlop={8}
                        onPress={() => handleDeletePoint(point)}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete prayer point "${point.request_text}"`}
                      >
                        <Text style={styles.pointRemoveIcon}>✕</Text>
                      </Pressable>
                    </View>
                    {answered && point.answered_date ? (
                      <Text style={styles.pointAnsweredDate}>
                        ✓ Answered · {point.answered_date}
                      </Text>
                    ) : null}
                    {point.verse_text && point.verse_ref ? (
                      <ScriptureBox
                        theme={theme}
                        styles={styles}
                        reference={point.verse_ref}
                        versionLabel={point.verse_version_id ?? ''}
                        text={point.verse_text}
                        note={point.verse_note ?? ''}
                        onNoteChange={(note) => changePointVerseNote(point, note)}
                        onDetach={() => detachPointVerse(point)}
                        onChangeVerse={() => setVerseTarget({ kind: 'prayer', pointId: point.id })}
                      />
                    ) : (
                      <ScalePressable
                        style={styles.attachChipPrompt}
                        onPress={() => setVerseTarget({ kind: 'prayer', pointId: point.id })}
                        accessibilityRole="button"
                        accessibilityLabel={`Add supporting Bible verse to Point ${index + 1}`}
                      >
                        <Text numberOfLines={1} style={styles.attachChipPromptText}>
                          📖 + Add supporting Bible verse to Point #{index + 1}
                        </Text>
                      </ScalePressable>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </AccordionCard>
      </ScrollView>

      {/* Rewind Past Days — Highlights-style full-screen archive */}
      <Modal visible={rewindOpen} animationType="slide" onRequestClose={() => setRewindOpen(false)}>
        <View style={[styles.rewindScreen, { backgroundColor: theme.background, paddingTop: insets.top }]}>
          {/* Header: title + count badge · calendar filter · close */}
          <View style={styles.rewindHeader}>
            <View style={styles.rewindHeaderTitleWrap}>
              <Text style={styles.rewindTitle}>Rewind Past Days</Text>
              <View style={styles.rewindCountBadge}>
                <Text style={styles.rewindCountText}>{rewindItemTotal}</Text>
              </View>
            </View>
            <View style={styles.rewindHeaderActions}>
              <ScalePressable
                style={[
                  styles.rewindCalendarButton,
                  rewindDateFilter ? styles.rewindCalendarButtonActive : null,
                ]}
                onPress={() => setRewindCalendarOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Filter the archive by date"
              >
                <Text style={styles.rewindCalendarButtonGlyph}>🗓</Text>
                <Text
                  style={[
                    styles.rewindCalendarButtonText,
                    rewindDateFilter ? styles.rewindCalendarButtonTextActive : null,
                  ]}
                >
                  {rewindDateFilter ? 'Filtered' : 'Calendar'}
                </Text>
              </ScalePressable>
              <Pressable
                onPress={() => setRewindOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close saved days archive"
              >
                <Text style={styles.rewindClose}>✕</Text>
              </Pressable>
            </View>
          </View>

          {/* Live search over Rhema / Devotion / Worship / Prayer notes */}
          <View style={styles.rewindSearchRow}>
            <TextInput
              style={styles.rewindSearchInput}
              placeholder="Search past Rhema, devotion, or prayer notes..."
              placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
              value={rewindSearch}
              onChangeText={setRewindSearch}
              returnKeyType="search"
            />
            {rewindSearch ? (
              <Pressable
                onPress={() => setRewindSearch('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Text style={styles.rewindSearchClearIcon}>✕</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Single-date calendar filter chip */}
          {rewindDateFilter ? (
            <ScalePressable
              style={styles.rewindFilterChip}
              onPress={() => setRewindDateFilter(null)}
              accessibilityRole="button"
              accessibilityLabel="Clear the date filter"
            >
              <Text style={styles.rewindFilterChipText}>
                Showing only {isoToDate(rewindDateFilter).getDate()}{' '}
                {MONTH_ABBRS[isoToDate(rewindDateFilter).getMonth()]} — tap to clear ✕
              </Text>
            </ScalePressable>
          ) : null}

          {/* Date-grouped archive list with `Open Day ›` on every header */}
          <SectionList
            style={styles.rewindList}
            contentContainerStyle={styles.rewindListContent}
            sections={rewindSections}
            keyExtractor={(item) => `${item.kind}-${item.id}`}
            renderSectionHeader={({ section }) => (
              <View style={styles.rewindSectionHeader}>
                <Text style={styles.rewindSectionDate}>{section.dateLabel}</Text>
                <ScalePressable
                  style={styles.rewindOpenDayButton}
                  onPress={() => changeDate(section.date)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open day ${section.dateLabel}`}
                >
                  <Text style={styles.rewindOpenDayText}>Open Day ›</Text>
                </ScalePressable>
              </View>
            )}
            renderItem={({ item, index }) => (
              <RewindItemCard item={item} index={index} theme={theme} styles={styles} />
            )}
            ListEmptyComponent={
              savedDates.length === 0 ? (
                <Text style={styles.rewindEmpty}>Your saved days will appear here.</Text>
              ) : (
                <Text style={styles.rewindEmpty}>No saved notes match your search.</Text>
              )
            }
          />
        </View>
      </Modal>

      {/* Calendar filter inside Rewind (does not change the main date) */}
      <PremiumCalendarModal
        visible={rewindCalendarOpen}
        selectedDate={rewindDateFilter ?? todayIsoDate()}
        onSelectDate={(picked) => {
          setRewindDateFilter(picked);
          setRewindCalendarOpen(false);
        }}
        onClose={() => setRewindCalendarOpen(false)}
        markedDates={savedDates}
        title="Filter Rewind by Date"
      />

      {/* Premium calendar selector (month + year picker) */}
      <PremiumCalendarModal
        visible={calendarOpen}
        selectedDate={selectedDate}
        onSelectDate={changeDate}
        onClose={() => setCalendarOpen(false)}
        markedDates={[selectedDate]}
        title="Daily Walk Date"
      />

      {/* Mark-answered intercept: optionally attach a thanksgiving verse */}
      <Modal
        visible={answeredPoint !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAnsweredPoint(null)}
      >
        <View style={styles.answeredBackdrop}>
          <Pressable style={styles.answeredBackdropTouch} onPress={() => setAnsweredPoint(null)} />
          <View style={styles.answeredCard}>
            <Text style={styles.answeredTitle}>🙌 Mark Prayer as Answered</Text>
            <Text style={styles.answeredQuestion}>
              Would you like to attach a thanksgiving or fulfilled Bible verse to this answered prayer?
            </Text>
            <ScalePressable
              style={styles.answeredAttachButton}
              onPress={handleAttachAnsweredVerse}
              accessibilityRole="button"
              accessibilityLabel="Add a Bible verse and mark the prayer answered"
            >
              <Text style={styles.answeredAttachText}>📖 + Add Bible Verse &amp; Mark Answered</Text>
            </ScalePressable>
            <ScalePressable
              style={styles.answeredSkip}
              onPress={handleSkipAnswered}
              accessibilityRole="button"
              accessibilityLabel="Skip the verse and mark the prayer answered"
            >
              <Text style={styles.answeredSkipText}>Skip &amp; Mark Answered</Text>
            </ScalePressable>
          </View>
        </View>
      </Modal>

      {/* Universal 4-step verse picker for ALL point attachments */}
      <VersePickerModal
        visible={verseTarget !== null}
        onInsert={handleInsertVerse}
        onClose={() => setVerseTarget(null)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// AccordionCard — collapsible section card (single-open behavior upstream)
// ---------------------------------------------------------------------------

function AccordionCard({
  styles,
  open,
  onToggle,
  icon,
  title,
  badge,
  delay,
  children,
}: {
  styles: ReturnType<typeof makeStyles>;
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  title: string;
  badge: number;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <AnimatedCard style={styles.card} delay={delay}>
      <Pressable
        style={styles.cardHeaderRow}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${open ? 'Collapse' : 'Expand'} ${title}`}
      >
        {icon}
        <Text numberOfLines={1} style={styles.cardTitle}>{title}</Text>
        <View style={styles.cardBadge}>
          <Text style={styles.cardBadgeText}>{badge}</Text>
        </View>
        <Text style={styles.cardChevron}>{open ? '▾' : '›'}</Text>
      </Pressable>
      {open ? <View style={styles.cardBody}>{children}</View> : null}
    </AnimatedCard>
  );
}

// ---------------------------------------------------------------------------
// RewindItemCard — one serial-numbered archive row with its section tag and
// any attached verse (highlight-tinted like the Highlights cards)
// ---------------------------------------------------------------------------

function RewindItemCard({
  item,
  index,
  theme,
  styles,
}: {
  item: RewindItem;
  index: number;
  theme: AppTheme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const highlight = item.highlightColor
    ? getHighlightStyle(item.highlightColor, theme.isDark)
    : null;
  return (
    <View
      style={[
        styles.rewindItem,
        highlight ? { backgroundColor: highlight.backgroundColor, borderColor: highlight.borderColor } : null,
      ]}
    >
      <View style={styles.rewindItemTopRow}>
        <SerialBadge
          number={index + 1}
          color={highlight?.backgroundColor}
          textColor={highlight?.textColor}
          borderColor={highlight?.borderColor}
        />
        <Text style={styles.rewindTag}>{item.tag}</Text>
      </View>
      <Text style={[styles.rewindItemText, highlight ? { color: highlight.textColor } : null]}>
        {item.text}
      </Text>
      {item.verseText && item.verseRef ? (
        <View style={styles.rewindVerseBox}>
          <View style={styles.languageBadge}>
            <Text numberOfLines={1} style={styles.languageBadgeText}>
              {item.verseRef} ({item.verseVersion || '—'})
            </Text>
          </View>
          <Text style={styles.rewindVerseText}>{item.verseText}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ScriptureBox — indented scripture card shown directly beneath a point
// ---------------------------------------------------------------------------

function ScriptureBox({
  theme,
  styles,
  reference,
  versionLabel,
  text,
  note,
  onNoteChange,
  onDetach,
  onChangeVerse,
}: {
  theme: AppTheme;
  styles: ReturnType<typeof makeStyles>;
  reference: string;
  versionLabel: string;
  text: string;
  note: string;
  onNoteChange: (note: string) => void;
  onDetach: () => void;
  onChangeVerse: () => void;
}) {
  return (
    <View style={styles.scriptureBox}>
      <View style={styles.scriptureHeader}>
        <Text numberOfLines={1} style={styles.scriptureRef}>
          📖 {reference}
        </Text>
        <Pressable
          hitSlop={6}
          onPress={onDetach}
          accessibilityRole="button"
          accessibilityLabel="Remove attached verse"
        >
          <Text style={styles.scriptureRemove}>✕</Text>
        </Pressable>
      </View>
      {versionLabel ? (
        <View style={styles.languageBadge}>
          <Text numberOfLines={1} style={styles.languageBadgeText}>
            {versionLabel}
          </Text>
        </View>
      ) : null}
      <Text style={styles.scriptureText}>{text}</Text>
      <TextInput
        style={styles.noteInput}
        value={note}
        onChangeText={onNoteChange}
        placeholder="Note on this scripture..."
        placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
        multiline
      />
      <ScalePressable
        style={styles.attachChip}
        onPress={onChangeVerse}
        accessibilityRole="button"
        accessibilityLabel="Change attached verse"
      >
        <PlusVerseSvg size={13} color={theme.primary} />
        <Text style={styles.attachChipText}>Change Verse</Text>
      </ScalePressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// EntrySectionBody — serial-numbered points for Rhema / Devotion / Worship
// ---------------------------------------------------------------------------

function EntrySectionBody({
  theme,
  styles,
  section,
  entries,
  legacyVerses,
  newEntryText,
  placeholder,
  selectedEntryId,
  onSelectEntry,
  onAddEntry,
  onNewEntryTextChange,
  onEntryContentChange,
  onEntryColorToggle,
  onRemoveEntry,
  onAttachVerse,
  onDetachEntryVerse,
  onEntryVerseNoteChange,
  onNoteChange,
  onRemoveVerse,
  hideComposer = false,
}: {
  theme: AppTheme;
  styles: ReturnType<typeof makeStyles>;
  section: DailyEntrySection;
  entries: DailyEntryRow[];
  legacyVerses: DailyVerseRow[];
  newEntryText: string;
  placeholder: string;
  selectedEntryId: number | null;
  onSelectEntry: (id: number | null) => void;
  onAddEntry: (section: DailyEntrySection) => void;
  onNewEntryTextChange: (text: string) => void;
  onEntryContentChange: (entry: DailyEntryRow, content: string) => void;
  onEntryColorToggle: (entry: DailyEntryRow, hex: string) => void;
  onRemoveEntry: (entry: DailyEntryRow) => void;
  onAttachVerse: (entry: DailyEntryRow) => void;
  onDetachEntryVerse: (entry: DailyEntryRow) => void;
  onEntryVerseNoteChange: (entry: DailyEntryRow, note: string) => void;
  onNoteChange: (verse: DailyVerseRow, note: string) => void;
  onRemoveVerse: (verse: DailyVerseRow) => void;
  /** Rhema: the standalone add-composer is replaced by the verse-first flow. */
  hideComposer?: boolean;
}) {
  return (
    <>
      {/* Serial-numbered points: 1 2 3 … with per-point verse chips */}
      {entries.map((entry, index) => {
        const selected = selectedEntryId === entry.id;
        const highlightStyle = entry.highlight_color
          ? getHighlightStyle(entry.highlight_color, theme.isDark)
          : null;
        return (
          <View key={entry.id} style={styles.pointStack}>
            <View
              style={[
                styles.pointBlock,
                highlightStyle
                  ? {
                      backgroundColor: highlightStyle.backgroundColor,
                      borderColor: highlightStyle.borderColor,
                      borderLeftWidth: 3,
                    }
                  : null,
              ]}
            >
              <View style={styles.pointTopRow}>
                <Pressable
                  onPress={() => onSelectEntry(selected ? null : entry.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Select Point ${index + 1}`}
                >
                  <SerialBadge
                    number={index + 1}
                    color={highlightStyle?.backgroundColor}
                    textColor={highlightStyle?.textColor}
                    borderColor={highlightStyle?.borderColor}
                  />
                </Pressable>
                <TextInput
                  style={[
                    styles.pointInput,
                    highlightStyle ? { color: highlightStyle.textColor } : null,
                  ]}
                  value={entry.content}
                  onChangeText={(text) => onEntryContentChange(entry, text)}
                  placeholder={placeholder}
                  placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
                  multiline
                />
                <Pressable
                  style={styles.pointRemove}
                  hitSlop={8}
                  onPress={() => onRemoveEntry(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete Point ${index + 1}`}
                >
                  <Text style={styles.pointRemoveIcon}>✕</Text>
                </Pressable>
              </View>
              {entry.verse_text && entry.verse_ref ? (
                <>
                  <ScriptureBox
                    theme={theme}
                    styles={styles}
                    reference={entry.verse_ref}
                    versionLabel={entry.verse_version_id ?? ''}
                    text={entry.verse_text}
                    note={entry.verse_note ?? ''}
                    onNoteChange={(note) => onEntryVerseNoteChange(entry, note)}
                    onDetach={() => onDetachEntryVerse(entry)}
                    onChangeVerse={() => onAttachVerse(entry)}
                  />
                </>
              ) : (
                <ScalePressable
                  style={styles.attachChipPrompt}
                  onPress={() => onAttachVerse(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add supporting Bible verse to Point ${index + 1}`}
                >
                  <Text numberOfLines={1} style={styles.attachChipPromptText}>
                    📖 + Add supporting Bible verse to Point #{index + 1}
                  </Text>
                </ScalePressable>
              )}
            </View>
            {selected ? (
              <View style={styles.pointPalette}>
                {HIGHLIGHT_COLORS.map((color) => {
                  const active = entry.highlight_color === color.hex;
                  return (
                    <ScalePressable
                      key={color.key}
                      style={[
                        styles.colorDot,
                        { backgroundColor: color.hex },
                        active ? styles.colorDotActive : null,
                      ]}
                      onPress={() => onEntryColorToggle(entry, color.hex)}
                      accessibilityRole="button"
                      accessibilityLabel={`Highlight Point ${index + 1} in ${color.englishName}`}
                    />
                  );
                })}
                <ScalePressable
                  style={styles.paletteDone}
                  onPress={() => onSelectEntry(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Done highlighting point"
                >
                  <Text style={styles.paletteDoneText}>Done</Text>
                </ScalePressable>
              </View>
            ) : null}
          </View>
        );
      })}

      {/* Legacy section-level verse cards (attached via earlier versions) */}
      {legacyVerses.map((verse) => (
        <View key={verse.id} style={styles.scriptureBox}>
          <View style={styles.scriptureHeader}>
            <Text style={styles.scriptureVersion}>{verse.version_short_name ?? ''}</Text>
            <Text numberOfLines={1} style={styles.scriptureRef}>
              📖 {verse.verse_ref}
            </Text>
            <Pressable
              hitSlop={6}
              onPress={() => onRemoveVerse(verse)}
              accessibilityRole="button"
              accessibilityLabel="Remove attached verse"
            >
              <Text style={styles.scriptureRemove}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.scriptureText}>{verse.verse_text}</Text>
          <TextInput
            style={styles.noteInput}
            value={verse.note ?? ''}
            onChangeText={(text) => onNoteChange(verse, text)}
            placeholder="Note on this scripture..."
            placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
            multiline
          />
        </View>
      ))}

      {/* Add point row: aligned input + Add button (hidden for the rhema flow) */}
      {!hideComposer ? (
        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            placeholder={placeholder}
            placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
            value={newEntryText}
            onChangeText={onNewEntryTextChange}
            onSubmitEditing={() => onAddEntry(section)}
            returnKeyType="done"
          />
          <ScalePressable
            style={[styles.addButton, newEntryText.trim() ? null : styles.addButtonDisabled]}
            onPress={() => onAddEntry(section)}
            accessibilityRole="button"
            accessibilityLabel="Add new point"
          >
            <Text style={styles.addButtonText}>Add</Text>
          </ScalePressable>
        </View>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles — every TextInput is aligned per the design spec:
// textAlignVertical top · padding 14/12 · lineHeight 22 · radius 10 ·
// 1px border · subtle contrasting fill.
// ---------------------------------------------------------------------------

function makeStyles(theme: AppTheme) {
  // Explicit dark/light adaptive input palette — typed text in Prayer Points,
  // Rhema notes and scripture notes is NEVER blacked out in Dark Mode.
  const inputPalette = {
    color: theme.isDark ? '#F8FAFC' : '#0F172A',
    backgroundColor: theme.isDark ? '#1E293B' : '#F1F5F9',
    borderColor: theme.isDark ? '#334155' : '#CBD5E1',
    borderWidth: 1,
  };
  return StyleSheet.create({
    screen: { flex: 1 },
    // Two-row custom header: Row 1 title + theme toggle, Row 2 action pills
    headerRowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingTop: 8,
    },
    headerTitle: {
      flex: 1,
      color: theme.text,
      fontSize: 17,
      fontWeight: '800',
      lineHeight: 24,
    },
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
    headerRowNav: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingTop: 6,
    },
    headerPillPrimary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.primary,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    headerPillPrimaryText: {
      color: theme.primaryForeground,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 20,
    },
    headerPillSecondary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    headerPillSecondaryText: {
      color: theme.primary,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 20,
    },
    todayChip: {
      marginLeft: 'auto',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.primary,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    todayChipText: {
      color: theme.primaryForeground,
      fontSize: 12,
      fontWeight: '800',
      lineHeight: 18,
    },
    strip: {
      backgroundColor: theme.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    // Fixed compact 7-day row
    stripRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 12,
      marginVertical: 8,
      flexGrow: 0,
    },
    dayChip: {
      flex: 1,
      height: 56,
      maxHeight: 56,
      marginHorizontal: 3,
      borderRadius: 12,
      paddingVertical: 6,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
    },
    dayChipActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    dayChipWeekday: { color: theme.textMuted, fontSize: 11, fontWeight: '700' },
    dayChipNumber: { color: theme.text, fontSize: 16, fontWeight: '700' },
    dayChipTextActive: { color: theme.primaryForeground },
    dayChipWeekdayToday: { color: theme.primary },
    dayChipNumberToday: { color: theme.primary },
    cards: {
      padding: 16,
      paddingBottom: 48,
      gap: 12,
    },
    card: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 12,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
    },
    cardTitle: {
      flex: 1,
      color: theme.text,
      fontSize: 15,
      fontWeight: '700',
    },
    cardBadge: {
      minWidth: 22,
      height: 22,
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    cardBadgeText: { color: theme.textMuted, fontSize: 11, fontWeight: '800' },
    cardChevron: { color: theme.textMuted, fontSize: 15, fontWeight: '700' },
    cardBody: { gap: 10, marginTop: 10 },
    colorRow: { flexDirection: 'row', gap: 10 },
    colorDot: {
      width: 26,
      height: 26,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    colorDotActive: { borderWidth: 2, borderColor: theme.text },
    pointStack: { gap: 4 },
    pointBlock: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      padding: 8,
      gap: 8,
    },
    pointBlockAnswered: { opacity: 0.85 },
    pointTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    serialBadge: {
      width: 26,
      height: 26,
      borderRadius: 999,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 6,
    },
    serialBadgeText: {
      color: theme.primaryForeground,
      fontSize: 12,
      fontWeight: '800',
    },
    // THE aligned multiline textbox (all inputs share this recipe).
    pointInput: {
      flex: 1,
      minHeight: 68,
      textAlignVertical: 'top',
      lineHeight: 22,
      fontSize: 15,
      borderRadius: 10,
      borderWidth: inputPalette.borderWidth,
      borderColor: inputPalette.borderColor,
      backgroundColor: inputPalette.backgroundColor,
      color: inputPalette.color,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    pointRemove: { padding: 6, marginTop: 4 },
    pointRemoveIcon: { color: theme.textMuted, fontSize: 13, fontWeight: '600' },
    attachChipPrompt: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    attachChipPromptText: {
      color: theme.primary,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 22,
    },
    attachChip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.surface,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    attachChipText: {
      color: theme.primary,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 22,
    },
    scriptureBox: {
      marginLeft: 34,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.readingBackground,
      padding: 10,
      gap: 6,
    },
    scriptureHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    scriptureVersion: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '700',
    },
    scriptureRef: {
      flex: 1,
      color: theme.primary,
      fontSize: 12,
      fontWeight: '700',
    },
    scriptureRemove: { color: theme.textMuted, fontSize: 13, fontWeight: '600' },
    scriptureText: {
      color: theme.text,
      fontSize: 14,
      lineHeight: 22,
    },
    // Aligned note box inside scripture cards (same recipe, compact min height).
    noteInput: {
      minHeight: 60,
      textAlignVertical: 'top',
      lineHeight: 22,
      fontSize: 13,
      borderRadius: 10,
      borderWidth: inputPalette.borderWidth,
      borderColor: inputPalette.borderColor,
      backgroundColor: inputPalette.backgroundColor,
      color: inputPalette.color,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    pointPalette: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    paletteDone: {
      marginLeft: 'auto',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    paletteDoneText: {
      color: theme.primary,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 22,
    },
    addRow: { flexDirection: 'row', gap: 8 },
    addInput: {
      flex: 1,
      minHeight: 48,
      textAlignVertical: 'center',
      lineHeight: 22,
      fontSize: 14,
      borderRadius: 10,
      borderWidth: inputPalette.borderWidth,
      borderColor: inputPalette.borderColor,
      backgroundColor: inputPalette.backgroundColor,
      color: inputPalette.color,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    addButton: {
      borderRadius: 10,
      backgroundColor: theme.primary,
      paddingHorizontal: 16,
      justifyContent: 'center',
      minHeight: 48,
    },
    addButtonDisabled: { opacity: 0.4 },
    addButtonText: { color: theme.primaryForeground, fontSize: 14, fontWeight: '700' },
    filterRow: { flexDirection: 'row', gap: 8 },
    filterPill: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    filterPillActive: { backgroundColor: theme.primary, borderColor: theme.primary },
    filterPillText: { color: theme.text, fontSize: 13, fontWeight: '700', lineHeight: 22 },
    filterPillTextActive: { color: theme.primaryForeground },
    emptyPoints: { color: theme.textMuted, fontSize: 13 },
    checkBox: {
      width: 24,
      height: 24,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 6,
    },
    checkBoxActive: { backgroundColor: theme.primary },
    checkMark: {
      color: theme.primaryForeground,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 16,
    },
    pointAnsweredDate: { color: theme.primary, fontSize: 12, fontWeight: '600' },
    // Rewind Past Days archive (Highlights-style full screen)
    rewindScreen: { flex: 1 },
    rewindHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: theme.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    rewindHeaderTitleWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 1,
    },
    rewindTitle: { color: theme.text, fontSize: 19, fontWeight: '800' },
    rewindCountBadge: {
      minWidth: 22,
      height: 22,
      borderRadius: 999,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    rewindCountText: { color: theme.primaryForeground, fontSize: 11, fontWeight: '800' },
    rewindHeaderActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flexShrink: 0,
    },
    rewindCalendarButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    rewindCalendarButtonActive: { backgroundColor: theme.primary },
    rewindCalendarButtonGlyph: { fontSize: 13, lineHeight: 18 },
    rewindCalendarButtonText: {
      color: theme.primary,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 20,
    },
    rewindCalendarButtonTextActive: { color: theme.primaryForeground },
    rewindClose: { color: theme.textMuted, fontSize: 18, fontWeight: '700', padding: 4 },
    rewindSearchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
    },
    rewindSearchInput: {
      flex: 1,
      height: 42,
      lineHeight: 22,
      fontSize: 14,
      borderRadius: 10,
      borderWidth: inputPalette.borderWidth,
      borderColor: inputPalette.borderColor,
      backgroundColor: inputPalette.backgroundColor,
      color: inputPalette.color,
      paddingHorizontal: 14,
    },
    rewindSearchClearIcon: { color: theme.textMuted, fontSize: 15, fontWeight: '700', padding: 6 },
    rewindFilterChip: {
      alignSelf: 'flex-start',
      marginLeft: 16,
      marginBottom: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    rewindFilterChipText: {
      color: theme.primary,
      fontSize: 12,
      fontWeight: '700',
      lineHeight: 18,
    },
    rewindList: { flex: 1 },
    rewindListContent: { padding: 16, paddingBottom: 40 },
    rewindSectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingVertical: 8,
    },
    rewindSectionDate: { flex: 1, color: theme.text, fontSize: 15, fontWeight: '800' },
    rewindOpenDayButton: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    rewindOpenDayText: { color: theme.primary, fontSize: 12, fontWeight: '700' },
    rewindItem: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 10,
      gap: 8,
      marginBottom: 8,
    },
    rewindItemTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rewindTag: { color: theme.textMuted, fontSize: 12, fontWeight: '700' },
    rewindItemText: { color: theme.text, fontSize: 14, lineHeight: 21 },
    rewindVerseBox: { gap: 6 },
    rewindVerseText: { color: theme.textMuted, fontSize: 13, lineHeight: 20 },
    rewindEmpty: { color: theme.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14 },
    // Rhema verse-first composer (1. select verse → 2. reflection → Save)
    rhemaComposer: { gap: 10 },
    rhemaStepLabel: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 22,
    },
    reflectionInput: {
      minHeight: 92,
      textAlignVertical: 'top',
      lineHeight: 22,
      fontSize: 15,
      borderRadius: 10,
      borderWidth: inputPalette.borderWidth,
      borderColor: inputPalette.borderColor,
      backgroundColor: inputPalette.backgroundColor,
      color: inputPalette.color,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    scriptureDraftNote: {
      color: theme.textMuted,
      fontSize: 12,
      lineHeight: 18,
      fontStyle: 'italic',
    },
    languageBadge: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 10,
      paddingVertical: 4,
      maxWidth: '100%',
    },
    languageBadgeText: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '700',
      lineHeight: 16,
    },
    // Mark-answered intercept modal (attach thanksgiving verse or skip)
    answeredBackdrop: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 28,
      backgroundColor: 'rgba(15, 23, 42, 0.55)',
    },
    answeredBackdropTouch: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    answeredCard: {
      width: '100%',
      maxWidth: 420,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 18,
      gap: 12,
    },
    answeredTitle: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '800',
      lineHeight: 22,
    },
    answeredQuestion: {
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 20,
    },
    answeredAttachButton: {
      minHeight: 44,
      borderRadius: 12,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    answeredAttachText: {
      color: theme.primaryForeground,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 20,
    },
    answeredSkip: {
      minHeight: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    answeredSkipText: {
      color: theme.primary,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 20,
    },
  });
}
