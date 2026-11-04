/**
 * App color constants for TamilBibleApp.
 *
 * Highlights are five high-contrast, dark/light adaptive colors. Every palette
 * entry carries a dark-mode background (deep translucent accent), a light-mode
 * background (soft warm tint), a solid border, and period-correct text colors,
 * so highlighted scripture is always 100% readable.
 * Themes provide the full surface palette the UI needs.
 */

// ---------------------------------------------------------------------------
// Highlight colors
// ---------------------------------------------------------------------------

/** Stable legacy picker keys (kept for backwards-compatible color mapping). */
export type HighlightColorKey = 'yellow' | 'green' | 'blue' | 'purple' | 'pink';

export type HighlightColorId = 'amber' | 'emerald' | 'sky' | 'rose' | 'violet';

export interface HighlightColor {
  /** Stable legacy key persisted in older builds (`highlights.color_key`). */
  key: HighlightColorKey;
  /** Palette id used by the picker UI and `getHighlightStyle`. */
  id: HighlightColorId;
  /** Display names for pickers. */
  tamilName: string;
  englishName: string;
  /** Swatch circle hex, used for chips, borders, and legend dots. */
  hex: string;
  /** Deep, rich translucent background for Dark Mode. */
  darkBg: string;
  /** Soft warm tint background for Light Mode. */
  lightBg: string;
  /** Solid accent border color. */
  border: string;
  /** Crisp text color over `darkBg`. */
  darkText: string;
  /** Deep text color over `lightBg`. */
  lightText: string;
  /** Legacy translucent rgba background (compat only; do not use for text). */
  background: string;
}

/** High-contrast palette that adapts to the active theme. */
export const HIGHLIGHT_PALETTE: HighlightColor[] = [
  {
    key: 'yellow',
    id: 'amber',
    tamilName: 'அம்பர்',
    englishName: 'Amber',
    hex: '#F59E0B',
    darkBg: 'rgba(245, 158, 11, 0.25)',
    lightBg: '#FEF3C7',
    border: '#F59E0B',
    darkText: '#F8FAFC',
    lightText: '#0F172A',
    background: 'rgba(245, 158, 11, 0.25)',
  },
  {
    key: 'green',
    id: 'emerald',
    tamilName: 'பச்சை',
    englishName: 'Emerald',
    hex: '#10B981',
    darkBg: 'rgba(16, 185, 129, 0.25)',
    lightBg: '#D1FAE5',
    border: '#10B981',
    darkText: '#F8FAFC',
    lightText: '#0F172A',
    background: 'rgba(16, 185, 129, 0.25)',
  },
  {
    key: 'blue',
    id: 'sky',
    tamilName: 'நீலம்',
    englishName: 'Sky',
    hex: '#38BDF8',
    darkBg: 'rgba(56, 189, 248, 0.25)',
    lightBg: '#E0F2FE',
    border: '#0284C7',
    darkText: '#F8FAFC',
    lightText: '#0F172A',
    background: 'rgba(56, 189, 248, 0.25)',
  },
  {
    key: 'pink',
    id: 'rose',
    tamilName: 'ரோஸ்',
    englishName: 'Rose',
    hex: '#F43F5E',
    darkBg: 'rgba(244, 63, 94, 0.25)',
    lightBg: '#FFE4E6',
    border: '#E11D48',
    darkText: '#F8FAFC',
    lightText: '#0F172A',
    background: 'rgba(244, 63, 94, 0.25)',
  },
  {
    key: 'purple',
    id: 'violet',
    tamilName: 'ஊதா',
    englishName: 'Violet',
    hex: '#A855F7',
    darkBg: 'rgba(168, 85, 247, 0.25)',
    lightBg: '#F3E8FF',
    border: '#7C3AED',
    darkText: '#F8FAFC',
    lightText: '#0F172A',
    background: 'rgba(168, 85, 247, 0.25)',
  },
];

/** Picker-facing alias for the palette (kept for existing screens). */
export const HIGHLIGHT_COLORS: HighlightColor[] = HIGHLIGHT_PALETTE;

/**
 * New accent swatch hexes, in picker order. Screens and the theme context
 * import this array directly (chips, color bars, pickers).
 */
export const PASTEL_HIGHLIGHT_COLORS = [
  '#F59E0B',
  '#10B981',
  '#38BDF8',
  '#F43F5E',
  '#A855F7',
] as const;

const HIGHLIGHT_COLOR_MAP: Record<HighlightColorKey, HighlightColor> =
  HIGHLIGHT_COLORS.reduce(
    (map, color) => {
      map[color.key] = color;
      return map;
    },
    {} as Record<HighlightColorKey, HighlightColor>,
  );

/**
 * Resolve a persisted `color_key` back into a color definition.
 * Falls back to yellow when the stored key is unknown (e.g. migrations).
 */
export function getHighlightColor(key: string): HighlightColor {
  return HIGHLIGHT_COLOR_MAP[key as HighlightColorKey] ?? HIGHLIGHT_COLOR_MAP.yellow;
}

/** One resolved highlight rendering style. */
export interface HighlightStyle {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
}

/**
 * Legacy pastel hexes from older builds -> palette id. The pale pastels used
 * white-on-pastel text before; they render with the adaptive palette now.
 */
const LEGACY_HEX_TO_ID: Record<string, HighlightColorId> = {
  '#FDE68A': 'amber',
  '#FFE9A8': 'amber',
  '#A7F3D0': 'emerald',
  '#BAE6FD': 'sky',
  '#FECDD3': 'rose',
  '#DDD6FE': 'violet',
};

const PALETTE_BY_ID: Record<HighlightColorId, HighlightColor> = HIGHLIGHT_PALETTE
  .reduce((map, color) => {
    map[color.id] = color;
    return map;
  }, {} as Record<HighlightColorId, HighlightColor>);

const DEFAULT_HIGHLIGHT_ID: HighlightColorId = 'amber';

function paletteForId(id: HighlightColorId): HighlightColor {
  return PALETTE_BY_ID[id] ?? PALETTE_BY_ID[DEFAULT_HIGHLIGHT_ID];
}

/**
 * Map ANY persisted color reference (legacy pastel hex like `#FDE68A`, a
 * newer swatch hex like `#F59E0B`, or a palette id like `amber`) to the
 * adaptive highlight render style for the active theme:
 *
 * - Dark mode: deep translucent accent background + crisp white `#F8FAFC` text.
 * - Light mode: soft warm pastel background + deep `#0F172A` text.
 *
 * The returned `backgroundColor` / `borderColor` / `textColor` guarantees
 * highlighted scripture stays readable in both themes.
 */
export function getHighlightStyle(colorHexOrId: string | null | undefined, isDark: boolean): HighlightStyle {
  const reference = (colorHexOrId ?? '').trim();
  let id: HighlightColorId | undefined;

  // Blank reference = the verse was never highlighted: return a fully
  // transparent style with the plain body text color so readers that pass the
  // style through unguarded can never paint a black-on-black verse in Dark
  // Mode (and never need a null check either).
  if (!reference) {
    return {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      textColor: isDark ? '#F1F5F9' : '#0F172A',
    };
  }

  if (reference) {
    const key = reference.toLowerCase();
    const byRawId = HIGHLIGHT_PALETTE
      .find((color) => color.id === key || color.hex.toLowerCase() === key);
    if (byRawId) {
      id = byRawId.id;
    } else {
      // Legacy hexes and any unknown-but-hex-like value map through the table.
      const normalized = reference.startsWith('#') ? reference.toUpperCase() : reference;
      id = LEGACY_HEX_TO_ID[normalized];
    }
  }

  // Unknown color refs (both here and above) resolve to the amber default.
  const palette = paletteForId(id ?? DEFAULT_HIGHLIGHT_ID);
  return {
    backgroundColor: isDark ? palette.darkBg : palette.lightBg,
    borderColor: palette.border,
    textColor: isDark ? palette.darkText : palette.lightText,
  };
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export interface AppTheme {
  /** True for the dark variant, so screens can tweak one-off styles. */
  isDark: boolean;
  /** Accent used for active tabs, buttons, and selection. */
  primary: string;
  /** Text/icons drawn on top of `primary`. */
  primaryForeground: string;
  /** Main window background. */
  background: string;
  /** Cards, sheets, and list rows. */
  surface: string;
  /** Alias of `surface` — card backgrounds. */
  card: string;
  /** Subtle variant used for inputs and read-progress bars. */
  surfaceMuted: string;
  /** Hairline borders and separators. */
  border: string;
  /** Primary body text. */
  text: string;
  /** Alias of `textMuted` — secondary/helper text. */
  subtext: string;
  /** Accent used for highlights-on-surface, links, and secondary actions. */
  accent: string;
  textMuted: string;
  /** Scripture reading area (slightly warmer than `background`). */
  readingBackground: string;
  tabBarBackground: string;
  tabBarActive: string;
  tabBarInactive: string;
  /** React-Native StatusBar values. */
  statusBarStyle: 'light' | 'dark';
  /** Days already read, drawn on calendar grids. */
  streakActive: string;
  streakInactive: string;
}

export const lightTheme: AppTheme = {
  isDark: false,
  primary: '#3B5BDB',
  primaryForeground: '#FFFFFF',
  accent: '#2563EB',
  background: '#F7F8FA',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  surfaceMuted: '#EEF0F4',
  border: '#E3E6EB',
  text: '#1B1F27',
  subtext: '#6B7280',
  textMuted: '#6B7280',
  readingBackground: '#FBFAF7',
  tabBarBackground: '#FFFFFF',
  tabBarActive: '#3B5BDB',
  tabBarInactive: '#9AA1AC',
  statusBarStyle: 'dark',
  streakActive: '#3B5BDB',
  streakInactive: '#E3E6EB',
};

export const darkTheme: AppTheme = {
  isDark: true,
  primary: '#7C9AFF',
  primaryForeground: '#101319',
  accent: '#8FB0FF',
  background: '#10131A',
  surface: '#1A1F29',
  card: '#1A1F29',
  surfaceMuted: '#232936',
  border: '#2C3340',
  text: '#EDF0F5',
  subtext: '#98A1AF',
  textMuted: '#98A1AF',
  readingBackground: '#13161D',
  tabBarBackground: '#1A1F29',
  tabBarActive: '#7C9AFF',
  tabBarInactive: '#8B95A5',
  statusBarStyle: 'light',
  streakActive: '#7C9AFF',
  streakInactive: '#2C3340',
};

export function getTheme(dark: boolean): AppTheme {
  return dark ? darkTheme : lightTheme;
}
