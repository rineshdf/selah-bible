/**
 * AnimatedCard — lightweight mount animation for main section cards.
 *
 * Wraps its children with a fade-in plus a slight upward slide (12dp) driven
 * by the native Animated driver, so cards settle without blocking touch or
 * adding layout thrash. Used for the Daily Walk section cards and static
 * manager cards; lists keep their plain mount behavior.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

export interface AnimatedCardProps {
  children: ReactNode;
  /** Outer card style — transform/opacity are appended to it. */
  style?: StyleProp<ViewStyle>;
  /** Optional stagger delay in ms so multiple cards cascade. */
  delay?: number;
  /** Duration of the fade+slide (ms). */
  duration?: number;
}

export default function AnimatedCard({
  children,
  style,
  delay = 0,
  duration = 280,
}: AnimatedCardProps) {
  // The driver value lives in lazy state (never a ref touched during render).
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      delay,
      useNativeDriver: true,
    }).start();
  }, [duration, delay, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
