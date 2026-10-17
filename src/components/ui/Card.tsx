import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '@/design/tokens';
import { Text } from './Text';

export type CardTone = 'default' | 'hero' | 'quiet' | 'tint' | 'danger';

interface CardProps {
  /** Small label above the title. Sentence case, never all-caps. */
  overline?: string;
  title?: string;
  subtitle?: string;
  tone?: CardTone;
  style?: ViewStyle;
  children?: React.ReactNode;
}

/**
 * A surface, not a box.
 *
 * Separation comes from background tone and whitespace, so there is exactly one
 * surface radius, no shadows and no borders — except on `danger`, where the signal
 * colour marks something that needs attention. `quiet` draws no surface at all.
 */
export function Card({ overline, title, subtitle, tone = 'default', style, children }: CardProps) {
  return (
    <View style={[styles.base, TONES[tone], style]}>
      {overline ? (
        <Text variant="caption" color={tone === 'danger' ? 'signalText' : 'textMuted'}>
          {overline}
        </Text>
      ) : null}
      {title ? <Text variant="heading" color="text">{title}</Text> : null}
      {subtitle ? <Text variant="sub" color="textMuted">{subtitle}</Text> : null}
      {children}
    </View>
  );
}

/** Alias: new code reads better as a surface. */
export const Surface = Card;

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.surface,
    gap: spacing.inline,
  },
});

const TONES: Record<CardTone, ViewStyle> = {
  default: {
    padding: spacing.card,
    backgroundColor: colors.surface,
  },
  hero: {
    padding: spacing.card,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  tint: {
    padding: spacing.card,
    backgroundColor: colors.surfaceTint,
  },
  quiet: {
    paddingVertical: spacing.sm,
    backgroundColor: 'transparent',
  },
  danger: {
    padding: spacing.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.signalText,
  },
};
