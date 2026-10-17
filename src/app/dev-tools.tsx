import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { useFocusEffect, useRouter, Redirect } from 'expo-router';
import { Screen, ScreenHeader, Card, Text, Button, Banner } from '@/components/ui';
import { spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import { getToday, __setDevClockOffset, __getDevClockOffset } from '@/experiment/clock';
import {
  loadSampleRunIn,
  loadSampleExperimentEntries,
  deleteSampleEntries,
} from '@/dev/sample-loader';
import { buildDevDiagnostics, type DevDiagnostics } from '@/dev/dev-diagnostics';
import {
  getActivePlan,
  getConsent,
  getSetup,
  listEntries,
  listExperimentPlans,
  resetCompletedPlan,
  saveSetup,
  type ExperimentSetupRecord,
} from '@/data/experiment-store';
import { addDaysToLocalDate, daysBetween, formatLocalDate } from '@/experiment/dates';
import {
  EXPERIMENTS,
  experimentById,
  exposureForExperimentId,
  type ExperimentId,
} from '@/experiment/experiments';
import { runInMinValidDays } from '@/experiment/config';
import { entriesForPlan } from '@/experiment/adapter';

const RUN_IN_DAYS = 14;

export default function DevToolsScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [offset, setOffset] = useState<number>(__getDevClockOffset());
  const [setup, setSetup] = useState<ExperimentSetupRecord | null>(null);
  const [diagnostics, setDiagnostics] = useState<DevDiagnostics | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setSetup(null);
      setDiagnostics(null);
      return;
    }
    setRefreshing(true);
    try {
      const [consent, loadedSetup, entries, plans, plan] = await Promise.all([
        getConsent(user.id),
        getSetup(user.id),
        listEntries(user.id),
        listExperimentPlans(user.id),
        getActivePlan(user.id),
      ]);
      setSetup(loadedSetup);
      setDiagnostics(buildDevDiagnostics({
        consent,
        setup: loadedSetup,
        entries,
        plans,
        plan,
        today: getToday(),
      }));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not read this account.');
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // Fail closed: this screen renders only when __DEV__ is strictly true. All hooks above
  // this line, so the guard never changes the hook order between builds.
  if (typeof __DEV__ === 'undefined' || __DEV__ !== true) {
    return <Redirect href="/" />;
  }

  const activeExperiment: ExperimentId = setup?.experimentId === 'screens-off-cutoff'
    ? 'screens-off-cutoff'
    : 'caffeine-cutoff';
  const activeInfo = experimentById(activeExperiment);

  const confirm = (title: string, message: string): Promise<boolean> =>
    Platform.OS === 'web'
      ? Promise.resolve(window.confirm(message))
      : new Promise<boolean>((resolve) => {
          Alert.alert(title, message, [
            { text: 'Cancel', onPress: () => resolve(false), style: 'cancel' },
            { text: 'Confirm', onPress: () => resolve(true) },
          ]);
        });

  const handleShift = (delta: number) => {
    const next = delta === 0 ? 0 : offset + delta;
    __setDevClockOffset(next);
    setOffset(next);
    setStatus(`Clock shifted. Offset: ${next} days (Today: ${getToday()})`);
    void refresh();
  };

  /** Points setup at one test and loads a fresh 14-night run-in for it. */
  const handlePrepareRunIn = async (id: ExperimentId) => {
    if (!user) {
      setStatus('Must be signed in to load sample data.');
      return;
    }
    const plan = await getActivePlan(user.id);
    if (plan) {
      setStatus('Finish or reset the running test before preparing a new run-in.');
      return;
    }
    const info = EXPERIMENTS[id];
    const proceed = await confirm(
      'Load Fake Run-in',
      `This writes ${RUN_IN_DAYS} ${info.exposureWord} nights for ${user.email || 'this account'} and points setup at ${info.name}. Proceed?`,
    );
    if (!proceed) return;

    setLoading(true);
    try {
      await saveSetup(user.id, {
        experimentId: id,
        cutoffTime: info.defaultCutoff,
        screeningAnswer: setup?.screeningAnswer ?? 'usually',
        runInStartDate: addDaysToLocalDate(getToday(), -RUN_IN_DAYS),
        nextCheckDate: null,
      });
      const count = await loadSampleRunIn(user.id, exposureForExperimentId(id));
      setStatus(`${info.name}: setup saved and ${count} sample nights loaded. Today should offer the check.`);
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Error preparing the run-in.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSample = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const count = await deleteSampleEntries(user.id);
      setStatus(`Deleted ${count} sample entries.`);
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Error deleting sample entries.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSampleExperiment = async () => {
    if (!user) return;
    const planRec = await getActivePlan(user.id);
    if (!planRec) {
      setStatus('No active plan found. Start a test first.');
      return;
    }
    if (planRec.status === 'completed') {
      setStatus('This test is already finished, and its days are locked. Reset it first if you want to load sample days.');
      return;
    }
    const planInfo = experimentById(experimentForRuleTypeSafe(planRec.plan.definition.conditionRule.type));
    const proceed = await confirm(
      'Load Test Data',
      `This writes sample ${planInfo.exposureWord} entries for every scheduled day of ${planInfo.name}. Proceed?`,
    );
    if (!proceed) return;

    setLoading(true);
    try {
      const count = await loadSampleExperimentEntries(user.id, planRec.plan);
      // Read back what the app can actually see, not just what the write returned: a
      // schema or lock problem must never look like a successful load.
      const visible = entriesForPlan(planRec.plan, await listEntries(user.id)).length;
      setStatus(
        visible > 0
          ? `Loaded ${count} sample test days for ${planInfo.name}. ${visible} of ${planRec.plan.chosenDuration} test days are now logged.`
          : 'Sample days were written, but none came back for this test. Check the database schema, then try again.',
      );
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Error loading sample experiment entries.');
    } finally {
      setLoading(false);
    }
  };

  const handleJumpToEPlusOne = async () => {
    if (!user) return;
    const planRec = await getActivePlan(user.id);
    if (!planRec) {
      setStatus('No active plan found.');
      return;
    }
    const lastExposureDate = planRec.plan.schedule[planRec.plan.schedule.length - 1]?.date;
    if (!lastExposureDate) return;

    // Jumping an empty test to its end only produces a "0 of 42 days" screen. Offer to
    // load the fixture days first, so the jump always lands on a test worth reading.
    if (entriesForPlan(planRec.plan, await listEntries(user.id)).length === 0) {
      if (planRec.status === 'completed') {
        setStatus('This test is already finished but has no logged days. Reset it first, then load sample days.');
        return;
      }
      const loadFirst = await confirm(
        'No test days logged',
        `No nights are logged for this test yet, so its end screen would say 0 of ${planRec.plan.chosenDuration}. Load sample days for every scheduled day first?`,
      );
      if (!loadFirst) return;
      try {
        const count = await loadSampleExperimentEntries(user.id, planRec.plan);
        setStatus(`Loaded ${count} sample test days.`);
        await refresh();
      } catch (e) {
        setStatus(e instanceof Error ? e.message : 'Error loading sample experiment entries.');
        return;
      }
    }

    const target = addDaysToLocalDate(lastExposureDate, 1);
    // Local, not UTC: getToday() (which this offset is applied to) is a local calendar
    // date, so a UTC basis lands the jump a day out for part of every day.
    const now = new Date();
    const realToday = formatLocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
    // The offset is relative to the real clock, so remove any shift already in place.
    const diff = daysBetween(realToday, target);
    __setDevClockOffset(diff);
    setOffset(diff);
    const logged = entriesForPlan(planRec.plan, await listEntries(user.id)).length;
    setStatus(
      `Clock jumped to E+1 (${target}). Offset: ${diff} days. ${logged} of ${planRec.plan.chosenDuration} test days logged.`,
    );
    void refresh();
  };

  const handleResetCompleted = async () => {
    if (!user) return;
    const planRec = await getActivePlan(user.id);
    if (!planRec) {
      setStatus('No plan found to reset.');
      return;
    }
    setLoading(true);
    try {
      await resetCompletedPlan(user.id, planRec.id);
      setStatus('Reset completed plan back to scheduled.');
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Error resetting plan.');
    } finally {
      setLoading(false);
    }
  };

  const rows = diagnostics?.rows ?? [];
  const runInRow = rows.find(row => row.label === 'Valid run-in nights');

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          overline="Internal testing only"
          title="Dev Tools"
          notice="Excluded from production builds."
          action={
            <Button
              label="Today"
              variant="quiet"
              onPress={() => router.replace('/')}
            />
          }
        />

        {status ? <Banner tone="info">{status}</Banner> : null}

        <Card tone="hero" overline="What the app sees" title={diagnostics?.headline ?? 'Reading account…'}>
          {diagnostics ? (
            <>
              {rows.map(row => (
                <View key={row.label} style={styles.diagRow}>
                  <Text variant="caption" color="textMuted">{row.label}</Text>
                  <Text variant="sub" tabular style={styles.diagValue}>{row.value}</Text>
                </View>
              ))}
              {diagnostics.warnings.map(warning => (
                <Text key={warning} variant="caption" color="signalText">• {warning}</Text>
              ))}
              <Button
                label={refreshing ? 'Refreshing…' : 'Refresh'}
                variant="quiet"
                loading={refreshing}
                onPress={() => void refresh()}
              />
            </>
          ) : (
            <Text variant="sub" color="textMuted">
              {user ? 'No readable state yet. Tap Refresh.' : 'Sign in to read this account.'}
            </Text>
          )}
        </Card>

        <Card tone="tint" overline="Simulated clock" title="Time travel">
          <Text variant="sub" color="textMuted" tabular>
            Effective Today: {getToday()}
          </Text>
          <Text variant="caption" color="textMuted" tabular>
            Offset: {offset} days
          </Text>
          <View style={styles.row}>
            <Button label="+1 Day" variant="secondary" onPress={() => handleShift(1)} />
            <Button label="+7 Days" variant="secondary" onPress={() => handleShift(7)} />
            <Button label="Reset (0)" variant="quiet" onPress={() => handleShift(0)} />
          </View>
        </Card>

        <Card tone="default" overline="Scenarios" title="Start from a known state">
          <Text variant="caption" color="textMuted">
            Each button points setup at that test and loads {RUN_IN_DAYS} logged nights ending
            yesterday, so the check should be ready (needs {runInMinValidDays} valid nights).
          </Text>
          <Button
            label={`Prepare ${EXPERIMENTS['caffeine-cutoff'].name} run-in`}
            variant="primary"
            loading={loading}
            onPress={() => void handlePrepareRunIn('caffeine-cutoff')}
          />
          <Button
            label={`Prepare ${EXPERIMENTS['screens-off-cutoff'].name} run-in`}
            variant="secondary"
            loading={loading}
            onPress={() => void handlePrepareRunIn('screens-off-cutoff')}
          />
          {runInRow ? (
            <Text variant="caption" color="textMuted">
              Now: {activeInfo.name}, {runInRow.value} valid run-in nights.
            </Text>
          ) : null}
        </Card>

        <Card tone="tint" overline="Fixtures" title="Sample data">
          <Text variant="sub" color="textMuted">
            User: {user?.email || 'None'}
          </Text>
          <Text variant="caption" color="textMuted">
            Rows are marked as samples, so Delete sample entries removes only these.
          </Text>
          <Button
            label={`Load test days (${activeInfo.name})`}
            variant="primary"
            loading={loading}
            onPress={() => void handleLoadSampleExperiment()}
          />
          <Button
            label="Jump to last day + 1"
            variant="secondary"
            onPress={() => void handleJumpToEPlusOne()}
          />
          <Button
            label="Reset completed plan"
            variant="secondary"
            loading={loading}
            onPress={() => void handleResetCompleted()}
          />
          <Button
            label="Delete sample entries"
            variant="quiet"
            loading={loading}
            onPress={() => void handleDeleteSample()}
          />
        </Card>

        <Button
          label="Back to Today"
          variant="secondary"
          onPress={() => router.replace('/')}
        />
      </ScrollView>
    </Screen>
  );
}

/** The rule type on a plan is a plain string; unknown values fall back to the caffeine test. */
function experimentForRuleTypeSafe(ruleType: string | undefined): ExperimentId {
  return ruleType === 'screen-cutoff' ? 'screens-off-cutoff' : 'caffeine-cutoff';
}

const styles = StyleSheet.create({
  content: { gap: spacing.section, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  diagValue: { flexShrink: 1, textAlign: 'right' },
});
