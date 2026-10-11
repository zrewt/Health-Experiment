import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Text, Button } from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import { authErrorMessage } from '@/lib/auth';

export default function HomeScreen() {
  const router = useRouter();
  const signOut = useAuthStore((state) => state.signOut);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignOut = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await signOut();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="titleSmall">Home</Text>
        <Button label="Sign out" variant="quiet" loading={loading} onPress={() => void handleSignOut()} />
      </View>
      {error ? <Text color="garnet" accessibilityRole="alert">{error}</Text> : null}

      <View style={styles.actionCard}>
        <Text variant="titleSmall" style={styles.cardTitle}>Self-Experiment</Text>
        <Text variant="body" color="ivorySecondary" style={styles.cardBody}>
          Track your sleep and evaluate whether caffeine cutoff improves sleep duration.
        </Text>
        <View style={styles.buttonRow}>
          <Button
            label="Run-in check-in"
            variant="primary"
            onPress={() => router.push('/run-in')}
          />
          <View style={styles.buttonSpacer} />
          <Button
            label="Setup & consent"
            variant="secondary"
            onPress={() => router.push('/setup-consent')}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actionCard: {
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radii.card,
  },
  cardTitle: {
    marginBottom: spacing.xs,
  },
  cardBody: {
    marginBottom: spacing.md,
  },
  buttonRow: {
    gap: spacing.sm,
  },
  buttonSpacer: {
    height: spacing.xs,
  },
});
