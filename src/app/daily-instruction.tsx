import React, { useEffect, useState } from 'react';
import { StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, ScreenHeader, Card, NavRow, StatStrip, Text, Button } from '@/components/ui';
import { spacing } from '@/design/tokens';
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
import { progressSummary, entriesForPlan } from '@/experiment/adapter';
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
        <Card overline="ENDED" title="Experiment ended early">
          <Text color="ivorySecondary">
            This experiment was ended without a result. Your logged entries have been kept. New experiments will arrive in future updates.
          </Text>
          <NavRow label="Back to Today" onPress={() => router.replace('/')} />
        </Card>
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

  // Progress summary. The entries MUST be narrowed to this plan's schedule first: the
  // user's log legitimately also holds their run-in days, and those fall outside the
  // experiment window, which progressSummary rejects rather than silently counting.
  const progress: ProgressSummary = progressSummary(plan, entriesForPlan(plan, entries), today);
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
        <ScreenHeader
          overline="TODAY'S PLAN"
          title="Daily Instruction"
          notice="This app is not medical advice."
          action={<Button label="Today" variant="quiet" onPress={() => router.replace('/')} />}
        />

        {statusMessage ? (
          <Card>
            <Text color="champagneLight" accessibilityLiveRegion="polite">{statusMessage}</Text>
          </Card>
        ) : null}

        {/* Top card: Today's rule or schedule status */}
        {isScheduled ? (
          <Card overline="UPCOMING">
            <Text variant="titleSmall">
              Your experiment starts on {plan.startDate}. Until then, keep your usual routine and keep logging.
            </Text>
          </Card>
        ) : isAfterLastExposure ? (
          <Card overline="FINAL DAY">
            <Text variant="titleSmall">
              Last check-in: log last night to include your final day.
            </Text>
          </Card>
        ) : todayScheduled ? (
          <Card tone="hero" overline="TODAY'S INSTRUCTION">
            <Text variant="titleMedium" color="champagneLight" serif>
              {todayScheduled.condition === 'intervention'
                ? `Today: no caffeine after ${cutoffTime}.`
                : 'Today: your usual routine.'}
            </Text>
          </Card>
        ) : null}

        {/* Progress Counts */}
        <Card overline="PROGRESS">
          <Text variant="titleSmall" color="champagneLight" tabular>
            Day {currentDayNum} of {plan.chosenDuration}
          </Text>
          <StatStrip
            items={[
              { label: 'Days logged', value: String(progress.daysLogged), emphasis: 'strong' },
              { label: 'Days remaining', value: String(progress.daysRemaining) },
            ]}
          />
          <StatStrip
            items={[
              { label: 'Adherent', value: String(progress.adherenceCounts.ADHERENT), emphasis: 'strong' },
              { label: 'Usual routine', value: String(progress.adherenceCounts.CONTROL_CLEAN) },
              { label: 'Contaminated', value: String(progress.adherenceCounts.CONTAMINATED) },
              { label: 'Unknown', value: String(progress.adherenceCounts.UNKNOWN), emphasis: 'muted' },
            ]}
          />
        </Card>

        {/* Yesterday's check-in */}
        <CheckInCard
          date={yesterday}
          label="LAST NIGHT"
          initialSleepMinutes={yesterdayEntry?.sleepMinutes ?? null}
          initialCaffeineTime={yesterdayEntry?.lastCaffeineTime ?? null}
          onSave={handleSaveCheckIn}
          saving={savingEntry}
        />

        {/* Ending early is irreversible, so it sits last and quietly. */}
        <Card tone="quiet">
          <Text variant="caption" color="ivoryMuted">
            Ending early keeps every logged entry but produces no result.
          </Text>
          <Button
            label="End experiment early"
            variant="quiet"
            loading={cancelling}
            onPress={() => void handleEndEarly()}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.lg },
});
