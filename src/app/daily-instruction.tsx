import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Text, Button } from '@/components/ui';
import { colors, spacing, radii } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import {
  getActivePlan,
  listEntries,
  saveEntry,
  cancelPlan,
  StoredDailyEntry,
} from '@/data/experiment-store';
import type { StoredExperimentPlan } from '@/data/plan-persistence';
import { getToday } from '@/experiment/clock';
import { getMorningEntryDate } from '@/experiment/dates';
import { progressSummary } from '@/experiment/adapter';
import type { DailyEntry, ProgressSummary } from '@/experiment/types';
import { CheckInCard } from '@/components/CheckInCard';
import { clearDailyReminder } from '@/notifications/reminders';

export default function DailyInstructionScreen() {
  const router = useRouter();
  const user = useAuthStore(state => state.user);
  const [planRecord, setPlanRecord] = useState<StoredExperimentPlan | null>(null);
  const [entries, setEntries] = useState<StoredDailyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingEntry, setSavingEntry] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const today = getToday();
  const yesterday = getMorningEntryDate(today);

  useEffect(() => {
    if (!user) return;
    let current = true;
    void (async () => {
      try {
        const [active, loadedEntries] = await Promise.all([
          getActivePlan(user.id),
          listEntries(user.id),
        ]);
        if (!current) return;
        setPlanRecord(active);
        setEntries(loadedEntries);
      } catch (e) {
        if (current) setStatusMessage(e instanceof Error ? e.message : 'Error loading plan.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [user, today]);

  if (loading) {
    return (
      <Screen>
        <Text color="ivorySecondary">Loading daily instructions...</Text>
      </Screen>
    );
  }

  if (!planRecord || planRecord.status === 'cancelled') {
    return (
      <Screen>
        <View style={styles.card}>
          <Text variant="titleSmall">Experiment Ended Early</Text>
          <Text color="ivorySecondary">
            This experiment was ended without a result. Your logged entries have been kept. New experiments will arrive in future updates.
          </Text>
          <Button label="Back to Home" variant="secondary" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  const { plan } = planRecord;
  const isScheduled = today < plan.startDate;
  const lastExposureDate = plan.schedule[plan.schedule.length - 1]?.date ?? plan.startDate;
  const isAfterLastExposure = today > lastExposureDate;

  // Find today's assignment if in schedule
  const todayScheduled = plan.schedule.find(s => s.date === today);
  const rule = plan.definition.conditionRule;
  const cutoffTime = (rule && 'cutoffTime' in rule && typeof (rule as any).cutoffTime === 'string')
    ? (rule as any).cutoffTime
    : '12:00';

  // Progress summary
  const progress: ProgressSummary = progressSummary(plan, entries, today);
  const dayIndex = plan.schedule.findIndex(s => s.date === today);
  const currentDayNum = dayIndex >= 0 ? dayIndex + 1 : isScheduled ? 0 : plan.chosenDuration;

  const yesterdayEntry = entries.find(e => e.date === yesterday);

  const handleSaveCheckIn = async (entry: DailyEntry) => {
    if (!user) return;
    setSavingEntry(true);
    try {
      const saved = await saveEntry(user.id, entry);
      setEntries(prev => {
        const next = prev.filter(e => e.date !== entry.date);
        next.push(saved);
        return next.sort((a, b) => a.date.localeCompare(b.date));
      });
      setStatusMessage('Check-in saved.');
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : 'Error saving check-in.');
    } finally {
      setSavingEntry(false);
    }
  };

  const handleEndEarly = async () => {
    if (!user || !planRecord) return;
    const message = 'This ends the experiment without a result. You cannot resume it. Your logged entries stay.';
    const confirm = Platform.OS === 'web'
      ? window.confirm(message)
      : await new Promise<boolean>(resolve => {
          Alert.alert('End Experiment Early?', message, [
            { text: 'Keep Going', onPress: () => resolve(false), style: 'cancel' },
            { text: 'End Experiment', onPress: () => resolve(true), style: 'destructive' },
          ]);
        });

    if (!confirm) return;

    setCancelling(true);
    try {
      await cancelPlan(user.id, planRecord.id);
      // Terminal state: no more daily check-ins, so clear the reminder now instead of
      // waiting for the next home-screen visit to notice.
      await clearDailyReminder();
      router.replace('/');
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : 'Could not end experiment early.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="titleLarge">Daily Instruction</Text>
        <Text color="champagne">This app is not medical advice.</Text>

        {statusMessage ? (
          <View style={styles.card}>
            <Text color="champagneLight">{statusMessage}</Text>
          </View>
        ) : null}

        {/* Top card: Today's rule or schedule status */}
        {isScheduled ? (
          <View style={styles.card}>
            <Text variant="overline" color="champagneMuted">UPCOMING</Text>
            <Text variant="titleSmall">
              Your experiment starts on {plan.startDate}. Until then, keep your usual routine and keep logging.
            </Text>
          </View>
        ) : isAfterLastExposure ? (
          <View style={styles.card}>
            <Text variant="overline" color="champagneMuted">FINAL DAY</Text>
            <Text variant="titleSmall">
              Last check-in: log last night to include your final day.
            </Text>
          </View>
        ) : todayScheduled ? (
          <View style={styles.card}>
            <Text variant="overline" color="champagneMuted">TODAY'S INSTRUCTION</Text>
            <Text variant="titleMedium" color="champagneLight">
              {todayScheduled.condition === 'intervention'
                ? `Today: no caffeine after ${cutoffTime}.`
                : 'Today: your usual routine.'}
            </Text>
          </View>
        ) : null}

        {/* Progress Counts */}
        <View style={styles.card}>
          <Text variant="overline" color="champagneMuted">PROGRESS</Text>
          <Text variant="titleSmall">
            Day {currentDayNum} of {plan.chosenDuration}
          </Text>
          <View style={styles.row}>
            <Text color="ivorySecondary">Days logged: </Text>
            <Text color="ivory" weight="semiBold">{progress.daysLogged}</Text>
          </View>
          <View style={styles.row}>
            <Text color="ivorySecondary">Days remaining: </Text>
            <Text color="ivory" weight="semiBold">{progress.daysRemaining}</Text>
          </View>
          <View style={styles.adherenceGrid}>
            <Text variant="caption" color="ivoryMuted">
              Adherent: {progress.adherenceCounts.ADHERENT} | Usual routine: {progress.adherenceCounts.CONTROL_CLEAN} | Contaminated: {progress.adherenceCounts.CONTAMINATED} | Unknown: {progress.adherenceCounts.UNKNOWN}
            </Text>
          </View>
        </View>

        {/* Yesterday's check-in */}
        <CheckInCard
          date={yesterday}
          label="LAST NIGHT"
          initialSleepMinutes={yesterdayEntry?.sleepMinutes ?? null}
          initialCaffeineTime={yesterdayEntry?.lastCaffeineTime ?? null}
          onSave={handleSaveCheckIn}
          saving={savingEntry}
        />

        {/* Secondary: End experiment early */}
        <View style={styles.endEarlyContainer}>
          <Button
            label="End experiment early"
            variant="quiet"
            loading={cancelling}
            onPress={() => void handleEndEarly()}
          />
        </View>
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
  row: { flexDirection: 'row', alignItems: 'center' },
  adherenceGrid: { marginTop: spacing.xs },
  endEarlyContainer: { marginTop: spacing.lg, alignItems: 'center' },
});
