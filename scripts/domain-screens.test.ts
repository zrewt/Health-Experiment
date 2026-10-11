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
import {
  getRunInDescriptiveStats,
} from '../src/experiment/view-model';
import type { DailyEntry } from '../src/experiment/types';

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
  assert.equal(addDaysToLocalDate('2024-02-28', 1), '2024-02-29'); // Leap year
  assert.equal(addDaysToLocalDate('2024-02-29', 1), '2024-03-01');
  assert.equal(addDaysToLocalDate('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToLocalDate('2026-03-01', -1), '2026-02-28');
});

test('DST changeover dates do not cause day slippage', () => {
  // Spring forward in US: 2026-03-08
  assert.equal(addDaysToLocalDate('2026-03-07', 1), '2026-03-08');
  assert.equal(addDaysToLocalDate('2026-03-08', 1), '2026-03-09');
  // Fall back in US: 2026-11-01
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
  // If today is 2026-10-15, morning check-in entry date is 2026-10-14.
  const today = '2026-10-15';
  assert.equal(canEditDate(today, '2026-10-14'), true); // Day 0 (current)
  assert.equal(canEditDate(today, '2026-10-13'), true); // Day -1
  assert.equal(canEditDate(today, '2026-10-12'), true); // Day -2
  assert.equal(canEditDate(today, '2026-10-11'), true); // Day -3
  assert.equal(canEditDate(today, '2026-10-10'), false); // Day -4 (too old)
  assert.equal(canEditDate(today, '2026-10-15'), false); // Future relative to entry date
  assert.equal(canEditDate(today, '2026-10-16'), false);
});

test('getRunInDescriptiveStats computes engine-native descriptive counts only', () => {
  const entries: DailyEntry[] = [
    { date: '2026-10-01', sleepMinutes: 480, lastCaffeineTime: '14:00' },
    { date: '2026-10-02', sleepMinutes: 450, lastCaffeineTime: '10:00' },
    { date: '2026-10-03', sleepMinutes: null, lastCaffeineTime: 'none' }, // missing sleep
    { date: '2026-10-04', sleepMinutes: 420, lastCaffeineTime: null }, // unknown caffeine
  ];

  const stats = getRunInDescriptiveStats(entries);
  assert.equal(stats.daysLogged, 4);
  assert.equal(stats.validDays, 3);
  // Average sleep: (480 + 450 + 420) / 3 = 450
  assert.equal(stats.averageSleepMinutes, 450);
  // Afternoon caffeine (cutoff 12:00): day 1 is 14:00 -> 1 day
  assert.equal(stats.afternoonCaffeineDays, 1);
  // Unknown caffeine: day 4 -> 1 day
  assert.equal(stats.unknownCaffeineDays, 1);
});
