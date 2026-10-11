import React from 'react';
import {
  TextInput,
  View,
  StyleSheet,
  TextInputProps,
  ViewStyle,
} from 'react-native';
import { colors, radii, spacing, typography } from '@/design/tokens';
import { Text } from './Text';

interface FieldProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
}

export const Field: React.FC<FieldProps> = ({
  label,
  error,
  containerStyle,
  style,
  ...props
}) => {
  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text variant="sub" color="ivoryMuted" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.ivoryMuted}
        style={[
          styles.input,
          error ? styles.inputError : undefined,
          style,
        ]}
        {...props}
      />
      {error ? (
        <Text variant="caption" color="garnet" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.sm,
  },
  label: {
    marginBottom: spacing.xs,
  },
  input: {
    height: 54,
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radii.control,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.md,
    color: colors.ivory,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
  },
  inputError: {
    borderColor: colors.garnet,
  },
  error: {
    marginTop: spacing.xs,
  },
});
