import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { colors, radii, spacing } from '@/design/tokens';
import { Text } from './Text';

export type PrimaryTab = 'today' | 'journal' | 'experiment' | 'settings';

const TABS: readonly { key: PrimaryTab; label: string; route: Href }[] = [
  { key: 'today', label: 'Today', route: '/' },
  { key: 'journal', label: 'Journal', route: '/journal' as Href },
  { key: 'experiment', label: 'Protocol', route: '/experiment' as Href },
  { key: 'settings', label: 'Settings', route: '/settings' as Href },
];

export function PrimaryNav({ current }: { current: PrimaryTab }) {
  const router = useRouter();

  return (
    <View style={styles.wrapper} accessibilityRole="tablist">
      <View style={styles.bar}>
        {TABS.map((tab) => {
          const active = tab.key === current;
          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                if (!active) {
                  router.replace(tab.route);
                }
              }}
              style={[styles.item, active && styles.itemActive]}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}
            >
              <Text
                variant="sub"
                color={active ? 'champagneLight' : 'ivoryMuted'}
                weight={active ? 'semiBold' : 'regular'}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingTop: spacing.md,
    backgroundColor: colors.ground,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineBright,
    padding: 6,
  },
  item: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  itemActive: {
    backgroundColor: colors.surfaceHigh,
  },
});
