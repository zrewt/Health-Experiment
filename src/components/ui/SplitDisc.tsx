import React, { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/design/tokens';

export type DiscTone = 'cutoff' | 'normal' | 'none';

interface SplitDiscProps {
  size?: number;
  /** Today's type. Carried by the text label beside the disc, never by colour alone. */
  tone: DiscTone;
  style?: ViewStyle;
}

/**
 * The signature mark: a circle split into two half-discs, the top one shifted right.
 *
 * Built from plain Views. The bottom half is always Ink, so the offset seam reads in
 * greyscale and the mark never depends on the Mint/Coral fills — those are decoration.
 * One settle animation on mount, skipped when the device asks for reduced motion.
 */
export function SplitDisc({ size = 132, tone, style }: SplitDiscProps) {
  const reduceMotion = useReducedMotion();
  const settle = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      settle.value = 1;
      return;
    }
    settle.value = withTiming(1, { duration: 320 });
  }, [reduceMotion, settle]);

  const half = size / 2;
  const topFill = tone === 'cutoff' ? colors.signal : tone === 'normal' ? colors.graphic : colors.surfaceTint;

  const topStyle = useAnimatedStyle(() => ({
    opacity: settle.value,
    // 22% of the diameter down to 14%: the halves end visibly out of line.
    transform: [{ translateX: size * (0.22 - 0.08 * settle.value) }],
  }));

  return (
    <View
      style={[{ width: size, height: size }, style]}
      // Decorative: the type is written in the label beside it.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          styles.half,
          {
            top: half,
            width: size,
            height: half,
            borderBottomLeftRadius: half,
            borderBottomRightRadius: half,
            backgroundColor: colors.text,
          },
        ]}
      />
      <Animated.View
        style={[
          styles.half,
          styles.topHalf,
          {
            width: size,
            height: half,
            borderTopLeftRadius: half,
            borderTopRightRadius: half,
            backgroundColor: topFill,
          },
          topStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  half: { position: 'absolute', left: 0 },
  /** The offset top half is the mark: it is drawn above the fixed bottom half. */
  topHalf: { top: 0 },
});
