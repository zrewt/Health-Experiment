import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '@/design/tokens';
import { Text } from './Text';

export type BannerTone = 'info' | 'notice' | 'error' | 'success';

interface BannerProps {
  tone?: BannerTone;
  children: React.ReactNode;
  /** Optional trailing control, e.g. a retry action. */
  action?: React.ReactNode;
  style?: ViewStyle;
}

const TONE = {
  error: { fill: colors.surface, text: 'signalText' as const, mark: colors.signalText },
  notice: { fill: colors.surfaceTint, text: 'accent' as const, mark: colors.accent },
  success: { fill: colors.surfaceTint, text: 'text' as const, mark: colors.accent },
  info: { fill: colors.surfaceTint, text: 'textMuted' as const, mark: colors.textMuted },
};

/**
 * Status and error messages in one shape.
 *
 * The mark is a small square plus words, never colour alone, and the error tone
 * keeps its border because it is the one thing on the page asking to be fixed.
 */
export function Banner({ tone = 'info', children, action, style }: BannerProps) {
  const tokens = TONE[tone];
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: tokens.fill },
        tone === 'error' ? styles.errorBorder : null,
        style,
      ]}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
    >
      <View style={styles.row}>
        <View style={[styles.mark, { backgroundColor: tokens.mark }]} />
        <Text variant="sub" color={tokens.text} style={styles.body}>
          {children}
        </Text>
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorBorder: { borderWidth: 1, borderColor: colors.signalText },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  mark: { width: 8, height: 8, borderRadius: 2, marginTop: 6 },
  body: { flex: 1 },
});
