import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, ScreenHeader, Card, NavRow, Text, Button, Details } from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import {
  getSetup, getConsent, listEntries, getActivePlan, getPendingPlan, savePlan, saveNextCheckDate,
  type ExperimentSetupRecord,
} from '@/data/experiment-store';
import { computeBaseline, assessFeasibility } from '@/experiment/adapter';
import { getFeasibilityScreenState } from '@/experiment/view-model';
import { getStartAttempt, isFeasibilityDue } from '@/experiment/start-attempt';
import { getToday } from '@/experiment/clock';
import { addDaysToLocalDate } from '@/experiment/dates';
import type { BaselineSummary, ExperimentPlan, FeasibilityScreenState, FeasibilityViewModel } from '@/experiment/types';

interface Assessment {
  setup: ExperimentSetupRecord;
  baseline: BaselineSummary;
  feasibility: FeasibilityViewModel;
  screen: FeasibilityScreenState;
}

export default function FeasibilityScreen() {
  const router = useRouter();
  const userId = useAuthStore(state => state.user?.id);
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

  useEffect(() => {
    let current = true;
    if (!userId) return;
    void (async () => {
      try {
        const consent = await getConsent(userId);
        const setup = await getSetup(userId);
        if (!current) return;
        if (!consent?.granted || !setup) {
          router.replace('/setup-consent');
          return;
        }
        const active = await getActivePlan(userId);
        if (!current) return;
        if (active) {
          setSaved(active.plan);
          return;
        }
        const pending = await getPendingPlan(userId);
        const entries = await listEntries(userId);
        if (!current) return;
        const baseline = pending?.feasibilitySnapshot.inputs.baseline ?? computeBaseline(entries);
        if (!pending && !isFeasibilityDue(baseline.validDays, setup.nextCheckDate ?? null, getToday())) {
          router.replace('/run-in');
          return;
        }
        const feasibility = pending?.feasibilitySnapshot ?? assessFeasibility(baseline);
        const screen = getFeasibilityScreenState(baseline, feasibility, setup);
        setAssessment({ setup, baseline, feasibility, screen });
        setDuration(pending?.chosenDuration ?? feasibility.defaultDuration);
        attemptRef.current = pending;
        setAttempt(pending);
        if (pending) setError('This plan is not confirmed on the server yet. Retry saving to confirm it.');
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : 'Could not load your log. Try again.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
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
        baseline: assessment.baseline, feasibility: assessment.feasibility,
        duration, today: getToday(), acknowledged, cutoffTime: assessment.setup.cutoffTime,
      });
      attemptRef.current = plan;
      setAttempt(plan);
      const stored = await savePlan(userId, plan);
      setSaved(stored.plan);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : 'Could not save the plan.'} Your test is not set yet. Retry saving the same plan.`);
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
  const keepState = state && (
    state.kind === 'cannot_assess' || state.kind === 'ineligible' || state.kind === 'not_informative'
  ) ? state : null;

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

  // The engine's own sentence for a negative verdict is kept word for word and shown
  // under Details, so the plain reason above never replaces it.
  const keepStatement = keepState && 'duration' in keepState && keepState.duration !== null
    ? assessment?.feasibility.options.find(option => option.duration === keepState.duration)?.statement ?? null
    : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          overline="AFTER 14 NIGHTS"
          title="Is this test worth doing?"
          notice="This app is not medical advice."
          action={<Button label="Home" variant="quiet" onPress={() => router.replace('/')} />}
        />
        {loading ? <Text accessibilityLiveRegion="polite">Loading your log…</Text> : null}
        {error ? <Text color="champagneLight" accessibilityRole="alert">{error}</Text> : null}
        {!loading && !state && !saved
          ? <Button label="Try again" onPress={() => { setLoading(true); setError(null); setReload(n => n + 1); }} />
          : null}
        {saved ? (
          <Card overline="ALL SET">
            <Text variant="titleSmall" accessibilityRole="header">Your test is set</Text>
            <Text accessibilityLiveRegion="polite">
              It starts on {saved.startDate} and runs for {saved.chosenDuration} days.
            </Text>
            <Text color="ivorySecondary">One short note a day, all the way through.</Text>
            <NavRow label="Back to my log" onPress={() => router.replace('/run-in')} />
          </Card>
        ) : !loading && state ? (
          <>
            {/* One verdict, one reason. */}
            <Card tone="hero">
              <Text variant="titleMedium" color="champagneLight" serif>{verdict}</Text>
              <Text variant="body" color="ivorySecondary">{reason}</Text>
            </Card>

            {startState ? (
              <>
                <Card overline="HOW LONG">
                  <Text variant="sub" color="ivorySecondary">Pick how many days to run it.</Text>
                  <View accessibilityRole="radiogroup" accessibilityLabel="Test length" style={styles.group}>
                    {startState.options.map(option => (
                      <Pressable
                        key={option.duration}
                        onPress={() => setDuration(option.duration)}
                        disabled={attempt !== null || saving}
                        accessibilityRole="radio"
                        accessibilityLabel={`${option.duration} days`}
                        aria-checked={duration === option.duration}
                        accessibilityState={{ checked: duration === option.duration, disabled: attempt !== null || saving }}
                        style={[styles.chip, duration === option.duration && styles.chipActive]}
                      >
                        <Text
                          variant="sub"
                          color={duration === option.duration ? 'ground' : 'ivory'}
                          weight="semiBold"
                        >
                          {option.duration} days
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </Card>

                {startState.requiresAcknowledgement ? (
                  <Pressable
                    onPress={() => setAcknowledged(value => !value)}
                    disabled={saving}
                    accessibilityRole="checkbox"
                    accessibilityLabel="I understand this test may tell me nothing."
                    aria-checked={acknowledged}
                    accessibilityState={{ checked: acknowledged, disabled: saving }}
                    style={styles.checkRow}
                  >
                    <Text>{acknowledged ? '☑' : '☐'} I understand this test may tell me nothing.</Text>
                  </Pressable>
                ) : null}

                <Button
                  label={attempt ? 'Try saving again' : 'Start the test'}
                  loading={saving}
                  disabled={!duration || (startState.requiresAcknowledgement && !acknowledged)}
                  onPress={() => void start()}
                />
                {!attempt ? <NavRow label="Not now" disabled={saving} onPress={() => router.replace('/run-in')} /> : null}

                <Details summary="The numbers behind this">
                  <Text variant="caption" color="ivoryMuted">{startState.simulationNote}</Text>
                  {startState.conservativeNote ? (
                    <Text variant="caption" color="ivorySecondary">{startState.conservativeNote}</Text>
                  ) : null}
                  {startState.options.map(option => (
                    <View key={option.duration} style={styles.factBlock}>
                      <Text variant="sub" color="champagneLight" weight="semiBold">{option.duration} days</Text>
                      <Text variant="caption" color="ivorySecondary">
                        {option.mdeLabel}: {option.numberQualifier === 'at least' ? 'at least ' : ''}
                        {typeof option.mdeDirectMinutes === 'number'
                          ? `${option.mdeDirectMinutes} minutes`
                          : option.mdeDirectMinutes === 'larger_than_60'
                          ? 'larger than 60 minutes'
                          : 'not available'}
                      </Text>
                      {option.mdeAssignedDayEquivalent !== null ? (
                        <Text variant="caption" color="ivorySecondary">
                          about {Math.round(option.mdeAssignedDayEquivalent)} minutes per cutoff day
                        </Text>
                      ) : null}
                      <Text variant="caption" color="ivorySecondary">{option.adherenceAssumptionText}</Text>
                      {option.statement !== null ? (
                        <Text variant="caption" color="ivorySecondary">{option.statement}</Text>
                      ) : null}
                    </View>
                  ))}
                  <Text variant="caption" color="ivorySecondary">
                    {assessment.feasibility.autocorrelationAssumptionText}
                  </Text>
                  {startState.startInstruction ? (
                    <Text variant="caption" color="ivorySecondary">{startState.startInstruction}</Text>
                  ) : null}
                </Details>
              </>
            ) : keepState ? (
              <>
                {/* One action: keep logging. The engine's own reasons stay under Details. */}
                <Button label={keepState.actions[0]} loading={saving} onPress={() => void recheck()} />
                <Details summary="What your log shows">
                  {'detailFacts' in keepState
                    ? keepState.detailFacts.map(fact => (
                        <Text key={fact} variant="caption" color="ivorySecondary">{fact}</Text>
                      ))
                    : null}
                  {keepState.reasons.map((line, index) => (
                    <Text key={index} variant="caption" color="ivorySecondary">{line}</Text>
                  ))}
                  {keepStatement ? (
                    <Text variant="caption" color="ivorySecondary">{keepStatement}</Text>
                  ) : null}
                </Details>
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
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  chip: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineBright,
    backgroundColor: colors.surfaceHigh,
  },
  chipActive: {
    backgroundColor: colors.champagne,
    borderColor: colors.champagneLight,
  },
  checkRow: {
    minHeight: 52,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  factBlock: { gap: 2, marginTop: spacing.sm },
});
