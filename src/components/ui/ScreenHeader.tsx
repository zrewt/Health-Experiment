import React from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '@/design/tokens';
import { Text } from './Text';

interface ScreenHeaderProps {
  overline: string;
  title: string;
  /** The standing non-medical-advice caption, or any single-line notice. */
  notice?: string;
  /** Optional trailing control, e.g. a quiet back action on a step screen. */
  action?: React.ReactNode;
}

/**
 * The one header shape every screen uses: an uppercase overline, the serif
 * screen name, and the standing caption. Keeps the top of every page identical
 * so the content below it is what varies.
 */
export function ScreenHeader({ overline, title, notice, action }: ScreenHeaderProps) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text variant="overline" color="champagneMuted">
            {overline}
          </Text>
          <Text variant="titleLarge">{title}</Text>
        </View>
        {action}
      </View>
      {notice ? (
        <Text variant="caption" color="champagne">
          {notice}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleBlock: { flexShrink: 1, gap: 2 },
});
