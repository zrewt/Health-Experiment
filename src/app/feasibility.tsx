import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Screen,
  ScreenHeader,
  Card,
  NavRow,
  Text,
  Button,
  Details,
  Banner,
  SplitDisc,
  type DiscTone,
} from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import { sentenceCase } from '@/design/labels';
import { useAuthStore } from '@/store/auth';
import {
  getSetup,
  getConsent,
  listEntries,
  getActivePlan,
  getPendingPlan,
  savePlan,
  saveNextCheckDate,
  listExperimentPlans,
  type ExperimentSetupRecord,
} from '@/data/experiment-store';
import { computeExperimentBaseline, assessFeasibility, entriesForRunIn } from '@/experiment/adapter';
import { exposureForExperimentId, experimentById } from '@/experiment/experiments';
import { getFeasibilityScreenState } from '@/experiment/view-model';
import { getStartAttempt, isFeasibilityDue } from '@/experiment/start-attempt';
import { getToday } from '@/experiment/clock';
import { addDaysToLocalDate } from '@/experiment/dates';
import type {
  BaselineSummary,
  ExperimentPlan,
  FeasibilityScreenState,
  FeasibilityViewModel,
} from '@/experiment/types';

interface Assessment {
  setup: ExperimentSetupRecord;
  baseline: BaselineSummary;
  feasibility: FeasibilityViewModel;
  screen: FeasibilityScreenState;
}

export default function FeasibilityScreen() {
  const router = useRouter();
  const userId = useAuthStore((state) => state.user?.id);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [attempt, setAttempt] = useState<ExperimentPlan | null>(null);
  // Synchronous guard retains a plan even if two presses precede the next render.
  const attemptRef = useRef<ExperimentPlan | null>(null);
  const busy = useRef(false);
  const [saved, setSaved] = useState<ExperimentPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const today = getToday();
  const nextRefreshDate = addDaysToLocalDate(today, 7);

  useEffect(() => {
    let current = true;
    if (!userId) return;
    void (async () => {
      try {
        const consent = await getConsent(userId);
        const setup = await getSetup(userId);
        if (!current) return;
        if (!consent?.granted || !setup) {
          // Onboarding starts at the test picker, so no test is chosen for the user.
          router.replace('/choose-test');
          return;
        }
        const active = await getActivePlan(userId);
        if (!current) return;
        if (active) {
          setSaved(active.plan);
          return;
        }
        const pending = await getPendingPlan(userId);
        const [entries, savedPlans] = await Promise.all([
          listEntries(userId),
          listExperimentPlans(userId),
        ]);
        if (!current) return;
        // The baseline is built from the run-in window only. Days inside an earlier plan's
        // schedule had caffeine cut on some mornings, so letting them through would bias
        // both this verdict-worthiness check and the afternoon-caffeine eligibility share.
        const runInEntries = entriesForRunIn(entries, savedPlans.map((item) => item.plan), getToday());
        const exposure = exposureForExperimentId(setup.experimentId);
        // The saved cutoff is the one the baseline is judged against; the default would
        // measure a different habit than the test the user is about to run.
        const baseline = pending?.feasibilitySnapshot.inputs.baseline
          ?? computeExperimentBaseline(exposure, runInEntries, { cutoffTime: setup.cutoffTime });
        if (!pending && !isFeasibilityDue(baseline.validDays, setup.nextCheckDate ?? null, getToday())) {
          router.replace('/run-in');
          return;
        }
        const feasibility = pending?.feasibilitySnapshot ?? assessFeasibility(baseline);
        const screen = getFeasibilityScreenState(baseline, feasibility, setup, exposure);
        setAssessment({ setup, baseline, feasibility, screen });
        setDuration(pending?.chosenDuration ?? feasibility.defaultDuration);
        attemptRef.current = pending;
        setAttempt(pending);
        if (pending) {
          setError(
            'Your exact test schedule is saved on this device, waiting for server confirmation. Tap Try saving again to finish.',
          );
        }
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : 'Could not load your log. Try again.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [userId, router, reload]);

  const start = async () => {
    if (!userId || !assessment || !duration || busy.current) return;
    if (assessment.screen.kind !== 'informative' && assessment.screen.kind !== 'long_shot') return;
    if (assessment.screen.requiresAcknowledgement && !acknowledged) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const plan = getStartAttempt(attemptRef.current, {
        baseline: assessment.baseline,
        feasibility: assessment.feasibility,
        duration,
        today: getToday(),
        acknowledged,
        cutoffTime: assessment.setup.cutoffTime,
        ruleType: experimentById(assessment.setup.experimentId).ruleType,
      });
      attemptRef.current = plan;
      setAttempt(plan);
      const stored = await savePlan(userId, plan);
      setSaved(stored.plan);
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : 'Could not save the plan.'} Your exact schedule is safely held on this device — tap Try saving again when ready.`,
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const recheck = async () => {
    if (!userId || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await saveNextCheckDate(userId, addDaysToLocalDate(getToday(), 7));
      router.replace('/run-in');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the next check date. Try again.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const state = assessment?.screen;
  const startState = state && (state.kind === 'informative' || state.kind === 'long_shot') ? state : null;
  const keepState =
    state &&
    (state.kind === 'cannot_assess' || state.kind === 'ineligible' || state.kind === 'not_informative')
      ? state
      : null;

  // One plain verdict per tier. The engine's own sentences and every number sit under
  // the Details toggle, so nothing statistical leads this screen.
  const verdict = !state
    ? ''
    : state.kind === 'informative'
    ? 'Good bet'
    : state.kind === 'long_shot'
    ? 'Worth a try'
    : state.kind === 'not_informative'
    ? 'Probably not enough to tell'
    : 'Not enough logged yet';

  const reason = startState
    ? 'Your log is steady enough for this test to show a real difference.'
    : keepState?.message ?? '';

  const discTone: DiscTone =
    state?.kind === 'informative'
      ? 'normal'
      : state?.kind === 'long_shot'
      ? 'cutoff'
      : 'none';

  // The engine's own sentence for a negative verdict is kept word for word and shown
  // under Details, so the plain reason above never replaces it.
  const keepStatement =
    keepState && 'duration' in keepState && keepState.duration !== null
      ? assessment?.feasibility.options.find((option) => option.duration === keepState.duration)
          ?.statement ?? null
      : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline={sentenceCase('AFTER 14 NIGHTS')}
          title="Is this test worth doing?"
          notice="This app is not medical advice."
          action={<Button label="Today" variant="quiet" onPress={() => router.replace('/')} />}
        />

        {loading ? <Text color="textMuted" accessibilityLiveRegion="polite">Loading your log…</Text> : null}

        {error ? (
          <Banner
            tone="error"
            action={
              attempt ? (
                <Button
                  label="Try saving again"
                  variant="quiet"
                  loading={saving}
                  onPress={() => void start()}
                />
              ) : (
                <Button
                  label="Reload"
                  variant="quiet"
                  onPress={() => {
                    setLoading(true);
                    setError(null);
                    setReload((n) => n + 1);
                  }}
                />
              )
            }
          >
            {error}
          </Banner>
        ) : null}

        {!loading && !state && !saved ? (
          <Button
            label="Try again"
            onPress={() => {
              setLoading(true);
              setError(null);
              setReload((n) => n + 1);
            }}
          />
        ) : null}

        {saved ? (
          <Card tone="hero" overline={sentenceCase('ALL SET')}>
            <View style={styles.heroRow}>
              <SplitDisc size={76} tone="normal" />
              <View style={styles.heroText}>
                <Text variant="title" accessibilityRole="header">
                  Your test is set
                </Text>
                <Text variant="body" color="textMuted" accessibilityLiveRegion="polite" tabular>
                  Starts {saved.startDate} · {saved.chosenDuration} days
                </Text>
              </View>
            </View>
            <Text variant="body" color="textMuted">
              One short note a day, all the way through.
            </Text>
            <Button label="Go to Today" variant="primary" onPress={() => router.replace('/')} />
            <NavRow label="Back to my log" onPress={() => router.replace('/run-in')} />
          </Card>
        ) : !loading && state && assessment ? (
          <>
            {/* One verdict, one reason, and structured count badge. */}
            <Card tone="hero">
              <View style={styles.heroRow}>
                <SplitDisc size={76} tone={discTone} />
                <View style={styles.heroText}>
                  <Text variant="caption" color="textMuted" tabular>
                    {assessment.baseline.validDays} of {assessment.baseline.targetDays} nights logged · Cutoff {assessment.setup.cutoffTime}
                  </Text>
                  <Text variant="title" accessibilityRole="header">
                    {verdict}
                  </Text>
                </View>
              </View>
              <Text variant="body" color="textMuted">
                {reason}
              </Text>
              {keepState ? (
                <Text variant="caption" color="textMuted" tabular>
                  Next check unlocks on {nextRefreshDate} after 7 more nights.
                </Text>
              ) : null}
            </Card>

            {startState ? (
              <>
                <Card tone="tint" overline={sentenceCase('HOW LONG')}>
                  <Text variant="sub" color="textMuted">
                    Pick how many days to run it.
                  </Text>
                  <View
                    accessibilityRole="radiogroup"
                    accessibilityLabel="Test length"
                    style={styles.group}
                  >
                    {startState.options.map((option) => {
                      const active = duration === option.duration;
                      return (
                        <Pressable
                          key={option.duration}
                          onPress={() => setDuration(option.duration)}
                          disabled={attempt !== null || saving}
                          accessibilityRole="radio"
                          accessibilityLabel={`${option.duration} days`}
                          aria-checked={active}
                          accessibilityState={{
                            checked: active,
                            disabled: attempt !== null || saving,
                          }}
                          style={[styles.chip, active && styles.chipActive]}
                        >
                          <Text
                            variant="sub"
                            color={active ? 'surface' : 'text'}
                            weight="semiBold"
                            tabular
                          >
                            {option.duration} days
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </Card>

                {startState.requiresAcknowledgement ? (
                  <Pressable
                    onPress={() => setAcknowledged((value) => !value)}
                    disabled={saving}
                    accessibilityRole="checkbox"
                    accessibilityLabel="I understand this test may tell me nothing."
                    aria-checked={acknowledged}
                    accessibilityState={{ checked: acknowledged, disabled: saving }}
                    style={styles.checkRow}
                  >
                    <View style={[styles.checkbox, acknowledged && styles.checkboxChecked]}>
                      {acknowledged ? (
                        <Text variant="body" color="surface" weight="semiBold">
                          ✓
                        </Text>
                      ) : null}
                    </View>
                    <Text variant="body" color="text" style={styles.checkLabel}>
                      I understand this test may tell me nothing.
                    </Text>
                  </Pressable>
                ) : null}

                <Button
                  label={attempt ? 'Try saving again' : 'Start the test'}
                  variant="primary"
                  loading={saving}
                  disabled={!duration || (startState.requiresAcknowledgement && !acknowledged)}
                  onPress={() => void start()}
                />
                {!attempt ? (
                  <NavRow
                    label="Not now"
                    disabled={saving}
                    onPress={() => router.replace('/run-in')}
                  />
                ) : null}

                <Card tone="quiet">
                  <Details summary="The numbers behind this">
                    <Text variant="caption" color="textMuted">
                      {startState.simulationNote}
                    </Text>
                    {startState.conservativeNote ? (
                      <Text variant="caption" color="textMuted">
                        {startState.conservativeNote}
                      </Text>
                    ) : null}
                    {startState.options.map((option) => (
                      <View key={option.duration} style={styles.factBlock}>
                        <Text variant="sub" color="accent" weight="semiBold" tabular>
                          {option.duration} days
                        </Text>
                        <Text variant="caption" color="textMuted">
                          {option.mdeLabel}: {option.numberQualifier === 'at least' ? 'at least ' : ''}
                          {typeof option.mdeDirectMinutes === 'number'
                            ? `${option.mdeDirectMinutes} minutes`
                            : option.mdeDirectMinutes === 'larger_than_60'
                            ? 'larger than 60 minutes'
                            : 'not available'}
                        </Text>
                        {option.mdeAssignedDayEquivalent !== null ? (
                          <Text variant="caption" color="textMuted">
                            about {Math.round(option.mdeAssignedDayEquivalent)} minutes per cutoff day
                          </Text>
                        ) : null}
                        <Text variant="caption" color="textMuted">
                          {option.adherenceAssumptionText}
                        </Text>
                        {option.statement !== null ? (
                          <Text variant="caption" color="textMuted">
                            {option.statement}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                    <Text variant="caption" color="textMuted">
                      {assessment.feasibility.autocorrelationAssumptionText}
                    </Text>
                    {startState.startInstruction ? (
                      <Text variant="caption" color="textMuted">
                        {startState.startInstruction}
                      </Text>
                    ) : null}
                  </Details>
                </Card>
              </>
            ) : keepState ? (
              <>
                {/* One action: keep logging. The engine's own reasons stay under Details. */}
                <Button
                  label={keepState.actions[0]}
                  variant="primary"
                  loading={saving}
                  onPress={() => void recheck()}
                />
                <NavRow
                  label="Not now"
                  disabled={saving}
                  onPress={() => router.replace('/run-in')}
                />
                <Card tone="quiet">
                  <Details summary="What your log shows">
                    {'detailFacts' in keepState
                      ? keepState.detailFacts.map((fact) => (
                          <Text key={fact} variant="caption" color="textMuted">
                            {fact}
                          </Text>
                        ))
                      : null}
                    {keepState.reasons.map((line, index) => (
                      <Text key={index} variant="caption" color="textMuted">
                        {line}
                      </Text>
                    ))}
                    {keepStatement ? (
                      <Text variant="caption" color="textMuted">
                        {keepStatement}
                      </Text>
                    ) : null}
                  </Details>
                </Card>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.section, paddingBottom: spacing.xxl },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroText: {
    flex: 1,
    gap: spacing.xs,
  },
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.sm,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  checkLabel: { flex: 1 },
  factBlock: { gap: 2, marginTop: spacing.sm },
});
