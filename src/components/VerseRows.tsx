/**
 * Per-verse scripture rendering shared by Messages, Daily Walk and the
 * universal verse picker data flow.
 *
 * Scripture stored via the verse picker keeps a `[n]` marker prefix per verse,
 * e.g. "[1] In the beginning…\n[2] …". `parseVerseRows` turns that tagged
 * text into badge rows; legacy combined text without markers falls back to a
 * single unnumbered row (still checked against the old `1.` prefix style).
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/constants/ThemeContext';

export type VerseRow = {
  /** Verse number, or `null` for an unnumbered fallback row. */
  verse: number | null;
  text: string;
};

/** Tagged storage format: `[1] text…\n[2] text…`. */
export function formatVersesForStorage(
  verses: { verse: number; text: string }[],
): string {
  return verses.map((item) => `[${item.verse}] ${item.text}`).join('\n');
}

/**
 * Split combined scripture text into per-verse rows.
 *
 * Accepts the picker's `[1] … \n[2] …` storage format and the older plain
 * `1. …` prefix format. Returns a single unnumbered row when no reliable
 * marker stream is found (legacy combined text).
 */
export function parseVerseRows(content: string): VerseRow[] {
  const text = (content ?? '').trim();
  if (!text) return [];

  // `[5] …` anywhere, or `5. …` after line start / whitespace.
  const markerRegex = /\[(\d{1,3})\]\s*|(^|\s)(\d{1,3})\.\s+/g;
  const marks: { verse: number; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = markerRegex.exec(text)) !== null) {
    const verse = match[1] !== undefined ? Number(match[1]) : Number(match[3]);
    marks.push({ verse, start: match.index, end: match.index + match[0].length });
  }

  if (marks.length > 0 && marks.every((mark, index) => mark.verse >= 1)) {
    const rows: VerseRow[] = [];
    let valid = true;
    let previous = -Infinity;
    marks.forEach((mark, index) => {
      const bodyStart = index === 0 ? mark.end : mark.end;
      const bodyEnd = index + 1 < marks.length ? marks[index + 1].start : text.length;
      const body = text.slice(bodyStart, bodyEnd).trim();
      if (!body || mark.verse <= previous) {
        valid = false;
      }
      rows.push({ verse: mark.verse, text: body });
      previous = mark.verse;
    });
    if (valid) return rows;
  }

  return [{ verse: null, text }];
}

function makeStyles() {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    // Hebrew codices and other RTL texts mirror the row and right-align the
    // text; the number badge slides to the left edge of the suffix line.
    rowRtl: {
      flexDirection: 'row-reverse',
      justifyContent: 'flex-start',
    },
    badge: {
      minWidth: 26,
      height: 24,
      borderRadius: 7,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    badgeText: { fontSize: 12, fontWeight: '800' },
    rowText: { flex: 1, fontSize: 15, lineHeight: 24 },
    rowTextRtl: {
      textAlign: 'right',
      writingDirection: 'rtl',
    },
  });
}

/** Rows of verse text with a small number badge per verse. */
export function VerseRows({
  rows,
  textColor,
  rtl = false,
}: {
  rows: VerseRow[];
  textColor?: string;
  /** Hebrew / RTL scriptures render row-reversed with right-aligned text. */
  rtl?: boolean;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(), []);
  return (
    <View>
      {rows.map((row, index) => (
        <View
          key={`${row.verse ?? 'x'}-${index}`}
          style={[styles.row, rtl ? styles.rowRtl : null]}
        >
          {row.verse !== null ? (
            <View style={[styles.badge, { backgroundColor: `${colors.primary}22` }]}>
              <Text style={[styles.badgeText, { color: colors.primary }]}>
                {row.verse}
              </Text>
            </View>
          ) : null}
          <Text
            style={[
              styles.rowText,
              { color: textColor ?? colors.text },
              rtl ? styles.rowTextRtl : null,
            ]}
          >
            {row.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Convenience wrapper: parse stored scripture text into rows then render. */
export function ParsedVerseRows({
  text,
  textColor,
  rtl = false,
}: {
  text: string;
  textColor?: string;
  rtl?: boolean;
}) {
  const rows = useMemo(() => parseVerseRows(text), [text]);
  return <VerseRows rows={rows} textColor={textColor} rtl={rtl} />;
}