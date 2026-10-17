import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { colors, spacing } from '@/design/tokens';
import { progressDots } from '@/experiment/plain-language';

interface NightTrackerProps {
  /** Nights with sleep logged so far. */
  logged: number;
  /** Nights the run-in needs. */
  target: number;
}

/**
 * A row of dots, one per night. Each filled dot is a night logged, so the user sees
 * progress at a glance before reading any number. The dots are decorative for screen
 * readers; the label carries the same information in words.
 */
export function NightTracker({ logged, target }: NightTrackerProps) {
  const dots = progressDots(logged, target);
  const filledCount = dots.filter(Boolean).length;

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${filledCount} of ${target} nights logged`}
      accessibilityValue={{ min: 0, max: target, now: filledCount }}
    >
      {dots.map((filled, index) => (
        <Dot key={index} filled={filled} index={index} />
      ))}
    </View>
  );
}

function Dot({ filled, index }: { filled: boolean; index: number }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(filled ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = filled ? 1 : 0;
      return;
    }
    progress.value = withDelay(index * 40, withTiming(filled ? 1 : 0, { duration: 260 }));
  }, [filled, index, reduceMotion, progress]);

  const animated = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [colors.lineStrong, colors.accent]),
    transform: [{ scale: 0.8 + 0.2 * progress.value }],
  }));

  return <Animated.View style={[styles.dot, animated]} />;
}

const DOT = 14;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
});
