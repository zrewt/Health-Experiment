import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView, Pressable, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Text, Button, Field } from '@/components/ui';
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
import {
  getLocalTodayDate,
  getMorningEntryDate,
  addDaysToLocalDate,
  canEditDate,
} from '@/experiment/dates';
import { runInMinValidDays } from '@/experiment/config';
import { isFeasibilityDue } from '@/experiment/start-attempt';
import { getRunInDescriptiveStats, type RunInDescriptiveStats } from '@/experiment/view-model';

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

  const today = getLocalTodayDate();
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
          if (existing.lastCaffeineTime === 'none') {
            setNoCaffeine(true);
            setCaffeineTime('');
          } else if (existing.lastCaffeineTime) {
            setNoCaffeine(false);
            setCaffeineTime(existing.lastCaffeineTime);
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
      if (existing.lastCaffeineTime === 'none') {
        setNoCaffeine(true);
        setCaffeineTime('');
      } else {
        setNoCaffeine(false);
        setCaffeineTime(existing.lastCaffeineTime || '');
      }
    } else {
      setSleepHours('');
      setSleepMins('');
      setCaffeineTime('');
      setNoCaffeine(false);
    }
    setFieldErrors(null);
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

    // Caffeine value
    let finalCaffeine: string | 'none' | null = null;
    if (noCaffeine) {
      finalCaffeine = 'none';
    } else if (caffeineTime.trim() !== '') {
      finalCaffeine = caffeineTime.trim();
    }

    setSavingEntry(true);
    setStorageError(null);
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
    } catch (err) {
      setStorageError(err instanceof Error ? err.message : 'Could not save entry. Please retry.');
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

  const getDayStatus = (d: string) => {
    const entry = entries.find((e) => e.date === d);
    if (!entry) return 'Missing';
    const syncSuffix = entry.synced === false ? ' (not synced yet)' : '';
    if (entry.sleepMinutes !== null && entry.lastCaffeineTime !== null) return `Logged${syncSuffix}`;
    if (entry.sleepMinutes !== null || entry.lastCaffeineTime !== null) return `Partly logged${syncSuffix}`;
    return `Missing${syncSuffix}`;
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Text variant="titleLarge" style={styles.title}>Baseline Run-in</Text>
        <Text variant="caption" color="champagne" style={styles.medicalNotice}>
          This app is not medical advice.
        </Text>

        {/* Progress line */}
        <View style={styles.progressCard}>
          <Text variant="titleSmall" color="champagneLight">
            {validDaysCount} of {runInMinValidDays} valid days
          </Text>
          <Text variant="sub" color="ivorySecondary" style={styles.progressSubtext}>
            Run-in ends on 14 valid days with sleep logged, not consecutive calendar days.
          </Text>
        </View>

        {/* Storage error / offline sync banner */}
        {storageError ? (
          <View style={styles.errorBanner}>
            <Text variant="sub" color="garnet" weight="semiBold" accessibilityRole="alert" style={{ flex: 1, marginRight: spacing.sm }}>
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
          </View>
        ) : null}

        {/* Run-in complete banner */}
        {isRunInComplete ? (
          <View style={styles.completeCard}>
            <Text variant="titleSmall" color="champagne">Run-in complete</Text>
            <Text variant="body" color="ivorySecondary" style={styles.paragraph}>
              {nextCheckDate ? 'Your next feasibility check is ready.' : 'You have logged the required 14 valid baseline days. The feasibility check is the next step.'}
            </Text>
            <Button label="Check feasibility" onPress={() => router.push('/feasibility')} />
          </View>
        ) : nextCheckDate ? (
          <Text color="ivorySecondary">Keep logging. Your next feasibility check is on {nextCheckDate}.</Text>
        ) : null}

        {/* Morning check-in card */}
        <View style={styles.card}>
          <Text variant="overline" color="champagneMuted">
            CHECK-IN FOR {activeDate === defaultEntryDate ? 'LAST NIGHT' : activeDate}
          </Text>
          <Text variant="titleSmall" style={styles.cardTitle}>
            Morning Check-in
          </Text>

          {/* Sleep duration inputs */}
          <Text variant="sub" color="ivory" weight="medium" style={styles.inputGroupLabel}>
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
          <Text variant="sub" color="ivory" weight="medium" style={styles.inputGroupLabel}>
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
              style={[
                styles.noCaffeineBtn,
                noCaffeine && styles.noCaffeineBtnActive,
              ]}
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

          {fieldErrors ? (
            <Text variant="caption" color="garnet" style={styles.errorNotice}>
              {fieldErrors}
            </Text>
          ) : null}

          <View style={styles.checkInActions}>
            <Button
              label={savingEntry ? 'Saving...' : 'Save check-in'}
              variant="primary"
              disabled={savingEntry}
              loading={savingEntry}
              onPress={() => void handleSaveEntry()}
            />
          </View>
        </View>

        {/* Last 3 days list */}
        <View style={styles.card}>
          <Text variant="sub" color="champagneLight" weight="semiBold" style={styles.cardHeader}>
            Recent Days
          </Text>
          {pastDays.map((d) => {
            const status = getDayStatus(d);
            const isEditable = canEditDate(today, d);
            const isSelected = activeDate === d;
            return (
              <Pressable
                key={d}
                onPress={() => selectDateForEdit(d)}
                style={[
                  styles.dayRow,
                  isSelected && styles.dayRowSelected,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Date ${d}, Status: ${status}`}
              >
                <View>
                  <Text variant="body" color="ivory" weight={isSelected ? 'semiBold' : 'regular'}>
                    {d}
                  </Text>
                  <Text
                    variant="caption"
                    color={status === 'Logged' ? 'champagneLight' : status === 'Partly logged' ? 'ivorySecondary' : 'ivoryMuted'}
                  >
                    {status}
                  </Text>
                </View>
                <Text variant="sub" color={isEditable ? 'champagne' : 'ivoryMuted'}>
                  {isEditable ? 'Edit →' : 'Read-only'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Descriptive panel (after at least 3 valid days) */}
        {validDaysCount >= 3 ? (
          <View style={styles.descriptivePanel}>
            <Text variant="overline" color="champagneMuted">
              DESCRIPTIVE LOG SUMMARY
            </Text>
            <Text variant="sub" color="champagneLight" weight="semiBold" style={styles.panelTitle}>
              What your log shows so far (descriptive, not a result)
            </Text>

            <View style={styles.statRow}>
              <Text variant="body" color="ivorySecondary">Days logged:</Text>
              <Text variant="body" color="ivory" weight="semiBold">
                {descriptiveStats.daysLogged}
              </Text>
            </View>

            <View style={styles.statRow}>
              <Text variant="body" color="ivorySecondary">Average sleep so far:</Text>
              <Text variant="body" color="ivory" weight="semiBold">
                {descriptiveStats.averageSleepMinutes !== null
                  ? `${(descriptiveStats.averageSleepMinutes / 60).toFixed(1)} hrs`
                  : '—'}
              </Text>
            </View>

            <View style={styles.statRow}>
              <Text variant="body" color="ivorySecondary">Afternoon caffeine days:</Text>
              <Text variant="body" color="ivory" weight="semiBold">
                {descriptiveStats.afternoonCaffeineDays} of {descriptiveStats.daysLogged}
              </Text>
            </View>

            <View style={styles.statRow}>
              <Text variant="body" color="ivorySecondary">Days with unknown caffeine:</Text>
              <Text variant="body" color="ivory" weight="semiBold">
                {descriptiveStats.unknownCaffeineDays}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  title: {
    marginBottom: spacing.xs,
  },
  medicalNotice: {
    marginBottom: spacing.md,
  },
  progressCard: {
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.hairlineBright,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  progressSubtext: {
    marginTop: spacing.xs,
  },
  errorBanner: {
    backgroundColor: colors.surface,
    borderColor: colors.garnet,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  completeCard: {
    backgroundColor: colors.surfaceHighlight,
    borderColor: colors.champagne,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  paragraph: {
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeader: {
    marginBottom: spacing.sm,
  },
  cardTitle: {
    marginVertical: spacing.xs,
  },
  inputGroupLabel: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  timeInputsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  caffeineRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  flexInput: {
    flex: 1,
  },
  noCaffeineBtn: {
    height: 54,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noCaffeineBtnActive: {
    backgroundColor: colors.champagne,
    borderColor: colors.champagneLight,
  },
  errorNotice: {
    marginTop: spacing.xs,
  },
  checkInActions: {
    marginTop: spacing.md,
  },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  dayRowSelected: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radii.control,
    paddingHorizontal: spacing.sm,
  },
  descriptivePanel: {
    backgroundColor: colors.surface,
    borderColor: colors.hairlineBright,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  panelTitle: {
    marginVertical: spacing.xs,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: spacing.xs,
  },
});
