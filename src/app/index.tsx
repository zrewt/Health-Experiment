import { useCallback, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import {
  Screen,
  Card,
  NavRow,
  StatStrip,
  Text,
  Button,
  Details,
  PrimaryNav,
  Banner,
  SplitDisc,
  type DiscTone,
} from '@/components/ui';
import { spacing } from '@/design/tokens';
import { readTodayType, sentenceCase } from '@/design/labels';
import { useAuthStore } from '@/store/auth';
import {
  getConsent,
  getSetup,
  listEntries,
  getActivePlan,
  listExperimentPlans,
  saveEntry,
  syncUnsyncedEntries,
  type ConsentRecord,
  type ExperimentSetupRecord,
  type StoredDailyEntry,
} from '@/data/experiment-store';
import type { StoredExperimentPlan } from '@/data/plan-persistence';
import { getToday } from '@/experiment/clock';
import { getTodayDashboardModel } from '@/experiment/today-dashboard';
import type { DailyEntry } from '@/experiment/types';
import { extractCutoffTime } from '@/experiment/lifecycle';
import { entriesForRunIn } from '@/experiment/adapter';
import { addDaysToLocalDate } from '@/experiment/dates';
import {
  buildCheckInReceipt,
  buildRunInRecap,
  PAIRS_EXPLANATION,
} from '@/experiment/wait-value';
import { CheckInCard } from '@/components/CheckInCard';
import { CheckInReceiptCard } from '@/components/CheckInReceiptCard';
import { NightTracker } from '@/components/NightTracker';
import { progressSentence } from '@/experiment/plain-language';
import { exposureValue } from '@/experiment/experiments';
import { syncReminders } from '@/notifications/reminders';
import { routeForHomeState } from '@/notifications/tap-target';

/**
 * Set once a brand-new account has been sent into setup in this app session. Without it,
 * backing out of setup to Home would send the user straight back into it.
 */
let autoSetupRouted = false;

export default function HomeScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const [loadingData, setLoadingData] = useState(true);
  const [savingEntry, setSavingEntry] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [previousEntrySnapshot, setPreviousEntrySnapshot] = useState<DailyEntry | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);

  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [setup, setSetup] = useState<ExperimentSetupRecord | null>(null);
  const [entries, setEntries] = useState<StoredDailyEntry[]>([]);
  const [plan, setPlan] = useState<StoredExperimentPlan | null>(null);
  // Every saved plan, so the run-in counters can ignore the days of an earlier test.
  const [savedPlans, setSavedPlans] = useState<StoredExperimentPlan[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // The check-in form is shown only when it is needed: last night is not logged
  // yet, or the user explicitly asked to edit. A completed morning otherwise
  // reads as a summary line.
  const [editingCheckIn, setEditingCheckIn] = useState(false);
  const [showEarlierDays, setShowEarlierDays] = useState(false);

  const today = getToday();

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    try {
      const [loadedConsent, loadedSetup, loadedEntries, loadedPlan, loadedPlans] = await Promise.all([
        getConsent(user.id),
        getSetup(user.id),
        listEntries(user.id),
        getActivePlan(user.id),
        listExperimentPlans(user.id),
      ]);
      setConsent(loadedConsent);
      setSetup(loadedSetup);
      setEntries(loadedEntries);
      setPlan(loadedPlan);
      setSavedPlans(loadedPlans);
      setError('');

      // An account that has never answered the consent question is new: it goes straight
      // into onboarding, so it starts right after sign-up without a tap on Home. The first
      // step is choosing which test to run, never a default one picked for the user.
      if (loadedConsent === null && !autoSetupRouted) {
        autoSetupRouted = true;
        router.replace('/choose-test');
        return;
      }

      const model = getTodayDashboardModel({
        consent: loadedConsent,
        setup: loadedSetup,
        entries: loadedEntries,
        plan: loadedPlan,
        plans: loadedPlans.map(item => item.plan),
        today,
      });

      setSelectedDate((prev) => {
        if (prev && model.checkIn.recentDays.some((d) => d.date === prev && d.editable)) {
          return prev;
        }
        return model.checkIn.defaultDate;
      });

      // Keep the scheduled reminder in step with the state. This resolves to an outcome
      // rather than throwing, so a notification problem can never break the home screen.
      const reminder = await syncReminders({
        state: model.state,
        today,
        plan: loadedPlan
          ? {
              startDate: loadedPlan.plan.startDate,
              chosenDuration: loadedPlan.plan.chosenDuration,
              schedule: loadedPlan.plan.schedule,
              conditionRule: loadedPlan.plan.definition.conditionRule,
            }
          : null,
      });
      setReminderNotice(
        reminder.status === 'skipped' && reminder.permission === 'denied'
          ? 'Daily reminders are off. Turn on notifications in Settings to get a nudge.'
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not determine status.');
    } finally {
      setLoadingData(false);
    }
  }, [user, today, router]);

  // The focus effect also runs on mount (the screen is focused when it mounts), so a
  // separate mount effect would only fetch the same data twice.
  useFocusEffect(
    useCallback(() => {
      void loadDashboard();
    }, [loadDashboard]),
  );

  const dashboard = getTodayDashboardModel({
    consent,
    setup,
    entries,
    plan,
    plans: savedPlans.map(item => item.plan),
    today,
  });

  const activeCheckInDate =
    selectedDate && dashboard.checkIn.recentDays.some((d) => d.date === selectedDate)
      ? selectedDate
      : dashboard.checkIn.defaultDate;
  const activeDayItem = dashboard.checkIn.recentDays.find((d) => d.date === activeCheckInDate);
  const canEditActiveDate = activeDayItem ? activeDayItem.editable : true;

  const lastNightLogged = dashboard.checkIn.status === 'logged';
  const activeCutoff = plan
    ? extractCutoffTime(plan.plan)
    : setup?.cutoffTime ?? null;

  // Run-in only: these nights are not test days, so a range and a usual are honest here.
  const runInEntries = entriesForRunIn(entries, savedPlans.map((item) => item.plan), today);
  const recap = buildRunInRecap(runInEntries, today);

  // The receipt repeats the night the user logged and counts only. During a test it never
  // touches another test night's sleep, and it never compares day types.
  const receiptEntry = entries.find(
    (item) => item.date === dashboard.checkIn.defaultDate && item.sleepMinutes !== null,
  );
  const schedule = plan?.plan.schedule ?? [];
  const lastNightIsTestDay = schedule.some((day) => day.date === dashboard.checkIn.defaultDate);
  const yesterday = addDaysToLocalDate(today, -1);
  const runInWindowDates: string[] = [];
  for (let index = 0; index < 14; index++) {
    const date = addDaysToLocalDate(yesterday, -index);
    if (setup?.runInStartDate && date < setup.runInStartDate) break;
    runInWindowDates.unshift(date);
  }
  const testWindowDates = schedule.filter((day) => day.date <= today).map((day) => day.date);
  const receipt = lastNightLogged && receiptEntry && !editingCheckIn && dashboard.checkIn.enabled
    ? buildCheckInReceipt({
        entry: receiptEntry,
        entries,
        windowDates: lastNightIsTestDay ? testWindowDates : runInWindowDates,
        cutoffDates: lastNightIsTestDay
          ? schedule.filter((day) => day.date <= today && day.condition === 'intervention').map((day) => day.date)
          : null,
        exposure: dashboard.checkIn.exposure,
        cutoffTime: activeCutoff,
      })
    : null;
  const checkInFormVisible =
    !loadingData && dashboard.checkIn.enabled && (!lastNightLogged || editingCheckIn);
  const earlierUnlogged = dashboard.checkIn.recentDays
    .slice(1)
    .filter((d) => d.editable && d.statusTone !== 'logged');

  // Presentation only: during a test the disc carries today's type, and the text label
  // beside it is what makes the mark readable in greyscale.
  const todayType =
    dashboard.state === 'plan_active' ? readTodayType(dashboard.instruction.heading) : null;
  const discTone: DiscTone = todayType?.kind ?? 'none';

  const handleSaveCheckIn = async (entry: DailyEntry) => {
    if (!user) return;
    const prevExisting = entries.find((e) => e.date === entry.date);
    setPreviousEntrySnapshot(
      prevExisting
        ? {
            date: prevExisting.date,
            sleepMinutes: prevExisting.sleepMinutes,
            lastCaffeineTime: prevExisting.lastCaffeineTime,
            lastScreenTime: prevExisting.lastScreenTime ?? null,
          }
        : {
            date: entry.date,
            sleepMinutes: null,
            lastCaffeineTime: null,
            lastScreenTime: null,
          },
    );
    setSavingEntry(true);
    setSaveMessage(null);
    setSyncNotice(null);
    setError('');
    try {
      const saved = await saveEntry(user.id, entry);
      setEntries((prev) => {
        const next = prev.filter((e) => e.date !== entry.date);
        next.push(saved);
        return next.sort((a, b) => a.date.localeCompare(b.date));
      });
      // Collapse back to the summary line: the check-in is done.
      setEditingCheckIn(false);
      setShowEarlierDays(false);
      if (saved.synced === false) {
        setSyncNotice('Saved on this device. Syncing now...');
        void syncUnsyncedEntries(user.id)
          .then(async (res) => {
            const refreshed = await listEntries(user.id);
            setEntries(refreshed);
            if (res.failedCount === 0) {
              setSyncNotice(null);
              setSaveMessage('Saved.');
            } else {
              setSyncNotice(`${res.failedCount} entr${res.failedCount === 1 ? 'y' : 'ies'} saved on this device.`);
            }
          })
          .catch(() => {
            setSyncNotice('Saved on this device. You can try syncing again any time.');
          });
      } else {
        setSaveMessage('Saved.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setSavingEntry(false);
    }
  };

  const handleUndoCheckIn = async () => {
    if (!user || !previousEntrySnapshot || savingEntry) return;
    setSavingEntry(true);
    setError('');
    try {
      const restored = await saveEntry(user.id, previousEntrySnapshot);
      setEntries((prev) => {
        const next = prev.filter((e) => e.date !== previousEntrySnapshot.date);
        next.push(restored);
        return next.sort((a, b) => a.date.localeCompare(b.date));
      });
      setSelectedDate(previousEntrySnapshot.date);
      setPreviousEntrySnapshot(null);
      setEditingCheckIn(true);
      setSaveMessage(`Restored ${previousEntrySnapshot.date} so you can change it.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not undo right now.');
    } finally {
      setSavingEntry(false);
    }
  };

  const handleRetrySync = async () => {
    if (!user || syncing) return;
    setSyncing(true);
    setError('');
    try {
      const res = await syncUnsyncedEntries(user.id);
      const refreshed = await listEntries(user.id);
      setEntries(refreshed);
      if (res.failedCount === 0) {
        setSyncNotice(null);
        setSaveMessage('All saved and synced.');
      } else {
        setSyncNotice(`${res.failedCount} entr${res.failedCount === 1 ? 'y' : 'ies'} still to sync.`);
      }
    } catch {
      setSyncNotice('Could not sync right now. Your entries are safe on this device.');
    } finally {
      setSyncing(false);
    }
  };

  const navigateToStateScreen = () => {
    const route = routeForHomeState(dashboard.state);
    if (route === '/') return;
    router.push(route as Href);
  };

  const action = dashboard.primaryAction;

  return (
    <Screen>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Status line: where the study stands today, and today's date. */}
        <View style={styles.statusRow}>
          <Text variant="caption" color="textMuted">
            {sentenceCase(dashboard.instruction.overline)}
          </Text>
          <Text variant="caption" color="textMuted" tabular>
            {today}
          </Text>
        </View>

        <Text variant="caption" color="textMuted">
          {dashboard.medicalNotice}
        </Text>

        {error ? (
          <Banner
            tone="error"
            action={<Button label="Retry" variant="quiet" onPress={() => void loadDashboard()} />}
          >
            {error}
          </Banner>
        ) : null}

        {syncNotice || dashboard.unsyncedCount > 0 ? (
          <Banner
            tone="notice"
            action={
              <Button
                label="Try again"
                variant="quiet"
                loading={syncing}
                onPress={() => void handleRetrySync()}
              />
            }
          >
            {syncNotice ??
              `${dashboard.unsyncedCount} check-in${dashboard.unsyncedCount === 1 ? '' : 's'} saved on this device.`}
          </Banner>
        ) : null}

        {reminderNotice ? (
          <Text variant="caption" color="textMuted">{reminderNotice}</Text>
        ) : null}

        {/* The hero: what today asks of you, one statement, at most one action. */}
        <Card tone="hero">
          {todayType?.kind ? (
            <View style={styles.discRow}>
              <SplitDisc size={88} tone={discTone} />
              <Text variant="heading" color="text">
                {todayType.label}
              </Text>
            </View>
          ) : null}

          <Text variant="title" accessibilityRole="header">
            {dashboard.instruction.heading}
          </Text>

          {/* A finished test leads with the plain heading; the engine's exact sentence
              stays one tap away instead of competing with it. */}
          {dashboard.state === 'plan_result_ready' ? (
            <>
              <Text variant="body" color="textMuted">Open it to read the full result.</Text>
              <Details summary="The exact words from your test">
                <Text variant="sub" color="textMuted">{dashboard.instruction.body}</Text>
              </Details>
            </>
          ) : (
            <Text variant="body" color="textMuted">{dashboard.instruction.body}</Text>
          )}

          <Text variant="caption" color="textMuted" tabular>{dashboard.instruction.detail}</Text>

          {/* A required step is a button; a step Today already covers stays a quiet row. */}
          {action && action.tone === 'primary' ? (
            <Button label={action.label} variant="primary" onPress={navigateToStateScreen} />
          ) : null}
          {action && action.tone === 'quiet' ? (
            <NavRow label={action.label} onPress={navigateToStateScreen} />
          ) : null}
        </Card>

        {/* The receipt for the night just logged: their own entry and plain counts. */}
        {receipt ? (
          <CheckInReceiptCard
            model={receipt}
            onEdit={() => {
              setSaveMessage(null);
              setSelectedDate(dashboard.checkIn.defaultDate);
              setEditingCheckIn(true);
            }}
          />
        ) : null}

        {!loadingData && dashboard.checkIn.enabled ? (
          <>
            {saveMessage ? (
              <Banner
                tone="success"
                action={
                  previousEntrySnapshot ? (
                    <Button
                      label="Undo"
                      variant="quiet"
                      onPress={() => void handleUndoCheckIn()}
                    />
                  ) : undefined
                }
              >
                {saveMessage}
              </Banner>
            ) : null}

            {/* The receipt already carries the summary and the edit row when it is shown. */}
            {lastNightLogged && !editingCheckIn && !receipt ? (
              <Card tone="tint" overline={`Logged for last night (${dashboard.checkIn.defaultDate})`}>
                <Text variant="heading">Last night is logged</Text>
                <Text variant="body" color="textMuted" tabular>{dashboard.checkIn.summary}</Text>
                <NavRow
                  label="Edit this check-in"
                  onPress={() => {
                    setSaveMessage(null);
                    setSelectedDate(dashboard.checkIn.defaultDate);
                    setEditingCheckIn(true);
                  }}
                />
              </Card>
            ) : null}

            {checkInFormVisible && canEditActiveDate ? (
              <CheckInCard
                key={activeCheckInDate}
                date={activeCheckInDate}
                label={
                  activeCheckInDate === dashboard.checkIn.defaultDate
                    ? `Last night (${activeCheckInDate})`
                    : activeCheckInDate
                }
                initialSleepMinutes={activeDayItem?.sleepMinutes ?? null}
                initialCaffeineTime={exposureValue(activeDayItem, dashboard.checkIn.exposure)}
                exposure={dashboard.checkIn.exposure}
                onSave={handleSaveCheckIn}
                saving={savingEntry}
              />
            ) : null}

            {checkInFormVisible && !canEditActiveDate ? (
              <Card tone="tint">
                <Text variant="body" color="textMuted">
                  This day is locked, because you already saved what we found.
                </Text>
                <NavRow
                  label="Back to last night"
                  onPress={() => {
                    setSelectedDate(dashboard.checkIn.defaultDate);
                    setEditingCheckIn(false);
                  }}
                />
              </Card>
            ) : null}

            {/* Earlier days are reachable, but only opened when wanted. */}
            {editingCheckIn || !lastNightLogged ? (
              earlierUnlogged.length > 0 || showEarlierDays ? (
                <Card tone="quiet">
                  <NavRow
                    label={
                      showEarlierDays
                        ? 'Hide earlier days'
                        : `${earlierUnlogged.length} earlier day${earlierUnlogged.length === 1 ? '' : 's'} not fully logged`
                    }
                    onPress={() => setShowEarlierDays((prev) => !prev)}
                  />
                  {showEarlierDays
                    ? dashboard.checkIn.recentDays.slice(1).map((day) => (
                        <NavRow
                          key={day.date}
                          label={day.label}
                          detail={day.statusText}
                          value={day.editable ? (day.date === activeCheckInDate ? 'Editing' : undefined) : 'Locked'}
                          disabled={!day.editable}
                          onPress={() => {
                            setSaveMessage(null);
                            setSelectedDate(day.date);
                            setEditingCheckIn(true);
                          }}
                        />
                      ))
                    : null}
                </Card>
              ) : null
            ) : null}
          </>
        ) : null}

        {/* Progress: one dot per night and one sentence. The figures sit under Details. */}
        {dashboard.progress?.kind === 'run_in' ? (
          <Card tone="tint" overline="Your progress">
            <NightTracker logged={dashboard.progress.validDays} target={dashboard.progress.targetDays} />
            <Text variant="body">
              {progressSentence(dashboard.progress.validDays, dashboard.progress.targetDays)}
            </Text>

            {/* Their own range, unlocked at three run-in nights. */}
            {dashboard.progress.range ? (
              <Text variant="sub" color="textMuted">{dashboard.progress.range.sentence}</Text>
            ) : null}

            {/* Weekly read-back, run-in only: test-day sleep is never averaged before the end. */}
            {recap ? (
              <Text variant="caption" color="textMuted">{recap.sentence}</Text>
            ) : null}

            {dashboard.progress.descriptiveStats ? (
              <Details summary="See your numbers">
                <Text variant="sub" color="textMuted">{dashboard.progress.nextStepText}</Text>
                <StatStrip
                  items={[
                    { label: 'Days logged', value: String(dashboard.progress.descriptiveStats.daysLogged) },
                    {
                      label: 'Avg sleep',
                      value:
                        dashboard.progress.descriptiveStats.averageSleepMinutes !== null
                          ? `${(dashboard.progress.descriptiveStats.averageSleepMinutes / 60).toFixed(1)}h`
                          : '—',
                    },
                    {
                      label: `${dashboard.checkIn.exposure === 'screens' ? 'Screens' : 'Caffeine'} after ${dashboard.progress.cutoffTime}`,
                      value: `${dashboard.progress.descriptiveStats.afterCutoffDays}`,
                    },
                    {
                      label:
                        dashboard.checkIn.exposure === 'screens'
                          ? 'Screens not logged'
                          : 'Caffeine not logged',
                      value: `${dashboard.progress.descriptiveStats.unknownExposureDays}`,
                    },
                  ]}
                />
              </Details>
            ) : null}
          </Card>
        ) : null}

        {dashboard.progress?.kind === 'experiment' ? (
          <Card tone="tint" overline="Test">
            {/* Progress counts nights in the log and cutoff days kept, never sleep values. */}
            <Text variant="heading" tabular>
              {dashboard.progress.nightsSoFar > 0
                ? `${dashboard.progress.nightsLogged} of ${dashboard.progress.nightsSoFar} nights logged`
                : 'No nights logged yet'}
            </Text>
            <Text variant="sub" tabular>
              {dashboard.progress.cutoffDaysSoFar > 0
                ? `${dashboard.progress.cutoffDaysKept} of ${dashboard.progress.cutoffDaysSoFar} cutoff days kept`
                : 'The first cutoff day is still ahead'}
            </Text>
            <Text variant="caption" color="textMuted" tabular>
              {dashboard.progress.pairsDone} of {dashboard.progress.pairsPlanned} pairs done
              {dashboard.progress.currentDayNum > 0
                ? ` · Day ${dashboard.progress.currentDayNum} of ${dashboard.progress.totalDays}`
                : ''}
            </Text>
            <Text variant="caption" color="textMuted">{PAIRS_EXPLANATION}</Text>
            <Text variant="sub" color="textMuted">{dashboard.progress.nextStepText}</Text>
            <Details summary="See your daily breakdown">
              <StatStrip
                items={[
                  { label: 'Kept the rule', value: String(dashboard.progress.adherenceCounts.ADHERENT), emphasis: 'strong' },
                  { label: 'Normal days', value: String(dashboard.progress.adherenceCounts.CONTROL_CLEAN) },
                  // CONTAMINATED is a normal day where the exposure was skipped or early, not
                  // "after cutoff" — that would describe the opposite of the count.
                  {
                    label:
                      dashboard.checkIn.exposure === 'screens'
                        ? 'Normal, screens used'
                        : 'Normal, no caffeine',
                    value: String(dashboard.progress.adherenceCounts.CONTAMINATED),
                  },
                  { label: 'Not sure', value: String(dashboard.progress.adherenceCounts.UNKNOWN), emphasis: 'muted' },
                ]}
              />
            </Details>
          </Card>
        ) : null}

        {dashboard.progress?.kind === 'result' ? (
          <Card tone="tint" overline="What we found">
            <StatStrip
              size="lg"
              items={[
                { label: 'Days looked at', value: String(dashboard.progress.daysAnalyzed), emphasis: 'strong' },
                { label: 'Days left out', value: String(dashboard.progress.daysExcluded) },
                { label: 'Nights not logged', value: String(dashboard.progress.missingOutcomeDays) },
              ]}
            />
            <Text variant="sub" color="textMuted">{dashboard.progress.nextStepText}</Text>
          </Card>
        ) : null}

        {/* One test runs at a time; this is where the other one is chosen. */}
        <Card tone="quiet">
          <NavRow
            label="Choose a test"
            detail="Caffeine cutoff, or screens off in the evening"
            onPress={() => router.push('/choose-test' as Href)}
          />
        </Card>

        {typeof __DEV__ !== 'undefined' && __DEV__ ? (
          <View>
            <NavRow
              label="Dev tools"
              detail="Sample data, clock offset and stage previews"
              onPress={() => router.push('/dev-tools')}
            />
          </View>
        ) : null}
      </ScrollView>

      <PrimaryNav current="today" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { gap: spacing.section, paddingBottom: spacing.section },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  discRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
});
