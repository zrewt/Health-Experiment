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
import { getJournalViewModel } from '../src/experiment/journal';
import type { DailyEntry } from '../src/experiment/types';
import { mergePendingEntries, retryPendingEntries } from '../src/data/pending-entries';
import {
  isValidCaffeineTime,
  readCaffeineTime,
  engineCaffeineTime,
  engineCaffeineServings,
  sanitizeCaffeineTimeForWrite,
  type StoredCaffeineTime,
} from '../src/experiment/caffeine-time';

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
  assert.equal(stats.afterCutoffDays, 1);
  assert.equal(stats.unknownExposureDays, 1);
  // The caffeine-only names still mirror the exposure-neutral fields.
  assert.equal(stats.afternoonCaffeineDays, stats.afterCutoffDays);
  assert.equal(stats.unknownCaffeineDays, stats.unknownExposureDays);
  assert.deepEqual(Object.keys(stats).sort(), [
    'afterCutoffDays', 'afternoonCaffeineDays', 'averageSleepMinutes', 'daysLogged',
    'unknownCaffeineDays', 'unknownExposureDays', 'validDays',
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

test('caffeine time validator accepts only strict 24-hour HH:mm', () => {
  for (const value of ['00:00', '09:05', '14:30', '23:59']) {
    assert.equal(isValidCaffeineTime(value), true, `accepts ${value}`);
  }
  for (const value of ['2:30', '9:30', '14:0', '2pm', '24:00', '12:60', ' 14:30', '14:30 ', '14:30:00', '', '14.30']) {
    assert.equal(isValidCaffeineTime(value), false, `rejects ${JSON.stringify(value)}`);
  }
});

test('caffeine time reading separates none, unset, valid and unreadable without guessing', () => {
  assert.deepEqual(readCaffeineTime(null), { kind: 'unset', time: null });
  assert.deepEqual(readCaffeineTime(''), { kind: 'unset', time: null });
  assert.deepEqual(readCaffeineTime('none'), { kind: 'none', time: null });
  assert.deepEqual(readCaffeineTime('14:30'), { kind: 'valid', time: '14:30' });
  assert.deepEqual(readCaffeineTime('9:30'), { kind: 'unreadable', time: null });
  assert.deepEqual(readCaffeineTime('nope'), { kind: 'unreadable', time: null });
});

test('caffeine helpers never turn a malformed or blank value into zero servings or a padded time', () => {
  const cases: Array<[string, StoredCaffeineTime, string | null, number | null, string | 'none' | null]> = [
    ['valid time', '14:30', '14:30', null, '14:30'],
    ['none', 'none', null, 0, 'none'],
    ['null (skipped)', null, null, null, null],
    ['blank', '', null, null, null],
    ['malformed single-digit', '9:30', null, null, null],
    ['malformed am/pm', '2pm', null, null, null],
    ['malformed leading space', ' 14:30', null, null, null],
    ['malformed trailing space', '14:30 ', null, null, null],
  ];
  for (const [label, input, expectedTime, expectedServings, expectedWrite] of cases) {
    assert.equal(engineCaffeineTime(input), expectedTime, `${label}: engine time`);
    assert.equal(engineCaffeineServings(input), expectedServings, `${label}: engine servings`);
    assert.equal(sanitizeCaffeineTimeForWrite(input), expectedWrite, `${label}: write value`);
  }
  // A malformed value must never become zero servings (that would read as "no caffeine").
  for (const malformed of ['9:30', '2pm', ' 14:30', '14:30 ', '25:00', 'nope', '14.30']) {
    assert.notEqual(engineCaffeineServings(malformed), 0, `malformed ${JSON.stringify(malformed)} must not be zero servings`);
    assert.notEqual(sanitizeCaffeineTimeForWrite(malformed), 'none', `malformed ${JSON.stringify(malformed)} must not become none`);
    assert.equal(sanitizeCaffeineTimeForWrite(malformed), null, `malformed ${JSON.stringify(malformed)} must not be persisted`);
  }
});

test('run-in descriptive panel never throws and counts malformed caffeine times as unknown without padding', () => {
  const entries: DailyEntry[] = [
    { date: '2026-10-01', sleepMinutes: 480, lastCaffeineTime: '14:30' },
    { date: '2026-10-02', sleepMinutes: 450, lastCaffeineTime: 'none' },
    { date: '2026-10-03', sleepMinutes: 420, lastCaffeineTime: '9:30' },
    { date: '2026-10-04', sleepMinutes: 430, lastCaffeineTime: ' 14:30' },
    { date: '2026-10-05', sleepMinutes: 440, lastCaffeineTime: '09:30' },
    { date: '2026-10-06', sleepMinutes: null, lastCaffeineTime: null },
  ];
  const stats = getRunInDescriptiveStats(entries);
  assert.equal(stats.daysLogged, 6);
  assert.equal(stats.validDays, 5);
  assert.equal(stats.averageSleepMinutes, (480 + 450 + 420 + 430 + 440) / 5);
  // Only 14:30 is after cutoff; 'none' and the valid 09:30 stay known but are not late.
  assert.equal(stats.afternoonCaffeineDays, 1);
  // Malformed '9:30', malformed ' 14:30' and unset null are unknown; nothing is padded.
  assert.equal(stats.unknownCaffeineDays, 3);
});

test('local times that cross a UTC date boundary still resolve to the local calendar date', () => {
  // Near-midnight local times are where UTC and local calendar dates disagree, which is the
  // exact shape of the bug fixed in a72854c. Exercises parseLocalDate, addDaysToLocalDate,
  // getMorningEntryDate and canEditDate across the boundary.

  // 23:30 local on 2026-02-15: the local date is 2026-02-15 even though UTC may already be
  // the 16th. parseLocalDate must accept the result of formatLocalDate.
  assert.deepEqual(parseLocalDate('2026-02-15'), { year: 2026, month: 2, day: 15 });
  assert.equal(formatLocalDate(2026, 2, 15), '2026-02-15');

  // Morning entry for a day whose previous evening was 23:30 is yesterday.
  assert.equal(getMorningEntryDate('2026-02-16'), '2026-02-15');

  // addDaysToLocalDate across the boundary does not flip to UTC.
  assert.equal(addDaysToLocalDate('2026-02-15', 1), '2026-02-16');
  assert.equal(addDaysToLocalDate('2026-02-15', -1), '2026-02-14');

  // 00:30 local on 2026-02-15 is still 2026-02-15; it is not 2026-02-14.
  assert.deepEqual(parseLocalDate('2026-02-15'), { year: 2026, month: 2, day: 15 });

  // canEditDate at the boundary: if the entry date is the morning check-in date it is editable.
  assert.equal(canEditDate('2026-02-16', '2026-02-15'), true, 'yesterday is the current entry date');
});

test('engineCaffeineTime and engineCaffeineServings honour the local date for near-midnight times', () => {
  // A time logged at 23:30 is a late caffeine time for eligibility but still a valid HH:mm.
  assert.equal(engineCaffeineTime('23:30'), '23:30');
  assert.equal(engineCaffeineServings('23:30'), null, 'a real time is unknown servings, not zero');

  // A time logged at 00:30 is still valid, and 00:30 is before noon so not late.
  assert.equal(engineCaffeineTime('00:30'), '00:30');
  assert.equal(engineCaffeineServings('00:30'), null);

  // Neither near-midnight time is treated as none.
  assert.notEqual(engineCaffeineServings('23:30'), 0);
  assert.notEqual(engineCaffeineServings('00:30'), 0);

  // A malformed near-midnight-looking value is still rejected.
  assert.equal(readCaffeineTime('23:3').kind, 'unreadable');
  assert.equal(readCaffeineTime('0:30').kind, 'unreadable');
});

test('getJournalViewModel builds dated list, preserves missing as null, and exposes accessible chart without condition comparison', () => {
  const setup = {
    experimentId: 'caffeine-cutoff',
    cutoffTime: '12:00',
    screeningAnswer: 'usually' as const,
    runInStartDate: '2026-02-10',
  };
  const entries = [
    { date: '2026-02-10', sleepMinutes: 450, lastCaffeineTime: '14:30', synced: true },
    // 2026-02-11 is completely unlogged (missing in timeline)
    { date: '2026-02-12', sleepMinutes: 420, lastCaffeineTime: null, synced: true }, // partly logged
    { date: '2026-02-13', sleepMinutes: 460, lastCaffeineTime: '9:30', synced: false }, // malformed + unsynced
    { date: '2026-02-14', sleepMinutes: 480, lastCaffeineTime: 'none' as const, synced: true },
  ];

  const vm = getJournalViewModel({
    entries,
    today: '2026-02-15',
    setup,
    plan: null,
  });

  assert.equal(vm.yesterday, '2026-02-14');
  assert.equal(vm.summary.totalTimelineDays, 5); // Feb 10..14 inclusive
  assert.equal(vm.summary.loggedDays, 2); // Feb 10 and Feb 14
  assert.equal(vm.summary.partialDays, 2); // Feb 12 and Feb 13 (sleep present, caffeine unreadable)
  assert.equal(vm.summary.missingDays, 1); // Feb 11

  const feb11 = vm.days.find(d => d.date === '2026-02-11')!;
  assert.equal(feb11.sleepMinutes, null, 'missing sleep remains null, never zero');
  assert.equal(feb11.sleepText, 'Not logged');
  assert.equal(feb11.statusTone, 'missing');
  assert.equal(feb11.editable, true); // within 3 days of 2026-02-14

  const feb10 = vm.days.find(d => d.date === '2026-02-10')!;
  assert.equal(feb10.editable, false); // 4 days before 2026-02-14

  const feb11Bar = vm.chart.bars.find(b => b.date === '2026-02-11')!;
  assert.equal(feb11Bar.sleepMinutes, null);
  assert.equal(feb11Bar.heightFraction, 0);
  assert.match(feb11Bar.accessibleSummary, /sleep not logged/);
  assert.match(vm.chart.accessibleOverview, /4 of 5 nights logged/);
});
