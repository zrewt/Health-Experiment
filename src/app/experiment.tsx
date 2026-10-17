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
  Banner,
  SplitDisc,
  type DiscTone,
} from '@/components/ui';
import { spacing } from '@/design/tokens';
import { sentenceCase } from '@/design/labels';
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
import { buildCycleComparison } from '@/experiment/cycle-comparison';

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
      // The choose screen owns the next step: it starts the other test's own run-in, or
      // re-enters the same one, so the finished test's nights never carry over.
      setNotice('Your last test is saved. Pick what to try next.');
      router.push('/choose-test' as Href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start another test.');
    } finally {
      setStartingCycle(false);
    }
  };

  // Only finished tests are compared, so the card never shows a test that is still running.
  const comparison = buildCycleComparison(
    [activePlan, ...historyPlans].filter((item): item is StoredExperimentPlan => item !== null),
  );

  const discTone: DiscTone =
    model.state === 'plan_active'
      ? 'cutoff'
      : model.state === 'run_in' ||
        model.state === 'feasibility_ready' ||
        model.state === 'plan_result_ready'
      ? 'normal'
      : 'none';

  return (
    <Screen>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          overline={sentenceCase('YOUR SLEEP TEST')}
          title="Your sleep test"
          notice={model.medicalNotice}
        />

        {error ? (
          <Banner
            tone="error"
            action={<Button label="Retry" variant="quiet" onPress={() => void loadLifecycle()} />}
          >
            {error}
          </Banner>
        ) : null}

        {notice ? <Banner tone="success">{notice}</Banner> : null}

        {/* The current test and the one step that comes next. */}
        <Card tone="hero" overline={sentenceCase('NOW')}>
          <View style={styles.heroRow}>
            <SplitDisc size={72} tone={discTone} />
            <View style={styles.heroText}>
              <Text variant="title" accessibilityRole="header">
                {model.detail.name}
              </Text>
              <Text variant="body" color="textMuted">
                {model.detail.purpose}
              </Text>
            </View>
          </View>

          <View style={styles.metaList}>
            <Row label="Cutoff time" value={model.detail.cutoffTime} />
            <Row label="Length" value={model.detail.durationText} />
            <Row
              label="Where you are"
              value={loading ? 'Loading...' : model.detail.stageLabel}
              emphasis="strong"
            />
          </View>

          <Text variant="sub" color="textMuted">
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
                <Text variant="sub" color="accent" weight="semiBold">
                  {step.title}
                </Text>
                <Text variant="sub" color="textMuted">
                  {step.description}
                </Text>
              </View>
            ))}
          </Disclosure>
        </Card>

        {comparison ? (
          <Card tone="tint" overline={sentenceCase('COMPARE YOUR TESTS')}>
            {comparison.rows.map((row, index) => (
              <View key={row.id} style={styles.savedItem}>
                {index > 0 ? <Divider /> : null}
                <Row label="Test" value={row.testName} />
                <Row label="Test starting" value={row.startDate} emphasis="default" />
                <Row label="Cutoff time" value={row.cutoffTime} />
                <Row
                  label="Rule followed"
                  value={
                    row.ruleFollowedDays === null
                      ? 'Not recorded'
                      : `${row.ruleFollowedDays} of ${row.plannedDays} days`
                  }
                />
                <Row
                  label="Sleep estimate"
                  value={
                    row.sleepEstimateMinutes === null
                      ? 'Could not be worked out'
                      : `${row.sleepEstimateMinutes} min a night more on cutoff days`
                  }
                />
              </View>
            ))}
            <View style={styles.emptyBlock}>
              {comparison.sentences.map(sentence => (
                <Text key={sentence} variant="sub" color="textMuted">
                  {sentence}
                </Text>
              ))}
            </View>
          </Card>
        ) : null}

        <Card tone="tint" overline={sentenceCase('PAST TESTS')}>
          {model.savedExperiments.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Text variant="sub" color="textMuted">
                No finished tests yet. Log 14 nights to find out whether a test is worth doing.
              </Text>
              {model.detail.nextStepRoute ? (
                <NavRow
                  label={model.detail.nextStepLabel}
                  onPress={() => router.push(model.detail.nextStepRoute as Href)}
                />
              ) : null}
            </View>
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
                    <Text variant="sub" color="accent" weight="semiBold">
                      What we found: {saved.verdictHeading}
                    </Text>
                    {/* The engine's own sentence is kept word for word, under Details. */}
                    {saved.statement ? (
                      <Details summary="The exact wording">
                        <Text variant="caption" color="textMuted">
                          {saved.statement}
                        </Text>
                      </Details>
                    ) : null}
                  </View>
                ) : null}

                {saved.status === 'completed' ? (
                  <NavRow
                    label="Read what we found"
                    onPress={() =>
                      router.push(`/result?planId=${encodeURIComponent(saved.id)}` as Href)
                    }
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
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroText: {
    flex: 1,
    gap: spacing.xs,
  },
  metaList: {
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  step: {
    paddingVertical: spacing.sm,
    gap: 4,
  },
  emptyBlock: {
    gap: spacing.sm,
  },
  savedItem: {
    gap: spacing.md,
  },
  verdictSnippet: {
    gap: 4,
  },
});
