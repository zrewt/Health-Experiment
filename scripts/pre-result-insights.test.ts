import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { getMorningMirror } from '../src/experiment/morning-mirror';
import { getMilestones, getReportTrailer } from '../src/experiment/milestones';
import { getProgressFigures } from '../src/experiment/progress-figures';
import type { DailyEntry } from '../src/experiment/types';
import type { ScheduledDay } from '../src/engine';

/**
 * Everything here is shown before a result exists. These tests pin three things: the
 * numbers are right, a claim needs enough data, and no model ever contains a comparison
 * of sleep by day type (which would be an interim result).
 */

function entry(date: string, sleep: number | null, caffeine: string | 'none' | null = null): DailyEntry {
  return { date, sleepMinutes: sleep, lastCaffeineTime: caffeine };
}

function day(date: string, condition: 'intervention' | 'control', blockIndex: number): ScheduledDay {
  return { date, condition, blockIndex };
}

test('progress figures count kept days, pairs and the best run', () => {
  const schedule = [
    day('2026-04-01', 'intervention', 0),
    day('2026-04-02', 'control', 0),
    day('2026-04-03', 'intervention', 1),
    day('2026-04-04', 'control', 1),
  ];
  const entries = [
    entry('2026-04-01', 450, '11:30'),
    entry('2026-04-02', 450, '15:00'),
    entry('2026-04-03', 450, '11:00'),
    entry('2026-04-04', 450, '15:00'),
  ];

  const figures = getProgressFigures(schedule, entries, '12:00', 'caffeine', '2026-04-04');
  assert.equal(figures.cutoffDaysPlanned, 2);
  assert.equal(figures.cutoffDaysKept, 2);
  assert.equal(figures.daysElapsed, 4);
  assert.equal(figures.nightsLogged, 4);
  assert.equal(figures.cutoffDaysElapsed, 2);
  assert.equal(figures.pairsPlanned, 2);
  assert.equal(figures.pairsDone, 2);
  assert.equal(figures.bestRun, 2);
  assert.equal(figures.currentRun, 2);
  // 30 min before on day 1, 60 min before on day 3.
  assert.equal(figures.bufferAverageMinutes, 45);
  assert.equal(figures.bufferTrendMinutes, null);
});

test('an unlogged day does not complete its pair, and a missed cutoff breaks the run', () => {
  const schedule = [
    day('2026-04-01', 'intervention', 0),
    day('2026-04-02', 'control', 0),
    day('2026-04-03', 'intervention', 1),
    day('2026-04-04', 'control', 1),
  ];
  const entries = [
    entry('2026-04-01', 450, '11:30'),
    // 04-02 missing entirely
    entry('2026-04-03', 450, '15:00'),
    entry('2026-04-04', 450, '15:00'),
  ];

  const figures = getProgressFigures(schedule, entries, '12:00', 'caffeine', '2026-04-04');
  assert.equal(figures.cutoffDaysKept, 1);
  // The second pair (04-03 and 04-04) is complete; the first is not because 04-02 is missing.
  assert.equal(figures.pairsDone, 1);
  assert.equal(figures.bestRun, 1);
  assert.equal(figures.currentRun, 0);
});

test('the buffer trend goes positive when the user starts stopping earlier', () => {
  const schedule: ScheduledDay[] = [];
  const entries: DailyEntry[] = [];
  // Fourteen cutoff days: 30 min before for the first week, 70 min before for the second.
  for (let index = 0; index < 14; index++) {
    const date = `2026-05-${String(index + 1).padStart(2, '0')}`;
    schedule.push(day(date, 'intervention', index));
    entries.push(entry(date, 450, index < 7 ? '11:30' : '10:50'));
  }

  const figures = getProgressFigures(schedule, entries, '12:00', 'caffeine', '2026-05-14');
  assert.equal(figures.bufferAverageMinutes, 70);
  assert.equal(figures.bufferTrendMinutes, 40);
});

test('the mirror compares the night with the user own usual, not with the other day type', () => {
  const entries: DailyEntry[] = Array.from({ length: 7 }, (_, index) =>
    entry(`2026-03-0${index + 1}`, 450, '11:30'));
  entries.push(entry('2026-03-08', 480, '11:30'));

  const mirror = getMorningMirror({
    entries,
    today: '2026-03-08',
    exposure: 'caffeine',
    cutoffTime: '12:00',
  });
  assert.ok(mirror);
  assert.equal(mirror.date, '2026-03-08');
  assert.equal(mirror.sleepMinutes, 480);
  // If the target leaked into its own baseline the delta would be 15, not 30.
  assert.equal(mirror.deltaMinutes, 30);
  assert.equal(mirror.comparison, 'above');
  assert.match(mirror.headline, /30 min above your usual/);
  assert.equal(mirror.isResult, false);
  assert.deepEqual(mirror.range, { lowMinutes: 450, highMinutes: 480, nights: 8 });

  // Timing and behavior, never a condition contrast.
  assert.match(mirror.facts[0], /last caffeine was at 11:30, 30 min before the 12:00 cutoff/);
  assert.match(mirror.facts[1], /nights|logged/);
  const serialized = JSON.stringify(mirror);
  assert.doesNotMatch(serialized, /"(control|intervention)"/);
  assert.doesNotMatch(serialized, /pValue|interval|estimate|normal day/);
});

test('the mirror handles a missed cutoff, a screen-free evening and no baseline', () => {
  const after = getMorningMirror({
    entries: [entry('2026-03-01', 450, '13:30')],
    today: '2026-03-01',
    exposure: 'caffeine',
    cutoffTime: '12:00',
  });
  assert.ok(after);
  assert.match(after.facts[0], /90 min after the 12:00 cutoff/);
  assert.equal(after.deltaMinutes, null);
  assert.equal(after.headline, '7½ hours logged.');
  assert.match(after.facts[1], /You have logged 1 of the last 7 nights/);

  const screens = getMorningMirror({
    entries: [{ date: '2026-03-01', sleepMinutes: 450, lastCaffeineTime: null, lastScreenTime: 'none' }],
    today: '2026-03-01',
    exposure: 'screens',
    cutoffTime: '21:30',
  });
  assert.ok(screens);
  assert.equal(screens.facts[0], 'No screens that evening.');

  const missing = getMorningMirror({
    entries: [entry('2026-03-01', 450, null)],
    today: '2026-03-01',
    exposure: 'caffeine',
    cutoffTime: '12:00',
  });
  assert.ok(missing);
  assert.match(missing.facts[0], /was not logged/);
});

test('the mirror counts kept cutoff days in a row when a schedule is available', () => {
  const schedule = [
    day('2026-04-01', 'intervention', 0),
    day('2026-04-02', 'intervention', 0),
    day('2026-04-03', 'intervention', 1),
  ];
  const entries = [
    entry('2026-04-01', 450, '11:00'),
    entry('2026-04-02', 450, '10:30'),
    entry('2026-04-03', 450, '11:30'),
  ];
  const mirror = getMorningMirror({
    entries,
    today: '2026-04-03',
    exposure: 'caffeine',
    cutoffTime: '12:00',
    schedule,
  });
  assert.ok(mirror);
  assert.equal(mirror.facts[1], 'That is 3 cutoff days kept in a row.');
});

test('a range milestone needs three nights, and a weekday claim needs four nights each', () => {
  const twoNights = getMilestones({
    entries: [entry('2026-03-02', 450, '11:00'), entry('2026-03-03', 470, '11:00')],
    today: '2026-03-03',
    exposure: 'caffeine',
    cutoffTime: '12:00',
  });
  assert.equal(twoNights.some(item => item.id === 'range'), false);

  const threeNights = getMilestones({
    entries: [
      entry('2026-03-01', 400, '11:00'),
      entry('2026-03-02', 450, '11:00'),
      entry('2026-03-03', 480, '11:00'),
    ],
    today: '2026-03-03',
    exposure: 'caffeine',
    cutoffTime: '12:00',
  });
  const range = threeNights.find(item => item.id === 'range');
  assert.ok(range);
  assert.match(range.title, /6 h 40 min/);
  assert.match(range.title, /8 hours/);
  assert.match(range.body, /spread/);

  // Saturdays 07/14/21 at 7 h, Sundays 08/15/22 at 8 h 20 m.
  const weekdayEntries: DailyEntry[] = [];
  for (const date of ['2026-03-07', '2026-03-14', '2026-03-21']) weekdayEntries.push(entry(date, 420, '11:00'));
  for (const date of ['2026-03-08', '2026-03-15', '2026-03-22']) weekdayEntries.push(entry(date, 500, '11:00'));

  // Three Saturdays and three Sundays are not enough for either group.
  assert.equal(getMilestones({
    entries: weekdayEntries,
    today: '2026-03-22',
    exposure: 'caffeine',
    cutoffTime: '12:00',
  }).some(item => item.id === 'weekday'), false);

  // Four nights of each weekday is the floor.
  const fourEach: DailyEntry[] = [
    ...weekdayEntries,
    entry('2026-03-28', 420, '11:00'),
    entry('2026-03-29', 500, '11:00'),
  ];
  const weekday = getMilestones({
    entries: fourEach,
    today: '2026-03-29',
    exposure: 'caffeine',
    cutoffTime: '12:00',
  }).find(item => item.id === 'weekday');
  assert.ok(weekday);
  assert.equal(weekday.title, 'Sundays run about 80 min longer.');

  // Only one Saturday is not enough to make the claim.
  const thin = getMilestones({
    entries: [entry('2026-03-07', 420, '11:00'), ...weekdayEntries.filter(item => item.date.startsWith('2026-03-08') || item.date.startsWith('2026-03-15'))],
    today: '2026-03-22',
    exposure: 'caffeine',
    cutoffTime: '12:00',
  });
  assert.equal(thin.some(item => item.id === 'weekday'), false);
});

test('milestones never praise a run or a buffer', () => {
  const schedule = [
    day('2026-04-01', 'intervention', 0),
    day('2026-04-03', 'intervention', 1),
    day('2026-04-05', 'intervention', 2),
  ];
  const entries = [
    entry('2026-04-01', 450, '11:30'),
    entry('2026-04-03', 450, '11:00'),
    entry('2026-04-05', 450, '11:45'),
  ];
  const milestones = getMilestones({
    entries,
    today: '2026-04-05',
    exposure: 'caffeine',
    cutoffTime: '12:00',
    schedule,
  });
  assert.equal(milestones.some(item => item.id === 'best-run'), false);
  assert.equal(milestones.some(item => item.id === 'buffer'), false);
});

test('the report trailer opens at the midpoint and near the end, and never after it', () => {
  assert.equal(getReportTrailer(20, 42), null);
  assert.ok(getReportTrailer(21, 42));
  assert.ok(getReportTrailer(39, 42));
  assert.ok(getReportTrailer(40, 42));
  assert.equal(getReportTrailer(43, 42), null);
  assert.equal(getReportTrailer(0, 42), null);
  assert.match(getReportTrailer(21, 42)!.body, /cutoff days and normal days/);
  assert.doesNotMatch(getReportTrailer(21, 42)!.body, /minutes|estimate|interval/);
});

test('the mirror module never imports the result engine', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/experiment/morning-mirror.ts'), 'utf8');
  assert.doesNotMatch(source, /analyzeExperiment|getVerdict|evaluate\s*\(/);
});
