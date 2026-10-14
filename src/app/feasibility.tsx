import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, ScreenHeader, Card, NavRow, Text, Button } from '@/components/ui';
import { colors, spacing } from '@/design/tokens';
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
        if (current) setError(e instanceof Error ? e.message : 'Could not load feasibility. Please retry.');
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
      setError(`${e instanceof Error ? e.message : 'Could not save the plan.'} Your experiment is not confirmed. Retry saving the same plan.`);
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
      setError(e instanceof Error ? e.message : 'Could not save the re-check date. Please retry.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const state = assessment?.screen;
  const startable = state?.kind === 'informative' || state?.kind === 'long_shot';
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          overline="BASELINE COMPLETE"
          title="Feasibility & commitment"
          notice={
            startable && !saved
              ? 'Approximate — this app is not medical advice.'
              : 'This app is not medical advice.'
          }
          action={<Button label="Today" variant="quiet" onPress={() => router.replace('/')} />}
        />
        {loading ? <Text accessibilityLiveRegion="polite">Loading your log…</Text> : null}
        {error ? <Text color="champagneLight" accessibilityRole="alert">{error}</Text> : null}
        {!loading && !state && !saved ? <Button label="Retry loading" onPress={() => { setLoading(true); setError(null); setReload(n => n + 1); }} /> : null}
        {saved ? (
          <Card>
            <Text variant="titleSmall" accessibilityRole="header">Experiment scheduled</Text>
            <Text accessibilityLiveRegion="polite">Your experiment is scheduled to start on {saved.startDate} and runs for {saved.chosenDuration} days.</Text>
            <Text color="ivorySecondary">Daily instructions arrive in the next app update.</Text>
            <NavRow label="Back to check-in" onPress={() => router.replace('/run-in')} />
          </Card>
        ) : !loading && state ? (
          <>
            {!startable && state.message ? <Text>{state.message}</Text> : null}
            {'reasons' in state ? (
              <Card>
                <Text variant="titleSmall" accessibilityRole="header">{state.detailsHeading}</Text>
                {state.reasons.map((reason, index) => <Text key={index} color="ivorySecondary">{reason}</Text>)}
                {'detailFacts' in state ? state.detailFacts.map(fact => <Text key={fact}>{fact}</Text>) : null}
              </Card>
            ) : null}
            {startable ? (
              <>
                <Text color="ivorySecondary">{state.simulationNote}</Text>
                {state.conservativeNote ? <Text>{state.conservativeNote}</Text> : null}
                <Text variant="titleSmall" accessibilityRole="header">Choose a duration</Text>
                <View accessibilityRole="radiogroup" accessibilityLabel="Experiment duration" style={styles.group}>
                  {state.options.map(option => (
                    <Card key={option.duration} style={duration === option.duration ? styles.selected : undefined}>
                      <Pressable
                        onPress={() => setDuration(option.duration)} disabled={attempt !== null || saving}
                        accessibilityRole="radio" accessibilityLabel={`${option.duration} days`}
                        aria-checked={duration === option.duration}
                        accessibilityState={{ checked: duration === option.duration, disabled: attempt !== null || saving }}
                        style={styles.choice}
                      >
                        <Text color="champagneLight" weight="semiBold">{duration === option.duration ? '●' : '○'} {option.duration} days</Text>
                      </Pressable>
                      {option.statement !== null ? <Text>{option.statement}</Text> : null}
                      <Text color="ivorySecondary">
                        {option.mdeLabel}: {option.numberQualifier === 'at least' ? 'at least ' : ''}
                        {typeof option.mdeDirectMinutes === 'number' ? `${option.mdeDirectMinutes} minutes`
                          : option.mdeDirectMinutes === 'larger_than_60' ? 'larger than 60 minutes' : 'not available'}
                      </Text>
                      {option.mdeAssignedDayEquivalent !== null ? <Text color="ivorySecondary">about {Math.round(option.mdeAssignedDayEquivalent)} minutes per assigned day</Text> : null}
                      <Text color="ivorySecondary">{option.adherenceAssumptionText}</Text>
                      <Text color="ivorySecondary">{assessment.feasibility.autocorrelationAssumptionText}</Text>
                    </Card>
                  ))}
                </View>
                <Text>{state.startInstruction}</Text>
                {state.requiresAcknowledgement ? (
                  <Pressable onPress={() => setAcknowledged(value => !value)} disabled={saving}
                    accessibilityRole="checkbox" accessibilityLabel="I understand this experiment will probably be inconclusive."
                    aria-checked={acknowledged}
                    accessibilityState={{ checked: acknowledged, disabled: saving }} style={styles.choice}>
                    <Text>{acknowledged ? '☑' : '☐'} I understand this experiment will probably be inconclusive.</Text>
                  </Pressable>
                ) : null}
                <Button label={attempt ? 'Retry saving plan' : 'Start experiment'} loading={saving}
                  disabled={!duration || (state.requiresAcknowledgement && !acknowledged)} onPress={() => void start()} />
                {!attempt ? <NavRow label="Not now" disabled={saving} onPress={() => router.replace('/run-in')} /> : null}
              </>
            ) : (
              <>
                <Button label="Keep logging; re-check in 7 days" loading={saving} onPress={() => void recheck()} />
                <NavRow label="Not now" disabled={saving} onPress={() => router.replace('/run-in')} />
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xxl },
  group: { gap: spacing.md },
  selected: { borderColor: colors.champagne },
  choice: { minHeight: 48, justifyContent: 'center', paddingVertical: spacing.sm },
});
