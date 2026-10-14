import { useCallback, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import {
  Screen,
  ScreenHeader,
  Card,
  NavRow,
  StatStrip,
  Text,
  Button,
  Details,
  PrimaryNav,
} from '@/components/ui';
import { spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import {
  getConsent,
  getSetup,
  listEntries,
  getActivePlan,
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
import { CheckInCard } from '@/components/CheckInCard';
import { syncReminders } from '@/notifications/reminders';
import { routeForHomeState } from '@/notifications/tap-target';

export default function HomeScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const [loadingData, setLoadingData] = useState(true);
  const [savingEntry, setSavingEntry] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);

  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [setup, setSetup] = useState<ExperimentSetupRecord | null>(null);
  const [entries, setEntries] = useState<StoredDailyEntry[]>([]);
  const [plan, setPlan] = useState<StoredExperimentPlan | null>(null);
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
      const [loadedConsent, loadedSetup, loadedEntries, loadedPlan] = await Promise.all([
        getConsent(user.id),
        getSetup(user.id),
        listEntries(user.id),
        getActivePlan(user.id),
      ]);
      setConsent(loadedConsent);
      setSetup(loadedSetup);
      setEntries(loadedEntries);
      setPlan(loadedPlan);
      setError('');

      const model = getTodayDashboardModel({
        consent: loadedConsent,
        setup: loadedSetup,
        entries: loadedEntries,
        plan: loadedPlan,
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
  }, [user, today]);

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
    today,
  });

  const activeCheckInDate =
    selectedDate && dashboard.checkIn.recentDays.some((d) => d.date === selectedDate)
      ? selectedDate
      : dashboard.checkIn.defaultDate;
  const activeDayItem = dashboard.checkIn.recentDays.find((d) => d.date === activeCheckInDate);
  const canEditActiveDate = activeDayItem ? activeDayItem.editable : true;

  const lastNightLogged = dashboard.checkIn.status === 'logged';
  const checkInFormVisible =
    !loadingData && dashboard.checkIn.enabled && (!lastNightLogged || editingCheckIn);
  const earlierUnlogged = dashboard.checkIn.recentDays
    .slice(1)
    .filter((d) => d.editable && d.statusTone !== 'logged');

  const handleSaveCheckIn = async (entry: DailyEntry) => {
    if (!user) return;
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
        <ScreenHeader
          overline={`TODAY • ${today}`}
          title="Today"
          notice={dashboard.medicalNotice}
        />

        {error ? (
          <Card tone="danger" style={styles.alertCard}>
            <Text color="garnet" accessibilityRole="alert">{error}</Text>
            <Button label="Retry" variant="quiet" onPress={() => void loadDashboard()} />
          </Card>
        ) : null}

        {syncNotice || dashboard.unsyncedCount > 0 ? (
          <Card style={styles.syncCard}>
            <Text variant="sub" color="champagneLight" accessibilityLiveRegion="polite">
              {syncNotice ??
                `${dashboard.unsyncedCount} check-in${dashboard.unsyncedCount === 1 ? '' : 's'} saved on this device.`}
            </Text>
            <Button
              label="Try again"
              variant="quiet"
              loading={syncing}
              onPress={() => void handleRetrySync()}
            />
          </Card>
        ) : null}

        {reminderNotice ? (
          <Text variant="caption" color="ivoryMuted">{reminderNotice}</Text>
        ) : null}

        {/* What today asks of you. One statement, one status line, at most one action. */}
        <Card tone="hero">
          <Text variant="overline" color="champagneMuted">{dashboard.instruction.overline}</Text>
          <Text variant="titleMedium" color="champagneLight" serif>
            {dashboard.instruction.heading}
          </Text>
          {/* A finished test leads with the plain heading; the engine's exact sentence
              stays one tap away instead of competing with it. */}
          {dashboard.state === 'plan_result_ready' ? (
            <>
              <Text variant="body" color="ivorySecondary">Open it to read the full result.</Text>
              <Details summary="The exact words from your test">
                <Text variant="sub" color="ivorySecondary">{dashboard.instruction.body}</Text>
              </Details>
            </>
          ) : (
            <Text variant="body" color="ivorySecondary">{dashboard.instruction.body}</Text>
          )}
          <Text variant="caption" color="ivoryMuted" tabular>{dashboard.instruction.detail}</Text>

          {/* A required step is a button; a step Today already covers stays a quiet row. */}
          {action && action.tone === 'primary' ? (
            <Button label={action.label} variant="primary" onPress={navigateToStateScreen} />
          ) : null}
          {action && action.tone === 'quiet' ? (
            <NavRow label={action.label} onPress={navigateToStateScreen} />
          ) : null}
        </Card>

        {!loadingData && dashboard.checkIn.enabled ? (
          <>
            {saveMessage ? (
              <Text variant="sub" color="champagneLight" accessibilityRole="alert" accessibilityLiveRegion="polite">
                {saveMessage}
              </Text>
            ) : null}

            {lastNightLogged && !editingCheckIn ? (
              <Card>
                <Text variant="overline" color="champagneMuted">
                  LOGGED FOR LAST NIGHT ({dashboard.checkIn.defaultDate})
                </Text>
                <Text variant="titleSmall" color="champagneLight" serif>Last night is logged</Text>
                <Text variant="body" color="ivorySecondary" tabular>{dashboard.checkIn.summary}</Text>
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
                    ? `LAST NIGHT (${activeCheckInDate})`
                    : activeCheckInDate
                }
                initialSleepMinutes={activeDayItem?.sleepMinutes ?? null}
                initialCaffeineTime={activeDayItem?.lastCaffeineTime ?? null}
                onSave={handleSaveCheckIn}
                saving={savingEntry}
              />
            ) : null}

            {checkInFormVisible && !canEditActiveDate ? (
              <Card>
                <Text variant="sub" color="ivorySecondary">
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

        {/* Progress: figures only, no interim estimates. */}
        {dashboard.progress?.kind === 'run_in' ? (
          <Card overline="PROGRESS">
            <Text variant="titleMedium" color="champagneLight" tabular>
              {dashboard.progress.validDays} of {dashboard.progress.targetDays} nights logged
            </Text>
            <Text variant="sub" color="ivorySecondary">{dashboard.progress.nextStepText}</Text>

            {dashboard.progress.descriptiveStats ? (
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
                    label: 'Caffeine after noon',
                    value: `${dashboard.progress.descriptiveStats.afternoonCaffeineDays}`,
                  },
                  {
                    label: 'Caffeine not logged',
                    value: `${dashboard.progress.descriptiveStats.unknownCaffeineDays}`,
                  },
                ]}
              />
            ) : null}
          </Card>
        ) : null}

        {dashboard.progress?.kind === 'experiment' ? (
          <Card overline="TEST">
            <Text variant="titleMedium" color="champagneLight" tabular>
              {dashboard.progress.currentDayNum > 0
                ? `Day ${dashboard.progress.currentDayNum} of ${dashboard.progress.totalDays}`
                : `${dashboard.progress.totalDays} days to go`}
            </Text>
            <StatStrip
              items={[
                { label: 'Days logged', value: String(dashboard.progress.daysLogged) },
                { label: 'Days remaining', value: String(dashboard.progress.daysRemaining) },
              ]}
            />
            <StatStrip
              items={[
                { label: 'Kept the rule', value: String(dashboard.progress.adherenceCounts.ADHERENT), emphasis: 'strong' },
                { label: 'Normal days', value: String(dashboard.progress.adherenceCounts.CONTROL_CLEAN) },
                // CONTAMINATED is a normal day where caffeine was skipped or early, not
                // "caffeine after cutoff" — that would describe the opposite of the count.
                { label: 'Normal, no caffeine', value: String(dashboard.progress.adherenceCounts.CONTAMINATED) },
                { label: 'Not sure', value: String(dashboard.progress.adherenceCounts.UNKNOWN), emphasis: 'muted' },
              ]}
            />
            <Text variant="sub" color="ivorySecondary">{dashboard.progress.nextStepText}</Text>
          </Card>
        ) : null}

        {dashboard.progress?.kind === 'result' ? (
          <Card overline="WHAT WE FOUND">
            <StatStrip
              size="lg"
              items={[
                { label: 'Days looked at', value: String(dashboard.progress.daysAnalyzed), emphasis: 'strong' },
                { label: 'Days left out', value: String(dashboard.progress.daysExcluded) },
                { label: 'Nights not logged', value: String(dashboard.progress.missingOutcomeDays) },
              ]}
            />
            <Text variant="sub" color="ivorySecondary">{dashboard.progress.nextStepText}</Text>
          </Card>
        ) : null}

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
  alertCard: { gap: spacing.sm },
  syncCard: { gap: spacing.sm },
});
