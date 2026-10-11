import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '@/design/tokens';

interface ScreenProps {
  children: ReactNode;
  style?: ViewStyle;
  padded?: boolean;
  safeBottom?: boolean;
}

export function Screen({ children, style, padded = true, safeBottom = true }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, {
      paddingTop: Math.max(insets.top, Platform.OS === 'web' ? 40 : 16),
      paddingBottom: safeBottom ? Math.max(insets.bottom, Platform.OS === 'web' ? 24 : 12) : 0,
    }, style]}>
      <View style={[styles.inner, padded && styles.padded]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  inner: { flex: 1 },
  padded: { paddingHorizontal: spacing.screen },
});
