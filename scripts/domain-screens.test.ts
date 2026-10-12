import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseLocalDate,
  formatLocalDate,
  addDaysToLocalDate,
  getMorningEntryDate,
  daysBetween,
  canEditDate,
} from '../src/experiment/dates';
import { getRunInDescriptiveStats } from '../src/experiment/view-model';
import type { DailyEntry } from '../src/experiment/types';
import { mergePendingEntries, retryPendingEntries } from '../src/data/pending-entries';

test('parseLocalDate and formatLocalDate handle standard dates', () => {
  const parts = parseLocalDate('2026-10-11');
  assert.deepEqual(parts, { year: 2026, month: 10, day: 11 });
  assert.equal(formatLocalDate(parts.year, parts.month, parts.day), '2026-10-11');
});

test('parseLocalDate rejects invalid formats', () => {
  assert.throws(() => parseLocalDate('2026/10/11'), /Invalid local date format/);
  assert.throws(() => parseLocalDate('10-11-2026'), /Invalid local date format/);
});

test('month end roll-overs work correctly without UTC skew', () => {
  assert.equal(addDaysToLocalDate('2026-01-31', 1), '2026-02-01');
  assert.equal(addDaysToLocalDate('2026-02-28', 1), '2026-03-01');
  assert.equal(addDaysToLocalDate('2024-02-28', 1), '2024-02-29');
  assert.equal(addDaysToLocalDate('2024-02-29', 1), '2024-03-01');
  assert.equal(addDaysToLocalDate('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToLocalDate('2026-03-01', -1), '2026-02-28');
});

test('DST changeover dates do not cause day slippage', () => {
  assert.equal(addDaysToLocalDate('2026-03-07', 1), '2026-03-08');
  assert.equal(addDaysToLocalDate('2026-03-08', 1), '2026-03-09');
  assert.equal(addDaysToLocalDate('2026-10-31', 1), '2026-11-01');
  assert.equal(addDaysToLocalDate('2026-11-01', 1), '2026-11-02');
});

test('getMorningEntryDate writes to yesterday (engine exposure day)', () => {
  assert.equal(getMorningEntryDate('2026-10-11'), '2026-10-10');
  assert.equal(getMorningEntryDate('2026-03-01'), '2026-02-28');
  assert.equal(getMorningEntryDate('2026-01-01'), '2025-12-31');
});

test('daysBetween computes exact calendar day delta', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-10'), 9);
  assert.equal(daysBetween('2026-10-10', '2026-10-01'), -9);
  assert.equal(daysBetween('2026-10-10', '2026-10-10'), 0);
});

test('canEditDate permits only current entry date and previous 3 days', () => {
  const today = '2026-10-15';
  assert.equal(canEditDate(today, '2026-10-14'), true);
  assert.equal(canEditDate(today, '2026-10-13'), true);
  assert.equal(canEditDate(today, '2026-10-12'), true);
  assert.equal(canEditDate(today, '2026-10-11'), true);
  assert.equal(canEditDate(today, '2026-10-10'), false);
  assert.equal(canEditDate(today, '2026-10-15'), false);
  assert.equal(canEditDate(today, '2026-10-16'), false);
});

test('getRunInDescriptiveStats exposes descriptive counts only', () => {
  const entries: DailyEntry[] = [
    { date: '2026-10-01', sleepMinutes: 480, lastCaffeineTime: '14:00' },
    { date: '2026-10-02', sleepMinutes: 450, lastCaffeineTime: '10:00' },
    { date: '2026-10-03', sleepMinutes: null, lastCaffeineTime: 'none' },
    { date: '2026-10-04', sleepMinutes: 420, lastCaffeineTime: null },
  ];
  const stats = getRunInDescriptiveStats(entries);
  assert.equal(stats.daysLogged, 4);
  assert.equal(stats.validDays, 3);
  assert.equal(stats.averageSleepMinutes, 450);
  assert.equal(stats.afternoonCaffeineDays, 1);
  assert.equal(stats.unknownCaffeineDays, 1);
  assert.deepEqual(Object.keys(stats).sort(), [
    'afternoonCaffeineDays', 'averageSleepMinutes', 'daysLogged', 'unknownCaffeineDays', 'validDays',
  ]);
});

test('pending cache entries remain visible beside server data and failed retries preserve nulls', async () => {
  const pending = {
    date: '2026-10-12', sleepMinutes: null, lastCaffeineTime: null,
    editedAt: '2026-10-12T12:00:00.000Z', synced: false,
  };
  const serverEntry = {
    date: '2026-10-11', sleepMinutes: 420, lastCaffeineTime: 'none' as const,
    editedAt: '2026-10-11T12:00:00.000Z', synced: true,
  };
  assert.deepEqual(mergePendingEntries([serverEntry], [pending]), [serverEntry, pending]);

  const result = await retryPendingEntries([pending], async () => false);
  assert.equal(result.syncedCount, 0);
  assert.equal(result.failedCount, 1);
  assert.equal(result.entries[0].synced, false);
  assert.equal(result.entries[0].sleepMinutes, null);
  assert.equal(result.entries[0].lastCaffeineTime, null);
});

test('successful pending retry marks server persistence without inventing missing values', async () => {
  const result = await retryPendingEntries([{
    date: '2026-10-12', sleepMinutes: null, lastCaffeineTime: null,
    editedAt: '2026-10-12T12:00:00.000Z', synced: false,
  }], async entry => entry.sleepMinutes === null && entry.lastCaffeineTime === null);
  assert.equal(result.syncedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(result.entries[0].synced, true);
  assert.equal(result.entries[0].sleepMinutes, null);
  assert.equal(result.entries[0].lastCaffeineTime, null);
});
