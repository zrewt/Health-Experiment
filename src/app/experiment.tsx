import React, { useCallback, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import {
  Details,
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
import { spacing } from '@/design/tokens';
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
import { validRunInDays } from '@/experiment/adapter';
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
      setError(e instanceof Error ? e.message : 'Could not load your test details.');
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
      // Counted over the new run-in window only: the test that just finished must not
      // decide that the next cycle already has its 14 nights.
      const validDays = validRunInDays(
        entries,
        [activePlan, ...historyPlans].filter((item): item is StoredExperimentPlan => item !== null).map(item => item.plan),
        today,
      );
      setNotice('Your last test is saved. Taking you to the next step.');
      router.push((validDays >= runInMinValidDays ? '/feasibility' : '/run-in') as Href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start another test.');
    } finally {
      setStartingCycle(false);
    }
  };

  return (
    <Screen>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline="YOUR SLEEP TEST"
          title="Your sleep test"
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

        {/* The current test and the one step that comes next. */}
        <Card tone="hero" overline="NOW">
          <Text variant="titleMedium" color="champagneLight" serif>
            {model.detail.name}
          </Text>
          <Text variant="body" color="ivorySecondary">
            {model.detail.purpose}
          </Text>

          <View style={styles.metaList}>
            <Row label="Cutoff time" value={model.detail.cutoffTime} />
            <Row label="Length" value={model.detail.durationText} />
            <Row
              label="Where you are"
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
              label="Start another test"
              variant="secondary"
              loading={startingCycle}
              onPress={() => void handleStartNewCycle()}
            />
          ) : null}
        </Card>

        {/* The explanation is worth reading once, not on every visit. */}
        <Card tone="quiet">
          <Disclosure label="How this works" summary="Three short steps">
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

        <Card overline="PAST TESTS">
          {model.savedExperiments.length === 0 ? (
            <Text variant="sub" color="ivoryMuted">
              No tests yet. Log 14 nights to find out whether a test is worth doing.
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
                <Row label="Cutoff time" value={saved.cutoffTime} />
                {saved.daysAnalyzed !== null ? (
                  <Row label="Days looked at" value={String(saved.daysAnalyzed)} />
                ) : null}

                {saved.verdictHeading ? (
                  <View style={styles.verdictSnippet}>
                    <Text variant="sub" color="champagne" weight="semiBold">
                      What we found: {saved.verdictHeading}
                    </Text>
                    {/* The engine's own sentence is kept word for word, under Details. */}
                    {saved.statement ? (
                      <Details summary="The exact wording">
                        <Text variant="caption" color="ivorySecondary">
                          {saved.statement}
                        </Text>
                      </Details>
                    ) : null}
                  </View>
                ) : null}

                {saved.status === 'completed' ? (
                  <NavRow
                    label="Read what we found"
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
  content: { gap: spacing.section, paddingBottom: spacing.section },
  metaList: {
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  step: {
    paddingVertical: spacing.sm,
    gap: 4,
  },
  savedItem: {
    gap: spacing.md,
  },
  verdictSnippet: {
    gap: 4,
  },
});
