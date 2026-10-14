import React from 'react';
import { Pressable, StyleSheet, ViewStyle, ActivityIndicator } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, radii, spacing } from '@/design/tokens';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  testID?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * One action per screen, sitting low in the thumb zone.
 *
 * No arrows, no borders (borders belong to inputs only), one radius: the primary
 * action is Ink on Paper, which is the strongest contrast in the palette.
 */
export const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  testID,
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePressIn = () => {
    if (disabled || loading) return;
    scale.value = withTiming(0.98, { duration: 110 });
  };

  const handlePressOut = () => {
    scale.value = withTiming(1, { duration: 140 });
  };

  const handlePress = () => {
    if (disabled || loading) return;
    if (variant === 'primary') {
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Haptics are a nicety; a device without them must not block the action.
      }
    }
    onPress();
  };

  const background =
    variant === 'primary' ? colors.text : variant === 'secondary' ? colors.surfaceTint : 'transparent';
  const labelColor =
    variant === 'primary' ? colors.surface : variant === 'secondary' ? colors.text : colors.accent;

  return (
    <AnimatedPressable
      testID={testID}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[styles.base, { backgroundColor: background, opacity: disabled ? 0.4 : 1 }, animatedStyle, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} size="small" />
      ) : (
        <Text variant="body" weight="semiBold" style={{ color: labelColor }}>
          {label}
        </Text>
      )}
    </AnimatedPressable>
  );
};

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
