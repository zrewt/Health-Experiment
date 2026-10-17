import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Card, NavRow, Text } from '@/components/ui';
import { spacing } from '@/design/tokens';
import type { MorningMirror } from '@/experiment/morning-mirror';

/**
 * The morning receipt: the night just logged, read against the user's own usual.
 *
 * It is deliberately not a result, and says so. The headline is the one number the card
 * leads with; the two facts underneath are timing and a behavior streak.
 */
export function MorningMirrorCard({ model, onEdit }: { model: MorningMirror; onEdit?: () => void }) {
  return (
    <Card tone="tint" overline="Your night">
      <Text variant="heading" accessibilityRole="header">
        {model.headline}
      </Text>
      <View style={styles.facts}>
        {model.facts.map(fact => (
          <Text key={fact} variant="body" color="textMuted">
            {fact}
          </Text>
        ))}
      </View>
      <Text variant="caption" color="textMuted">
        Your own numbers, not your result.
      </Text>
      {onEdit ? <NavRow label="Edit this check-in" onPress={onEdit} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  facts: { gap: spacing.xs },
});
