/**
 * A pressable with a lightweight 100%-native-driver touch impulse:
 * scale 1→0.97→1 and highlight overlay opacity 0→0.14→0, both driven by a
 * single `Animated.Value` with `useNativeDriver: true` and `delayPressIn={0}`
 * so taps respond under 16ms. No `setState` runs inside `onPressIn`/`onPressOut`.
 * Layout flex styles are forwarded to the outer Pressable; visual styles apply
 * to the inner animated view.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useOptionalAppTheme } from '@/constants/ThemeContext';

export interface ScalePressableProps extends Omit<PressableProps, 'style' | 'children' | 'android_ripple'> {
  /**
   * Layout & visual styles. Layout flex styles are automatically forwarded to
   * the outer Pressable, while visual styles apply to the inner animated view.
   */
  style?: StyleProp<ViewStyle>;
  /** Rendered inside the animated view. */
  children?: ReactNode;
  /**
   * Android ripple. Pass `null` to disable it entirely, or a custom config to
   * override the subtle indigo ripple used app-wide.
   */
  android_ripple?: PressableProps['android_ripple'] | null;
}

const PRESSED_SCALE = 0.97;
const PRESSED_OPACITY = 0.14;

/** App-wide default ripple (matches the indigo accent) when none is given. */
const DEFAULT_RIPPLE: PressableProps['android_ripple'] = {
  color: 'rgba(99,102,241,0.12)',
  borderless: false,
};

const LAYOUT_PROPERTIES = new Set([
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'width',
  'minWidth',
  'maxWidth',
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginHorizontal',
  'marginVertical',
  'marginStart',
  'marginEnd',
  'alignSelf',
  'position',
  'top',
  'bottom',
  'left',
  'right',
  'start',
  'end',
  'zIndex',
]);

export function ScalePressable({
  style,
  onPressIn,
  onPressOut,
  android_ripple,
  children,
  ...rest
}: ScalePressableProps) {
  const themeContext = useOptionalAppTheme();
  const isDark = themeContext ? themeContext.themeMode === 'dark' : false;

  // Single Animated.Value driven 0→1 on press and 1→0 on release, purely
  // native (useNativeDriver: true). No setState in press handlers. Held in
  // state with its interpolations created once at initialization so no
  // interpolation runs during component render.
  const [{ anim, pressedScale, pressedOpacity }] = useState(() => {
    const a = new Animated.Value(0);
    return {
      anim: a,
      pressedScale: a.interpolate({ inputRange: [0, 1], outputRange: [1, PRESSED_SCALE] }),
      pressedOpacity: a.interpolate({ inputRange: [0, 1], outputRange: [0, PRESSED_OPACITY] }),
    };
  });

  const { outerStyle, innerStyle, flatStyle } = useMemo(() => {
    const flat = (StyleSheet.flatten(style) || {}) as ViewStyle;
    const outer: Record<string, unknown> = {};
    const inner: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(flat)) {
      if (value === undefined) continue;
      if (LAYOUT_PROPERTIES.has(key)) {
        (outer as Record<string, unknown>)[key] = value;
      } else {
        (inner as Record<string, unknown>)[key] = value;
      }
    }

    // Ensure wrapping a flex: 1 button never collapses its width
    const innerRecord = inner as Record<string, unknown>;
    if (flat.flex !== undefined) {
      innerRecord.flex = flat.flex;
    }
    if (flat.width !== undefined) {
      innerRecord.width = '100%';
    }
    if (flat.height !== undefined) {
      outer.height = flat.height;
    }
    if (flat.borderRadius !== undefined) {
      outer.borderRadius = flat.borderRadius;
    }

    return { outerStyle: outer, innerStyle: inner, flatStyle: flat };
  }, [style]);

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      if (rest.disabled) return;
      Animated.timing(anim, {
        toValue: 1,
        duration: 60,
        useNativeDriver: true,
      }).start();
      onPressIn?.(event);
    },
    [anim, onPressIn, rest.disabled],
  );

  const handlePressOut = useCallback(
    (event: GestureResponderEvent) => {
      if (rest.disabled) return;
      Animated.timing(anim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start();
      onPressOut?.(event);
    },
    [anim, onPressOut, rest.disabled],
  );

  const impulseBg = isDark
    ? 'rgba(129, 140, 248, 0.16)'
    : 'rgba(79, 70, 229, 0.10)';

  return (
    <Pressable
      style={outerStyle}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      unstable_pressDelay={0}
      {...rest}
      android_ripple={
        android_ripple !== null && android_ripple !== undefined
          ? android_ripple
          : DEFAULT_RIPPLE
      }
    >
      <Animated.View
        style={[
          innerStyle,
          {
            overflow: 'hidden',
            transform: [{ scale: pressedScale }],
          },
        ]}
      >
        {children}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            flatStyle.borderRadius !== undefined ? { borderRadius: flatStyle.borderRadius } : null,
            {
              opacity: pressedOpacity,
              backgroundColor: impulseBg,
            },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}
