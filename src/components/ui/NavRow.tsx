import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { spacing } from '@/design/tokens';
import { Text, type TextColor } from './Text';

interface NavRowProps {
  label: string;
  /** Optional second line explaining where the row leads. */
  detail?: string;
  /** Optional short value shown before the chevron. */
  value?: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

/**
 * A quiet way to move somewhere. Reads as part of the page rather than competing
 * with the one action that matters.
 */
export function NavRow({ label, detail, value, onPress, tone = 'default', disabled = false }: NavRowProps) {
  const accent: TextColor = tone === 'danger' ? 'signalText' : 'accent';
  const labelColor: TextColor = tone === 'danger' ? 'signalText' : 'text';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      accessibilityState={{ disabled }}
    >
      <View style={styles.info}>
        <Text variant="body" color={disabled ? 'textMuted' : labelColor}>
          {label}
        </Text>
        {detail ? (
          <Text variant="caption" color="textMuted">
            {detail}
          </Text>
        ) : null}
      </View>
      <View style={styles.trailing}>
        {value ? (
          <Text variant="sub" color={accent} tabular>
            {value}
          </Text>
        ) : null}
        {/* A list-row disclosure indicator, not a button arrow: it says "this leads
            somewhere", which is what makes the row discoverable. */}
        <Text variant="sub" color="textMuted">
          ›
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.sm,
  },
  info: { flex: 1, gap: spacing.xs },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
