import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import {
  Screen,
  ScreenHeader,
  Card,
  Row,
  Divider,
  NavRow,
  Text,
  Button,
  Details,
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
        if (current) setError(e instanceof Error ? e.message : 'Could not load your plan.');
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
          overline="WHAT WE FOUND"
          title="Nothing here yet"
          notice={MEDICAL_NOTICE}
          action={<Button label="Today" variant="quiet" onPress={backToToday} />}
        />
        <Card title="No sleep test is running">
          <NavRow
            label="See past tests"
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
      setError(e instanceof Error ? e.message : 'Could not save your log.');
    } finally {
      setSavingEntry(false);
    }
  };

  const handleComputeResult = async () => {
    if (!user || computing) return;

    // Hard invariant: the result can never be computed before E+1
    if (today <= lastExposureDate) {
      setError('You can see what we found the day after your last day.');
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
      setError(`${e instanceof Error ? e.message : 'Could not work out the result.'} Try again.`);
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
      setError(e instanceof Error ? e.message : 'Could not start a new test.');
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
            overline="WHAT WE FOUND"
            title="What we found"
            notice={MEDICAL_NOTICE}
            action={<Button label="Today" variant="quiet" onPress={backToToday} />}
          />

          {/* 1. What we found: the plain heading leads. The engine's own sentence is
              kept word for word and sits under Details, with the reasons it gives. */}
          <Card tone="hero" overline="WHAT WE FOUND">
            <Text variant="titleMedium" color="champagneLight">{heading}</Text>
            <Text variant="body" color="ivorySecondary">
              Here is what your log showed, and how sure we can be about it.
            </Text>

            <Details summary="The exact wording, and what it does not say">
              <Text variant="sub" color="ivory">{res.statement}</Text>
              {res.reasons && res.reasons.length > 0 ? (
                <View style={styles.reasonsBox}>
                  {res.reasons.map((reason, idx) => (
                    <Text key={idx} variant="caption" color="ivorySecondary">• {reason}</Text>
                  ))}
                </View>
              ) : null}

              {explanation.whatItTellsYou.doesTell.map((line, idx) => (
                <Text key={`does-${idx}`} variant="sub" color="ivorySecondary">• {line}</Text>
              ))}
              {explanation.whatItTellsYou.doesNotTell.map((line, idx) => (
                <Text key={`not-${idx}`} variant="sub" color="ivoryMuted">• {line}</Text>
              ))}
              <Text variant="caption" color="champagne">{MEDICAL_NOTICE}</Text>
            </Details>

            {/* The days behind the result, available but not in the way. */}
            <Details summary={`See all ${explanation.underlyingDays.length} days`}>
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
            </Details>
          </Card>

          {/* 2. How sure we are: one plain line, then every number under Details. */}
          <Card overline="HOW SURE WE ARE">
            <Text variant="body" color="ivorySecondary">
              This is a cautious read of your own log.
            </Text>

            <Details summary="The numbers">
              {res.conservativeEstimate !== null ? (
                <Text variant="titleSmall" color="champagneLight" tabular>
                  Cautious estimate: {res.conservativeEstimate} minutes a night more sleep on cutoff days
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

              <Divider />
              <Row
                label="Days looked at"
                value={`${explanation.contributingDays.analyzedTotal} of ${explanation.contributingDays.totalScheduled}`}
              />
              <Row
                label="Cutoff days looked at"
                value={`${explanation.contributingDays.analyzedIntervention} of ${intDays}`}
              />
              <Row
                label="Normal days looked at"
                value={`${explanation.contributingDays.analyzedControl} of ${ctrlDays}`}
              />
              <Row
                label="Nights not logged"
                value={String(res.missingOutcomeDays)}
                emphasis="muted"
              />
              <Row
                label="Caffeine time not logged"
                value={String(res.unknownExposureDays)}
                emphasis="muted"
              />
              <Row label="Days left out" value={String(res.daysExcluded)} emphasis="muted" />

              <Divider />
              <Text variant="overline" color="champagneMuted">HOW OFTEN YOU KEPT TO IT</Text>
              {/* ADHERENT = a cutoff day with no caffeine after the cutoff.
                  CONTAMINATED = a normal day where caffeine was skipped or early, so the
                  label must not claim caffeine after the cutoff. */}
              <Text color="ivory">
                Kept the rule on {res.adherence.counts.ADHERENT} of {intDays} cutoff days.
              </Text>
              <Text color="ivory">
                No caffeine after cutoff on {res.adherence.counts.CONTAMINATED} of {ctrlDays} normal days.
              </Text>

              {res.limitations && res.limitations.length > 0 ? (
                <View style={styles.explainBox}>
                  <Text variant="overline" color="champagneMuted">WHAT WE COULD NOT RULE OUT</Text>
                  {res.limitations.map((lim, idx) => (
                    <Text key={idx} variant="caption" color="ivoryMuted">• {lim}</Text>
                  ))}
                </View>
              ) : null}
            </Details>
          </Card>

          {/* 3. What to do next: one action, then quiet ways onward. */}
          <Card overline="WHAT TO DO NEXT">
            <Text variant="sub" color="ivorySecondary">
              This is saved. You can start another test any time.
            </Text>
            <Button
              label="Start a new sleep test"
              variant="primary"
              loading={startingNewCycle}
              onPress={() => void handleStartNextCycle()}
            />
            <NavRow
              label="Past tests"
              onPress={() => router.push('/experiment' as Href)}
            />
            <NavRow label="Open my log" onPress={() => router.push('/journal' as Href)} />
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
          overline="LAST DAY"
          title="Last night to log"
          notice={MEDICAL_NOTICE}
          action={<Button label="Today" variant="quiet" onPress={backToToday} />}
        />

        <Card title="Your sleep test is over">
          <Text color="ivorySecondary">
            {isFinalMissing
              ? `Log ${lastExposureDate} to see what we found.`
              : 'Every day is logged.'}
          </Text>
        </Card>

        {/* Counts only: never a comparison or a verdict before the result is opened. */}
        <Card overline="SO FAR">
          <Text color="ivory">Days logged: {progress.daysLogged} of {plan.chosenDuration}</Text>
          <Details summary="How often you kept to it">
            <Text variant="caption" color="ivoryMuted">
              Kept the rule: {progress.adherenceCounts.ADHERENT} · Normal days: {progress.adherenceCounts.CONTROL_CLEAN} · Normal, no caffeine: {progress.adherenceCounts.CONTAMINATED} · Not sure: {progress.adherenceCounts.UNKNOWN}
            </Text>
          </Details>
        </Card>

        {isFinalMissing ? (
          <CheckInCard
            key={lastExposureDate}
            date={lastExposureDate}
            label={`LAST DAY (${lastExposureDate})`}
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
            Once you open what we found, these days are locked. Fix anything you need to first.
          </Text>
          <Button
            label="See what we found"
            variant="primary"
            loading={computing}
            onPress={() => void handleComputeResult()}
          />
          <NavRow label="Open my log" onPress={() => router.push('/journal' as Href)} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.section, paddingBottom: spacing.section },
  reasonsBox: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  explainBox: {
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  daysList: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  dayRow: {
    padding: spacing.md,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radii.control,
    gap: 4,
  },
  dayRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
