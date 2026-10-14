import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, spacing } from '@/design/tokens';
import { Text } from './Text';

interface DisclosureProps {
  label: string;
  /** One line shown under the label while collapsed. */
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * Progressive disclosure: detail that is available but not competing for
 * attention. Used for guides, privacy notes and FAQ blocks so a screen shows
 * its headline content first and keeps the explanation one tap away.
 */
export function Disclosure({ label, summary, defaultOpen = false, children }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={styles.wrapper}>
      <Pressable
        onPress={() => setOpen((prev) => !prev)}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.headerText}>
          <Text variant="sub" color="champagneLight" weight="semiBold">
            {label}
          </Text>
          {summary && !open ? (
            <Text variant="caption" color="ivoryMuted">
              {summary}
            </Text>
          ) : null}
        </View>
        <Text variant="sub" color="champagne">
          {open ? '–' : '+'}
        </Text>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 44,
  },
  headerText: { flex: 1, gap: 2 },
  body: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
});
