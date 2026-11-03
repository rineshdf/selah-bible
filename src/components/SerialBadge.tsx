import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/constants/ThemeContext';
import { getHighlightStyle } from '@/constants/colors';

export interface SerialBadgeProps {
  number: number;
  color?: string;
  textColor?: string;
  borderColor?: string;
}

export default function SerialBadge({ number, color, textColor, borderColor }: SerialBadgeProps) {
  const { theme } = useAppTheme();
  const resolved = color ? getHighlightStyle(color, theme.isDark) : null;
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: color ? (resolved?.backgroundColor ?? color) : theme.surfaceMuted,
          borderColor: borderColor ?? resolved?.borderColor ?? theme.border,
        },
      ]}
    >
      <Text style={[styles.number, { color: textColor ?? resolved?.textColor ?? theme.text }]}>
        {number}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
});
