import React, { useEffect, useState } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Screen,
  ScreenHeader,
  Card,
  NavRow,
  StatStrip,
  Text,
  Button,
  Details,
  Banner,
  SplitDisc,
} from '@/components/ui';
import { CheckInCard } from '@/components/CheckInCard';
import { NightTracker } from '@/components/NightTracker';
import { spacing } from '@/design/tokens';
import { sentenceCase } from '@/design/labels';
import { useAuthStore } from '@/store/auth';
import {
  listEntries,
  saveEntry,
  syncUnsyncedEntries,
  getConsent,
  getSetup,
  listExperimentPlans,
  type StoredDailyEntry,
} from '@/data/experiment-store';
import type { StoredExperimentPlan } from '@/data/plan-persistence';
import type { DailyEntry } from '@/experiment/types';
import { getToday } from '@/experiment/clock';
import {
  getMorningEntryDate,
  addDaysToLocalDate,
  canEditDate,
} from '@/experiment/dates';
import { runInMinValidDays } from '@/experiment/config';
import {
  formatSleepFriendly,
  progressSentence,
} from '@/experiment/plain-language';
import { computeExperimentBaseline, entriesForRunIn, validRunInDays } from '@/experiment/adapter';
import {
  experimentById,
  exposureForExperimentId,
  exposureValue,
  type ExposureKind,
} from '@/experiment/experiments';
import { isFeasibilityDue } from '@/experiment/start-attempt';
import { getLatestMilestone } from '@/experiment/milestones';
import { getRunInDescriptiveStats, type RunInDescriptiveStats } from '@/experiment/view-model';
import {
  CAFFEINE_TIME_UNREADABLE_MARKER,
  readCaffeineTime,
} from '@/experiment/caffeine-time';

function summarizeEntry(entry: DailyEntry, exposure: ExposureKind = 'caffeine'): string {
  const sleep = formatSleepFriendly(entry.sleepMinutes);
  const read = readCaffeineTime(exposureValue(entry, exposure));
  const word = exposure === 'screens' ? 'screen use' : 'caffeine';
  const exposureText =
    read.kind === 'none'
      ? `No ${exposure === 'screens' ? 'screens' : 'caffeine'}`
      : read.kind === 'valid'
      ? `Last ${word} ${read.time}`
      : read.kind === 'unreadable'
      ? `${exposure === 'screens' ? 'Screen' : 'Caffeine'} time unreadable`
      : `${exposure === 'screens' ? 'Screen use' : 'Caffeine'} not logged`;
  return `${sleep} · ${exposureText}`;
}

export default function RunInScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const [entries, setEntries] = useState<StoredDailyEntry[]>([]);
  // Earlier tests: their days are not part of this run-in.
  const [savedPlans, setSavedPlans] = useState<StoredExperimentPlan[]>([]);
  const [activeDate, setActiveDate] = useState<string>('');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [nextCheckDate, setNextCheckDate] = useState<string | null>(null);
  // The time the user picked in setup; the descriptive counts read it, not a default.
  const [cutoffTime, setCutoffTime] = useState<string>('12:00');

  const [savingEntry, setSavingEntry] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [previousEntrySnapshot, setPreviousEntrySnapshot] = useState<DailyEntry | null>(null);
  const [editing, setEditing] = useState(false);

  const today = getToday();
  const defaultEntryDate = getMorningEntryDate(today);

  const [reloadTrigger, setReloadTrigger] = useState(0);

  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let isCurrent = true;

    async function fetchData() {
      try {
        const consent = await getConsent(userId!);
        if (!isCurrent) return;
        if (!consent || !consent.granted) {
          // Onboarding starts at the test picker, so no test is chosen for the user.
          router.replace('/choose-test');
          return;
        }

        const [setup, loaded, plans] = await Promise.all([
          getSetup(userId!),
          listEntries(userId!),
          listExperimentPlans(userId!),
        ]);
        if (!isCurrent) return;
        setNextCheckDate(setup?.nextCheckDate ?? null);
        setExposure(exposureForExperimentId(setup?.experimentId));
        setCutoffTime(setup?.cutoffTime ?? experimentById(setup?.experimentId).defaultCutoff);
        setEntries(loaded);
        setSavedPlans(plans);
        setActiveDate((prev) => prev || defaultEntryDate);
        setStorageError(null);
      } catch (err) {
        if (isCurrent) {
          setStorageError(err instanceof Error ? err.message : 'Could not load your log.');
        }
      }
    }

    void fetchData();

    return () => {
      isCurrent = false;
    };
  }, [userId, defaultEntryDate, router, reloadTrigger]);

  const [exposure, setExposure] = useState<ExposureKind>('caffeine');

  const selectDateForEdit = (date: string) => {
    if (!canEditDate(today, date, savedPlans)) return;
    setActiveDate(date);
    setEditing(true);
    setStatusMessage(null);
  };

  const handleSaveEntry = async (entry: DailyEntry) => {
    if (!user) return;
    if (!canEditDate(today, entry.date, savedPlans)) {
      setStorageError('This day belongs to a finished test and is locked.');
      return;
    }

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
    setStorageError(null);
    setStatusMessage(null);
    try {
      const saved = await saveEntry(user.id, entry);

      // Update local state without dropping
      setEntries((prev) => {
        const next = prev.filter((e) => e.date !== entry.date);
        next.push(saved);
        return next.sort((a, b) => a.date.localeCompare(b.date));
      });
      setEditing(false);

      if (saved.synced !== false) {
        setStatusMessage(`Saved for ${entry.date}: ${summarizeEntry(entry, exposure)}.`);
      } else {
        setStorageError('Saved on this device (not synced yet). Retrying sync now…');
        void syncUnsyncedEntries(user.id)
          .then((result) => {
            if (result.failedCount === 0) {
              setStorageError(null);
              setStatusMessage(`Saved and synced for ${entry.date}: ${summarizeEntry(entry, exposure)}.`);
              setReloadTrigger((n) => n + 1);
            } else {
              setStorageError(
                `${result.failedCount} entr${result.failedCount === 1 ? 'y' : 'ies'} saved on this device. Tap Retry sync when online.`,
              );
            }
          })
          .catch(() => {
            setStorageError('Saved on this device. Sync will retry when your connection is back.');
          });
      }
    } catch {
      setStorageError('Could not save this check-in. Your answers are still in the form — try again.');
    } finally {
      setSavingEntry(false);
    }
  };

  const handleUndoLastSave = async () => {
    if (!user || !previousEntrySnapshot || savingEntry) return;
    setSavingEntry(true);
    setStorageError(null);
    try {
      const restored = await saveEntry(user.id, previousEntrySnapshot);
      setEntries((prev) => {
        const next = prev.filter((e) => e.date !== previousEntrySnapshot.date);
        next.push(restored);
        return next.sort((a, b) => a.date.localeCompare(b.date));
      });
      setActiveDate(previousEntrySnapshot.date);
      setPreviousEntrySnapshot(null);
      setEditing(true);
      setStatusMessage(`Restored ${previousEntrySnapshot.date} so you can change it.`);
    } catch {
      setStorageError('Could not undo the change right now. Try editing the day directly below.');
    } finally {
      setSavingEntry(false);
    }
  };

  // Calculations for progress & descriptive counts.
  // The run-in window is the days after every earlier plan's last scheduled day: days from
  // a finished test were not "getting to know your sleep" and must not inflate this count.
  const allPlans = savedPlans.map((item) => item.plan);
  const runInEntries = entriesForRunIn(entries, allPlans, today);
  const validDaysCount = validRunInDays(entries, allPlans, today, exposure);
  const isRunInComplete = isFeasibilityDue(validDaysCount, nextCheckDate, today);
  const descriptiveStats: RunInDescriptiveStats = getRunInDescriptiveStats(runInEntries, cutoffTime);
  // The screens test reads its own baseline: nights with screens after the cutoff.
  const screenBaseline = exposure === 'screens'
    ? computeExperimentBaseline(exposure, runInEntries, { cutoffTime })
    : null;
  // The first real aha: the user's own range, once there are enough nights to show one.
  const runInMilestone = getLatestMilestone({
    entries: runInEntries,
    today,
    exposure,
    cutoffTime,
  });

  // Past 3 editable days list (yesterday, -2 days, -3 days)
  const pastDays = [
    defaultEntryDate,
    addDaysToLocalDate(defaultEntryDate, -1),
    addDaysToLocalDate(defaultEntryDate, -2),
  ];

  const targetDate = activeDate || defaultEntryDate;
  const activeEntry = entries.find((e) => e.date === targetDate);
  const targetDayLogged =
    activeEntry !== undefined &&
    activeEntry.sleepMinutes !== null &&
    exposureValue(activeEntry, exposure) !== null &&
    readCaffeineTime(exposureValue(activeEntry, exposure)).kind !== 'unreadable';

  const getDayStatus = (d: string) => {
    const entry = entries.find((e) => e.date === d);
    if (!entry) return 'Missing';
    const syncSuffix = entry.synced === false ? ' (not synced yet)' : '';
    const exposureRead = exposureValue(entry, exposure);
    if (readCaffeineTime(exposureRead).kind === 'unreadable') {
      const base = entry.sleepMinutes !== null ? 'Partly logged' : 'Missing';
      return `${base}${syncSuffix} — ${CAFFEINE_TIME_UNREADABLE_MARKER}`;
    }
    if (entry.sleepMinutes !== null && exposureRead !== null) return `Logged${syncSuffix}`;
    if (entry.sleepMinutes !== null || exposureRead !== null) return `Partly logged${syncSuffix}`;
    return `Missing${syncSuffix}`;
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline={sentenceCase('GETTING TO KNOW YOU')}
          title="Getting to know your sleep"
          notice="This app is not medical advice."
          action={<Button label="Today" variant="quiet" onPress={() => router.replace('/')} />}
        />

        {/* Progress: one dot per night, exact count badge, and one plain sentence. */}
        <Card tone="hero" overline="Your progress">
          <View style={styles.heroHeader}>
            <SplitDisc size={68} tone="normal" />
            <View style={styles.heroMeta}>
              <Text variant="heading" tabular>
                {validDaysCount} of {runInMinValidDays} nights logged
              </Text>
              <Text variant="body" color="textMuted">
                {progressSentence(validDaysCount, runInMinValidDays)}
              </Text>
              {/* The first real aha: their own range, and why one night cannot answer. */}
              {runInMilestone ? (
                <Text variant="sub" color="textMuted">
                  {runInMilestone.title} {runInMilestone.body}
                </Text>
              ) : null}
            </View>
          </View>
          <NightTracker logged={validDaysCount} target={runInMinValidDays} />
          {nextCheckDate && !isRunInComplete ? (
            <Text variant="caption" color="textMuted" tabular>
              Next check unlocks on {nextCheckDate}. Keep logging each morning.
            </Text>
          ) : null}
        </Card>

        {/* Storage error / offline sync recovery banner */}
        {storageError ? (
          <Banner
            tone="error"
            action={
              <Button
                label="Retry sync"
                variant="quiet"
                loading={syncing}
                onPress={async () => {
                  if (user) {
                    setSyncing(true);
                    try {
                      const res = await syncUnsyncedEntries(user.id);
                      setEntries(await listEntries(user.id));
                      if (res.failedCount === 0) {
                        setStorageError(null);
                        setStatusMessage('All saved entries are synced with your account.');
                      } else {
                        setStorageError(
                          `${res.failedCount} entr${res.failedCount === 1 ? 'y' : 'ies'} still waiting to sync. Your log is safe on this device.`,
                        );
                      }
                      setReloadTrigger((n) => n + 1);
                    } finally {
                      setSyncing(false);
                    }
                  }
                }}
              />
            }
          >
            {storageError}
          </Banner>
        ) : null}

        {/* Save confirmation with immediate Undo / Edit affordances */}
        {statusMessage ? (
          <Banner
            tone="success"
            action={
              <View style={styles.bannerActions}>
                {previousEntrySnapshot ? (
                  <Button
                    label="Undo"
                    variant="quiet"
                    onPress={() => void handleUndoLastSave()}
                  />
                ) : null}
                <Button
                  label="Back to Today"
                  variant="quiet"
                  onPress={() => router.replace('/')}
                />
              </View>
            }
          >
            {statusMessage}
          </Banner>
        ) : null}

        {/* All-nights-logged banner */}
        {isRunInComplete ? (
          <Card tone="hero" overline="Ready to check" title="All 14 nights are in">
            <Text variant="body" color="textMuted">
              {nextCheckDate
                ? 'Your next check is ready.'
                : 'You have logged 14 nights. Next: find out whether a test is worth doing.'}
            </Text>
            <Button
              label="Is this test worth doing?"
              variant="primary"
              onPress={() => router.push('/feasibility')}
            />
          </Card>
        ) : null}

        {/* Morning check-in: collapses to a clean summary card once logged unless editing */}
        {targetDayLogged && !editing && activeEntry ? (
          <Card
            tone="tint"
            overline={
              targetDate === defaultEntryDate
                ? `Logged for last night (${targetDate})`
                : `Logged for ${targetDate}`
            }
          >
            <Text variant="heading">Check-in saved</Text>
            <Text variant="body" color="textMuted" tabular>
              {summarizeEntry(activeEntry)}
            </Text>
            <NavRow
              label="Edit this check-in"
              onPress={() => setEditing(true)}
            />
          </Card>
        ) : (
          <CheckInCard
            key={targetDate}
            date={targetDate}
            label={targetDate === defaultEntryDate ? `last night (${targetDate})` : targetDate}
            initialSleepMinutes={activeEntry?.sleepMinutes ?? null}
            exposure={exposure}
            initialCaffeineTime={exposureValue(activeEntry, exposure)}
            onSave={handleSaveEntry}
            saving={savingEntry}
          />
        )}

        {/* Last 3 days list */}
        <Card tone="tint" overline="Recent days">
          {pastDays.map((d) => {
            const status = getDayStatus(d);
            const isEditable = canEditDate(today, d, savedPlans);
            const isSelected = targetDate === d && editing;
            return (
              <NavRow
                key={d}
                label={d === defaultEntryDate ? `Last night (${d})` : d}
                detail={status}
                value={isEditable ? (isSelected ? 'Editing' : 'Edit') : 'Locked'}
                disabled={!isEditable}
                onPress={() => selectDateForEdit(d)}
              />
            );
          })}
        </Card>

        {/* Your own counts only: never a comparison, estimate or verdict. Tucked under Details. */}
        {validDaysCount >= 3 ? (
          <Card tone="quiet">
            <Details summary="See your numbers so far">
              <Text variant="sub" color="textMuted">
                Your own numbers, not a result. Nights logged count, not days in a row.
              </Text>
              <StatStrip
                size="lg"
                items={[
                  { label: 'Days logged', value: String(descriptiveStats.daysLogged) },
                  {
                    label: 'Average sleep',
                    value:
                      descriptiveStats.averageSleepMinutes !== null
                        ? `${(descriptiveStats.averageSleepMinutes / 60).toFixed(1)} hrs`
                        : '—',
                  },
                  {
                    label: `${screenBaseline ? 'Screens' : 'Caffeine'} after ${cutoffTime}`,
                    value: `${screenBaseline ? screenBaseline.lateCaffeineDays : descriptiveStats.afterCutoffDays} of ${descriptiveStats.daysLogged}`,
                  },
                  {
                    label: screenBaseline ? 'Screen time not logged' : 'Caffeine not logged',
                    value: String(screenBaseline ? screenBaseline.unknownExposureDays : descriptiveStats.unknownExposureDays),
                  },
                ]}
              />
            </Details>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.section, paddingBottom: spacing.xxl },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroMeta: {
    flex: 1,
    gap: spacing.xs,
  },
  bannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
