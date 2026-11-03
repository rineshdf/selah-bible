/**
 * Bottom navigation for all 6 tabs.
 *
 * Each `<Tabs.Screen>` gets its own crisp custom SVG icon that grows heavier
 * (and gains an accent pill) when focused. The bar is a fixed 64dp tall with
 * a hairline top border and safe-area padding, so every icon + label pair
 * sits evenly aligned without clipping.
 */

import { Tabs } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/constants/ThemeContext';
import {
  TabBibleSvg,
  TabDailyWalkSvg,
  TabHighlightsSvg,
  TabMessagesSvg,
  TabProgressSvg,
  TabVersionsSvg,
} from '@/components/SvgIcons';

export default function TabsLayout() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();

  /** Focused icon sits inside a subtle rounded pill; unfocused is bare. */
  const tabIcon = (Icon: typeof TabBibleSvg) => {
    function TabBarIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
      return (
        <View
          style={[
            tabStyles.iconPill,
            focused
              ? {
                  backgroundColor: theme.isDark
                    ? 'rgba(124,154,255,0.16)'
                    : 'rgba(59,91,219,0.10)',
                }
              : null,
          ]}
        >
          <Icon color={color} size={24} focused={focused} />
        </View>
      );
    }
    return TabBarIcon;
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tabBarActive,
        tabBarInactiveTintColor: theme.tabBarInactive,
        tabBarStyle: {
          backgroundColor: theme.tabBarBackground,
          borderTopColor: theme.border,
          height: 64 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontWeight: '600',
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Bible',
          tabBarIcon: tabIcon(TabBibleSvg),
        }}
      />
      <Tabs.Screen
        name="highlights"
        options={{
          title: 'Highlights',
          tabBarIcon: tabIcon(TabHighlightsSvg),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: tabIcon(TabMessagesSvg),
        }}
      />
      <Tabs.Screen
        name="daily-walk"
        options={{
          title: 'Daily Walk',
          tabBarIcon: tabIcon(TabDailyWalkSvg),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          tabBarIcon: tabIcon(TabProgressSvg),
        }}
      />
      <Tabs.Screen
        name="bibles"
        options={{
          title: 'Library',
          tabBarIcon: tabIcon(TabVersionsSvg),
        }}
      />
    </Tabs>
  );
}

const tabStyles = StyleSheet.create({
  iconPill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
