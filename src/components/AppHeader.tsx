/**
 * Compact reusable top bar that starts continuous from the status bar: the
 * status-bar inset is padding INSIDE the header (no SafeAreaView wrapper, no
 * dead gap), then one row of content. The top-right always renders the SVG
 * Sun/Moon dark & light toggle (Step 1); screens can add custom right
 * widgets before it.
 */

import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/constants/ThemeContext';
import { SunMoonSvg } from '@/components/SvgIcons';
import SelahAppIconSvg from '@/components/SelahAppIconSvg';
import type { AppTheme } from '@/constants/colors';

export interface AppHeaderProps {
  /** Left widget override (pill, back button...). */
  left?: React.ReactNode;
  /** Extra widgets before the theme toggle (calendar button, etc.). */
  right?: React.ReactNode;
  /** Optional single-line title drawn after `left`. */
  title?: string;
  /** Set to true to hide the default Selah icon when no custom `left` is provided. */
  hideIcon?: boolean;
}

export default function AppHeader({ left, right, title, hideIcon }: AppHeaderProps) {
  const { theme, themeMode, toggleTheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const topInset = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0,
    Platform.OS === 'ios' ? 20 : 24,
  );
  const styles = makeStyles(theme);
  return (
    <View style={[styles.bar, { paddingTop: topInset + 6 }]}>
      <View style={styles.leftSection}>
        {left ? (
          <View style={styles.leftSlot}>{left}</View>
        ) : !hideIcon ? (
          <SelahAppIconSvg size={22} color={theme.primary} />
        ) : null}
        {title ? <Text numberOfLines={1} style={styles.title}>{title}</Text> : null}
      </View>
      <View style={styles.rightSlot}>
        {right}
        <Pressable
          style={styles.toggleButton}
          onPress={toggleTheme}
          accessibilityRole="button"
          accessibilityLabel={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} theme`}
        >
          <SunMoonSvg isDark={themeMode === 'dark'} size={20} color={theme.primary} />
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    bar: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 14,
      paddingBottom: 10,
      backgroundColor: theme.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    leftSection: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    leftSlot: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    title: {
      flex: 1,
      color: theme.text,
      fontSize: 20,
      fontWeight: '800',
    },
    rightSlot: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0,
    },
    toggleButton: {
      width: 34,
      height: 34,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
