import React, { useCallback, useState } from 'react';
import { StyleSheet, View, ScrollView, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  Screen,
  ScreenHeader,
  Card,
  NavRow,
  Disclosure,
  StatStrip,
  Text,
  Button,
  PrimaryNav,
} from '@/components/ui';
import { colors, radii, spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import {
  getSetup,
  listEntries,
  getActivePlan,
  saveEntry,
  syncUnsyncedEntries,
  type ExperimentSetupRecord,
  type StoredDailyEntry,
} from '@/data/experiment-store';
import type { StoredExperimentPlan } from '@/data/plan-persistence';
import { getToday } from '@/experiment/clock';
import { formatSleepDuration, getJournalViewModel } from '@/experiment/journal';
import type { DailyEntry } from '@/experiment/types';
import { CheckInCard } from '@/components/CheckInCard';

type FilterMode = 'all' | 'incomplete' | 'editable';

export default function JournalScreen() {
  const user = useAuthStore((state) => state.user);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');

  const [setup, setSetup] = useState<ExperimentSetupRecord | null>(null);
  const [entries, setEntries] = useState<StoredDailyEntry[]>([]);
  const [plan, setPlan] = useState<StoredExperimentPlan | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);

  const today = getToday();

  const loadJournal = useCallback(async () => {
    if (!user) return;
    try {
      const [loadedSetup, loadedEntries, loadedPlan] = await Promise.all([
        getSetup(user.id),
        listEntries(user.id),
        getActivePlan(user.id),
      ]);
      setSetup(loadedSetup);
      setEntries(loadedEntries);
      setPlan(loadedPlan);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load journal.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  // The focus effect also runs on mount (the screen is focused when it mounts), so a
  // separate mount effect would only fetch the same data twice.
  useFocusEffect(
    useCallback(() => {
      void loadJournal();
    }, [loadJournal]),
  );

  const journal = getJournalViewModel({
    entries,
    today,
    setup,
    plan,
  });

  const unsyncedCount = entries.filter((e) => e.synced === false).length;
  const activeEditItem = editingDate
    ? journal.days.find((d) => d.date === editingDate && d.editable) ?? null
    : null;

  const filteredDays = journal.days.filter((d) => {
    if (filter === 'incomplete') return d.statusTone !== 'logged';
    if (filter === 'editable') return d.editable;
    return true;
  });

  const handleSaveEntry = async (entry: DailyEntry) => {
    if (!user) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const saved = await saveEntry(user.id, entry);
      setEntries((prev) => {
        const next = prev.filter((e) => e.date !== entry.date);
        next.push(saved);
        return next.sort((a, b) => a.date.localeCompare(b.date));
      });
      if (saved.synced === false) {
        setSaveMessage('Entry saved on this device (waiting to sync).');
        void syncUnsyncedEntries(user.id).then(async () => {
          setEntries(await listEntries(user.id));
        });
      } else {
        setSaveMessage(`Saved check-in for ${entry.date}.`);
      }
      setEditingDate(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save entry.');
    } finally {
      setSaving(false);
    }
  };

  const handleRetrySync = async () => {
    if (!user || syncing) return;
    setSyncing(true);
    try {
      const res = await syncUnsyncedEntries(user.id);
      setEntries(await listEntries(user.id));
      if (res.failedCount === 0) {
        setSaveMessage('All entries synced.');
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Screen>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline="SLEEP & CAFFEINE LOG"
          title="Journal"
          notice={journal.medicalNotice}
        />

        {error ? (
          <Card tone="danger">
            <Text color="garnet" accessibilityRole="alert">{error}</Text>
            <Button label="Retry" variant="quiet" onPress={() => void loadJournal()} />
          </Card>
        ) : null}

        {unsyncedCount > 0 ? (
          <Card>
            <Text variant="sub" color="champagneLight">
              {unsyncedCount} entr{unsyncedCount === 1 ? 'y' : 'ies'} saved locally (not synced yet).
            </Text>
            <Button label="Retry Sync" variant="quiet" loading={syncing} onPress={() => void handleRetrySync()} />
          </Card>
        ) : null}

        {saveMessage ? (
          <Text variant="sub" color="champagneLight" accessibilityRole="alert" accessibilityLiveRegion="polite">
            {saveMessage}
          </Text>
        ) : null}

        {/* Descriptive counts only: never a condition comparison. */}
        <Card overline="LOG OVERVIEW (DESCRIPTIVE ONLY)">
          <StatStrip
            items={[
              { label: 'Complete days', value: String(journal.summary.loggedDays), emphasis: 'strong' },
              { label: 'Partly logged', value: String(journal.summary.partialDays) },
              { label: 'Missing days', value: String(journal.summary.missingDays), emphasis: 'muted' },
              {
                label: 'Avg sleep',
                value:
                  journal.summary.averageSleepMinutes !== null
                    ? formatSleepDuration(journal.summary.averageSleepMinutes)
                    : '—',
              },
            ]}
          />
          <Text variant="caption" color="ivoryMuted">
            Missing fields remain blank and are never counted as zero sleep or no caffeine.
          </Text>
        </Card>

        <Card overline={`SLEEP DURATION (RECENT ${journal.chart.bars.length} DAYS)`}>
          <Text variant="sub" color="ivorySecondary" accessibilityRole="summary">
            {journal.chart.accessibleOverview}
          </Text>

          <View style={styles.chartContainer} accessibilityLabel={journal.chart.accessibleOverview}>
            {journal.chart.bars.map((bar) => (
              <View
                key={bar.date}
                style={styles.barColumn}
                accessible
                accessibilityLabel={bar.accessibleSummary}
              >
                <View style={styles.barTrack}>
                  {bar.sleepMinutes !== null ? (
                    <View
                      style={[
                        styles.barFill,
                        { height: `${Math.round(bar.heightFraction * 100)}%` },
                      ]}
                    />
                  ) : (
                    <View style={styles.barMissingDot} />
                  )}
                </View>
                <Text variant="overline" color="ivoryMuted" tabular style={styles.barLabel}>
                  {bar.shortLabel}
                </Text>
              </View>
            ))}
          </View>

          {/* The same reading, in words, without taking over the card. */}
          <Disclosure label="Read the log as text" summary="Most recent 5 nights, in words">
            {journal.chart.bars
              .slice(-5)
              .reverse()
              .map((bar) => (
                <Text key={bar.date} variant="caption" color="ivorySecondary" tabular>
                  • {bar.accessibleSummary}
                </Text>
              ))}
          </Disclosure>
        </Card>

        {/* Inline editor when an editable day is selected */}
        {activeEditItem ? (
          <View style={styles.editorWrapper}>
            <CheckInCard
              key={activeEditItem.date}
              date={activeEditItem.date}
              label={activeEditItem.date}
              initialSleepMinutes={activeEditItem.sleepMinutes}
              initialCaffeineTime={activeEditItem.lastCaffeineTime}
              onSave={handleSaveEntry}
              saving={saving}
            />
            <NavRow label="Close editor" onPress={() => setEditingDate(null)} />
          </View>
        ) : null}

        <Card overline="DATED ENTRIES">
          <Text variant="caption" color="ivoryMuted">
            Entries from yesterday and the previous 3 days can be edited unless locked by a completed experiment.
          </Text>

          <View style={styles.filterRow} accessibilityRole="tablist">
            {(
              [
                ['all', `All (${journal.days.length})`],
                ['incomplete', `Missing/Partial (${journal.summary.missingDays + journal.summary.partialDays})`],
                ['editable', 'Editable window'],
              ] as const
            ).map(([key, label]) => (
              <Pressable
                key={key}
                onPress={() => setFilter(key)}
                style={[styles.filterChip, filter === key && styles.filterChipActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: filter === key }}
              >
                <Text
                  variant="caption"
                  color={filter === key ? 'ground' : 'ivorySecondary'}
                  weight="semiBold"
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          {loading ? (
            <Text color="ivorySecondary">Loading entries...</Text>
          ) : filteredDays.length === 0 ? (
            <Text color="ivoryMuted">No days match this filter.</Text>
          ) : (
            filteredDays.map((day) => {
              const isSelected = editingDate === day.date;
              return (
                <Pressable
                  key={day.date}
                  disabled={!day.editable}
                  onPress={() => {
                    setSaveMessage(null);
                    setEditingDate(isSelected ? null : day.date);
                  }}
                  style={[styles.dayRow, isSelected && styles.dayRowSelected]}
                  accessibilityRole="button"
                  accessibilityLabel={`${day.date}, ${day.phaseLabel}, Sleep ${day.sleepText}, ${day.caffeineText}, Status ${day.statusText}`}
                  accessibilityState={{ selected: isSelected, disabled: !day.editable }}
                >
                  <View style={styles.dayRowMain}>
                    <View style={styles.dayHeaderLine}>
                      <Text variant="body" color="ivory" weight="semiBold" tabular>
                        {day.date}
                      </Text>
                      <Text variant="overline" color="champagneMuted">
                        {day.phaseLabel.toUpperCase()}
                      </Text>
                    </View>
                    <Text variant="sub" color="ivorySecondary" tabular>
                      Sleep: {day.sleepText} • {day.caffeineText}
                    </Text>
                    <Text
                      variant="caption"
                      color={
                        day.statusTone === 'unreadable'
                          ? 'garnet'
                          : day.statusTone === 'logged'
                          ? 'champagneLight'
                          : day.statusTone === 'partial'
                          ? 'ivorySecondary'
                          : 'ivoryMuted'
                      }
                    >
                      {day.statusText}
                    </Text>
                  </View>
                  <Text variant="sub" color={day.editable ? 'champagne' : 'ivorySubtle'}>
                    {!day.editable ? 'Read-only' : isSelected ? 'Editing' : 'Edit →'}
                  </Text>
                </Pressable>
              );
            })
          )}
        </Card>
      </ScrollView>

      <PrimaryNav current="journal" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.lg },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 132,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radii.control,
    gap: 4,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
  },
  barTrack: {
    flex: 1,
    width: '100%',
    maxWidth: 16,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 4,
  },
  barFill: {
    width: '100%',
    backgroundColor: colors.champagne,
    borderRadius: 4,
  },
  barMissingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.ivorySubtle,
  },
  barLabel: {
    fontSize: 9,
  },
  editorWrapper: {
    gap: spacing.xs,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  filterChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineBright,
    backgroundColor: colors.surfaceHigh,
  },
  filterChipActive: {
    backgroundColor: colors.champagne,
    borderColor: colors.champagne,
  },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    borderRadius: radii.control,
    gap: spacing.sm,
  },
  dayRowSelected: {
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.hairlineGold,
    borderWidth: 1,
  },
  dayRowMain: {
    flex: 1,
    gap: 2,
  },
  dayHeaderLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
