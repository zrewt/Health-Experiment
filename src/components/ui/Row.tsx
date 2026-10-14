import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '@/design/tokens';
import { Text, type TextColor } from './Text';

export type RowEmphasis = 'default' | 'strong' | 'gold' | 'muted' | 'danger';

const EMPHASIS_COLOR: Record<RowEmphasis, TextColor> = {
  default: 'ivory',
  strong: 'champagneLight',
  gold: 'champagne',
  muted: 'ivoryMuted',
  danger: 'garnet',
};

interface RowProps {
  label: string;
  value: string;
  emphasis?: RowEmphasis;
}

/** A single label / value line: muted label on the left, value on the right. */
export function Row({ label, value, emphasis = 'default' }: RowProps) {
  return (
    <View style={styles.row}>
      <Text variant="sub" color="ivoryMuted" style={styles.rowLabel}>
        {label}
      </Text>
      <Text variant="sub" color={EMPHASIS_COLOR[emphasis]} weight="semiBold" tabular>
        {value}
      </Text>
    </View>
  );
}

export interface StatItem {
  label: string;
  value: string;
  emphasis?: RowEmphasis;
}

/**
 * A measured strip of figures. Values sit above their labels so a set of counts
 * reads as one unit instead of a wall of label/value lines.
 */
export function StatStrip({ items, size = 'md' }: { items: readonly StatItem[]; size?: 'md' | 'lg' }) {
  return (
    <View style={styles.strip}>
      {items.map((item) => (
        <View key={item.label} style={styles.stat}>
          <Text
            variant={size === 'lg' ? 'titleSmall' : 'body'}
            color={EMPHASIS_COLOR[item.emphasis ?? 'default']}
            weight="semiBold"
            tabular
          >
            {item.value}
          </Text>
          <Text variant="caption" color="ivoryMuted">
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 28,
  },
  rowLabel: { flexShrink: 1 },
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.lg,
    rowGap: spacing.md,
  },
  stat: {
    flexGrow: 1,
    flexBasis: 64,
    gap: 4,
  },
  divider: {
    height: 1,
    backgroundColor: colors.hairline,
  },
});
