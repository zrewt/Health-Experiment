import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, NavRow, Text } from '@/components/ui';
import { spacing } from '@/design/tokens';
import type { CheckInReceipt } from '@/experiment/wait-value';

/**
 * The receipt for the night just logged: the duration as entered, the time entered, two
 * plain counts, and the fixed line that keeps it from reading as a result.
 *
 * Nothing here is derived from test-day sleep beyond that night's own duration.
 */
export function CheckInReceiptCard({
  model,
  onEdit,
}: {
  model: CheckInReceipt;
  onEdit?: () => void;
}) {
  return (
    <Card tone="tint" overline="Your night">
      <Text variant="heading" accessibilityRole="header">{model.sleepText}</Text>
      <View style={styles.lines}>
        <Text variant="body" color="textMuted">{model.timingText}</Text>
        <Text variant="sub" color="textMuted">{model.countsText}</Text>
      </View>
      <Text variant="caption" color="textMuted">{model.footer}</Text>
      {onEdit ? <NavRow label="Edit this check-in" onPress={onEdit} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  lines: { gap: spacing.xs },
});
