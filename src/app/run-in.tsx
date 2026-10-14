import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView, Pressable, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Screen,
  ScreenHeader,
  Card,
  NavRow,
  StatStrip,
  Text,
  Button,
  Field,
} from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import {
  listEntries,
  saveEntry,
  syncUnsyncedEntries,
  getConsent,
  getSetup,
  StoredDailyEntry,
} from '@/data/experiment-store';
import { getToday } from '@/experiment/clock';
import {
  getMorningEntryDate,
  addDaysToLocalDate,
  canEditDate,
} from '@/experiment/dates';
import { runInMinValidDays } from '@/experiment/config';
import { isFeasibilityDue } from '@/experiment/start-attempt';
import { getRunInDescriptiveStats, type RunInDescriptiveStats } from '@/experiment/view-model';
import {
  CAFFEINE_TIME_FORMAT_MESSAGE,
  CAFFEINE_TIME_UNREADABLE_MARKER,
  CAFFEINE_TIME_UNREADABLE_MESSAGE,
  isValidCaffeineTime,
  readCaffeineTime,
} from '@/experiment/caffeine-time';

export default function RunInScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const [entries, setEntries] = useState<StoredDailyEntry[]>([]);
  const [activeDate, setActiveDate] = useState<string>('');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [nextCheckDate, setNextCheckDate] = useState<string | null>(null);

  // Morning check-in card input states
  const [sleepHours, setSleepHours] = useState<string>('');
  const [sleepMins, setSleepMins] = useState<string>('');
  const [caffeineTime, setCaffeineTime] = useState<string>('');
  const [noCaffeine, setNoCaffeine] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
          router.replace('/setup-consent');
          return;
        }

        const setup = await getSetup(userId!);
        if (!isCurrent) return;
        setNextCheckDate(setup?.nextCheckDate ?? null);
        const loaded = await listEntries(userId!);
        if (!isCurrent) return;
        setEntries(loaded);

        const target = defaultEntryDate;
        setActiveDate(target);
        const existing = loaded.find((e) => e.date === target);
        if (existing) {
          if (existing.sleepMinutes !== null) {
            setSleepHours(String(Math.floor(existing.sleepMinutes / 60)));
            setSleepMins(String(existing.sleepMinutes % 60));
          } else {
            setSleepHours('');
            setSleepMins('');
          }
          const storedCaffeine = readCaffeineTime(existing.lastCaffeineTime);
          if (storedCaffeine.kind === 'none') {
            setNoCaffeine(true);
            setCaffeineTime('');
          } else if (storedCaffeine.kind === 'valid') {
            setNoCaffeine(false);
            setCaffeineTime(storedCaffeine.time ?? '');
          } else {
            // 'unset' or 'unreadable': never prefill a guessed or malformed value.
            setNoCaffeine(false);
            setCaffeineTime('');
          }
        } else {
          setSleepHours('');
          setSleepMins('');
          setCaffeineTime('');
          setNoCaffeine(false);
        }
      } catch (err) {
        if (isCurrent) {
          setStorageError(err instanceof Error ? err.message : 'Failed to load experiment data.');
        }
      }
    }

    void fetchData();

    return () => {
      isCurrent = false;
    };
  }, [userId, defaultEntryDate, router, reloadTrigger]);

  const selectDateForEdit = (date: string) => {
    setActiveDate(date);
    const existing = entries.find((e) => e.date === date);
    if (existing) {
      if (existing.sleepMinutes !== null) {
        setSleepHours(String(Math.floor(existing.sleepMinutes / 60)));
        setSleepMins(String(existing.sleepMinutes % 60));
      } else {
        setSleepHours('');
        setSleepMins('');
      }
      const storedCaffeine = readCaffeineTime(existing.lastCaffeineTime);
      if (storedCaffeine.kind === 'none') {
        setNoCaffeine(true);
        setCaffeineTime('');
      } else if (storedCaffeine.kind === 'valid') {
        setNoCaffeine(false);
        setCaffeineTime(storedCaffeine.time ?? '');
      } else {
        setNoCaffeine(false);
        setCaffeineTime('');
      }
    } else {
      setSleepHours('');
      setSleepMins('');
      setCaffeineTime('');
      setNoCaffeine(false);
    }
    setFieldErrors(null);
    setStatusMessage(null);
  };

  const handleSaveEntry = async () => {
    if (!user) return;
    setFieldErrors(null);
    setStorageError(null);

    // Compute sleep minutes (null if skipped)
    let finalSleepMinutes: number | null = null;
    if (sleepHours.trim() !== '' || sleepMins.trim() !== '') {
      const h = Number(sleepHours.trim()) || 0;
      const m = Number(sleepMins.trim()) || 0;
      if (h < 0 || m < 0 || m >= 60) {
        setFieldErrors('Please enter valid sleep hours and minutes.');
        return;
      }
      finalSleepMinutes = h * 60 + m;
    }

    // Gentle bounds confirmation for sleep outside 2h to 14h
    if (finalSleepMinutes !== null) {
      const hours = finalSleepMinutes / 60;
      if (hours < 2 || hours > 14) {
        const proceed = await new Promise<boolean>((resolve) => {
          if (Platform.OS === 'web') {
            resolve(window.confirm(`You logged ${hours.toFixed(1)} hours of sleep. Would you like to save this?`));
          } else {
            Alert.alert(
              'Confirm Sleep Duration',
              `You logged ${hours.toFixed(1)} hours of sleep. Is this correct?`,
              [
                { text: 'Edit', onPress: () => resolve(false), style: 'cancel' },
                { text: 'Yes, Save', onPress: () => resolve(true) },
              ],
            );
          }
        });
        if (!proceed) return;
      }
    }

    // Caffeine value: strict HH:MM only; single-digit hours are not padded.
    // On rejection the typed text is kept and nothing is saved for this field.
    let finalCaffeine: string | 'none' | null = null;
    if (noCaffeine) {
      finalCaffeine = 'none';
    } else if (caffeineTime.trim() !== '') {
      if (!isValidCaffeineTime(caffeineTime.trim())) {
        setFieldErrors(CAFFEINE_TIME_FORMAT_MESSAGE);
        return;
      }
      finalCaffeine = caffeineTime.trim();
    }

    setSavingEntry(true);
    setStorageError(null);
    setStatusMessage(null);
    try {
      const saved = await saveEntry(user.id, {
        date: activeDate,
        sleepMinutes: finalSleepMinutes,
        lastCaffeineTime: finalCaffeine,
      });

      // Update local state without dropping
      setEntries((prev) => {
        const next = prev.filter((e) => e.date !== activeDate);
        next.push(saved);
        return next.sort((a, b) => a.date.localeCompare(b.date));
      });
      // Distinct from the "not synced yet" banner below: claim a full save only once the
      // write is confirmed, never while it is still local-only.
      setStatusMessage(saved.synced === false ? null : 'Check-in saved.');

      if (saved.synced === false) {
        setStorageError('Entry saved locally (not synced yet). Sync will be retried now.');
        void syncUnsyncedEntries(user.id).then((result) => {
          if (result.failedCount === 0) {
            setStorageError(null);
            setReloadTrigger((n) => n + 1);
          } else {
            setStorageError(`${result.failedCount} entries still not synced yet. You can retry sync.`);
          }
        }).catch(() => {
          setStorageError('Entry saved locally (not synced yet). Sync failed; you can retry.');
        });
      }
    } catch {
      // Plain failure message: no raw technical text is surfaced to the user.
      setStorageError('Could not save this check-in. Please try again.');
    } finally {
      setSavingEntry(false);
    }
  };

  // Calculations for progress & descriptive counts
  const validDaysCount = entries.filter((e) => e.sleepMinutes !== null).length;
  const isRunInComplete = isFeasibilityDue(validDaysCount, nextCheckDate, today);
  const descriptiveStats: RunInDescriptiveStats = getRunInDescriptiveStats(entries);

  // Past 3 editable days list (yesterday, -2 days, -3 days)
  const pastDays = [
    defaultEntryDate,
    addDaysToLocalDate(defaultEntryDate, -1),
    addDaysToLocalDate(defaultEntryDate, -2),
  ];

  // Read-side guard surfaced in the card: the active day's stored value could not be read.
  const activeEntry = entries.find((e) => e.date === activeDate);
  const activeCaffeineUnreadable = activeEntry
    ? readCaffeineTime(activeEntry.lastCaffeineTime).kind === 'unreadable'
    : false;

  const getDayStatus = (d: string) => {
    const entry = entries.find((e) => e.date === d);
    if (!entry) return 'Missing';
    const syncSuffix = entry.synced === false ? ' (not synced yet)' : '';
    if (readCaffeineTime(entry.lastCaffeineTime).kind === 'unreadable') {
      const base = entry.sleepMinutes !== null ? 'Partly logged' : 'Missing';
      return `${base}${syncSuffix} — ${CAFFEINE_TIME_UNREADABLE_MARKER}`;
    }
    if (entry.sleepMinutes !== null && entry.lastCaffeineTime !== null) return `Logged${syncSuffix}`;
    if (entry.sleepMinutes !== null || entry.lastCaffeineTime !== null) return `Partly logged${syncSuffix}`;
    return `Missing${syncSuffix}`;
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline="BASELINE RUN-IN"
          title="Baseline Run-in"
          notice="This app is not medical advice."
          action={<Button label="Today" variant="quiet" onPress={() => router.replace('/')} />}
        />

        {/* Progress line: counts only, never a result. */}
        <Card tone="hero" overline="BASELINE PROGRESS">
          <Text variant="titleMedium" color="champagneLight" tabular>
            {validDaysCount} of {runInMinValidDays} valid days
          </Text>
          <Text variant="sub" color="ivorySecondary">
            Run-in ends on 14 valid days with sleep logged, not consecutive calendar days.
          </Text>
        </Card>

        {/* Storage error / offline sync banner */}
        {storageError ? (
          <Card tone="danger">
            <Text variant="sub" color="garnet" weight="semiBold" accessibilityRole="alert">
              {storageError}
            </Text>
            <Button
              label="Retry Sync"
              variant="quiet"
              loading={syncing}
              onPress={async () => {
                if (user) {
                  setSyncing(true);
                  const res = await syncUnsyncedEntries(user.id);
                  setSyncing(false);
                  setEntries(await listEntries(user.id));
                  if (res.failedCount === 0) {
                    setStorageError(null);
                  } else {
                    setStorageError(`${res.failedCount} entries still not synced yet. Tap to retry.`);
                  }
                  setReloadTrigger((n) => n + 1);
                }
              }}
            />
          </Card>
        ) : null}

        {/* Run-in complete banner */}
        {isRunInComplete ? (
          <Card tone="hero" title="Run-in complete">
            <Text variant="body" color="ivorySecondary">
              {nextCheckDate ? 'Your next feasibility check is ready.' : 'You have logged the required 14 valid baseline days. The feasibility check is the next step.'}
            </Text>
            <Button label="Check feasibility" onPress={() => router.push('/feasibility')} />
          </Card>
        ) : nextCheckDate ? (
          <Text color="ivorySecondary">Keep logging. Your next feasibility check is on {nextCheckDate}.</Text>
        ) : null}

        {/* Morning check-in card */}
        <Card
          overline={`CHECK-IN FOR ${activeDate === defaultEntryDate ? 'LAST NIGHT' : activeDate}`}
          title="Morning Check-in"
        >

          {/* Sleep duration inputs */}
          <Text variant="sub" color="ivoryMuted">
            Sleep duration (hours & minutes)
          </Text>
          <View style={styles.timeInputsRow}>
            <View style={styles.flexInput}>
              <Field
                placeholder="Hours (e.g. 7)"
                keyboardType="numeric"
                value={sleepHours}
                onChangeText={setSleepHours}
              />
            </View>
            <View style={styles.flexInput}>
              <Field
                placeholder="Minutes (e.g. 30)"
                keyboardType="numeric"
                value={sleepMins}
                onChangeText={setSleepMins}
              />
            </View>
          </View>

          {/* Last caffeine time input */}
          <Text variant="sub" color="ivoryMuted">
            Last caffeine time (yesterday)
          </Text>
          <View style={styles.caffeineRow}>
            <View style={styles.flexInput}>
              <Field
                placeholder="HH:MM (e.g. 14:30)"
                editable={!noCaffeine}
                value={noCaffeine ? '' : caffeineTime}
                onChangeText={setCaffeineTime}
              />
            </View>
            <Pressable
              onPress={() => {
                setNoCaffeine(!noCaffeine);
                if (!noCaffeine) setCaffeineTime('');
              }}
              style={[styles.segment, noCaffeine && styles.segmentActive]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: noCaffeine }}
            >
              <Text
                variant="sub"
                color={noCaffeine ? 'ground' : 'ivorySecondary'}
                weight="semiBold"
              >
                No caffeine
              </Text>
            </Pressable>
          </View>

          {activeCaffeineUnreadable ? (
            <Text
              variant="caption"
              color="garnet"
              accessibilityRole="alert"
            >
              {CAFFEINE_TIME_UNREADABLE_MESSAGE}
            </Text>
          ) : null}

          {fieldErrors ? (
            <Text variant="caption" color="garnet" accessibilityRole="alert">
              {fieldErrors}
            </Text>
          ) : null}

          {statusMessage ? (
            <Text
              variant="caption"
              color="champagneLight"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {statusMessage}
            </Text>
          ) : null}

          <Button
            label={savingEntry ? 'Saving...' : 'Save check-in'}
            variant="primary"
            disabled={savingEntry}
            loading={savingEntry}
            onPress={() => void handleSaveEntry()}
          />
        </Card>

        {/* Last 3 days list */}
        <Card overline="RECENT DAYS">
          {pastDays.map((d) => {
            const status = getDayStatus(d);
            const isEditable = canEditDate(today, d);
            const isSelected = activeDate === d;
            return (
              <NavRow
                key={d}
                label={d}
                detail={status}
                value={isEditable ? (isSelected ? 'Editing' : 'Edit') : 'Read-only'}
                onPress={() => selectDateForEdit(d)}
              />
            );
          })}
        </Card>

        {/* Descriptive counts only: never a comparison, estimate or verdict. */}
        {validDaysCount >= 3 ? (
          <Card
            overline="DESCRIPTIVE LOG SUMMARY"
            subtitle="What your log shows so far (descriptive, not a result)"
          >
            <StatStrip
              size="lg"
              items={[
                { label: 'Days logged', value: String(descriptiveStats.daysLogged) },
                {
                  label: 'Average sleep so far',
                  value:
                    descriptiveStats.averageSleepMinutes !== null
                      ? `${(descriptiveStats.averageSleepMinutes / 60).toFixed(1)} hrs`
                      : '—',
                },
                {
                  label: 'Afternoon caffeine days',
                  value: `${descriptiveStats.afternoonCaffeineDays} of ${descriptiveStats.daysLogged}`,
                },
                {
                  label: 'Days with unknown caffeine',
                  value: String(descriptiveStats.unknownCaffeineDays),
                },
              ]}
            />
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xxl },
  timeInputsRow: { flexDirection: 'row', gap: spacing.sm },
  caffeineRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  flexInput: { flex: 1 },
  segment: {
    height: 54,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: colors.champagne,
    borderColor: colors.champagneLight,
  },
});
