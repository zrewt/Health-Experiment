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
 * Progressive disclosure: detail that is available but not competing for attention.
 *
 * The open/closed state is carried by the +/− glyph and by aria-expanded, never by
 * colour alone, and the header keeps a 52 pt touch target.
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
          <Text variant="sub" color="text" weight="semiBold">
            {label}
          </Text>
          {summary && !open ? (
            <Text variant="caption" color="textMuted">
              {summary}
            </Text>
          ) : null}
        </View>
        <Text variant="sub" color="accent" weight="semiBold">
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
  headerText: { flex: 1, gap: spacing.xs },
  body: {
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
});
