/**
 * Global theme mode context.
 *
 * - `themeMode`: the persisted user preference ('dark' | 'light').
 * - `setThemeMode` / `toggleTheme`: mutation helpers.
 * - `colors`: the resolved palette for the active mode, including the five
 *   minimal pastel highlight hexes.
 * - `theme`: the full `AppTheme` palette from `@/constants/colors`.
 *
 * The mode is persisted in AsyncStorage under `@app_theme_mode`; the context
 * writes it on every change so the light/dark switch survives app restarts.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getTheme,
  PASTEL_HIGHLIGHT_COLORS,
  type AppTheme,
} from '@/constants/colors';

export const THEME_MODE_STORAGE_KEY = '@app_theme_mode';

export type ThemeMode = 'dark' | 'light';

export interface ThemeColors {
  /** Main window background. */
  background: string;
  /** Cards, sheets, modals, and list rows. */
  surface: string;
  /** Alias of `surface` kept explicit for card-based UI. */
  card: string;
  /** Primary body text. */
  text: string;
  /** Secondary/helper text. */
  subtext: string;
  /** Hairline borders and separators. */
  border: string;
  /** Primary interactive color (buttons, active chips). */
  primary: string;
  /** Accent for links and secondary actions. */
  accent: string;
  /** The 5 minimal pastel highlight colors, in picker order. */
  highlights: readonly string[];
}

export interface ThemeContextValue {
  themeMode: ThemeMode;
  toggleTheme: () => void;
  setThemeMode: (mode: ThemeMode) => void;
  colors: ThemeColors;
  /** Full palette from `@/constants/colors` for the active mode. */
  theme: AppTheme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function buildColors(mode: ThemeMode, theme: AppTheme): ThemeColors {
  return {
    background: theme.background,
    surface: theme.surface,
    card: theme.card,
    text: theme.text,
    subtext: theme.subtext,
    border: theme.border,
    primary: theme.primary,
    accent: theme.accent,
    highlights: PASTEL_HIGHLIGHT_COLORS,
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');
  const [hydrated, setHydrated] = useState(false);

  // Hydrate the persisted preference once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(THEME_MODE_STORAGE_KEY);
        if (!cancelled && (raw === 'dark' || raw === 'light')) {
          setThemeModeState(raw);
        }
      } catch {
        // Unreadable storage: keep the dark default.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    void AsyncStorage
      .setItem(THEME_MODE_STORAGE_KEY, mode)
      .catch(() => undefined);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeModeState((previous) => {
      const next: ThemeMode = previous === 'dark' ? 'light' : 'dark';
      void AsyncStorage
        .setItem(THEME_MODE_STORAGE_KEY, next)
        .catch(() => undefined);
      return next;
    });
  }, []);

  const theme = useMemo(() => getTheme(themeMode === 'dark'), [themeMode]);
  const colors = useMemo(() => buildColors(themeMode, theme), [theme, themeMode]);

  const value = useMemo<ThemeContextValue>(() => ({
    themeMode,
    toggleTheme,
    setThemeMode,
    colors,
    theme,
  }), [colors, setThemeMode, theme, themeMode, toggleTheme]);

  // Render children only after the stored preference is known so screens do
  // not flash the wrong palette for a frame. `hydrated` resolves immediately
  // even when storage fails.
  if (!hydrated) {
    return null;
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Access the active theme mode, palette, and toggles anywhere in the app. */
export function useAppTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useAppTheme must be used inside <ThemeProvider>.');
  }
  return context;
}
