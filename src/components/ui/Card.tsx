import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '@/design/tokens';
import { Text } from './Text';

export type CardTone = 'default' | 'hero' | 'quiet' | 'danger';

interface CardProps {
  overline?: string;
  title?: string;
  subtitle?: string;
  tone?: CardTone;
  style?: ViewStyle;
  children?: React.ReactNode;
}

/**
 * The single card container used across the app.
 *
 * Tones:
 * - default: the ordinary grouped block.
 * - hero: the one block per screen that carries today's instruction or the current stage.
 * - quiet: no box at all — an editorial section separated by spacing only.
 * - danger: destructive actions, marked with the garnet hairline.
 */
export function Card({ overline, title, subtitle, tone = 'default', style, children }: CardProps) {
  return (
    <View style={[styles.base, TONES[tone], style]}>
      {overline ? (
        <Text variant="overline" color={tone === 'danger' ? 'garnet' : 'champagneMuted'}>
          {overline}
        </Text>
      ) : null}
      {title ? (
        <Text variant="titleSmall" color={tone === 'hero' ? 'champagneLight' : 'ivory'}>
          {title}
        </Text>
      ) : null}
      {subtitle ? (
        <Text variant="sub" color="ivorySecondary">
          {subtitle}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.card,
    borderCurve: 'continuous',
    gap: spacing.inline,
  },
});

const TONES: Record<CardTone, ViewStyle> = {
  default: {
    padding: spacing.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  hero: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairlineGold,
    gap: spacing.md,
  },
  quiet: {
    paddingVertical: spacing.md,
    backgroundColor: 'transparent',
  },
  danger: {
    padding: spacing.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.garnet,
  },
};
