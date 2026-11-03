/**
 * A pressable whose content springs down to 0.97 while pressed and springs
 * back to 1.0 on release, plus a subtle Android ripple. Used for the pill
 * buttons, menu rows and cards across the tabs where a plain `Pressable`
 * would feel static. Styling mirrors the surrounding `Pressable` usage, so
 * screens can swap it in without touching their StyleSheet.
 */

import { useMemo, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export interface ScalePressableProps extends Omit<PressableProps, 'style' | 'children'> {
  /**
   * Layout styles for the pill / card, applied to the inner animated view so
   * the whole element scales as one. Function styles (state → style) are not
   * supported; press feedback comes from the spring instead.
   */
  style?: StyleProp<ViewStyle>;
  /** Rendered inside the animated view. Render-prop children are not supported. */
  children?: ReactNode;
}

const PRESSED_SCALE = 0.97;

export function ScalePressable({
  style,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: ScalePressableProps) {
  /** Stable animated value, created once per mounted element. */
  const scale = useMemo(() => new Animated.Value(1), []);

  const springTo = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 34,
      bounciness: 3,
    }).start();
  };

  const handlePressIn = (event: GestureResponderEvent) => {
    springTo(PRESSED_SCALE);
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    springTo(1);
    onPressOut?.(event);
  };

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      android_ripple={{ color: 'rgba(99,102,241,0.12)', borderless: false }}
      {...rest}
    >
      <Animated.View
        style={[style, { transform: [{ scale }] }]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
