import React, { useCallback, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import {
  Screen,
  ScreenHeader,
  Card,
  Text,
  Button,
  Banner,
  NavRow,
  PrimaryNav,
} from '@/components/ui';
import { spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import {
  getActivePlan,
  getConsent,
  getSetup,
  listExperimentPlans,
  saveSetup,
  type ConsentRecord,
  type ExperimentSetupRecord,
} from '@/data/experiment-store';
import type { StoredExperimentPlan } from '@/data/plan-persistence';
import {
  EXPERIMENTS,
  EXPERIMENT_IDS,
  experimentForRuleType,
  type ExperimentId,
} from '@/experiment/experiments';

const MEDICAL_NOTICE = 'This app is not medical advice.' as const;

export default function ChooseTestScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const [loading, setLoading] = useState(true);
  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [setup, setSetup] = useState<ExperimentSetupRecord | null>(null);
  const [activePlan, setActivePlan] = useState<StoredExperimentPlan | null>(null);
  const [history, setHistory] = useState<StoredExperimentPlan[]>([]);
  const [starting, setStarting] = useState<ExperimentId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [loadedConsent, loadedSetup, loadedActive, loadedHistory] = await Promise.all([
        getConsent(user.id),
        getSetup(user.id),
        getActivePlan(user.id),
        listExperimentPlans(user.id),
      ]);
      setConsent(loadedConsent);
      setSetup(loadedSetup);
      setActivePlan(loadedActive);
      setHistory(loadedHistory);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your tests.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // One test at a time: a running test blocks starting the other one.
  const runningId = activePlan && activePlan.status !== 'completed'
    ? experimentForRuleType(activePlan.plan.definition.conditionRule.type).id
    : null;

  const choose = async (id: ExperimentId) => {
    if (!user || starting) return;
    if (!setup || !consent) {
      // First run: setup-consent records consent and saves the test it was asked for, not the
      // caffeine default. It also catches the case where a setup row exists without consent.
      router.replace(`/setup-consent?id=${encodeURIComponent(id)}` as Href);
      return;
    }
    setStarting(id);
    setError(null);
    try {
      // Returning to the same test keeps its cutoff and its saved re-check. A different test
      // starts from its own default cutoff, and carries no deferral or screening answer
      // from the test it replaced: those answered a different question.
      const sameTest = setup.experimentId === id;
      const cutoffTime = sameTest ? setup.cutoffTime : EXPERIMENTS[id].defaultCutoff;
      await saveSetup(user.id, {
        ...setup,
        experimentId: id,
        cutoffTime,
        screeningAnswer: sameTest ? setup.screeningAnswer : 'usually',
        nextCheckDate: sameTest ? setup.nextCheckDate ?? null : null,
      });
      router.replace('/run-in' as Href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch tests. Try again.');
    } finally {
      setStarting(null);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline={setup ? 'Sleep tests' : 'Welcome'}
          title={setup ? 'Choose a test' : 'Pick your first test'}
          notice={MEDICAL_NOTICE}
        />

        {!setup && !loading ? (
          <Text variant="body" color="textMuted">
            You can run the other test later. Only one runs at a time.
          </Text>
        ) : null}

        {error ? <Banner tone="error">{error}</Banner> : null}

        {runningId ? (
          <Banner tone="info">
            {`${EXPERIMENTS[runningId].name} is running. Finish or stop it before you start another.`}
          </Banner>
        ) : null}

        {EXPERIMENT_IDS.map((id) => {
          const info = EXPERIMENTS[id];
          const isRunning = runningId === id;
          const finishedBefore = history.some(
            (item) => item.status === 'completed' && experimentForRuleType(item.plan.definition.conditionRule.type).id === id,
          );
          const blocked = runningId !== null && !isRunning;
          const status = isRunning ? 'Running' : finishedBefore ? 'Finished before' : 'Not run yet';
          return (
            <Card key={id} tone={isRunning ? 'hero' : 'tint'} title={info.name}>
              <Text variant="body" color="textMuted">{info.whatYouDo}</Text>
              <View style={styles.meta}>
                <Text variant="sub" color="textMuted">Status: {loading ? 'Loading...' : status}</Text>
                <Text variant="sub" color="textMuted">Default cutoff: {info.defaultCutoff}</Text>
              </View>
              {isRunning ? (
                <NavRow label="Open this test" onPress={() => router.replace('/experiment' as Href)} />
              ) : (
                <Button
                  label={`Start the ${info.name.toLowerCase()} test`}
                  variant="primary"
                  disabled={blocked || loading}
                  loading={starting === id}
                  onPress={() => void choose(id)}
                />
              )}
            </Card>
          );
        })}

        {setup ? (
          <NavRow label="Back to my sleep test" onPress={() => router.replace('/experiment' as Href)} />
        ) : null}
      </ScrollView>
      {setup ? <PrimaryNav current="experiment" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.section, paddingBottom: spacing.section },
  meta: { gap: spacing.xs, paddingVertical: spacing.sm },
});
