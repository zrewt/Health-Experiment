import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '@/design/tokens';

interface ScreenProps {
  children: ReactNode;
  style?: ViewStyle;
  /** Set false for screens that manage their own horizontal padding. */
  padded?: boolean;
  safeBottom?: boolean;
}

/**
 * The one screen container: Mist background, a 24 pt gutter, safe-area aware.
 * Content is capped and centred on wide viewports so the phone layout keeps its
 * reading measure on tablets and in the browser.
 */
export function Screen({ children, style, padded = true, safeBottom = true }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: Math.max(insets.top, Platform.OS === 'web' ? 24 : 12),
          paddingBottom: safeBottom ? Math.max(insets.bottom, Platform.OS === 'web' ? 16 : 8) : 0,
        },
        style,
      ]}
    >
      <View style={[styles.inner, padded && styles.padded]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  inner: { flex: 1, width: '100%', maxWidth: 620, alignSelf: 'center' },
  padded: { paddingHorizontal: spacing.screen },
});
