import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Text, Button } from '@/components/ui';
import { colors, spacing, radii } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import {
  getActivePlan,
  listEntries,
  saveEntry,
  completePlan,
  StoredDailyEntry,
} from '@/data/experiment-store';
import type { StoredExperimentPlan } from '@/data/plan-persistence';
import { getToday } from '@/experiment/clock';
import { progressSummary, evaluate, entriesForPlan } from '@/experiment/adapter';
import type { DailyEntry, ProgressSummary, ResultSnapshot } from '@/experiment/types';
import { CheckInCard } from '@/components/CheckInCard';
import { clearDailyReminder } from '@/notifications/reminders';

const VERDICT_HEADINGS: Record<string, string> = {
  SUPPORTED: 'Supported',
  NO_DETECTABLE_EFFECT: 'No detectable effect',
  INCONCLUSIVE: 'Inconclusive',
};

export default function ResultScreen() {
  const router = useRouter();
  const user = useAuthStore(state => state.user);
  const [planRecord, setPlanRecord] = useState<StoredExperimentPlan | null>(null);
  const [entries, setEntries] = useState<StoredDailyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingEntry, setSavingEntry] = useState(false);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHowToRead, setShowHowToRead] = useState(false);

  const today = getToday();

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
        if (current) setError(e instanceof Error ? e.message : 'Error loading plan.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [user, today]);

  if (loading) {
    return (
      <Screen>
        <Text color="ivorySecondary">Loading...</Text>
      </Screen>
    );
  }

  if (!planRecord) {
    return (
      <Screen>
        <View style={styles.card}>
          <Text variant="titleSmall">No Active Experiment</Text>
          <Button label="Back to Home" variant="secondary" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  const { plan } = planRecord;
  const lastExposureDate = plan.schedule[plan.schedule.length - 1]?.date ?? plan.startDate;
  const lastEntry = entries.find(e => e.date === lastExposureDate);
  const isFinalMissing = !lastEntry || lastEntry.sleepMinutes === null;

  const progress: ProgressSummary = progressSummary(plan, entries, today);

  const handleSaveFinalCheckIn = async (entry: DailyEntry) => {
    if (!user) return;
    setSavingEntry(true);
    try {
      const saved = await saveEntry(user.id, entry);
      setEntries(prev => {
        const next = prev.filter(e => e.date !== entry.date);
        next.push(saved);
        return next.sort((a, b) => a.date.localeCompare(b.date));
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error saving final check-in.');
    } finally {
      setSavingEntry(false);
    }
  };

  const handleComputeResult = async () => {
    if (!user || computing) return;

    // Hard invariant: the result can never be computed before E+1
    if (today <= lastExposureDate) {
      setError('The experiment result cannot be computed before the day after your last experiment day (E+1).');
      return;
    }

    setComputing(true);
    setError(null);
    try {
      // If already has a result snapshot stored on planRecord, use it directly
      if (planRecord.status === 'completed' && planRecord.result) {
        setComputing(false);
        return;
      }

      // Compute using evaluate() on entriesForPlan only
      const planEntries = entriesForPlan(plan, entries);
      const evaluated = evaluate(plan, planEntries, today);

      const snapshot: ResultSnapshot = {
        ...evaluated,
        evaluatedAt: new Date().toISOString(),
      };

      const updated = await completePlan(user.id, planRecord.id, snapshot, snapshot.evaluatedAt);
      setPlanRecord(updated);
      // The experiment is complete: stop the daily check-in reminder as soon as the
      // result is stored, without waiting for the next home-screen visit to clear it.
      await clearDailyReminder();
    } catch (e) {
      setError(`${e instanceof Error ? e.message : 'Could not compute result.'} Retry viewing result.`);
    } finally {
      setComputing(false);
    }
  };

  // SCREEN 5B: plan_result_ready (status === 'completed' with stored snapshot)
  if (planRecord.status === 'completed' && planRecord.result) {
    const res = planRecord.result;
    const heading = VERDICT_HEADINGS[res.verdictLabel] ?? res.verdictLabel;
    const intDays = plan.schedule.filter(s => s.condition === 'intervention').length;
    const ctrlDays = plan.schedule.filter(s => s.condition === 'control').length;

    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Text variant="titleLarge">Your Result</Text>
          <Text color="champagne">This app is not medical advice.</Text>

          <View style={styles.card}>
            <Text variant="overline" color="champagneMuted">VERDICT</Text>
            <Text variant="titleMedium" color="champagneLight">{heading}</Text>
            <Text variant="body" color="ivory">{res.statement}</Text>
          </View>

          {res.conservativeEstimate !== null ? (
            <View style={styles.card}>
              <Text variant="sub" color="ivorySecondary">
                Conservative estimate (lower end of the plausible range): {res.conservativeEstimate} minutes
              </Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text variant="overline" color="champagneMuted">ADHERENCE SUMMARY</Text>
            <Text color="ivory">
              Followed cutoff rule on {res.adherence.counts.ADHERENT} of {intDays} assigned days.
            </Text>
            <Text color="ivory">
              Had caffeine after cutoff on {res.adherence.counts.CONTAMINATED} of {ctrlDays} usual routine days.
            </Text>
          </View>

          <View style={styles.card}>
            <Text variant="overline" color="champagneMuted">DAY COUNTS</Text>
            <Text color="ivorySecondary">Days analyzed: {res.daysAnalyzed.intervention + res.daysAnalyzed.control}</Text>
            <Text color="ivorySecondary">Days excluded: {res.daysExcluded}</Text>
            <Text color="ivorySecondary">Days with no sleep logged: {res.missingOutcomeDays}</Text>
          </View>

          {res.limitations && res.limitations.length > 0 ? (
            <View style={styles.card}>
              <Text variant="overline" color="champagneMuted">LIMITATIONS</Text>
              {res.limitations.map((lim, idx) => (
                <Text key={idx} variant="caption" color="ivoryMuted">• {lim}</Text>
              ))}
            </View>
          ) : null}

          <View style={styles.card}>
            <Button
              label={showHowToRead ? 'Hide "How to read this"' : 'How to read this'}
              variant="quiet"
              onPress={() => setShowHowToRead(!showHowToRead)}
            />
            {showHowToRead ? (
              <View style={styles.explainBox}>
                <Text variant="caption" color="ivorySecondary">
                  This compares days assigned to the caffeine cutoff with days assigned to your usual routine. It describes the difference between those assigned days; it cannot tell you why it happened.
                </Text>
                <Text variant="caption" color="champagne">
                  This app is not medical advice.
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text variant="sub" color="ivoryMuted">
              New experiments will arrive in a future update.
            </Text>
            <Button label="Back to Home" variant="secondary" onPress={() => router.replace('/')} />
          </View>
        </ScrollView>
      </Screen>
    );
  }

  // SCREEN 5A: plan_awaiting_final
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="titleLarge">Final Check-in</Text>
        <Text color="champagne">This app is not medical advice.</Text>

        <View style={styles.card}>
          <Text variant="titleSmall">Your experiment is complete.</Text>
          <Text color="ivorySecondary">
            {isFinalMissing
              ? `You need to log your final day (${lastExposureDate}) before viewing your result.`
              : 'All scheduled days have been logged.'}
          </Text>
        </View>

        {/* Progress counts only */}
        <View style={styles.card}>
          <Text variant="overline" color="champagneMuted">SUMMARY COUNTS</Text>
          <Text color="ivory">Days logged: {progress.daysLogged} of {plan.chosenDuration}</Text>
          <Text variant="caption" color="ivoryMuted">
            Adherent: {progress.adherenceCounts.ADHERENT} | Control clean: {progress.adherenceCounts.CONTROL_CLEAN} | Contaminated: {progress.adherenceCounts.CONTAMINATED} | Unknown: {progress.adherenceCounts.UNKNOWN}
          </Text>
        </View>

        {isFinalMissing ? (
          <CheckInCard
            date={lastExposureDate}
            label={`FINAL EXPOSURE DAY (${lastExposureDate})`}
            initialSleepMinutes={lastEntry?.sleepMinutes ?? null}
            initialCaffeineTime={lastEntry?.lastCaffeineTime ?? null}
            onSave={handleSaveFinalCheckIn}
            saving={savingEntry}
          />
        ) : null}

        {error ? (
          <View style={styles.card}>
            <Text color="champagneLight">{error}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text variant="sub" color="champagneLight" weight="medium">
            Once you view your result, the days in this experiment are locked, so log or fix any days first.
          </Text>
          <Button
            label="See my result"
            variant="primary"
            loading={computing}
            onPress={() => void handleComputeResult()}
          />
          <Button
            label="Go back"
            variant="secondary"
            onPress={() => router.replace('/')}
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
  explainBox: {
    paddingTop: spacing.xs,
    gap: spacing.xs,
  },
});
