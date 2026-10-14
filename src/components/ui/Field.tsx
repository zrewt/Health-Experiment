import React, { useState } from 'react';
import { TextInput, View, StyleSheet, TextInputProps, ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from '@/design/tokens';
import { Text } from './Text';

interface FieldProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
}

/**
 * The one input. A hairline border is allowed here and nowhere else, in
 * lineStrong (#788F8C, 3.18:1 on the background) so the control's boundary is
 * perceivable; focus switches the border to the accent instead of a glow.
 */
export const Field: React.FC<FieldProps> = ({ label, error, containerStyle, style, onFocus, onBlur, ...props }) => {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text variant="caption" color="textMuted" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        keyboardAppearance="light"
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          { borderColor: focused ? colors.focus : error ? colors.signalText : colors.lineStrong },
          style,
        ]}
        {...props}
      />
      {error ? (
        <Text variant="caption" color="signalText" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: {},
  input: {
    minHeight: 56,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: radii.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
  },
  error: { marginTop: spacing.xs },
});
