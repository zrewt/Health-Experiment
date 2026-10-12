import React from 'react';
import {
  Pressable,
  StyleSheet,
  ViewStyle,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
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

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
    };
  });

  const handlePressIn = () => {
    if (disabled || loading) return;
    scale.value = withTiming(0.97, { duration: 110 });
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
        // Haptics safe fallback
      }
    }
    onPress();
  };

  const getBackgroundColor = () => {
    if (variant === 'primary') return colors.champagne;
    if (variant === 'secondary') return colors.surface;
    return 'transparent';
  };

  const getBorderColor = () => {
    if (variant === 'primary') return colors.champagneLight;
    if (variant === 'secondary') return colors.hairlineBright;
    return 'transparent';
  };

  return (
    <AnimatedPressable
      testID={testID}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[
        styles.base,
        {
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor(),
          borderWidth: variant === 'quiet' ? 0 : 1,
          opacity: disabled ? 0.35 : 1,
        },
        animatedStyle,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.ground : colors.champagne}
          size="small"
        />
      ) : (
        <Text
          variant="body"
          weight="semiBold"
          style={{
            color: variant === 'primary' ? colors.ground : variant === 'secondary' ? colors.ivory : colors.ivoryMuted,
            letterSpacing: 0.1,
          }}
        >
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
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderCurve: 'continuous',
  },
});
