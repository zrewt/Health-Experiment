import React from 'react';
import { StyleSheet } from 'react-native';
import { Card, Text } from '@/components/ui';
import { spacing } from '@/design/tokens';

/**
 * One unlocked sentence about the user's own sleep or effort. Used for milestones before a
 * test ends, and for "what we learned anyway" after it.
 *
 * It carries no result and no comparison between day types; the caller supplies both lines.
 */
export function InsightCard({
  overline = 'Your numbers',
  title,
  body,
}: {
  overline?: string;
  title: string;
  body: string;
}) {
  return (
    <Card tone="quiet" overline={overline}>
      <Text variant="heading" style={styles.title}>{title}</Text>
      <Text variant="sub" color="textMuted">{body}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: spacing.xs },
});
