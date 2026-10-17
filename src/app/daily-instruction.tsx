import React, { useEffect, useState } from 'react';
import { StyleSheet, ScrollView, Alert, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Screen, Card, NavRow, StatStrip, Text, Button, Details, SplitDisc, Banner, type DiscTone,
} from '@/components/ui';
import { spacing } from '@/design/tokens';
import { readTodayType } from '@/design/labels';
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
import {
  experimentForRuleType,
  exposureForExperimentId,
  exposureValue,
  cutoffRuleText,
} from '@/experiment/experiments';
import type { DailyEntry, ProgressSummary } from '@/experiment/types';
import { CheckInCard } from '@/components/CheckInCard';

import { CutoffCountdown } from '@/components/CutoffCountdown';
import { getProgressFigures } from '@/experiment/progress-figures';
import { getReportTrailer } from '@/experiment/milestones';
import { getMotivation } from '@/data/motivation';
import { getCutoffIntent, saveCutoffIntent, clearCutoffIntent } from '@/data/cutoff-intent';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [motivation, setMotivation] = useState<string | null>(null);
  // The time tapped on last night's countdown, if it belongs to the night being logged.
  const [intentTime, setIntentTime] = useState<string | null>(null);
  // The time already tapped for tonight, so the countdown reads back instead of asking again.
  const [tonightOffAt, setTonightOffAt] = useState<string | null>(null);

  const today = getToday();
  const yesterday = getMorningEntryDate(today);

  useEffect(() => {
    if (!user) return;
    let current = true;
    void (async () => {
      try {
        const [active, loadedEntries, loadedMotivation, loadedIntent, tonightIntent] = await Promise.all([
          getActivePlan(user.id),
          listEntries(user.id),
          getMotivation(user.id),
          getCutoffIntent(user.id, yesterday),
          getCutoffIntent(user.id, today),
        ]);
        if (!current) return;
        setPlanRecord(active);
        setEntries(loadedEntries);
        setMotivation(loadedMotivation);
        setIntentTime(loadedIntent?.time ?? null);
        setTonightOffAt(tonightIntent?.time ?? null);
      } catch (e) {
        if (current) setStatusMessage(e instanceof Error ? e.message : 'Could not load your test. Try again.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [user, today, yesterday]);

  if (loading) {
    return (
      <Screen>
        <Text color="textMuted">Loading…</Text>
      </Screen>
    );
  }

  if (!planRecord || planRecord.status === 'cancelled') {
    return (
      <Screen>
        <Card overline="Ended" title="Test stopped early">
          <Text color="textMuted">
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
  // Everything the screen says about today comes from the test this plan runs.
  const experiment = experimentForRuleType(rule.type);
  const exposure = exposureForExperimentId(experiment.id);
  const cutoffTime = (rule && 'cutoffTime' in rule && typeof (rule as any).cutoffTime === 'string')
    ? (rule as any).cutoffTime
    : experiment.defaultCutoff;

  // Progress summary. The entries MUST be narrowed to this plan's schedule first: the
  // user's log legitimately also holds their run-in days, and those fall outside the
  // experiment window, which progressSummary rejects rather than silently counting.
  const progress: ProgressSummary = progressSummary(plan, entriesForPlan(plan, entries), today);
  const dayIndex = plan.schedule.findIndex(s => s.date === today);
  const currentDayNum = dayIndex >= 0 ? dayIndex + 1 : isScheduled ? 0 : plan.chosenDuration;

  const yesterdayEntry = entries.find(e => e.date === yesterday);

  // Progress that counts what the user controls, plus the own-baseline reading of the
  // night just logged. Neither can become an interim result.
  const progressFigures = getProgressFigures(plan.schedule, entries, cutoffTime, exposure, today);
  const cutoffDaysPlanned = plan.schedule.filter(day => day.condition === 'intervention').length;
  const trailer = getReportTrailer(currentDayNum, plan.chosenDuration);
  const storedExposure = exposureValue(yesterdayEntry, exposure);
  const prefilledFromIntent = storedExposure === null && intentTime !== null;

  // One big line, and today's number. Nothing else competes for the first glance.
  const todayLine = isScheduled
    ? `Starts ${plan.startDate}`
    : isAfterLastExposure
    ? 'All done — log last night'
    : todayScheduled?.condition === 'intervention'
    ? `Today: cutoff day, ${cutoffRuleText(experiment, cutoffTime)}`
    : 'Today: normal day';

  const dayLine = isScheduled
    ? `Starts in ${plan.chosenDuration} days from that date`
    : `Day ${currentDayNum} of ${plan.chosenDuration}`;

  // Presentation only: the sentence is split into the hero line and its rule, and the
  // disc's fill follows today's type. The text beside the disc is what carries it.
  const todayType = readTodayType(todayLine);
  const discTone: DiscTone = todayType.kind ?? 'none';

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
      // Clear only the pre-fill that this save actually consumed. Tonight's fresh tap must
      // survive a morning check-in for last night.
      if (entry.date === yesterday && intentTime !== null) {
        void clearCutoffIntent(user.id);
        setIntentTime(null);
      }
      setStatusMessage(null);
      if (saved.synced !== false) {
        // Confirmed in the account: back to Home, where the day now shows as logged.
        router.replace('/');
      } else {
        setStatusMessage('Saved on this device. Syncing now...');
      }
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setSavingEntry(false);
    }
  };

  const handleLogOff = async (time: string) => {
    if (!user) return;
    const saved = await saveCutoffIntent(user.id, { date: today, time, exposure });
    if (saved) {
      setTonightOffAt(time);
      setStatusMessage(null);
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
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Where today sits in the test, and the way out of it. */}
        <View style={styles.topRow}>
          <Text variant="caption" color="textMuted" tabular>{dayLine}</Text>
          <Pressable
            onPress={() => setMenuOpen(prev => !prev)}
            style={styles.menuButton}
            accessibilityRole="button"
            accessibilityLabel="Menu"
            accessibilityState={{ expanded: menuOpen }}
            // React Native Web does not emit aria-expanded from accessibilityState.
            aria-expanded={menuOpen}
          >
            <Text variant="sub" color="accent" weight="semiBold">Menu</Text>
            <Text variant="sub" color="accent" weight="semiBold">{menuOpen ? '–' : '+'}</Text>
          </Pressable>
        </View>

        {menuOpen ? (
          <Card tone="tint">
            <Text variant="sub" weight="semiBold">End this test early</Text>
            <Text variant="caption" color="textMuted">
              Ending early keeps your entries but works nothing out.
            </Text>
            <Button
              label="End early"
              variant="quiet"
              loading={cancelling}
              onPress={() => void handleEndEarly()}
            />
          </Card>
        ) : null}

        {statusMessage ? (
          <Banner tone="error">{statusMessage}</Banner>
        ) : null}

        {/* The one thing that matters today: the mark, the type, and the rule. */}
        <Card tone="hero">
          <View style={styles.heroRow}>
            <SplitDisc size={96} tone={discTone} />
            <View style={styles.heroText}>
              <Text variant="title" accessibilityRole="header">{todayType.clause}</Text>
              {todayType.rule ? (
                <Text variant="body" color="textMuted">{todayType.rule}</Text>
              ) : null}
            </View>
          </View>
        </Card>

        {/* Evening ritual, only on a cutoff day and only near the cutoff time. */}
        {!isScheduled && !isAfterLastExposure && todayScheduled?.condition === 'intervention' ? (
          <CutoffCountdown
            cutoffTime={cutoffTime}
            exposure={exposure}
            loggedOffAt={tonightOffAt}
            onLogOff={(time) => void handleLogOff(time)}
          />
        ) : null}

        {/* The reason they wrote at setup, on the day it can help most. */}
        {motivation && !isAfterLastExposure && todayScheduled?.condition === 'intervention'
          && progressFigures.currentRun === 0 ? (
          <Card tone="quiet">
            <Text variant="sub" color="textMuted">You wrote: “{motivation}”</Text>
            <Text variant="caption" color="textMuted">Tonight’s cutoff is {cutoffTime}.</Text>
          </Card>
        ) : null}

        {prefilledFromIntent ? (
          <Text variant="caption" color="textMuted">
            We filled in {intentTime} from your tap last night. Change it if it is not right.
          </Text>
        ) : null}

        {/* The log itself. Its Save button is the one main action on this screen. */}
        <CheckInCard
          date={yesterday}
          label="Last night"
          initialSleepMinutes={yesterdayEntry?.sleepMinutes ?? null}
          initialCaffeineTime={storedExposure ?? (prefilledFromIntent ? intentTime : null)}
          exposure={exposure}
          onSave={handleSaveCheckIn}
          saving={savingEntry}
        />

        {/* On the morning after the last day, the effort is reflected back before the lock. */}
        {isAfterLastExposure ? (
          <Card tone="tint" overline="The last night">
            <Text variant="heading">That is the last night.</Text>
            <Text variant="body" color="textMuted">
              You logged {progress.daysLogged} of {plan.chosenDuration} nights and kept the rule on{' '}
              {progress.adherenceCounts.ADHERENT} of {cutoffDaysPlanned} cutoff days.
            </Text>
            <Text variant="caption" color="textMuted">
              Open what we found on Today to lock these days.
            </Text>
          </Card>
        ) : null}

        {/* Counts are available, not in the way. */}
        <Card tone="quiet">
          <Details summary="How the test is going">
            <StatStrip
              items={[
                { label: 'Days logged', value: String(progress.daysLogged), emphasis: 'strong' },
                {
                  label: 'Cutoff days kept',
                  value: `${progressFigures.cutoffDaysKept} of ${progressFigures.cutoffDaysPlanned}`,
                },
                { label: 'Days to go', value: String(progress.daysRemaining) },
              ]}
            />
            <StatStrip
              items={[
                { label: 'Kept the rule', value: String(progress.adherenceCounts.ADHERENT) },
                { label: 'Normal days', value: String(progress.adherenceCounts.CONTROL_CLEAN) },
                {
                  // CONTAMINATED is a normal day where the user skipped the cutoff themselves,
                  // so the label must not claim the opposite of that.
                  label: exposure === 'screens' ? 'Normal, screens off early' : 'Normal, no caffeine',
                  value: String(progress.adherenceCounts.CONTAMINATED),
                },
                { label: 'Not sure', value: String(progress.adherenceCounts.UNKNOWN), emphasis: 'muted' },
              ]}
            />
          </Details>
        </Card>

        {/* Second half of the test: name what the report will contain, with no numbers. */}
        {trailer && !isScheduled && !isAfterLastExposure ? (
          <Card tone="quiet">
            <Details summary={trailer.title}>
              <Text variant="sub" color="textMuted">{trailer.body}</Text>
            </Details>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.section, paddingBottom: spacing.section },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  menuButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 44,
    minWidth: 44,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  heroText: { flex: 1, gap: spacing.sm },
});
