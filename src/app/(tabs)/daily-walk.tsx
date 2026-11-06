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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
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
import SelahAppIconSvg from '@/components/SelahAppIconSvg';
import PremiumCalendarModal, {
  dateToIso,
  isoToDate,
  todayIsoDate,
} from '@/components/PremiumCalendarModal';
import VersePickerModal, { type VersePickResult } from '@/components/VersePickerModal';
import { VerseRows, ParsedVerseRows, formatVersesForStorage, parseVerseRows } from '@/components/VerseRows';
import { isRtlVersionLabel } from '@/constants/books';
import SerialBadge from '@/components/SerialBadge';
import { ScalePressable } from '@/components/ScalePressable';
import {
  BibleBookSvg,
  CalendarSvg,
  ChecklistSvg,
  ChevronLeftSvg,
  ChevronRightSvg,
  PlusVerseSvg,
  PrayerHandsSvg,
  RewindSvg,
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
/** Short weekday abbreviations for the selected-date badge (`Wed, Nov 4`). */
const WEEKDAY_ABBRS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

/** `Nov 6, 2026` — short local-calendar label for Rewind status pills and
 * timelines ('YYYY-MM-DD' parsed without UTC shifting). */
function formatShortDate(iso: string): string {
  const date = isoToDate(iso);
  if (!date || Number.isNaN(date.getTime())) return iso;
  return `${MONTH_ABBRS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Accordion card keys — strictly one card open at a time. */
type CardKey = DailyEntrySection | 'prayer';

type PrayerFilter = 'all' | 'answered';

/** One pending verse-insert target: a serial entry point or a prayer point. */
type VerseTarget =
  | { kind: 'entry'; entryId: number }
  | { kind: 'prayer'; pointId: number }
  /** Rhema composer: a picked Word attaches to (or auto-creates) the draft. */
  | { kind: 'rhema-draft' }
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

/**
 * Storage shape for `verse_text`: tagged per-verse text ("[1] … \n[2] …")
 * so scripture cards can render number-badge rows; legacy combined text is
 * the fallback shape.
 */
function verseTextForStorage(result: VersePickResult): string {
  return result.verses.length > 0 ? formatVersesForStorage(result.verses) : result.text;
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
  /** Saved "Note on this scripture" attached to the verse, if any. */
  verseNote: string | null;
  highlightColor: string | null;
  /** Owning section — drives the symmetrical section icon in the card header. */
  section: DailyEntrySection | 'prayer';
  /** Prayer points only: 0 = pending, 1 = answered; 0 for entries/verses. */
  isAnswered: number;
  /** Prayer points only: 'YYYY-MM-DD' the request was marked answered. */
  answeredDate: string | null;
  /** 'YYYY-MM-DD' the row was saved (the Rewind date group itself). */
  requestedDate: string;
};

/** One Rewind section: all matching notes saved on one date. */
type RewindSection = {
  date: string;
  dateIso: string;
  dateLabel: string;
  totalCount: number;
  data: RewindItem[];
};

/** Section labels shown next to every Rewind serial badge (icon is rendered
 * separately by `rewindSectionIcon`, replacing the old emoji tags). */
const REWIND_TAGS: Record<DailyEntrySection | 'prayer', string> = {
  rhema: 'Rhema',
  devotion: 'Devotion',
  worship: 'Worship',
  prayer: 'Prayer Point',
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function DailyWalkScreen() {
  const { theme, colors, themeMode, toggleTheme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const topModalInset = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 36) : 0,
    36,
  );

  const { width: screenWidth } = useWindowDimensions();
  const H_PAD = 14;
  const innerWidth = screenWidth - H_PAD * 2;
  const dayGap = 6;
  const dayCardW = Math.floor((innerWidth - dayGap * 6) / 7);

  const today = todayIsoDate();
  const [selectedDate, setSelectedDate] = useState<string>(() => todayIsoDate());
  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [rewindOpen, setRewindOpen] = useState(false);
  const [savedDates, setSavedDates] = useState<string[]>([]);
  /** Rewind archive live-search + optional single-date filter. */
  const [rewindSearch, setRewindSearch] = useState('');
  const [rewindDateFilter, setRewindDateFilter] = useState<string | null>(null);
  const [rewindCalendarOpen, setRewindCalendarOpen] = useState(false);
  const [collapsedRewindDates, setCollapsedRewindDates] = useState<Record<string, boolean>>({});

  /** Which accordion card is expanded (single-open at a time). */
  const [openCard, setOpenCard] = useState<CardKey | null>('rhema');

  const [entries, setEntries] = useState<DailyEntryRow[]>([]);
  const [verseRows, setVerseRows] = useState<DailyVerseRow[]>([]);
  const [points, setPoints] = useState<PrayerPointRow[]>([]);
  const [hydrated, setHydrated] = useState(false);

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
  /** Composer-level highlight color per section (5-dot selector). */
  const [newSectionColor, setNewSectionColor] = useState<Record<DailyEntrySection, string | null>>({
    rhema: null,
    devotion: null,
    worship: null,
  });
  /** Highlight color staged for the next prayer request the user adds. */
  const [prayerDraftColor, setPrayerDraftColor] = useState<string | null>(null);
  const [newRequest, setNewRequest] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [verseTarget, setVerseTarget] = useState<VerseTarget | null>(null);

  // --- Rhema composer draft ("What God Spoke to Me") -------------------------
  // The composer ALWAYS shows both controls: "1. Select Word of God" (+ the
  // attached ScriptureBox once a verse is picked) and "2. What God Spoke to Me
  // Through This Word" with the five highlight dots. Everything auto-saves:
  // typing (350ms debounce), colour taps, verse picks and notes write
  // straight to SQLite — no Save button exists.
  /** SQLite row id currently backing the composer draft (null = none yet). */
  const [activeRhemaDraftId, setActiveRhemaDraftId] = useState<number | null>(null);
  const [rhemaDraftText, setRhemaDraftText] = useState('');
  const [rhemaDraftColor, setRhemaDraftColor] = useState<string | null>(null);
  /** Verse currently attached to the composer's draft ScriptureBox. */
  const [rhemaDraftVerse, setRhemaDraftVerse] = useState<VersePickResult | null>(null);
  /** True for ~1.8s after every successful auto-save ("✓ Auto-saved" chip). */
  const [rhemaShowAutoSaved, setRhemaShowAutoSaved] = useState(false);
  // Refs mirror the draft so debounce timers, insert callbacks and the flush
  // path always write the LATEST values regardless of stale closures.
  const activeRhemaDraftIdRef = useRef<number | null>(null);
  const rhemaDraftTextRef = useRef('');
  const rhemaDraftColorRef = useRef<string | null>(null);
  const rhemaSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rhemaFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Rhema draft auto-save helpers -----------------------------------------

  /** Show the subtle "✓ Auto-saved" chip next to the dots for ~1.8s. */
  const flashRhemaSaved = useCallback(() => {
    if (rhemaFlashTimerRef.current) clearTimeout(rhemaFlashTimerRef.current);
    setRhemaShowAutoSaved(true);
    rhemaFlashTimerRef.current = setTimeout(() => {
      rhemaFlashTimerRef.current = null;
      setRhemaShowAutoSaved(false);
    }, 1800);
  }, []);

  /** Commit a pending debounced reflection so timer edits are never lost. */
  const flushRhemaDraft = useCallback(() => {
    if (rhemaSaveTimerRef.current) {
      clearTimeout(rhemaSaveTimerRef.current);
      rhemaSaveTimerRef.current = null;
      if (activeRhemaDraftIdRef.current !== null) {
        updateDailyEntry(activeRhemaDraftIdRef.current, { content: rhemaDraftTextRef.current });
        flashRhemaSaved();
      }
    }
  }, [flashRhemaSaved]);

  /**
   * Hand the composer to a fresh draft: stop the debounce, drop the verse,
   * colour and reflection, and unbind the SQLite row (it already lives in the
   * list as its own card). Called by "+ New Rhema" and on date changes.
   */
  const resetRhemaDraft = useCallback(() => {
    if (rhemaSaveTimerRef.current) {
      clearTimeout(rhemaSaveTimerRef.current);
      rhemaSaveTimerRef.current = null;
    }
    if (rhemaFlashTimerRef.current) {
      clearTimeout(rhemaFlashTimerRef.current);
      rhemaFlashTimerRef.current = null;
    }
    activeRhemaDraftIdRef.current = null;
    setActiveRhemaDraftId(null);
    rhemaDraftTextRef.current = '';
    setRhemaDraftText('');
    rhemaDraftColorRef.current = null;
    setRhemaDraftColor(null);
    setRhemaDraftVerse(null);
    setRhemaShowAutoSaved(false);
  }, []);

  /** Finalize the composer's entry ("+ New Rhema") and start a fresh draft. */
  const handleStartNewRhema = useCallback(() => {
    flushRhemaDraft();
    animateLayout();
    resetRhemaDraft();
    setEntries(getDailyEntriesForDate(selectedDate));
  }, [flushRhemaDraft, resetRhemaDraft, selectedDate, setEntries]);

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
      // The Rhema composer draft belongs to the day being left: commit its
      // pending reflection, then hand the composer to the new day.
      flushRhemaDraft();
      resetRhemaDraft();
      setEntries(importLegacyDraft(dateIso));
      setVerseRows(getDailyVersesForDate(dateIso));
      setPoints(getPrayerPointsForDate(dateIso));
      setSelectedEntryId(null);
    },
    [
      flushRhemaDraft,
      importLegacyDraft,
      resetRhemaDraft,
      setEntries,
      setPoints,
      setSelectedEntryId,
      setVerseRows,
    ],
  );

  const refreshSavedDates = useCallback(() => {
    setSavedDates(getSavedDailyWalkDates());
  }, []);

  /** Switching dates (chip tap / calendar): load the new day synchronously.
   *  Future dates are blocked everywhere — the walk is only writable for
   *  days up to and including today. */
  const changeDate = useCallback(
    (dateIso: string) => {
      if (dateIso > todayIsoDate()) return;
      setSelectedDate(dateIso);
      loadDay(dateIso);
      setCalendarOpen(false);
      setRewindOpen(false);
    },
    [loadDay, setCalendarOpen, setSelectedDate, setRewindOpen],
  );

  /**
   * Auto-save the Rhema composer to SQLite. If the draft already owns a row
   * (`activeRhemaDraftId`) the patch updates that exact row; otherwise the
   * patch INSERTS the row now — an empty reflection is fine — and stores the
   * new id so every later keystroke, colour tap or verse pick lands on the
   * SAME Rhema entry.
   */
  const upsertRhemaDraft = useCallback(
    (
      fields: {
        content?: string;
        highlight_color?: string | null;
        verse_ref?: string | null;
        verse_text?: string | null;
        verse_note?: string | null;
        verse_version_id?: string | null;
      },
    ): number => {
      const draftId = activeRhemaDraftIdRef.current;
      if (draftId !== null) {
        updateDailyEntry(draftId, fields);
        flashRhemaSaved();
        return draftId;
      }
      const newId = addDailyEntry({
        entry_date: selectedDate,
        section: 'rhema',
        content: fields.content ?? rhemaDraftTextRef.current,
        highlight_color: 'highlight_color' in fields
          ? fields.highlight_color ?? null
          : rhemaDraftColorRef.current,
        verse_ref: fields.verse_ref ?? null,
        verse_text: fields.verse_text ?? null,
        verse_note: fields.verse_note ?? null,
        verse_version_id: fields.verse_version_id ?? null,
      });
      activeRhemaDraftIdRef.current = newId;
      setActiveRhemaDraftId(newId);
      setEntries(getDailyEntriesForDate(selectedDate));
      flashRhemaSaved();
      return newId;
    },
    [flashRhemaSaved, selectedDate, setEntries],
  );

  /** 350ms-debounced auto-save of the draft reflection while typing. */
  const handleRhemaDraftTextChange = useCallback(
    (text: string) => {
      setRhemaDraftText(text);
      rhemaDraftTextRef.current = text;
      if (rhemaSaveTimerRef.current) clearTimeout(rhemaSaveTimerRef.current);
      rhemaSaveTimerRef.current = setTimeout(() => {
        rhemaSaveTimerRef.current = null;
        upsertRhemaDraft({ content: text });
      }, 350);
    },
    [upsertRhemaDraft],
  );

  /** Tap a highlight dot: toggle the colour on the composer's draft row. */
  const handleRhemaDraftColor = useCallback(
    (hex: string) => {
      const nextColor = rhemaDraftColorRef.current === hex ? null : hex;
      rhemaDraftColorRef.current = nextColor;
      setRhemaDraftColor(nextColor);
      // With no row yet the stored colour rides along at insert time; once a
      // draft row exists the colour is persisted immediately.
      if (activeRhemaDraftIdRef.current !== null) {
        upsertRhemaDraft({ highlight_color: nextColor });
      }
    },
    [upsertRhemaDraft],
  );

  /** ScriptureBox note on the composer's attached verse (auto-persisted). */
  const handleRhemaDraftNoteChange = useCallback(
    (note: string) => {
      setRhemaDraftVerse((current) => (current ? { ...current, note } : current));
      upsertRhemaDraft({ verse_note: note });
    },
    [upsertRhemaDraft],
  );

  /** Detach the verse shown on the composer's draft ScriptureBox. */
  const detachRhemaDraftVerse = useCallback(() => {
    setRhemaDraftVerse(null);
    const draftId = activeRhemaDraftIdRef.current;
    if (draftId !== null) {
      updateDailyEntry(draftId, {
        verse_ref: null,
        verse_text: null,
        verse_note: null,
        verse_version_id: null,
      });
      flashRhemaSaved();
    }
  }, [flashRhemaSaved]);

  // Screen teardown: commit a pending debounced reflection so closing the
  // tab mid-keystroke never loses text.
  useEffect(() => {
    return () => {
      if (rhemaSaveTimerRef.current) {
        clearTimeout(rhemaSaveTimerRef.current);
        rhemaSaveTimerRef.current = null;
        if (activeRhemaDraftIdRef.current !== null) {
          updateDailyEntry(activeRhemaDraftIdRef.current, { content: rhemaDraftTextRef.current });
        }
      }
      if (rhemaFlashTimerRef.current) {
        clearTimeout(rhemaFlashTimerRef.current);
        rhemaFlashTimerRef.current = null;
      }
    };
  }, []);

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

  /** Expand one card and collapse the others. */
  const toggleCard = useCallback(
    (key: CardKey) => {
      setOpenCard((current) => (current === key ? null : key));
    },
    [setOpenCard],
  );

  // --- Serial section points (Rhema / Devotion / Worship) --------------------

  const addSectionEntry = useCallback(
    (section: DailyEntrySection) => {
      const text = newSectionText[section].trim();
      if (!text) return;
      addDailyEntry({
        entry_date: selectedDate,
        section,
        content: text,
        highlight_color: newSectionColor[section] ?? null,
      });
      setNewSectionText((previous) => ({ ...previous, [section]: '' }));
      setNewSectionColor((previous) => ({ ...previous, [section]: null }));
      setEntries(getDailyEntriesForDate(selectedDate));
    },
    [newSectionText, newSectionColor, selectedDate, setEntries, setNewSectionText, setNewSectionColor],
  );

  /** Toggle a highlight dot on a section composer (5-color palette). */
  const toggleComposerColor = useCallback(
    (section: DailyEntrySection, hex: string) => {
      setNewSectionColor((previous) => ({
        ...previous,
        [section]: previous[section] === hex ? null : hex,
      }));
    },
    [setNewSectionColor],
  );

  /** Toggle the highlight dot staged for the next prayer request. */
  const togglePrayerDraftColor = useCallback(
    (colorId: string) => {
      setPrayerDraftColor((current) => (current === colorId ? null : colorId));
    },
    [setPrayerDraftColor],
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
        verse_text: verseTextForStorage(result),
        verse_note: result.note,
        verse_version_id: versionLabelFor(result),
      };
      if (verseTarget.kind === 'entry') {
        updateDailyEntry(verseTarget.entryId, fields);
        setEntries(getDailyEntriesForDate(selectedDate));
      } else if (verseTarget.kind === 'prayer') {
        updatePrayerPoint(verseTarget.pointId, fields);
        setPoints(getPrayerPointsForDate(selectedDate));
      } else if (verseTarget.kind === 'rhema-draft') {
        // Rhema composer flow: the picked Word auto-saves onto the composer's
        // draft — creating the SQLite row instantly when the reflection is
        // still empty, or attaching to the exact same entry when the user
        // typed first (`activeRhemaDraftId`). No Save button involved.
        setRhemaDraftVerse(result);
        const draftId = activeRhemaDraftIdRef.current;
        if (draftId !== null) {
          updateDailyEntry(draftId, fields);
          flashRhemaSaved();
        } else {
          const newId = addDailyEntry({
            entry_date: selectedDate,
            section: 'rhema',
            content: rhemaDraftTextRef.current,
            highlight_color: rhemaDraftColorRef.current,
            verse_ref: ref,
            verse_text: verseTextForStorage(result),
            verse_note: result.note || null,
            verse_version_id: versionLabelFor(result),
          });
          activeRhemaDraftIdRef.current = newId;
          setActiveRhemaDraftId(newId);
          flashRhemaSaved();
        }
        setEntries(getDailyEntriesForDate(selectedDate));
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
    [flashRhemaSaved, selectedDate, setEntries, setPoints, setPendingPrayerVerse, setVerseTarget, verseTarget],
  );

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
      ...(prayerDraftColor ? { color: prayerDraftColor } : {}),
      ...(pendingPrayerVerse ? {
        verse_ref: `${pendingPrayerVerse.bookName} ${pendingPrayerVerse.chapter}:${pendingPrayerVerse.verse}`,
        verse_text: verseTextForStorage(pendingPrayerVerse),
        verse_note: pendingPrayerVerse.note || null,
        verse_version_id: versionLabelFor(pendingPrayerVerse),
      } : {}),
    });
    setNewRequest('');
    setPendingPrayerVerse(null);
    setPrayerDraftColor(null);
    setPoints(getPrayerPointsForDate(selectedDate));
  }, [newRequest, pendingPrayerVerse, prayerDraftColor, selectedDate, setNewRequest, setPendingPrayerVerse, setPrayerDraftColor, setPoints]);

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

  /** Toggle a highlight dot on a saved prayer point card (5-color palette). */
  const changePointColor = useCallback(
    (point: PrayerPointRow, colorId: string) => {
      const next = point.color === colorId ? null : colorId;
      setPoints((previous) => previous.map((row) => (
        row.id === point.id ? { ...row, color: next } : row
      )));
      updatePrayerPoint(point.id, { color: next });
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
          verseNote: entry.verse_note,
          highlightColor: entry.highlight_color,
          section: entry.section,
          isAnswered: 0,
          answeredDate: null,
          requestedDate: entry.entry_date,
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
          verseNote: verse.note,
          highlightColor: null,
          section: verse.section,
          isAnswered: 0,
          answeredDate: null,
          requestedDate: verse.entry_date,
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
          verseNote: point.verse_note,
          // Task 5 — prayer colors tint the Rewind archives too ('amber' ids).
          highlightColor: point.color,
          section: 'prayer',
          // Task 3 — answered status + dates drive the Rewind status pill.
          isAnswered: point.is_answered,
          answeredDate: point.answered_at ?? point.answered_date,
          requestedDate: point.entry_date,
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
        dateIso: date,
        dateLabel: `${WEEKDAY_FULL_NAMES[dateObj.getDay()]}, ${MONTH_ABBRS[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`,
        totalCount: matches.length,
        data: matches,
      });
    }
    return sections;
  }, [savedDates, rewindDateFilter, rewindSearch]);
  const rewindDateGroups = rewindSections;
  const rewindItemTotal = rewindSections.reduce((sum, section) => sum + section.data.length, 0);

  const renderedRewindSections = useMemo(() => {
    return rewindSections.map((section) => ({
      ...section,
      data: collapsedRewindDates[section.dateIso] ? [] : section.data,
    }));
  }, [rewindSections, collapsedRewindDates]);

  /** Row-1 badge label: `Today • Wed, Nov 4` or `Mon, Nov 2, 2026`. */
  const dateBadgeLabel = useMemo(() => {
    const date = isoToDate(selectedDate);
    if (selectedDate === today) {
      return `Today • ${WEEKDAY_ABBRS[date.getDay()]}, ${MONTH_ABBRS[date.getMonth()]} ${date.getDate()}`;
    }
    return `${WEEKDAY_ABBRS[date.getDay()]}, ${MONTH_ABBRS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }, [selectedDate, today]);

  /** Week navigation can never move past the current week. */
  const weekContainsToday = weekDates(weekStart).includes(today);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topModalInset + 8 }]}>
      {/* FIX 5 — one unified header container: Rows 1-3 all share the exact
          14px left/right edges of the accordion cards below. */}
      <View style={styles.headerContainer}>
        {/* Row 1 — Title & Theme Toggle */}
        <View style={[styles.titleRow, { paddingHorizontal: H_PAD }]}>
          <View style={styles.titleMeta}>
            <View style={styles.titleIconRow}>
              <SelahAppIconSvg size={22} color={theme.primary} />
              <Text style={styles.headerTitle}>Daily Walk</Text>
            </View>
            <ScalePressable
              style={styles.dateBadge}
              onPress={() => setCalendarOpen(true)}
              android_ripple={null}
              accessibilityRole="button"
              accessibilityLabel={`Selected date ${dateBadgeLabel}. Open calendar`}
            >
              <Text numberOfLines={1} style={styles.dateBadgeText}>
                <CalendarSvg size={14} color={theme.primary} /> {dateBadgeLabel}
              </Text>
            </ScalePressable>
          </View>
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

        {/* Row 2 — Full-Size 50/50 Rewind & Calendar Buttons */}
        <View style={styles.actionBar}>
          <ScalePressable
            style={styles.navButtonRewind}
            onPress={() => {
              refreshSavedDates();
              setRewindOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Open saved past days"
          >
            <RewindSvg size={18} color="#FFFFFF" />
            <Text style={styles.navButtonRewindText}>Rewind</Text>
          </ScalePressable>
          <ScalePressable
            style={styles.navButtonCalendar}
            onPress={() => setCalendarOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open calendar"
          >
            <CalendarSvg size={18} color={colors.primary} />
            <Text style={styles.navButtonCalendarText}>Calendar</Text>
          </ScalePressable>
        </View>

        {/* Row 3 — Sleek Week Switcher Bar Using Vector Chevron Icons */}
        <View style={[styles.weekSwitcher, { width: innerWidth, marginHorizontal: H_PAD }]}>
          <ScalePressable
            style={styles.weekSwitcherArrow}
            onPress={() => changeDate(isoShifted(selectedDate, -7))}
            accessibilityRole="button"
            accessibilityLabel="Previous week"
          >
            <ChevronLeftSvg size={20} color={theme.text} />
          </ScalePressable>
          <View style={styles.weekSwitcherCenter}>
            <Text style={styles.weekSwitcherLabel}>{dateBadgeLabel}</Text>
            {Boolean(selectedDate !== today) ? (
              <ScalePressable
                style={styles.todayPill}
                onPress={() => changeDate(today)}
                accessibilityRole="button"
                accessibilityLabel="Jump to today"
              >
                <Text style={styles.todayPillText}>↺ Today</Text>
              </ScalePressable>
            ) : null}
          </View>
          <ScalePressable
            style={[styles.weekSwitcherArrow, weekContainsToday ? styles.weekSwitcherArrowDisabled : null]}
            onPress={() => {
              const nextDate = isoShifted(selectedDate, 7);
              changeDate(nextDate <= today ? nextDate : today);
            }}
            disabled={weekContainsToday}
            accessibilityRole="button"
            accessibilityLabel="Next week"
          >
            <ChevronRightSvg size={20} color={theme.text} />
          </ScalePressable>
        </View>

          {/* Row 4 — Full-Width 7-Day Week Cards */}
          <View style={[styles.strip, { width: innerWidth, marginHorizontal: H_PAD }]}>
            {weekDates(weekStart).map((dateIso) => {
              const active = dateIso === selectedDate;
              const isToday = dateIso === today;
              const isFuture = dateIso > today;
              const date = isoToDate(dateIso);
              return (
                <ScalePressable
                  key={dateIso}
                  style={[
                    styles.dayCard,
                    { width: dayCardW },
                    active ? styles.dayCardActive : null,
                    isFuture ? styles.dayCardDisabled : null,
                  ]}
                  onPress={() => changeDate(dateIso)}
                  disabled={isFuture}
                  accessibilityRole="button"
                  accessibilityLabel={`Select date ${dateIso}`}
                >
                  <Text
                    style={[
                      styles.dayCardWeekday,
                      active ? styles.dayCardTextActive : null,
                      !active && isToday ? styles.dayCardWeekdayToday : null,
                    ]}
                  >
                    {WEEKDAY_NAMES[(date.getDay() + 6) % 7]}
                  </Text>
                  <Text
                    style={[
                      styles.dayCardNumber,
                      active ? styles.dayCardTextActive : null,
                      !active && isToday ? styles.dayCardNumberToday : null,
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
        {/* Rhema composer — "1. Select Word of God" and "2. What God Spoke to
            Me Through This Word" are ALWAYS visible together. The reflection,
            verse picks, note and colour auto-save to SQLite (350ms typing
            debounce; verse/colour/note persist instantly) — no Save button.
            "+ New Rhema" finalizes the draft so several entries per day are
            effortless. */}
        <View style={styles.rhemaComposer}>
          {/* 1 — Word of God (+ attached ScriptureBox while a verse is picked) */}
          <ScalePressable
            style={styles.attachChipPrompt}
            onPress={() => setVerseTarget({ kind: 'rhema-draft' })}
            accessibilityRole="button"
            accessibilityLabel="Select Word of God — pick a Bible verse for this Rhema"
          >
            <Text numberOfLines={1} style={styles.attachChipPromptText}>
              1. Select Word of God
            </Text>
          </ScalePressable>
          {Boolean(rhemaDraftVerse) ? (
            <ScriptureBox
              theme={theme}
              styles={styles}
              reference={
                rhemaDraftVerse
                  ? `${rhemaDraftVerse.bookName} ${rhemaDraftVerse.chapter}:${rhemaDraftVerse.verse}`
                  : ''
              }
              versionLabel={rhemaDraftVerse ? versionLabelFor(rhemaDraftVerse) : ''}
              text={rhemaDraftVerse ? verseTextForStorage(rhemaDraftVerse) : ''}
              note={rhemaDraftVerse?.note ?? ''}
              onNoteChange={handleRhemaDraftNoteChange}
              onDetach={detachRhemaDraftVerse}
              onChangeVerse={() => setVerseTarget({ kind: 'rhema-draft' })}
            />
          ) : null}
          {/* 2 — What God Spoke to Me (auto-saved while typing) */}
          <Text style={styles.rhemaComposerLabel}>
            2. What God Spoke to Me Through This Word
          </Text>
          <TextInput
            style={styles.pointInput}
            value={rhemaDraftText}
            onChangeText={handleRhemaDraftTextChange}
            placeholder="Write the promise, instruction, or revelation God gave you from this verse..."
            placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
            multiline
          />
          {/* Task 5 — bottom action/color bar: the 5 highlight dots on the
              left, the concise "✓ Saved" status (never clips or drops
              letters) and the "+ Add" pill on the right. */}
          <View style={styles.composerActionBar}>
            <View style={styles.composerDots}>
              {HIGHLIGHT_COLORS.map((color) => {
                const active = rhemaDraftColor === color.hex;
                return (
                  <ScalePressable
                    key={color.key}
                    style={[
                      styles.composerColorDot,
                      { backgroundColor: color.hex },
                      active ? styles.colorDotActive : null,
                    ]}
                    onPress={() => handleRhemaDraftColor(color.hex)}
                    accessibilityRole="button"
                    accessibilityLabel={`Highlight Rhema draft in ${color.englishName}`}
                  />
                );
              })}
            </View>
            <View style={styles.composerActions}>
              {Boolean(rhemaShowAutoSaved) ? (
                <Text numberOfLines={1} style={styles.rhemaAutoSavedText}>✓ Saved</Text>
              ) : null}
              {Boolean(rhemaDraftText.trim().length > 0 || rhemaDraftVerse) ? (
                <ScalePressable
                  style={styles.composerAddButton}
                  onPress={handleStartNewRhema}
                  accessibilityRole="button"
                  accessibilityLabel="Add a new Rhema entry"
                >
                  <Text style={styles.composerAddText}>+ Add</Text>
                </ScalePressable>
              ) : null}
            </View>
          </View>
        </View>
        {/* Saved cards for the day — the composer's own draft row stays inside
            the composer above (never duplicated below it). */}
        <EntrySectionBody
          theme={theme}
          styles={styles}
          section="rhema"
          entries={selectedEntries('rhema').filter((entry) => entry.id !== activeRhemaDraftId)}
          legacyVerses={legacyVersesOf('rhema')}
          newEntryText={newSectionText.rhema}
          placeholder={placeholders.rhema}
          composerColor={newSectionColor.rhema}
          onComposerColorChange={(hex) => toggleComposerColor('rhema', hex)}
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
            composerColor={newSectionColor.devotion}
            onComposerColorChange={(hex) => toggleComposerColor('devotion', hex)}
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
            composerColor={newSectionColor.worship}
            onComposerColorChange={(hex) => toggleComposerColor('worship', hex)}
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
              <VerseRows
                rows={pendingPrayerVerse.verses.length > 0
                  ? pendingPrayerVerse.verses.map((verse) => ({ verse: verse.verse, text: verse.text }))
                  : [{ verse: null, text: pendingPrayerVerse.text }]}
                rtl={isRtlVersionLabel(pendingPrayerVerse.languageName || pendingPrayerVerse.versionShortName)}
              />
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
          </View>
          {/* Task 5 — unified composer action/color bar for Prayer Points. */}
          <View style={styles.composerActionBar}>
            <View style={styles.composerDots}>
              {HIGHLIGHT_COLORS.map((color) => {
                const active = prayerDraftColor === color.id;
                return (
                  <ScalePressable
                    key={color.key}
                    style={[
                      styles.composerColorDot,
                      { backgroundColor: color.hex },
                      active ? styles.colorDotActive : null,
                    ]}
                    onPress={() => togglePrayerDraftColor(color.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Highlight new prayer requests in ${color.englishName}`}
                  />
                );
              })}
            </View>
            <View style={styles.composerActions}>
              <ScalePressable
                style={[styles.composerAddButton, newRequest.trim() ? null : styles.addButtonDisabled]}
                onPress={handleAddPoint}
                accessibilityRole="button"
                accessibilityLabel={pendingPrayerVerse ? 'Add prayer request with attached verse' : 'Add prayer request'}
              >
                <Text style={styles.composerAddText}>{pendingPrayerVerse ? 'Add + Verse' : 'Add'}</Text>
              </ScalePressable>
            </View>
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
              // Task 5 — the picked highlight color tints the saved prayer
              // card (bg / border / badge / text) just like the other
              // sections, in both the main view and Rewind.
              const pointHighlight = point.color
                ? getHighlightStyle(point.color, theme.isDark)
                : null;
              // Narrowed verse locals keep the Boolean(...) child gates both
              // crash-proof (empty strings never leak into <View>) and
              // type-safe for the strictly-typed ScriptureBox props.
              const pointVerseText = point.verse_text ?? '';
              const pointVerseRef = point.verse_ref ?? '';
              const hasPointVerse = Boolean(
                pointVerseText.trim().length > 0 && pointVerseRef.trim().length > 0,
              );
              return (
                <View key={point.id} style={styles.pointStack}>
                  <View
                    style={[
                      styles.pointBlock,
                      answered ? styles.pointBlockAnswered : null,
                      pointHighlight
                        ? {
                            backgroundColor: pointHighlight.backgroundColor,
                            borderColor: pointHighlight.borderColor,
                            borderLeftWidth: 3,
                          }
                        : null,
                    ]}
                  >
                    <View style={styles.pointTopRow}>
                      <SerialBadge
                        number={index + 1}
                        color={pointHighlight?.backgroundColor}
                        textColor={pointHighlight?.textColor}
                        borderColor={pointHighlight?.borderColor}
                      />
                      <TextInput
                        style={[
                          styles.pointInput,
                          pointHighlight ? { color: pointHighlight.textColor } : null,
                        ]}
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
                    {/* Task 5 — always-visible 5-color dots on each saved
                        prayer card (color applies in this view + Rewind). */}
                    <View style={styles.rhemaInlineColorRow}>
                      {HIGHLIGHT_COLORS.map((color) => {
                        const active = point.color === color.id;
                        return (
                          <ScalePressable
                            key={color.key}
                            style={[
                              styles.colorDot,
                              { backgroundColor: color.hex },
                              active ? styles.colorDotActive : null,
                            ]}
                            onPress={() => changePointColor(point, color.id)}
                            accessibilityRole="button"
                            accessibilityLabel={`Highlight prayer point ${index + 1} in ${color.englishName}`}
                          />
                        );
                      })}
                    </View>
                    {Boolean(answered && point.answered_date) ? (
                      <Text style={styles.pointAnsweredDate}>
                        ✓ Answered · {point.answered_date}
                      </Text>
                    ) : null}
                    {hasPointVerse ? (
                      <ScriptureBox
                        theme={theme}
                        styles={styles}
                        reference={pointVerseRef}
                        versionLabel={point.verse_version_id ?? ''}
                        text={pointVerseText}
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
      <Modal
        visible={rewindOpen}
        animationType="fade"
        statusBarTranslucent={true}
        onRequestClose={() => setRewindOpen(false)}
      >
        <View style={[styles.rewindScreen, { backgroundColor: colors.background }]}>
          {/* Header: title + count badge · calendar filter · close */}
          <View style={[styles.rewindHeader, { paddingTop: topModalInset + 10, paddingBottom: 12, backgroundColor: colors.background }]}>
            <View style={styles.rewindHeaderTitleWrap}>
              <Text numberOfLines={1} style={styles.rewindTitle}>Rewind Past Days</Text>
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
                <CalendarSvg size={16} color={rewindDateFilter ? theme.primaryForeground : colors.primary} />
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
            {Boolean(rewindSearch) ? (
              <Pressable
                onPress={() => setRewindSearch('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Text style={styles.rewindSearchClearIcon}>✕</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Clean header control bar: Past Journal Days (N) + Expand All / Collapse All */}
          <View style={styles.rewindControlBar}>
            <Text style={styles.rewindControlBarLabel}>
              Past Journal Days ({rewindDateGroups.length})
            </Text>
            <View style={styles.rewindControlBarActions}>
              <ScalePressable
                style={styles.rewindPillButton}
                onPress={() => {
                  setCollapsedRewindDates({});
                }}
                accessibilityRole="button"
                accessibilityLabel="Expand all past days"
              >
                <Text style={styles.rewindPillButtonText}>Expand All</Text>
              </ScalePressable>
              <ScalePressable
                style={styles.rewindPillButton}
                onPress={() => {
                  const next: Record<string, boolean> = {};
                  rewindDateGroups.forEach((g) => {
                    next[g.dateIso] = true;
                  });
                  setCollapsedRewindDates(next);
                }}
                accessibilityRole="button"
                accessibilityLabel="Collapse all past days"
              >
                <Text style={styles.rewindPillButtonText}>Collapse All</Text>
              </ScalePressable>
            </View>
          </View>

          {/* Single-date calendar filter chip */}
          {Boolean(rewindDateFilter) ? (
            <ScalePressable
              style={styles.rewindFilterChip}
              onPress={() => setRewindDateFilter(null)}
              accessibilityRole="button"
              accessibilityLabel="Clear the date filter"
            >
              <Text style={styles.rewindFilterChipText}>
                Showing only {isoToDate(rewindDateFilter!).getDate()}{' '}
                {MONTH_ABBRS[isoToDate(rewindDateFilter!).getMonth()]} — tap to clear ✕
              </Text>
            </ScalePressable>
          ) : null}

          {/* Date-grouped archive list with collapsible accordion headers */}
          <SectionList
            style={styles.rewindList}
            contentContainerStyle={styles.rewindListContent}
            sections={renderedRewindSections}
            extraData={collapsedRewindDates}
            keyExtractor={(item) => `${item.kind}-${item.id}`}
            renderSectionHeader={({ section }) => {
              const isCollapsed = Boolean(collapsedRewindDates[section.dateIso]);
              return (
                <View style={styles.rewindSectionHeader}>
                  <ScalePressable
                    style={styles.rewindSectionAccordion}
                    onPress={() => {
                      // Default state is expanded: an untouched key (undefined)
                      // means expanded, first tap collapses it explicitly.
                      setCollapsedRewindDates((prev) => {
                        const currentIsCollapsed = prev[section.dateIso] !== undefined ? prev[section.dateIso] : false;
                        return { ...prev, [section.dateIso]: !currentIsCollapsed };
                      });
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !isCollapsed }}
                    accessibilityLabel={`${isCollapsed ? 'Expand' : 'Collapse'} ${section.dateLabel}`}
                  >
                    <Text style={styles.rewindAccordionChevron}>{isCollapsed ? '▸' : '▾'}</Text>
                    <Text numberOfLines={1} style={styles.rewindSectionDate}>
                      {section.dateLabel}
                    </Text>
                    <View style={styles.rewindGroupBadge}>
                      <Text style={styles.rewindGroupBadgeText}>{section.totalCount}</Text>
                    </View>
                  </ScalePressable>
                  <ScalePressable
                    style={styles.rewindOpenDayButton}
                    onPress={() => changeDate(section.date)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open day ${section.dateLabel}`}
                  >
                    <Text style={styles.rewindOpenDayText}>Open Day ›</Text>
                  </ScalePressable>
                </View>
              );
            }}
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
      <ScalePressable
        style={styles.cardHeaderRow}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${open ? 'Collapse' : 'Expand'} ${title}`}
      >
        {/* Task 2 — every section icon sits in the same uniform 32x32 rounded
            badge so the four headers align identically. */}
        <View style={styles.sectionIconBadge}>{icon}</View>
        <Text numberOfLines={1} style={styles.cardTitle}>{title}</Text>
        <View style={styles.cardBadge}>
          <Text style={styles.cardBadgeText}>{badge}</Text>
        </View>
        <Text style={styles.cardChevron}>{open ? '▾' : '›'}</Text>
      </ScalePressable>
      {open ? <View style={styles.cardBody}>{children}</View> : null}
    </AnimatedCard>
  );
}

// ---------------------------------------------------------------------------
// RewindItemCard — one serial-numbered archive row with its section tag and
// any attached verse (highlight-tinted like the Highlights cards)
// ---------------------------------------------------------------------------

/** Symmetrical section icon + compact badge rendered in every Rewind header
 * row (Task 2 — replaces the old raw emoji tags). */
function rewindSectionIcon(section: DailyEntrySection | 'prayer', color: string): React.JSX.Element {
  switch (section) {
    case 'rhema':
      return <SparkleRhemaSvg size={16} color={color} />;
    case 'devotion':
      return <BibleBookSvg size={16} color={color} />;
    case 'worship':
      return <PrayerHandsSvg size={16} color={color} />;
    case 'prayer':
      return <ChecklistSvg size={16} color={color} />;
  }
}

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
  // Task 4 — no empty reflection gap: the body <Text> renders only when the
  // entry actually carries text, so the verse block sits right beneath the
  // badge row when "What God Spoke to Me" was left empty.
  const hasMainText = Boolean(item.text && String(item.text).trim().length > 0);
  // Task 4 — "Note on this scripture" persisted with the verse renders in a
  // dedicated read-only note box at the bottom of every Rewind card.
  const scriptureNote = item.verseNote ?? '';
  const hasScriptureNote = Boolean(scriptureNote && scriptureNote.trim().length > 0);
  const hasVerseBlock = Boolean(
    item.verseText
    && String(item.verseText).trim().length > 0
    && item.verseRef
    && String(item.verseRef).trim().length > 0,
  );
  const isPrayer = item.kind === 'prayer';
  const answered = isPrayer && item.isAnswered === 1;
  return (
    <View
      style={[
        styles.rewindItem,
        highlight ? { backgroundColor: highlight.backgroundColor, borderColor: highlight.borderColor } : null,
      ]}
    >
      <View style={styles.rewindItemTopRow}>
        {/* Task 3 — left: index badge + symmetrical section icon + label. */}
        <View style={styles.rewindItemHeaderLeft}>
          <SerialBadge
            number={index + 1}
            color={highlight?.backgroundColor}
            textColor={highlight?.textColor}
            borderColor={highlight?.borderColor}
          />
          <View style={styles.rewindIconBadge}>{rewindSectionIcon(item.section, theme.primary)}</View>
          <Text
            numberOfLines={1}
            style={[styles.rewindTag, highlight ? { color: highlight.textColor } : null]}
          >
            {item.tag}
          </Text>
        </View>
        {/* Task 3 — right: Answered / Not Answered status + date pill on
            prayer cards, always visible at a glance. */}
        {isPrayer && answered ? (
          <View style={[styles.rewindStatusPill, styles.rewindStatusAnswered]}>
            <Text
              numberOfLines={1}
              style={[styles.rewindStatusPillText, styles.rewindStatusAnsweredText]}
            >
              {`✓ Answered • ${formatShortDate(item.answeredDate ?? item.requestedDate)}`}
            </Text>
          </View>
        ) : null}
        {isPrayer && !answered ? (
          <View style={[styles.rewindStatusPill, styles.rewindStatusPending]}>
            <Text
              numberOfLines={1}
              style={[styles.rewindStatusPillText, styles.rewindStatusPendingText]}
            >
              {`Not Answered • ${formatShortDate(item.requestedDate)}`}
            </Text>
          </View>
        ) : null}
      </View>
      {hasMainText ? (
        <Text style={[styles.rewindItemText, highlight ? { color: highlight.textColor } : null]}>
          {item.text}
        </Text>
      ) : null}
      {hasVerseBlock ? (
        <View style={[styles.rewindVerseBox, !hasMainText ? styles.rewindVerseBoxFirst : null]}>
          <View style={styles.languageBadge}>
            <Text numberOfLines={1} style={styles.languageBadgeText}>
              {item.verseRef} ({item.verseVersion || '—'})
            </Text>
          </View>
          {/* Task 4 — structured [5]-badge verse rows, identical to the main
              Daily Walk scripture cards (never one unreadable blob). */}
          <ParsedVerseRows
            text={String(item.verseText)}
            rtl={isRtlVersionLabel(item.verseVersion ?? '')}
            textColor={highlight?.textColor}
          />
        </View>
      ) : null}
      {hasScriptureNote ? (
        <View style={styles.rewindNoteBox}>
          <Text style={styles.rewindNoteLabel}>Note on this scripture</Text>
          <Text style={styles.rewindNoteText}>{scriptureNote.trim()}</Text>
        </View>
      ) : null}
      {/* Task 3 — full prayer timeline footer once a request is answered, so
          the user sees exactly when it was asked and when God answered. */}
      {isPrayer && answered && item.answeredDate ? (
        <View
          style={[styles.rewindTimelineRow, highlight ? { borderTopColor: highlight.borderColor } : null]}
        >
          <Text style={[styles.rewindTimelineText, highlight ? { color: highlight.textColor } : null]}>
            {`Requested: ${formatShortDate(item.requestedDate)}`}
          </Text>
          <Text style={[styles.rewindTimelineText, highlight ? { color: highlight.textColor } : null]}>
            {`Answered: ${formatShortDate(item.answeredDate)}`}
          </Text>
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
  const verseRows = useMemo(() => parseVerseRows(text), [text]);
  // Hebrew codices render Right-to-Left: the persisted version label
  // (`"Hebrew (עברית) • WLC"`) carries the verdict.
  const isRtlVerse = isRtlVersionLabel(versionLabel);
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
      {Boolean(versionLabel && String(versionLabel).trim().length > 0) ? (
        <View style={styles.languageBadge}>
          <Text numberOfLines={1} style={styles.languageBadgeText}>
            {versionLabel}
          </Text>
        </View>
      ) : null}
      <VerseRows rows={verseRows} rtl={isRtlVerse} />
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
  composerColor,
  onComposerColorChange,
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
  /** Highlight color staged in the section composer (5-dot selector). */
  composerColor: string | null;
  /** Toggle a highlight dot on the section composer. */
  onComposerColorChange: (hex: string) => void;
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
        // Narrowed verse locals — Boolean(...) keeps empty strings out of
        // <View> children while keeping ScriptureBox props type-safe.
        const entryVerseText = entry.verse_text ?? '';
        const entryVerseRef = entry.verse_ref ?? '';
        const hasEntryVerse = Boolean(
          entryVerseText.trim().length > 0 && entryVerseRef.trim().length > 0,
        );
        // Rhema cards are a dedicated inline pattern: debounced reflection,
        // always-visible colour dots, auto-saved verse — no Save button.
        if (section === 'rhema') {
          return (
            <RhemaEntryCard
              key={entry.id}
              entry={entry}
              index={index}
              theme={theme}
              styles={styles}
              selected={selected}
              highlightStyle={highlightStyle}
              onSelectEntry={onSelectEntry}
              onCommitContent={onEntryContentChange}
              onColorToggle={onEntryColorToggle}
              onRemoveEntry={onRemoveEntry}
              onAttachVerse={onAttachVerse}
              onDetachEntryVerse={onDetachEntryVerse}
              onEntryVerseNoteChange={onEntryVerseNoteChange}
            />
          );
        }
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
              {Boolean(hasEntryVerse) ? (
                <>
                  <ScriptureBox
                    theme={theme}
                    styles={styles}
                    reference={entryVerseRef}
                    versionLabel={entry.verse_version_id ?? ''}
                    text={entryVerseText}
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
            {Boolean(verse.version_short_name && String(verse.version_short_name).trim().length > 0) ? (
              <Text style={styles.scriptureVersion}>{verse.version_short_name}</Text>
            ) : null}
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
          <ParsedVerseRows
            text={verse.verse_text ?? ''}
            rtl={isRtlVersionLabel(verse.version_short_name ?? '')}
          />
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

      {/* Add point row: aligned input, then the unified action/color bar —
          the 5 highlight dots on the left and the Add button on the right. */}
      {!hideComposer ? (
        <>
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
          </View>
          <View style={styles.composerActionBar}>
            <View style={styles.composerDots}>
              {HIGHLIGHT_COLORS.map((color) => {
                const active = composerColor === color.hex;
                return (
                  <ScalePressable
                    key={color.key}
                    style={[
                      styles.composerColorDot,
                      { backgroundColor: color.hex },
                      active ? styles.colorDotActive : null,
                    ]}
                    onPress={() => onComposerColorChange(color.hex)}
                    accessibilityRole="button"
                    accessibilityLabel={`Set ${section} composer highlight to ${color.englishName}`}
                  />
                );
              })}
            </View>
            <View style={styles.composerActions}>
              <ScalePressable
                style={[styles.composerAddButton, newEntryText.trim() ? null : styles.addButtonDisabled]}
                onPress={() => onAddEntry(section)}
                accessibilityRole="button"
                accessibilityLabel="Add new point"
              >
                <Text style={styles.composerAddText}>Add</Text>
              </ScalePressable>
            </View>
          </View>
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// RhemaEntryCard — auto-saved Rhema point with an inline, 400ms-debounced
// reflection input and always-visible colour dots. No Save button: the entry
// row (and its picked verse) already lives in SQLite when the card shows.
// ---------------------------------------------------------------------------

function RhemaEntryCard({
  entry,
  index,
  theme,
  styles,
  selected,
  highlightStyle,
  onSelectEntry,
  onCommitContent,
  onColorToggle,
  onRemoveEntry,
  onAttachVerse,
  onDetachEntryVerse,
  onEntryVerseNoteChange,
}: {
  entry: DailyEntryRow;
  index: number;
  theme: AppTheme;
  styles: ReturnType<typeof makeStyles>;
  selected: boolean;
  highlightStyle: ReturnType<typeof getHighlightStyle> | null;
  onSelectEntry: (id: number | null) => void;
  onCommitContent: (entry: DailyEntryRow, content: string) => void;
  onColorToggle: (entry: DailyEntryRow, hex: string) => void;
  onRemoveEntry: (entry: DailyEntryRow) => void;
  onAttachVerse: (entry: DailyEntryRow) => void;
  onDetachEntryVerse: (entry: DailyEntryRow) => void;
  onEntryVerseNoteChange: (entry: DailyEntryRow, note: string) => void;
}) {
  const [reflection, setReflection] = useState(entry.content);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(entry.content);
  const commitRef = useRef(onCommitContent);
  // Narrowed verse locals — Boolean(...) keeps empty strings out of <View>
  // children while keeping ScriptureBox props strictly typed (string).
  const verseText = entry.verse_text ?? '';
  const verseRef = entry.verse_ref ?? '';
  const hasVerse = Boolean(
    verseText.trim().length > 0 && verseRef.trim().length > 0,
  );

  // Keep the commit callback mirror current (refs are written in effects,
  // never during render).
  useEffect(() => {
    commitRef.current = onCommitContent;
  });

  // NOTE: the card is keyed by `entry.id` upstream, so an entry swap re-mounts
  // and the initializer picks the fresh content — no sync effect required.

  /** Debounced inline save — 400ms after the last keystroke. */
  const commitSoon = useCallback(
    (value: string) => {
      latestRef.current = value;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        commitRef.current(entry, value);
      }, 400);
    },
    [entry],
  );

  useEffect(() => {
    return () => {
      // Flush on unmount/entry swap so the last edits are never lost.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        if (latestRef.current !== entry.content) {
          commitRef.current(entry, latestRef.current);
        }
      }
    };
  }, [entry]);

  return (
    <View style={styles.pointStack}>
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
            accessibilityLabel={`Select Rhema point ${index + 1}`}
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
            value={reflection}
            onChangeText={(text) => {
              setReflection(text);
              commitSoon(text);
            }}
            placeholder="What God spoke to me..."
            placeholderTextColor={theme.isDark ? '#94A3B8' : '#64748B'}
            multiline
          />
          <Pressable
            style={styles.pointRemove}
            hitSlop={8}
            onPress={() => onRemoveEntry(entry)}
            accessibilityRole="button"
            accessibilityLabel={`Delete Rhema point ${index + 1}`}
          >
            <Text style={styles.pointRemoveIcon}>✕</Text>
          </Pressable>
        </View>
        {Boolean(selected) ? (
          <View style={styles.rhemaInlineColorRow}>
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
                  onPress={() => onColorToggle(entry, color.hex)}
                  accessibilityRole="button"
                  accessibilityLabel={`Highlight Rhema point ${index + 1} in ${color.englishName}`}
                />
              );
            })}
            <ScalePressable
              style={styles.paletteDone}
              onPress={() => onSelectEntry(null)}
              accessibilityRole="button"
              accessibilityLabel="Done highlighting Rhema point"
            >
              <Text style={styles.paletteDoneText}>Done</Text>
            </ScalePressable>
          </View>
        ) : null}
        {Boolean(hasVerse) ? (
          <ScriptureBox
            theme={theme}
            styles={styles}
            reference={verseRef}
            versionLabel={entry.verse_version_id ?? ''}
            text={verseText}
            note={entry.verse_note ?? ''}
            onNoteChange={(note) => onEntryVerseNoteChange(entry, note)}
            onDetach={() => onDetachEntryVerse(entry)}
            onChangeVerse={() => onAttachVerse(entry)}
          />
        ) : (
          <ScalePressable
            style={styles.attachChipPrompt}
            onPress={() => onAttachVerse(entry)}
            accessibilityRole="button"
            accessibilityLabel={`Change or add Bible verse to Rhema point ${index + 1}`}
          >
            <Text numberOfLines={1} style={styles.attachChipPromptText}>
              📖 + Add supporting Bible verse to Rhema #{index + 1}
            </Text>
          </ScalePressable>
        )}
      </View>
    </View>
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
    // Unified header container; rows carry their own 14px horizontal
    // insets so their edges match the accordion cards below exactly.
    headerContainer: {
      width: '100%',
      marginBottom: 2,
    },
    // Row 1: title + date badge on the left (flex 1, gap 10), theme
    // toggle flush right; no floating center pill.
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    titleMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
      minWidth: 0,
    },
    titleIconRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    headerTitle: {
      color: theme.text,
      fontSize: 22,
      fontWeight: '800',
      lineHeight: 28,
      flexShrink: 0,
    },
    // Tappable date badge next to the title (no `flex 1` stretch).
    dateBadge: {
      flexShrink: 1,
      minWidth: 0,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dateBadgeText: {
      color: theme.primary,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 18,
      textAlign: 'center',
    },
    themeToggle: {
      width: 38,
      height: 38,
      borderRadius: 19,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    // Row 2: Full-Size 50/50 Rewind & Calendar Buttons
    actionBar: {
      width: '100%',
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      height: 44,
      minHeight: 44,
      marginTop: 10,
      marginBottom: 10,
    },
    navButtonRewind: {
      flex: 1,
      height: 44,
      minHeight: 44,
      maxWidth: '48.5%',
      borderRadius: 13,
      backgroundColor: theme.primary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 14,
      flexShrink: 0,
    },
    navButtonRewindText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '800',
      includeFontPadding: false,
      flexShrink: 0,
    },
    navButtonCalendar: {
      flex: 1,
      height: 44,
      minHeight: 44,
      maxWidth: '48.5%',
      borderRadius: 13,
      borderWidth: 1.5,
      borderColor: theme.primary,
      backgroundColor: theme.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 14,
      flexShrink: 0,
    },
    navButtonCalendarText: {
      color: theme.primary,
      fontSize: 15,
      fontWeight: '800',
      includeFontPadding: false,
      flexShrink: 0,
    },
    // Row 3: Sleek Week Switcher Bar Using Vector Chevron Icons
    weekSwitcher: {
      height: 42,
      minHeight: 42,
      marginBottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.surface,
      borderRadius: 11,
      paddingHorizontal: 6,
      borderWidth: 1,
      borderColor: theme.border,
    },
    weekSwitcherArrow: {
      width: 44,
      height: 34,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    weekSwitcherArrowDisabled: { opacity: 0.28 },
    weekSwitcherCenter: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    weekSwitcherLabel: {
      color: theme.text,
      fontSize: 13.5,
      fontWeight: '700',
      textAlign: 'center',
    },
    todayPill: {
      borderRadius: 12,
      backgroundColor: theme.primary,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    todayPillText: {
      color: '#FFFFFF',
      fontSize: 11.5,
      fontWeight: '800',
    },
    // Row 4: 7 exact-width day cards span the full inner width.
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 64,
      minHeight: 64,
      marginBottom: 14,
    },
    dayCard: {
      height: 62,
      minHeight: 62,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
    },
    dayCardActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    dayCardDisabled: { opacity: 0.3 },
    dayCardWeekday: {
      color: theme.textMuted,
      fontSize: 11.5,
      fontWeight: '600',
      includeFontPadding: false,
    },
    dayCardNumber: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '800',
      marginTop: 2,
      includeFontPadding: false,
    },
    dayCardTextActive: { color: theme.primaryForeground },
    dayCardWeekdayToday: { color: theme.primary },
    dayCardNumberToday: { color: theme.primary },
    // FIX 5 — accordion cards share the exact 14px left/right edges as the
    // header rows and the 7-day strip.
    cards: {
      paddingHorizontal: 14,
      paddingBottom: 28,
      gap: 10,
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
    // Task 2 — uniform 32x32 rounded badge every accordion section icon
    // renders inside, so all four headers align identically.
    sectionIconBadge: {
      width: 32,
      height: 32,
      borderRadius: 9,
      backgroundColor: theme.primary + '18',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
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
    // Rhema composer — "1. Select Word of God" + "2. What God Spoke to Me"
    // always visible together, with the five highlight dots, the subtle
    // auto-save chip and the "+ New Rhema" pill in one bottom row.
    rhemaComposer: { gap: 10 },
    rhemaComposerLabel: {
      color: theme.text,
      fontSize: 13.5,
      fontWeight: '700',
      lineHeight: 20,
      marginTop: 2,
    },
    // Task 5 — unified bottom action/color bar for ALL section composers:
    // the 5 highlight dots left, the auto-save status + Add button right.
    composerActionBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 12,
      gap: 8,
      width: '100%',
    },
    composerDots: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flexShrink: 0,
    },
    composerColorDot: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
    },
    composerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      flex: 1,
    },
    composerAddButton: {
      paddingHorizontal: 14,
      height: 34,
      borderRadius: 17,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    composerAddText: {
      fontSize: 13,
      fontWeight: '800',
      color: '#FFFFFF',
      includeFontPadding: false,
    },
    rhemaAutoSavedText: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.primary,
      includeFontPadding: false,
      flexShrink: 0,
      paddingHorizontal: 4,
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
    addButtonDisabled: { opacity: 0.4 },
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
    rewindTitle: {
      color: theme.text,
      fontSize: 19,
      fontWeight: '800',
      flexShrink: 1,
    },
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
    rewindControlBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 8,
    },
    rewindControlBarLabel: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    rewindControlBarActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    rewindPillButton: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 12,
      paddingVertical: 5,
    },
    rewindPillButtonText: {
      color: theme.primary,
      fontSize: 12,
      fontWeight: '700',
    },
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
    rewindSectionAccordion: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
    },
    rewindAccordionChevron: {
      color: theme.primary,
      fontSize: 14,
      fontWeight: '800',
      width: 14,
    },
    rewindSectionDate: { flexShrink: 1, color: theme.text, fontSize: 15, fontWeight: '800' },
    rewindGroupBadge: {
      minWidth: 20,
      height: 20,
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    rewindGroupBadgeText: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '700',
    },
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
      marginBottom: 8,
    },
    // Task 3 — space-between header: index badge + icon + label on the left,
    // Answered / Not Answered status pill on the right (prayer cards).
    rewindItemTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 8,
    },
    rewindItemHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 1,
    },
    // Task 2 — compact 26x26 rounded icon badge beside each Rewind serial
    // badge (same tint as the section headers), replacing raw emoji tags.
    rewindIconBadge: {
      width: 26,
      height: 26,
      borderRadius: 8,
      backgroundColor: theme.primary + '18',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    rewindTag: { color: theme.textMuted, fontSize: 12, fontWeight: '700', flexShrink: 1 },
    rewindItemText: { color: theme.text, fontSize: 14, lineHeight: 21 },
    // Task 4 — verse block inside a Rewind card: sits directly beneath the
    // badge row (marginTop 0) when the reflection text itself is empty so no
    // hollow gap is left where "What God Spoke to Me" was never written.
    rewindVerseBox: { gap: 6, marginTop: 8 },
    rewindVerseBoxFirst: { marginTop: 0 },
    // Task 3 — status pill (Answered = emerald, Not Answered = amber).
    rewindStatusPill: {
      flexShrink: 1,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      borderWidth: 1,
    },
    rewindStatusAnswered: {
      backgroundColor: theme.isDark ? 'rgba(16, 185, 129, 0.22)' : 'rgba(16, 185, 129, 0.16)',
      borderColor: '#10B981',
    },
    rewindStatusPending: {
      backgroundColor: theme.isDark ? 'rgba(245, 158, 11, 0.20)' : 'rgba(245, 158, 11, 0.14)',
      borderColor: '#F59E0B',
    },
    rewindStatusPillText: { fontSize: 11.5, fontWeight: '800' },
    rewindStatusAnsweredText: { color: theme.isDark ? '#34D399' : '#059669' },
    rewindStatusPendingText: { color: theme.isDark ? '#FBBF24' : '#D97706' },
    // Task 3 — subtle requested/answered timeline under answered prayers.
    rewindTimelineRow: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 12,
    },
    rewindTimelineText: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.subtext,
    },
    // Task 4 — read-only "Note on this scripture" box at the bottom of a
    // Rewind scripture card.
    rewindNoteBox: {
      marginTop: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: theme.isDark ? 'rgba(15, 23, 42, 0.55)' : 'rgba(255, 255, 255, 0.75)',
      borderWidth: 1,
      borderColor: theme.border,
    },
    rewindNoteLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: theme.subtext,
      marginBottom: 2,
    },
    rewindNoteText: {
      fontSize: 13.5,
      fontWeight: '600',
      color: theme.text,
      lineHeight: 19,
    },
    rewindEmpty: { color: theme.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14 },
    // Rhema entry cards: always-visible inline colour dots under reflection
    rhemaInlineColorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 4,
      marginBottom: 8,
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
