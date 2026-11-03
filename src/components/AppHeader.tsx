/**
 * Compact reusable top bar — 44dp tall so center content keeps maximum
 * screen space. The top-right always renders the SVG Sun/Moon dark & light
 * toggle (Step 1); screens can add custom right widgets before it.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/constants/ThemeContext';
import { SunMoonSvg } from '@/components/SvgIcons';
import type { AppTheme } from '@/constants/colors';

export interface AppHeaderProps {
  /** Left widget override (pill, back button...). */
  left?: React.ReactNode;
  /** Extra widgets before the theme toggle (calendar button, etc.). */
  right?: React.ReactNode;
  /** Optional single-line title drawn after `left`. */
  title?: string;
}

export default function AppHeader({ left, right, title }: AppHeaderProps) {
  const { theme, themeMode, toggleTheme } = useAppTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.bar}>
      <View style={styles.leftSlot}>{left}</View>
      {title ? <Text numberOfLines={1} style={styles.title}>{title}</Text> : null}
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
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      backgroundColor: theme.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    leftSlot: {
      flexDirection: 'row',
      alignItems: 'center',
      minWidth: 40,
      flexShrink: 1,
    },
    title: {
      flex: 1,
      color: theme.text,
      fontSize: 15,
      fontWeight: '700',
    },
    rightSlot: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
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
