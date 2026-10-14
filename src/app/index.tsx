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
          ? 'Daily reminders are off. Turn notifications on for Aevum in Settings to get a check-in nudge.'
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
        setSyncNotice('Entry saved locally (not synced yet). Retrying sync...');
        void syncUnsyncedEntries(user.id)
          .then(async (res) => {
            const refreshed = await listEntries(user.id);
            setEntries(refreshed);
            if (res.failedCount === 0) {
              setSyncNotice(null);
              setSaveMessage('Check-in saved.');
            } else {
              setSyncNotice(`${res.failedCount} entr${res.failedCount === 1 ? 'y' : 'ies'} saved locally (not synced yet).`);
            }
          })
          .catch(() => {
            setSyncNotice('Entry saved locally (not synced yet). You can retry sync anytime.');
          });
      } else {
        setSaveMessage('Check-in saved.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this check-in. Please try again.');
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
        setSaveMessage('All entries synced.');
      } else {
        setSyncNotice(`${res.failedCount} entr${res.failedCount === 1 ? 'y' : 'ies'} still waiting to sync.`);
      }
    } catch {
      setSyncNotice('Sync could not complete right now. Your entries remain saved on this device.');
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
                `${dashboard.unsyncedCount} check-in${dashboard.unsyncedCount === 1 ? '' : 's'} saved on device (waiting to sync).`}
            </Text>
            <Button
              label="Retry Sync"
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
          <Text variant="body" color="ivorySecondary">{dashboard.instruction.body}</Text>
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
                <Text variant="titleSmall" color="champagneLight" serif>Morning check-in complete</Text>
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
                  This day is locked because its experiment result has been saved.
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
          <Card overline="BASELINE">
            <Text variant="titleMedium" color="champagneLight" tabular>
              {dashboard.progress.validDays} of {dashboard.progress.targetDays} valid nights
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
                    label: 'Late caffeine',
                    value: `${dashboard.progress.descriptiveStats.afternoonCaffeineDays}`,
                  },
                  {
                    label: 'Unknown caffeine',
                    value: `${dashboard.progress.descriptiveStats.unknownCaffeineDays}`,
                  },
                ]}
              />
            ) : null}
          </Card>
        ) : null}

        {dashboard.progress?.kind === 'experiment' ? (
          <Card overline="EXPERIMENT">
            <Text variant="titleMedium" color="champagneLight" tabular>
              {dashboard.progress.currentDayNum > 0
                ? `Day ${dashboard.progress.currentDayNum} of ${dashboard.progress.totalDays}`
                : `${dashboard.progress.totalDays} days scheduled`}
            </Text>
            <StatStrip
              items={[
                { label: 'Days logged', value: String(dashboard.progress.daysLogged) },
                { label: 'Days remaining', value: String(dashboard.progress.daysRemaining) },
              ]}
            />
            <StatStrip
              items={[
                { label: 'Adherent', value: String(dashboard.progress.adherenceCounts.ADHERENT), emphasis: 'strong' },
                { label: 'Usual routine', value: String(dashboard.progress.adherenceCounts.CONTROL_CLEAN) },
                { label: 'Contaminated', value: String(dashboard.progress.adherenceCounts.CONTAMINATED) },
                { label: 'Unknown', value: String(dashboard.progress.adherenceCounts.UNKNOWN), emphasis: 'muted' },
              ]}
            />
            <Text variant="sub" color="ivorySecondary">{dashboard.progress.nextStepText}</Text>
          </Card>
        ) : null}

        {dashboard.progress?.kind === 'result' ? (
          <Card overline="EXPERIMENT SUMMARY">
            <StatStrip
              size="lg"
              items={[
                { label: 'Days analyzed', value: String(dashboard.progress.daysAnalyzed), emphasis: 'strong' },
                { label: 'Days excluded', value: String(dashboard.progress.daysExcluded) },
                { label: 'No sleep logged', value: String(dashboard.progress.missingOutcomeDays) },
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
  content: { gap: spacing.md, paddingBottom: spacing.lg },
  alertCard: { gap: spacing.xs },
  syncCard: { gap: spacing.xs },
});
