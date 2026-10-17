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
  StatStrip,
  Text,
  Button,
  Details,
  Banner,
} from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import { sentenceCase } from '@/design/labels';
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
import { causationCaveat } from '@/experiment/result-summary';
import { buildPlainResult } from '@/experiment/result-plain-language';
import { extractCutoffTime, getResultExplanationModel } from '@/experiment/lifecycle';
import { getMilestones } from '@/experiment/milestones';
import { VERDICT_HEADINGS } from '@/experiment/verdict-headings';
import {
  cutoffRuleText,
  experimentForRuleType,
  exposureForExperimentId,
  exposureValue,
} from '@/experiment/experiments';
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
          // Always loaded: the new-cycle count and a shared link both need every plan.
          listExperimentPlans(user.id),
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
        <Text color="textMuted">Loading...</Text>
      </Screen>
    );
  }

  if (!planRecord) {
    return (
      <Screen>
        <ScreenHeader
          overline={today}
          title="Nothing here yet"
          notice={MEDICAL_NOTICE}
          action={<Button label="Today" variant="quiet" onPress={backToToday} />}
        />
        <Card tone="tint" title="No sleep test is running">
          <NavRow
            label="See past tests"
            onPress={() => router.replace('/experiment' as Href)}
          />
        </Card>
      </Screen>
    );
  }

  const { plan } = planRecord;
  // Every label below names this test's exposure, never an assumed caffeine test.
  const experiment = experimentForRuleType(plan.definition.conditionRule.type);
  const exposure = exposureForExperimentId(experiment.id);
  const isScreens = exposure === 'screens';
  const lastExposureDate = plan.schedule[plan.schedule.length - 1]?.date ?? plan.startDate;
  const lastEntry = entries.find(e => e.date === lastExposureDate);
  const isFinalMissing = !lastEntry || lastEntry.sleepMinutes === null;

  // Narrowed to this plan's schedule for the same reason as the daily screen: the user's
  // log also holds their run-in days, which sit outside the experiment window.
  const progress: ProgressSummary = progressSummary(plan, entriesForPlan(plan, entries), today);
  // "Logged sleep" means a night with a sleep figure, which is what the result used.
  const nightsWithSleep = entriesForPlan(plan, entries).filter(
    entry => entry.sleepMinutes !== null,
  ).length;

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
      // The next step is a choice, not a re-entry: the choose screen starts the other test's
      // own run-in, or the same one again, so the finished days never carry over.
      router.replace('/choose-test' as Href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start a new test.');
    } finally {
      setStartingNewCycle(false);
    }
  };

  // A test that was stopped before its last day still says so plainly, with no numbers to read.
  if (planRecord.status === 'cancelled') {
    const elapsedDays = plan.schedule.filter(day => day.date <= today).length;
    const plain = buildPlainResult({
      result: null,
      heading: 'Test ended early',
      plannedDays: plan.chosenDuration,
      daysLogged: nightsWithSleep,
      daysElapsed: elapsedDays,
      endedEarly: true,
    });

    return (
      <Screen>
        <ScreenHeader
          overline={`${today} · ${experiment.name}`}
          title="What we found"
          notice={MEDICAL_NOTICE}
          action={<Button label="Today" variant="quiet" onPress={backToToday} />}
        />
        <Card tone="hero">
          <Text variant="title" accessibilityRole="header">{plain.headline}</Text>
          <View style={styles.whatThisMeans}>
            <Text variant="caption" color="textMuted">{sentenceCase('WHAT THIS MEANS')}</Text>
            <Text variant="body">{plain.paragraph}</Text>
          </View>
          <Text variant="caption" color="textMuted">{causationCaveat(experiment.exposureWord)}</Text>
        </Card>
        <Card tone="tint" overline={sentenceCase('WHAT TO DO NEXT')}>
          <Text variant="sub" color="textMuted">{plain.nextStep}</Text>
          <Button
            label="Start a new sleep test"
            variant="primary"
            onPress={() => router.replace('/choose-test' as Href)}
          />
          <NavRow label="Past tests" onPress={() => router.push('/experiment' as Href)} />
        </Card>
      </Screen>
    );
  }

  // SCREEN 5B: plan_result_ready (status === 'completed' with stored snapshot)
  if (planRecord.status === 'completed' && planRecord.result) {
    const res = planRecord.result;
    const explanation = getResultExplanationModel(plan, res, entries);
    const cutoffTime = extractCutoffTime(plan);
    const noExposureOnNormalDay = `${cutoffRuleText(experiment, cutoffTime).replace(/^no/, 'No')}`;
    const intDays = explanation.contributingDays.assignedIntervention;
    const ctrlDays = explanation.contributingDays.assignedControl;
    // What this means, in words a reader can act on. Built only from the stored result.
    const plain = buildPlainResult({
      result: res,
      heading: VERDICT_HEADINGS[res.verdictLabel] ?? res.verdictLabel,
      plannedDays: plan.chosenDuration,
      daysLogged: nightsWithSleep,
    });
    const caveat = causationCaveat(experiment.exposureWord);
    // What the log already says about them, independent of the test's answer: a null result
    // should still return something they did not know before.
    const insights = getMilestones({
      entries,
      today,
      exposure,
      cutoffTime,
      schedule: plan.schedule,
    });

    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ScreenHeader
            overline={`${today} · ${experiment.name}`}
            title="What we found"
            notice={MEDICAL_NOTICE}
            action={<Button label="Today" variant="quiet" onPress={backToToday} />}
          />

          {/* 1. What we found: the plain heading leads. The engine's own sentence is
              kept word for word and sits under Details, with the reasons it gives. */}
          <Card tone="hero">
            <Text variant="title" accessibilityRole="header">{plain.headline}</Text>

            {/* The answer, in everyday words and everyday units. */}
            <View style={styles.whatThisMeans}>
              <Text variant="caption" color="textMuted">{sentenceCase('WHAT THIS MEANS')}</Text>
              <Text variant="body">{plain.paragraph}</Text>
            </View>

            <Text variant="caption" color="textMuted">
              {caveat}
            </Text>

            <Details summary="Details">
              <Text variant="caption" color="textMuted">
                The engine's own sentence is kept word for word. Here "units" means minutes of
                sleep per night.
              </Text>
              <Text variant="sub">{res.statement}</Text>
              {res.reasons && res.reasons.length > 0 ? (
                <View style={styles.reasonsBox}>
                  {res.reasons.map((reason, idx) => (
                    <Text key={idx} variant="caption" color="textMuted">• {reason}</Text>
                  ))}
                </View>
              ) : null}

              {explanation.whatItTellsYou.doesTell.map((line, idx) => (
                <Text key={`does-${idx}`} variant="sub" color="textMuted">• {line}</Text>
              ))}
              {explanation.whatItTellsYou.doesNotTell.map((line, idx) => (
                <Text key={`not-${idx}`} variant="sub" color="textMuted">• {line}</Text>
              ))}
              <Text variant="caption" color="accent">{MEDICAL_NOTICE}</Text>
            </Details>

            {/* The days behind the result, available but not in the way. */}
            <Details summary={`See all ${explanation.underlyingDays.length} days`}>
              <View style={styles.daysList}>
                {explanation.underlyingDays.map((day) => (
                  <View key={day.date} style={styles.dayRow}>
                    <View style={styles.dayRowHeader}>
                      <Text variant="sub" weight="semiBold" tabular>
                        {day.date}
                      </Text>
                      <Text variant="caption" color="textMuted">
                        {day.assignedLabel}
                      </Text>
                    </View>
                    <Text variant="caption" color="textMuted" tabular>
                      Sleep: {day.sleepText} • {day.exposureText}
                    </Text>
                  </View>
                ))}
              </View>
            </Details>
          </Card>

          {/* 2. How sure we are: one plain line, then every number under Details. */}
          <Card tone="tint" overline={sentenceCase('HOW SURE WE ARE')}>
            <Text variant="body" color="textMuted">
              {plain.certainty}
            </Text>

            <Details summary="Scientific details">
              {res.conservativeEstimate !== null ? (
                <Text variant="heading" tabular>
                  Cautious estimate: {res.conservativeEstimate} minutes of sleep per night more on
                  cutoff days
                </Text>
              ) : null}
              <Text variant="caption" color="textMuted">
                This is the low end of the range the engine could work out from your log.
              </Text>
              <Text variant="sub" tabular>
                {explanation.estimateExplanation.intervalText}
              </Text>
              <Text variant="caption" color="textMuted">
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
                label={isScreens ? 'Screen time not logged' : 'Caffeine time not logged'}
                value={String(res.unknownExposureDays)}
                emphasis="muted"
              />
              <Row label="Days left out" value={String(res.daysExcluded)} emphasis="muted" />

              <Divider />
              <Text variant="caption" color="textMuted">{sentenceCase('HOW OFTEN YOU KEPT TO IT')}</Text>
              {/* ADHERENT = a cutoff day that kept the rule.
                  CONTAMINATED = a normal day where the exposure was skipped or early, so the
                  label must not claim the exposure happened after the cutoff. */}
              <Text>
                Kept the rule on {res.adherence.counts.ADHERENT} of {intDays} cutoff days.
              </Text>
              <Text>
                {noExposureOnNormalDay} on {res.adherence.counts.CONTAMINATED} of {ctrlDays} normal days.
              </Text>

              {res.limitations && res.limitations.length > 0 ? (
                <View style={styles.explainBox}>
                  <Text variant="caption" color="textMuted">{sentenceCase('WHAT WE COULD NOT RULE OUT')}</Text>
                  {res.limitations.map((lim, idx) => (
                    <Text key={idx} variant="caption" color="textMuted">• {lim}</Text>
                  ))}
                </View>
              ) : null}
            </Details>
          </Card>

          {/* 3. What to do next: one action, then quiet ways onward. */}
          <Card tone="tint" overline={sentenceCase('WHAT TO DO NEXT')}>
            <Text variant="sub" color="textMuted">
              {plain.nextStep}
            </Text>
            <Text variant="caption" color="textMuted">
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

          {/* What the log says about their sleep either way, so a null result still gives. */}
          {insights.length > 0 ? (
            <Card tone="quiet" overline="Your sleep, beyond the test">
              <Text variant="sub" color="textMuted">
                These come from your own log. The test did not need to answer them.
              </Text>
              {insights.slice(-3).map(item => (
                <View key={item.id} style={styles.insightRow}>
                  <Text variant="body">{item.title}</Text>
                  <Text variant="caption" color="textMuted">{item.body}</Text>
                </View>
              ))}
            </Card>
          ) : null}

          {error ? (
            <Banner
              tone="error"
              action={
                <Button
                  label="Try again"
                  variant="quiet"
                  loading={startingNewCycle}
                  onPress={() => void handleStartNextCycle()}
                />
              }
            >
              {error}
            </Banner>
          ) : null}
        </ScrollView>
      </Screen>
    );
  }

  // SCREEN 5A: plan_awaiting_final
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline={sentenceCase('LAST DAY')}
          title="Last night to log"
          notice={MEDICAL_NOTICE}
          action={<Button label="Today" variant="quiet" onPress={backToToday} />}
        />

        <Card tone="hero" title="Your sleep test is over">
          <Text variant="body" color="textMuted">
            {isFinalMissing
              ? `Log ${lastExposureDate} to see what we found.`
              : 'Every day is logged.'}
          </Text>
        </Card>

        {/* Counts only: never a comparison or a verdict before the result is opened. */}
        <Card tone="tint" overline={sentenceCase('SO FAR')}>
          <Text variant="heading" tabular>
            You logged {progress.daysLogged} of {plan.chosenDuration} nights
          </Text>
          <Text variant="body" color="textMuted">
            and kept the rule on {progress.adherenceCounts.ADHERENT} of{' '}
            {plan.schedule.filter(day => day.condition === 'intervention').length} cutoff days.
          </Text>
          <Details summary="How often you kept to it">
            <StatStrip
              items={[
                { label: 'Kept the rule', value: String(progress.adherenceCounts.ADHERENT) },
                { label: 'Normal days', value: String(progress.adherenceCounts.CONTROL_CLEAN) },
                {
                  label: isScreens ? 'Normal, no screens' : 'Normal, no caffeine',
                  value: String(progress.adherenceCounts.CONTAMINATED),
                },
                { label: 'Not sure', value: String(progress.adherenceCounts.UNKNOWN), emphasis: 'muted' },
              ]}
            />
          </Details>
        </Card>

        {isFinalMissing ? (
          <CheckInCard
            key={lastExposureDate}
            date={lastExposureDate}
            label={`Last day (${lastExposureDate})`}
            initialSleepMinutes={lastEntry?.sleepMinutes ?? null}
            initialCaffeineTime={exposureValue(lastEntry, exposure)}
            exposure={exposure}
            onSave={handleSaveFinalCheckIn}
            saving={savingEntry}
          />
        ) : null}

        {error ? (
          <Banner
            tone="error"
            action={
              <Button
                label="Try again"
                variant="quiet"
                loading={computing}
                onPress={() => void handleComputeResult()}
              />
            }
          >
            {error}
          </Banner>
        ) : null}

        <Card tone="hero">
          <Text variant="sub" color="accent" weight="medium">
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
  whatThisMeans: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
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
    backgroundColor: colors.surfaceTint,
    borderRadius: radii.control,
    gap: spacing.xs,
  },
  dayRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  insightRow: { gap: spacing.xs, paddingTop: spacing.sm },
});
