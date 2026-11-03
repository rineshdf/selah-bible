/**
 * Premium calendar modal with an interactive year selector.
 *
 * - Tapping the header month opens a month grid; tapping the year opens a
 *   scrollable year picker (1995–2040) so users jump to any year in one tap.
 * - 7-column day grid highlighting today + the selected date, with subtle
 *   dots under dates present in `markedDates`.
 * - Prev/next month arrows and a one-tap "Today" reset.
 * - Fully styled for both dark and light themes via `useAppTheme()`.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAppTheme } from '@/constants/ThemeContext';
import { SunMoonSvg } from '@/components/SvgIcons';
import type { AppTheme } from '@/constants/colors';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const YEARS_MIN = 1995;
const YEARS_MAX = 2040;

export interface PremiumCalendarModalProps {
  visible: boolean;
  /** Active selection, 'YYYY-MM-DD'. */
  selectedDate: string;
  onSelectDate: (dateStr: string) => void;
  onClose: () => void;
  /** Extra dates ('YYYY-MM-DD') drawn with a dot. */
  markedDates?: string[];
  /** Header title override (e.g. "Filter highlights"). */
  title?: string;
}

export function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function isoToDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map((part) => Number(part));
  return new Date(year, month - 1, day);
}

export function dateToIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export default function PremiumCalendarModal({
  visible,
  selectedDate,
  onSelectDate,
  onClose,
  markedDates = [],
  title,
}: PremiumCalendarModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {visible ? (
        <CalendarSheet
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          onClose={onClose}
          markedDates={markedDates}
          title={title}
        />
      ) : null}
    </Modal>
  );
}

/**
 * The interactive sheet. Mounted only while the modal is visible, so all
 * view state initializes straight from props — no sync-in-effect resets.
 */
function CalendarSheet({
  selectedDate,
  onSelectDate,
  onClose,
  markedDates,
  title,
}: Omit<PremiumCalendarModalProps, 'visible'>) {
  const { theme, themeMode, toggleTheme } = useAppTheme();
  const styles = makeStyles(theme);

  // Visible month/year derive from the selection at mount, then move freely.
  const [viewYear, setViewYear] = useState(() => {
    const date = selectedDate ? isoToDate(selectedDate) : isoToDate(todayIsoDate());
    return date.getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const date = selectedDate ? isoToDate(selectedDate) : isoToDate(todayIsoDate());
    return date.getMonth();
  });
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  const marked = useMemo(() => new Set(markedDates), [markedDates]);
  const today = todayIsoDate();

  /** Blank leading cells + one cell per day, Monday-first. */
  const gridCells = useMemo(() => {
    const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(dateToIso(new Date(viewYear, viewMonth, day)));
    }
    return cells;
  }, [viewMonth, viewYear]);

  const shiftMonth = useCallback((delta: number) => {
    setViewMonth((month) => {
      const next = month + delta;
      if (next < 0) {
        setViewYear((year) => year - 1);
        return 11;
      }
      if (next > 11) {
        setViewYear((year) => year + 1);
        return 0;
      }
      return next;
    });
  }, []);

  const handleGoToday = useCallback(() => {
    onSelectDate(today);
    const date = isoToDate(today);
    setViewYear(date.getFullYear());
    setViewMonth(date.getMonth());
    onClose();
  }, [onClose, onSelectDate, today]);

  const handlePick = useCallback(
    (iso: string) => {
      onSelectDate(iso);
      onClose();
    },
    [onClose, onSelectDate],
  );

  const years = useMemo(
    () => Array.from({ length: YEARS_MAX - YEARS_MIN + 1 }, (_, index) => YEARS_MIN + index),
    [],
  );

  return (
    <>
      <View style={styles.overlay}>
        <Pressable style={styles.overlayTouch} onPress={onClose} accessibilityLabel="Close calendar" />
        <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
          <View style={styles.headerRow}>
            <Text numberOfLines={1} style={styles.title}>{title ?? 'Select Date'}</Text>
            <Pressable
              style={styles.headerIcon}
              onPress={toggleTheme}
              accessibilityRole="button"
              accessibilityLabel="Toggle dark or light theme"
            >
              <SunMoonSvg isDark={themeMode === 'dark'} size={20} color={theme.primary} />
            </Pressable>
            <Pressable
              style={styles.headerIcon}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close calendar"
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {/* Month & year selectors + quick arrows */}
          <View style={styles.monthRow}>
            <Pressable
              style={styles.arrowButton}
              onPress={() => shiftMonth(-1)}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
            >
              <Text style={styles.arrowText}>‹</Text>
            </Pressable>

            <Pressable
              style={styles.monthLabelButton}
              onPress={() => setMonthPickerOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityLabel="Choose month"
            >
              <Text style={styles.monthLabel}>{MONTH_NAMES[viewMonth]}</Text>
            </Pressable>
            <Pressable
              style={styles.monthLabelButton}
              onPress={() => setYearPickerOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityLabel="Choose year"
            >
              <Text style={styles.monthLabel}>
                {viewYear} <Text style={styles.caret}>▾</Text>
              </Text>
            </Pressable>

            <Pressable
              style={styles.arrowButton}
              onPress={() => shiftMonth(1)}
              accessibilityRole="button"
              accessibilityLabel="Next month"
            >
              <Text style={styles.arrowText}>›</Text>
            </Pressable>
          </View>

          {/* Month picker grid */}
          {monthPickerOpen ? (
            <View style={styles.monthPickerWrap}>
              {MONTH_NAMES.map((name, index) => {
                const active = index === viewMonth;
                return (
                  <Pressable
                    key={name}
                    style={[styles.monthPickerCell, active ? styles.gridCellSelected : null]}
                    onPress={() => {
                      setViewMonth(index);
                      setMonthPickerOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${name}`}
                  >
                    <Text
                      style={[
                        styles.monthPickerText,
                        active ? styles.gridCellTextSelected : null,
                      ]}
                    >
                      {name.slice(0, 3)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {/* Year picker: scrollable grid, 1995–2040 */}
          {yearPickerOpen ? (
            <ScrollView
              style={styles.yearPicker}
              contentContainerStyle={styles.yearPickerContent}
              showsVerticalScrollIndicator
            >
              {years.map((year) => {
                const active = year === viewYear;
                return (
                  <Pressable
                    key={year}
                    style={[styles.yearCell, active ? styles.yearCellActive : null]}
                    onPress={() => {
                      setViewYear(year);
                      setYearPickerOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Jump to ${year}`}
                  >
                    <Text
                      style={[
                        styles.yearCellText,
                        active ? styles.gridCellTextSelected : null,
                      ]}
                    >
                      {year}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <>
              <View style={styles.weekRow}>
                {WEEKDAY_HEADERS.map((name) => (
                  <Text key={name} style={styles.weekHeader}>{name}</Text>
                ))}
              </View>
              <View style={styles.grid}>
                {gridCells.map((iso, index) =>
                  iso === null ? (
                    <View key={`blank-${index}`} style={styles.gridCell} />
                  ) : (
                    <Pressable
                      key={iso}
                      style={[styles.gridCell, iso === selectedDate ? styles.gridCellSelected : null]}
                      onPress={() => handlePick(iso)}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${iso}`}
                    >
                      <Text
                        style={[
                          styles.gridCellText,
                          iso === today ? styles.gridCellTextToday : null,
                          iso === selectedDate ? styles.gridCellTextSelected : null,
                        ]}
                      >
                        {Number(iso.slice(8, 10))}
                      </Text>
                      {marked.has(iso) ? <View style={styles.gridCellDot} /> : null}
                    </Pressable>
                  ),
                )}
              </View>
            </>
          )}

          {/* Footer: quick Today reset + selection caption */}
          <View style={styles.footerRow}>
            <Text numberOfLines={1} style={styles.footerSelection}>
              {selectedDate === today ? `Today · ${selectedDate}` : `Selected: ${selectedDate}`}
            </Text>
            <Pressable
              style={styles.todayButton}
              onPress={handleGoToday}
              accessibilityRole="button"
              accessibilityLabel="Reset selection to today"
            >
              <Text style={styles.todayButtonText}>Today</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    overlayTouch: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    sheet: {
      width: '100%',
      maxWidth: 400,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 14,
      gap: 8,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    title: {
      flex: 1,
      color: theme.text,
      fontSize: 16,
      fontWeight: '700',
    },
    headerIcon: { padding: 4 },
    closeText: { color: theme.textMuted, fontSize: 16, fontWeight: '700' },
    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 4,
    },
    arrowButton: {
      width: 32,
      height: 32,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    arrowText: { color: theme.text, fontSize: 18, lineHeight: 20 },
    monthLabelButton: {
      borderRadius: 8,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    monthLabel: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '700',
    },
    caret: { color: theme.textMuted, fontSize: 11 },
    monthPickerWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 8,
    },
    monthPickerCell: {
      width: '23.5%',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      paddingVertical: 8,
    },
    monthPickerText: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '600',
    },
    yearPicker: {
      height: 210,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
    },
    yearPickerContent: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      padding: 8,
    },
    yearCell: {
      width: '22.5%',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      paddingVertical: 8,
    },
    yearCellActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    yearCellText: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '600',
    },
    weekRow: {
      flexDirection: 'row',
      paddingHorizontal: 2,
    },
    weekHeader: {
      width: '14.28%',
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textAlign: 'center',
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    gridCell: {
      width: '14.28%',
      alignItems: 'center',
      justifyContent: 'center',
      aspectRatio: 1.15,
      borderRadius: 8,
      gap: 2,
    },
    gridCellSelected: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
      borderWidth: 1,
    },
    gridCellText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '600',
    },
    gridCellTextToday: { color: theme.primary, fontWeight: '800' },
    gridCellTextSelected: { color: theme.primaryForeground, fontWeight: '700' },
    gridCellDot: {
      width: 4,
      height: 4,
      borderRadius: 999,
      backgroundColor: theme.accent,
    },
    footerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      marginTop: 2,
    },
    footerSelection: {
      flex: 1,
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    todayButton: {
      borderRadius: 999,
      backgroundColor: theme.primary,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    todayButtonText: {
      color: theme.primaryForeground,
      fontSize: 13,
      fontWeight: '700',
    },
  });
}
