import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { useRouter, Redirect } from 'expo-router';
import { Screen, Text, Button } from '@/components/ui';
import { colors, spacing, radii } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import { getToday, __setDevClockOffset, __getDevClockOffset } from '@/experiment/clock';
import { loadSampleRunIn, deleteSampleEntries } from '@/dev/sample-loader';

export default function DevToolsScreen() {
  const router = useRouter();
  const user = useAuthStore(state => state.user);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [offset, setOffset] = useState<number>(__getDevClockOffset());

  if (typeof __DEV__ !== 'undefined' && !__DEV__) {
    return <Redirect href="/" />;
  }

  const handleShift = (delta: number) => {
    const next = delta === 0 ? 0 : offset + delta;
    __setDevClockOffset(next);
    setOffset(next);
    setStatus(`Clock shifted. Offset: ${next} days (Today: ${getToday()})`);
  };

  const handleLoadSample = async () => {
    if (!user) {
      setStatus('Must be signed in to load sample data.');
      return;
    }

    const email = user.email || 'Current user';
    const message = `This will write 14 valid fake entries for ${email}. Proceed?`;

    const proceed = Platform.OS === 'web'
      ? window.confirm(message)
      : await new Promise<boolean>((resolve) => {
          Alert.alert('Load Fake Data', message, [
            { text: 'Cancel', onPress: () => resolve(false), style: 'cancel' },
            { text: 'Confirm', onPress: () => resolve(true) },
          ]);
        });

    if (!proceed) return;

    setLoading(true);
    try {
      const count = await loadSampleRunIn(user.id);
      setStatus(`Successfully loaded ${count} sample entries ending yesterday.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Error loading sample run-in.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSample = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const count = await deleteSampleEntries(user.id);
      setStatus(`Deleted ${count} entries.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Error deleting sample entries.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="titleLarge">Dev Tools</Text>
        <Text color="champagne">Internal testing only. Excluded from production.</Text>

        <View style={styles.card}>
          <Text variant="titleSmall">Simulated Clock</Text>
          <Text color="ivorySecondary">Effective Today: {getToday()}</Text>
          <Text color="ivoryMuted">Offset: {offset} days</Text>

          <View style={styles.row}>
            <Button label="+1 Day" variant="secondary" onPress={() => handleShift(1)} />
            <Button label="+7 Days" variant="secondary" onPress={() => handleShift(7)} />
            <Button label="Reset (0)" variant="quiet" onPress={() => handleShift(0)} />
          </View>
        </View>

        <View style={styles.card}>
          <Text variant="titleSmall">Sample Data</Text>
          <Text color="ivorySecondary">User: {user?.email || 'None'}</Text>
          <Button
            label="Load sample run-in (14 days)"
            variant="primary"
            loading={loading}
            onPress={() => void handleLoadSample()}
          />
          <Button
            label="Delete sample entries"
            variant="quiet"
            loading={loading}
            onPress={() => void handleDeleteSample()}
          />
        </View>

        {status ? (
          <View style={styles.card}>
            <Text color="champagneLight">{status}</Text>
          </View>
        ) : null}

        <Button label="Back to Home" variant="secondary" onPress={() => router.replace('/')} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.hairlineBright,
  },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
