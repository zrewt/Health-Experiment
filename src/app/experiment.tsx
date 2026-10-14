import React, { useCallback, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import {
  Screen,
  ScreenHeader,
  Card,
  Row,
  Divider,
  NavRow,
  Disclosure,
  Text,
  Button,
  PrimaryNav,
} from '@/components/ui';
import { colors, spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import {
  getConsent,
  getSetup,
  listEntries,
  getActivePlan,
  listExperimentPlans,
  archiveCompletedPlanForRepeat,
  type ConsentRecord,
  type ExperimentSetupRecord,
  type StoredDailyEntry,
} from '@/data/experiment-store';
import type { StoredExperimentPlan } from '@/data/plan-persistence';
import { getToday } from '@/experiment/clock';
import { getExperimentLifecycleModel } from '@/experiment/lifecycle';
import { runInMinValidDays } from '@/experiment/config';

export default function ExperimentScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const [loading, setLoading] = useState(true);
  const [startingCycle, setStartingCycle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [setup, setSetup] = useState<ExperimentSetupRecord | null>(null);
  const [entries, setEntries] = useState<StoredDailyEntry[]>([]);
  const [activePlan, setActivePlan] = useState<StoredExperimentPlan | null>(null);
  const [historyPlans, setHistoryPlans] = useState<StoredExperimentPlan[]>([]);

  const today = getToday();

  const loadLifecycle = useCallback(async () => {
    if (!user) return;
    try {
      const [loadedConsent, loadedSetup, loadedEntries, loadedActive, loadedHistory] =
        await Promise.all([
          getConsent(user.id),
          getSetup(user.id),
          listEntries(user.id),
          getActivePlan(user.id),
          listExperimentPlans(user.id),
        ]);
      setConsent(loadedConsent);
      setSetup(loadedSetup);
      setEntries(loadedEntries);
      setActivePlan(loadedActive);
      setHistoryPlans(loadedHistory);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load experiment details.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  // The focus effect also runs on mount (the screen is focused when it mounts), so a
  // separate mount effect would only fetch the same data twice.
  useFocusEffect(
    useCallback(() => {
      void loadLifecycle();
    }, [loadLifecycle]),
  );

  const model = getExperimentLifecycleModel({
    consent,
    setup,
    entries,
    activePlan,
    historyPlans,
    today,
  });

  const handleStartNewCycle = async () => {
    if (!user || startingCycle) return;
    setStartingCycle(true);
    setError(null);
    setNotice(null);
    try {
      if (activePlan && activePlan.status === 'completed') {
        await archiveCompletedPlanForRepeat(user.id, activePlan);
      }
      await loadLifecycle();
      const validDays = entries.filter((e) => e.sleepMinutes !== null).length;
      setNotice('Previous experiment saved to your history. You can now check feasibility or continue logging.');
      router.push((validDays >= runInMinValidDays ? '/feasibility' : '/run-in') as Href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start a new experiment cycle.');
    } finally {
      setStartingCycle(false);
    }
  };

  return (
    <Screen>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline="N-OF-1 SELF-EXPERIMENT"
          title="Experiment"
          notice={model.medicalNotice}
        />

        {error ? (
          <Card tone="danger">
            <Text color="garnet" accessibilityRole="alert">{error}</Text>
            <Button label="Retry" variant="quiet" onPress={() => void loadLifecycle()} />
          </Card>
        ) : null}

        {notice ? (
          <Card>
            <Text variant="sub" color="champagneLight" accessibilityLiveRegion="polite">
              {notice}
            </Text>
          </Card>
        ) : null}

        {/* The current experiment and the one step that comes next. */}
        <Card tone="hero" overline="CURRENT EXPERIMENT">
          <Text variant="titleMedium" color="champagneLight" serif>
            {model.detail.name}
          </Text>
          <Text variant="body" color="ivorySecondary">
            {model.detail.purpose}
          </Text>

          <View style={styles.metaList}>
            <Row label="Personal cutoff time" value={model.detail.cutoffTime} />
            <Row label="Duration" value={model.detail.durationText} />
            <Row
              label="Current stage"
              value={loading ? 'Loading...' : model.detail.stageLabel}
              emphasis="strong"
            />
          </View>

          <Text variant="sub" color="ivorySecondary">
            {model.detail.stageDescription}
          </Text>

          {model.detail.nextStepRoute ? (
            <Button
              label={model.detail.nextStepLabel}
              variant="primary"
              onPress={() => router.push(model.detail.nextStepRoute as Href)}
            />
          ) : null}

          {model.detail.canStartNewCycle && activePlan?.status === 'completed' ? (
            <Button
              label="Start a new caffeine experiment"
              variant="secondary"
              loading={startingCycle}
              onPress={() => void handleStartNewCycle()}
            />
          ) : null}
        </Card>

        {/* The explanation is worth reading once, not on every visit. */}
        <Card tone="quiet">
          <Disclosure label="How this experiment works" summary="Three stages from baseline to result">
            {model.guideSteps.map((step) => (
              <View key={step.stepNumber} style={styles.step}>
                <Text variant="sub" color="champagneLight" weight="semiBold">
                  {step.title}
                </Text>
                <Text variant="sub" color="ivorySecondary">
                  {step.description}
                </Text>
              </View>
            ))}
          </Disclosure>
        </Card>

        <Card overline="SAVED RESULTS & HISTORY">
          {model.savedExperiments.length === 0 ? (
            <Text variant="sub" color="ivoryMuted">
              No scheduled or completed experiments yet. Complete your 14-day baseline run-in and feasibility check to start your first experiment.
            </Text>
          ) : (
            model.savedExperiments.map((saved, index) => (
              <View key={saved.id} style={styles.savedItem}>
                {index > 0 ? <Divider /> : null}
                <Row
                  label="Dates"
                  value={`${saved.startDate} → ${saved.endDate} (${saved.chosenDuration}d)`}
                  emphasis="default"
                />
                <Row
                  label="Status"
                  value={saved.statusLabel}
                  emphasis={saved.status === 'completed' ? 'strong' : 'muted'}
                />
                <Row label="Cutoff" value={saved.cutoffTime} />
                {saved.daysAnalyzed !== null ? (
                  <Row label="Days analyzed" value={String(saved.daysAnalyzed)} />
                ) : null}

                {saved.verdictHeading ? (
                  <View style={styles.verdictSnippet}>
                    <Text variant="sub" color="champagne" weight="semiBold">
                      Verdict: {saved.verdictHeading}
                    </Text>
                    {saved.statement ? (
                      <Text variant="caption" color="ivorySecondary">
                        {saved.statement}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {saved.status === 'completed' ? (
                  <NavRow
                    label="Open saved result"
                    onPress={() => router.push(`/result?planId=${encodeURIComponent(saved.id)}` as Href)}
                  />
                ) : null}
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      <PrimaryNav current="experiment" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.lg },
  metaList: {
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
    gap: spacing.xs,
  },
  step: {
    paddingVertical: spacing.xs,
    gap: 2,
  },
  savedItem: {
    gap: spacing.xs,
  },
  verdictSnippet: {
    gap: 2,
  },
});
