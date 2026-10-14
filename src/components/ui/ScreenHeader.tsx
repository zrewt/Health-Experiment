import React from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '@/design/tokens';
import { Text } from './Text';

interface ScreenHeaderProps {
  /** Small label above the title. Sentence case — this app has no all-caps eyebrows. */
  overline: string;
  title: string;
  /** Standing notice or one-line status. */
  notice?: string;
  /** Optional trailing control, e.g. a quiet way back. */
  action?: React.ReactNode;
}

/**
 * One header shape for every screen: a quiet label, the screen title, and at most
 * one supporting line. Nothing here competes with the content below it.
 */
export function ScreenHeader({ overline, title, notice, action }: ScreenHeaderProps) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text variant="caption" color="textMuted">
            {overline}
          </Text>
          <Text variant="title">{title}</Text>
        </View>
        {action}
      </View>
      {notice ? (
        <Text variant="caption" color="textMuted">
          {notice}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleBlock: { flexShrink: 1, gap: spacing.xs },
});
