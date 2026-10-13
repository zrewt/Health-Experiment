import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { useRouter, Redirect } from 'expo-router';
import { Screen, Text, Button } from '@/components/ui';
import { colors, spacing, radii } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import { getToday, __setDevClockOffset, __getDevClockOffset } from '@/experiment/clock';
import { loadSampleRunIn, loadSampleExperimentEntries, deleteSampleEntries } from '@/dev/sample-loader';
import { getActivePlan, resetCompletedPlan } from '@/data/experiment-store';
import { addDaysToLocalDate, daysBetween, formatLocalDate } from '@/experiment/dates';

export default function DevToolsScreen() {
  const router = useRouter();
  const user = useAuthStore(state => state.user);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [offset, setOffset] = useState<number>(__getDevClockOffset());

  // Fail closed: this screen renders only when __DEV__ is strictly true.
  if (typeof __DEV__ === 'undefined' || __DEV__ !== true) {
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

  const handleLoadSampleExperiment = async () => {
    if (!user) return;
    const planRec = await getActivePlan(user.id);
    if (!planRec) {
      setStatus('No active plan found. Start an experiment first.');
      return;
    }

    const email = user.email || 'Current user';
    const message = `This will write sample experiment entries for ${email} across the full plan schedule. Proceed?`;
    const proceed = Platform.OS === 'web'
      ? window.confirm(message)
      : await new Promise<boolean>((resolve) => {
          Alert.alert('Load Experiment Data', message, [
            { text: 'Cancel', onPress: () => resolve(false), style: 'cancel' },
            { text: 'Confirm', onPress: () => resolve(true) },
          ]);
        });
    if (!proceed) return;

    setLoading(true);
    try {
      const count = await loadSampleExperimentEntries(user.id, planRec.plan);
      setStatus(`Loaded ${count} sample experiment entries for the active plan.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Error loading sample experiment entries.');
    } finally {
      setLoading(false);
    }
  };

  const handleJumpToEPlusOne = async () => {
    if (!user) return;
    const planRec = await getActivePlan(user.id);
    if (!planRec) {
      setStatus('No active plan found.');
      return;
    }
    const lastExposureDate = planRec.plan.schedule[planRec.plan.schedule.length - 1]?.date;
    if (!lastExposureDate) return;
    const target = addDaysToLocalDate(lastExposureDate, 1);
    // Local, not UTC: getToday() (which this offset is applied to) is a local calendar
    // date, so a UTC basis lands the jump a day out for part of every day.
    const now = new Date();
    const realToday = formatLocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const diff = daysBetween(realToday, target);
    __setDevClockOffset(diff);
    setOffset(diff);
    setStatus(`Clock jumped to E+1 (${target}). Offset: ${diff} days.`);
  };

  const handleResetCompleted = async () => {
    if (!user) return;
    const planRec = await getActivePlan(user.id);
    if (!planRec) {
      setStatus('No plan found to reset.');
      return;
    }
    setLoading(true);
    try {
      await resetCompletedPlan(user.id, planRec.id);
      setStatus('Reset completed plan back to scheduled.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Error resetting plan.');
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
            label="Load sample experiment entries"
            variant="secondary"
            loading={loading}
            onPress={() => void handleLoadSampleExperiment()}
          />
          <Button
            label="Jump to last exposure date + 1"
            variant="secondary"
            onPress={() => void handleJumpToEPlusOne()}
          />
          <Button
            label="Reset completed plan (dev)"
            variant="secondary"
            loading={loading}
            onPress={() => void handleResetCompleted()}
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
