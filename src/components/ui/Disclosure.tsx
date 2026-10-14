import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { spacing } from '@/design/tokens';
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
        // React Native Web does not emit aria-expanded from accessibilityState, so it is
        // set explicitly: the open/closed state must reach assistive tech, not just the
        // +/− glyph.
        aria-expanded={open}
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
  wrapper: { gap: spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 52,
  },
  headerText: { flex: 1, gap: 4 },
  body: {
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
});
