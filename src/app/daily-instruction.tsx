import React, { useEffect, useState } from 'react';
import { StyleSheet, ScrollView, Alert, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Screen, ScreenHeader, Card, NavRow, StatStrip, Text, Button, Details, Disclosure,
} from '@/components/ui';
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
        if (current) setStatusMessage(e instanceof Error ? e.message : 'Could not load your test. Try again.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [user, today]);

  if (loading) {
    return (
      <Screen>
        <Text color="ivorySecondary">Loading…</Text>
      </Screen>
    );
  }

  if (!planRecord || planRecord.status === 'cancelled') {
    return (
      <Screen>
        <Card overline="ENDED" title="Test stopped early">
          <Text color="ivorySecondary">
            Your entries are safe. Nothing was worked out, and you can start again any time.
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

  // One big line, and today's number. Nothing else competes for the first glance.
  const todayLine = isScheduled
    ? `Starts ${plan.startDate}`
    : isAfterLastExposure
    ? 'All done — log last night'
    : todayScheduled?.condition === 'intervention'
    ? `Today: cutoff day, no caffeine after ${cutoffTime}`
    : 'Today: normal day';

  const dayLine = isScheduled
    ? `Starts in ${plan.chosenDuration} days from that date`
    : `Day ${currentDayNum} of ${plan.chosenDuration}`;

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
      setStatusMessage('Saved.');
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setSavingEntry(false);
    }
  };

  const handleEndEarly = async () => {
    if (!user || !planRecord) return;
    const message = 'This ends the test and works nothing out. You cannot resume it. Your entries stay.';
    const confirm = Platform.OS === 'web'
      ? window.confirm(message)
      : await new Promise<boolean>(resolve => {
          Alert.alert('End this test early?', message, [
            { text: 'Keep going', onPress: () => resolve(false), style: 'cancel' },
            { text: 'End it', onPress: () => resolve(true), style: 'destructive' },
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
      setStatusMessage(e instanceof Error ? e.message : 'Could not end the test. Try again.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          overline="TODAY’S NOTE"
          title="Today"
          notice="This app is not medical advice."
          action={<Button label="Home" variant="quiet" onPress={() => router.replace('/')} />}
        />

        {statusMessage ? (
          <Text variant="sub" color="champagneLight" accessibilityLiveRegion="polite">{statusMessage}</Text>
        ) : null}

        {/* The one line that matters today, and nothing else. */}
        <Card tone="hero">
          <Text variant="titleMedium" color="champagneLight" serif>
            {todayLine}
          </Text>
          <Text variant="caption" color="ivoryMuted" tabular>{dayLine}</Text>
        </Card>

        {/* The log itself. Its Save button is the one main action on this screen. */}
        <CheckInCard
          date={yesterday}
          label="LAST NIGHT"
          initialSleepMinutes={yesterdayEntry?.sleepMinutes ?? null}
          initialCaffeineTime={yesterdayEntry?.lastCaffeineTime ?? null}
          onSave={handleSaveCheckIn}
          saving={savingEntry}
        />

        {/* Counts are available, not in the way. */}
        <Details summary="How the test is going">
          <StatStrip
            items={[
              { label: 'Days logged', value: String(progress.daysLogged), emphasis: 'strong' },
              { label: 'Days to go', value: String(progress.daysRemaining) },
            ]}
          />
          <StatStrip
            items={[
              { label: 'Kept the rule', value: String(progress.adherenceCounts.ADHERENT) },
              { label: 'Normal days', value: String(progress.adherenceCounts.CONTROL_CLEAN) },
              { label: 'Normal, no caffeine', value: String(progress.adherenceCounts.CONTAMINATED) },
              { label: 'Not sure', value: String(progress.adherenceCounts.UNKNOWN), emphasis: 'muted' },
            ]}
          />
        </Details>

        {/* Ending early is irreversible, so it lives in the menu. */}
        <Disclosure label="Menu" summary="End this test early">
          <View style={styles.menuBody}>
            <Text variant="caption" color="ivoryMuted">
              Ending early keeps your entries but works nothing out.
            </Text>
            <Button
              label="End early"
              variant="quiet"
              loading={cancelling}
              onPress={() => void handleEndEarly()}
            />
          </View>
        </Disclosure>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.section, paddingBottom: spacing.section },
  menuBody: { gap: spacing.sm, paddingTop: spacing.sm },
});
