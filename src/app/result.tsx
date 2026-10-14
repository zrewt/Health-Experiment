import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import {
  Screen,
  ScreenHeader,
  Card,
  Row,
  Divider,
  Disclosure,
  NavRow,
  Text,
  Button,
} from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import {
  getActivePlan,
  listExperimentPlans,
  archiveCompletedPlanForRepeat,
  listEntries,
  saveEntry,
  completePlan,
  StoredDailyEntry,
} from '@/data/experiment-store';
import type { StoredExperimentPlan } from '@/data/plan-persistence';
import { getToday } from '@/experiment/clock';
import { progressSummary, evaluate, entriesForPlan } from '@/experiment/adapter';
import { VERDICT_HEADINGS } from '@/experiment/verdict-headings';
import { getResultExplanationModel } from '@/experiment/lifecycle';
import { runInMinValidDays } from '@/experiment/config';
import type { DailyEntry, ProgressSummary, ResultSnapshot } from '@/experiment/types';
import { CheckInCard } from '@/components/CheckInCard';
import { clearDailyReminder } from '@/notifications/reminders';

const MEDICAL_NOTICE = 'This app is not medical advice.' as const;

export default function ResultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ planId?: string }>();
  const requestedPlanId = typeof params.planId === 'string' ? params.planId : undefined;

  const user = useAuthStore(state => state.user);
  const [planRecord, setPlanRecord] = useState<StoredExperimentPlan | null>(null);
  const [entries, setEntries] = useState<StoredDailyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingEntry, setSavingEntry] = useState(false);
  const [computing, setComputing] = useState(false);
  const [startingNewCycle, setStartingNewCycle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = getToday();

  useEffect(() => {
    if (!user) return;
    let current = true;
    void (async () => {
      try {
        const [active, loadedEntries, history] = await Promise.all([
          getActivePlan(user.id),
          listEntries(user.id),
          requestedPlanId ? listExperimentPlans(user.id) : Promise.resolve([]),
        ]);
        if (!current) return;
        const matchedFromHistory = requestedPlanId
          ? history.find(item => item.id === requestedPlanId) ?? null
          : null;
        setPlanRecord(matchedFromHistory ?? active);
        setEntries(loadedEntries);
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : 'Error loading plan.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [user, today, requestedPlanId]);

  const backToToday = () => router.replace('/');

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
        <ScreenHeader
          overline="RESULT"
          title="Your Result"
          notice={MEDICAL_NOTICE}
          action={<Button label="Today" variant="quiet" onPress={backToToday} />}
        />
        <Card title="No Active Experiment">
          <NavRow
            label="View Experiment History"
            onPress={() => router.replace('/experiment' as Href)}
          />
        </Card>
      </Screen>
    );
  }

  const { plan } = planRecord;
  const lastExposureDate = plan.schedule[plan.schedule.length - 1]?.date ?? plan.startDate;
  const lastEntry = entries.find(e => e.date === lastExposureDate);
  const isFinalMissing = !lastEntry || lastEntry.sleepMinutes === null;

  // Narrowed to this plan's schedule for the same reason as the daily screen: the user's
  // log also holds their run-in days, which sit outside the experiment window.
  const progress: ProgressSummary = progressSummary(plan, entriesForPlan(plan, entries), today);

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

  const handleStartNextCycle = async () => {
    if (!user || startingNewCycle || planRecord.status !== 'completed') return;
    setStartingNewCycle(true);
    setError(null);
    try {
      await archiveCompletedPlanForRepeat(user.id, planRecord);
      const validDays = entries.filter(e => e.sleepMinutes !== null).length;
      router.replace((validDays >= runInMinValidDays ? '/feasibility' : '/run-in') as Href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start a new experiment cycle.');
    } finally {
      setStartingNewCycle(false);
    }
  };

  // SCREEN 5B: plan_result_ready (status === 'completed' with stored snapshot)
  if (planRecord.status === 'completed' && planRecord.result) {
    const res = planRecord.result;
    const heading = VERDICT_HEADINGS[res.verdictLabel] ?? res.verdictLabel;
    const explanation = getResultExplanationModel(plan, res, entries);
    const intDays = explanation.contributingDays.assignedIntervention;
    const ctrlDays = explanation.contributingDays.assignedControl;

    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ScreenHeader
            overline="EXPERIMENT RESULT"
            title="Your Result"
            notice={MEDICAL_NOTICE}
            action={<Button label="Today" variant="quiet" onPress={backToToday} />}
          />

          {/* 1. Conclusion first, with the engine statement unchanged */}
          <Card tone="hero" overline="VERDICT">
            <Text variant="titleMedium" color="champagneLight">{heading}</Text>
            <Text variant="body" color="ivory">{res.statement}</Text>
            {res.reasons && res.reasons.length > 0 ? (
              <View style={styles.reasonsBox}>
                {res.reasons.map((reason, idx) => (
                  <Text key={idx} variant="caption" color="ivorySecondary">• {reason}</Text>
                ))}
              </View>
            ) : null}
          </Card>

          {/* 2. Clear explanation of the estimate and uncertainty */}
          <Card overline="ESTIMATE & UNCERTAINTY">
            {res.conservativeEstimate !== null ? (
              <Text variant="titleSmall" color="champagneLight" tabular>
                Conservative estimate: {res.conservativeEstimate} minutes
              </Text>
            ) : null}
            <Text variant="sub" color="ivorySecondary">
              {explanation.estimateExplanation.conservativeEstimateText}
            </Text>
            <Text variant="sub" color="ivory" tabular>
              {explanation.estimateExplanation.intervalText}
            </Text>
            <Text variant="caption" color="ivoryMuted">
              {explanation.estimateExplanation.uncertaintyNote}
            </Text>
          </Card>

          {/* 3. How many days contributed and what data was missing */}
          <Card overline="CONTRIBUTING & MISSING DAYS">
            <Row
              label="Days analyzed"
              value={`${explanation.contributingDays.analyzedTotal} of ${explanation.contributingDays.totalScheduled}`}
            />
            <Row
              label="Cutoff days analyzed"
              value={`${explanation.contributingDays.analyzedIntervention} of ${intDays} assigned`}
            />
            <Row
              label="Usual-routine days analyzed"
              value={`${explanation.contributingDays.analyzedControl} of ${ctrlDays} assigned`}
            />
            <Row
              label="Days with no sleep logged"
              value={String(res.missingOutcomeDays)}
              emphasis="muted"
            />
            <Row
              label="Days with unknown caffeine time"
              value={String(res.unknownExposureDays)}
              emphasis="muted"
            />
            <Row label="Days excluded" value={String(res.daysExcluded)} emphasis="muted" />

            <Divider />
            <Text variant="overline" color="champagneMuted">ADHERENCE SUMMARY</Text>
            <Text color="ivory">
              Followed cutoff rule on {res.adherence.counts.ADHERENT} of {intDays} assigned days.
            </Text>
            <Text color="ivory">
              Had caffeine after cutoff on {res.adherence.counts.CONTAMINATED} of {ctrlDays} usual routine days.
            </Text>
          </Card>

          {res.limitations && res.limitations.length > 0 ? (
            <Card overline="LIMITATIONS">
              {res.limitations.map((lim, idx) => (
                <Text key={idx} variant="caption" color="ivoryMuted">• {lim}</Text>
              ))}
            </Card>
          ) : null}

          {/* 4. What this result does—and does not—tell you */}
          <Card tone="quiet">
            <Disclosure
              label="What this result tells you"
              summary="And what it does not tell you"
            >
              {explanation.whatItTellsYou.doesTell.map((line, idx) => (
                <Text key={`does-${idx}`} variant="sub" color="ivorySecondary">
                  • {line}
                </Text>
              ))}

              <Text variant="overline" color="champagneMuted" style={styles.disclosureHeading}>
                WHAT THIS RESULT DOES NOT TELL YOU
              </Text>
              {explanation.whatItTellsYou.doesNotTell.map((line, idx) => (
                <Text key={`not-${idx}`} variant="sub" color="ivoryMuted">
                  • {line}
                </Text>
              ))}

              <View style={styles.explainBox}>
                <Text variant="caption" color="ivorySecondary">
                  This compares days assigned to the caffeine cutoff with days assigned to your usual routine. It describes the difference between those assigned days; it cannot tell you why it happened.
                </Text>
                <Text variant="caption" color="champagne">
                  {MEDICAL_NOTICE}
                </Text>
              </View>
            </Disclosure>
          </Card>

          {/* 5. Access to the underlying logged days */}
          <Card tone="quiet">
            <Disclosure
              label={`Inspect ${explanation.underlyingDays.length} scheduled days`}
              summary="These scheduled days are locked to preserve your experiment snapshot."
            >
              <View style={styles.daysList}>
                {explanation.underlyingDays.map((day) => (
                  <View key={day.date} style={styles.dayRow}>
                    <View style={styles.dayRowHeader}>
                      <Text variant="sub" color="ivory" weight="semiBold" tabular>
                        {day.date}
                      </Text>
                      <Text variant="caption" color="champagneLight">
                        {day.assignedLabel}
                      </Text>
                    </View>
                    <Text variant="caption" color="ivorySecondary" tabular>
                      Sleep: {day.sleepText} • {day.caffeineText}
                    </Text>
                  </View>
                ))}
              </View>
            </Disclosure>
            <NavRow label="Open full Journal" onPress={() => router.push('/journal' as Href)} />
          </Card>

          {/* 6. Next steps in the experiment lifecycle */}
          <Card overline="WHAT NEXT">
            <Text variant="sub" color="ivorySecondary">
              Your result is saved in your Experiment history. You can start a new caffeine experiment cycle anytime while keeping this result and its locked days intact.
            </Text>
            <Button
              label="Start a new caffeine experiment"
              variant="primary"
              loading={startingNewCycle}
              onPress={() => void handleStartNextCycle()}
            />
            <NavRow
              label="Experiment overview & saved results"
              onPress={() => router.push('/experiment' as Href)}
            />
          </Card>

          {error ? (
            <Card tone="danger">
              <Text color="garnet" accessibilityRole="alert">{error}</Text>
            </Card>
          ) : null}
        </ScrollView>
      </Screen>
    );
  }

  // SCREEN 5A: plan_awaiting_final
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          overline="FINAL CHECK-IN"
          title="Final Check-in"
          notice={MEDICAL_NOTICE}
          action={<Button label="Today" variant="quiet" onPress={backToToday} />}
        />

        <Card title="Your experiment is complete.">
          <Text color="ivorySecondary">
            {isFinalMissing
              ? `You need to log your final day (${lastExposureDate}) before viewing your result.`
              : 'All scheduled days have been logged.'}
          </Text>
        </Card>

        {/* Progress counts only */}
        <Card overline="SUMMARY COUNTS">
          <Text color="ivory">Days logged: {progress.daysLogged} of {plan.chosenDuration}</Text>
          <Text variant="caption" color="ivoryMuted">
            Adherent: {progress.adherenceCounts.ADHERENT} | Control clean: {progress.adherenceCounts.CONTROL_CLEAN} | Contaminated: {progress.adherenceCounts.CONTAMINATED} | Unknown: {progress.adherenceCounts.UNKNOWN}
          </Text>
        </Card>

        {isFinalMissing ? (
          <CheckInCard
            key={lastExposureDate}
            date={lastExposureDate}
            label={`FINAL EXPOSURE DAY (${lastExposureDate})`}
            initialSleepMinutes={lastEntry?.sleepMinutes ?? null}
            initialCaffeineTime={lastEntry?.lastCaffeineTime ?? null}
            onSave={handleSaveFinalCheckIn}
            saving={savingEntry}
          />
        ) : null}

        {error ? (
          <Card tone="danger">
            <Text color="garnet" accessibilityRole="alert">{error}</Text>
          </Card>
        ) : null}

        <Card>
          <Text variant="sub" color="champagneLight" weight="medium">
            Once you view your result, the days in this experiment are locked, so log or fix any days first.
          </Text>
          <Button
            label="See my result"
            variant="primary"
            loading={computing}
            onPress={() => void handleComputeResult()}
          />
          <NavRow label="Review log in Journal" onPress={() => router.push('/journal' as Href)} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.lg },
  reasonsBox: {
    marginTop: spacing.xs,
    gap: 4,
  },
  disclosureHeading: {
    marginTop: spacing.xs,
  },
  explainBox: {
    paddingTop: spacing.xs,
    gap: spacing.xs,
  },
  daysList: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  dayRow: {
    padding: spacing.sm,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radii.control,
    gap: 2,
  },
  dayRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
