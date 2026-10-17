import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCheckInReceipt,
  buildRunInRange,
  buildRunInRecap,
  formatHoursMinutes,
  roundToFive,
  NOT_YOUR_RESULT,
  RANGE_MIN_NIGHTS,
  WEEKDAY_MIN_NIGHTS,
} from '../src/experiment/wait-value';
import { entriesForRunIn } from '../src/experiment/adapter';
import { getMilestones } from '../src/experiment/milestones';
import { CURRENT_CONSENT_VERSION } from '../src/experiment/consent';
import { getTodayDashboardModel } from '../src/experiment/today-dashboard';
import type { DailyEntry, ExperimentPlan } from '../src/experiment/types';
import type { ConsentRecord, ExperimentSetupRecord } from '../src/data/experiment-store';
import type { StoredExperimentPlan } from '../src/data/plan-persistence';
import { generateSchedule } from '../src/engine';

const BANNED = [
  'adherence',
  'exposure',
  'estimate',
  'power',
  'interval',
  'control',
  'randomized',
  'caused',
  'causes',
  'helped',
  'improves',
  'improved',
  'proves',
  'significant',
  'confidence',
  'p-value',
  'units',
  'streak',
  'best run',
  'buffer',
];

function entry(
  date: string,
  sleep: number | null,
  caffeine: string | 'none' | null = null,
  screens: string | 'none' | null = null,
): DailyEntry {
  return { date, sleepMinutes: sleep, lastCaffeineTime: caffeine, lastScreenTime: screens };
}

function assertPlain(text: string) {
  const lower = text.toLowerCase();
  for (const banned of BANNED) {
    assert.ok(!lower.includes(banned), `banned word "${banned}" in: ${text}`);
  }
  assert.ok(!/\d\.\d/.test(text), `decimal in: ${text}`);
}

function daysBetween(start: string, count: number): string[] {
  const dates: string[] = [];
  const [year, month, day] = start.split('-').map(Number);
  for (let index = 0; index < count; index++) {
    const date = new Date(Date.UTC(year, month - 1, day + index, 12));
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

const RUN_IN_DATES = daysBetween('2026-04-01', 14);
const RUN_IN = RUN_IN_DATES.map((date, index) =>
  entry(date, 400 + index * 5, index % 2 === 0 ? '11:30' : '15:00'),
);

function planFor(days = 42, startDate = '2026-05-01'): ExperimentPlan {
  const design = { type: 'randomized-blocks' as const, blockLength: 2, balanceWeekends: true };
  return {
    seed: 7,
    analysisSeed: ((7 * 1664525 + 1013904223) >>> 0),
    schedule: generateSchedule(startDate, days, design, 7),
    chosenDuration: days,
    startDate,
    assumedAdherence: 0.9,
    assumedContamination: 0.1,
    baselineStats: { sd: 30, assumedAutocorrelation: 0.2, validDays: 14 },
    definition: {
      name: 'Caffeine cutoff',
      startDate,
      lengthDays: days,
      design,
      seed: 7,
      outcomeMetric: 'sleepMinutes',
      conditionRule: { type: 'caffeine-cutoff', cutoffTime: '12:00' },
    },
    feasibilitySnapshot: { inputs: { minimumMeaningfulEffectMinutes: 10 }, options: [] } as never,
  };
}

test('the range unlocks at three nights, never two', () => {
  assert.equal(RANGE_MIN_NIGHTS, 3);
  assert.equal(buildRunInRange(RUN_IN.slice(0, 2)), null);
  const three = buildRunInRange(RUN_IN.slice(0, 3));
  assert.ok(three);
  assert.equal(three.nights, 3);
  assert.match(three.sentence, /which is why one night cannot answer the question/);
  assertPlain(three.sentence);

  const four = buildRunInRange(RUN_IN.slice(0, 4));
  assert.ok(four);
  assert.equal(four.nights, 4);
  assert.ok(four.highMinutes >= three.highMinutes);
  assert.ok(four.lowMinutes <= three.lowMinutes);
});

test('the range uses hours and minutes, rounded to five', () => {
  assert.equal(formatHoursMinutes(450), '7 hours 30 minutes');
  assert.equal(formatHoursMinutes(480), '8 hours');
  assert.equal(formatHoursMinutes(65), '1 hour 5 minutes');
  assert.equal(formatHoursMinutes(1), '1 minute');
  assert.equal(roundToFive(443), 445);
  assert.equal(roundToFive(442), 440);

  const range = buildRunInRange([
    entry('2026-04-01', 400, '11:00'),
    entry('2026-04-02', 443, '11:00'),
    entry('2026-04-03', 481, '11:00'),
  ]);
  assert.ok(range);
  assert.equal(range.sentence, 'Your nights so far run from 6 hours 40 minutes to 8 hours, which is why one night cannot answer the question.');
  assertPlain(range.sentence);
});

test('a mid-test receipt carries only the night entered and plain counts', () => {
  const plan = planFor(4);
  const dates = plan.schedule.map(day => day.date);
  const entries: DailyEntry[] = dates.map((date, index) => entry(
    date,
    // Wildly different sleep by day type: if any of it leaked, the test would see it.
    plan.schedule[index].condition === 'intervention' ? 520 : 380,
    plan.schedule[index].condition === 'intervention' ? '11:00' : '16:00',
  ));
  const target = entries[entries.length - 1];

  const receipt = buildCheckInReceipt({
    entry: target,
    entries,
    windowDates: dates,
    cutoffDates: plan.schedule.filter(day => day.condition === 'intervention').map(day => day.date),
    exposure: 'caffeine',
    cutoffTime: '12:00',
  });

  assert.deepEqual(Object.keys(receipt).sort(), [
    'counts', 'countsText', 'date', 'footer', 'sleepMinutes', 'sleepText', 'timingText',
  ]);
  assert.deepEqual(Object.keys(receipt.counts).sort(), [
    'cutoffDaysKept', 'cutoffDaysSoFar', 'nightsLogged', 'nightsSoFar',
  ]);
  assert.equal(receipt.sleepText, formatHoursMinutes(target.sleepMinutes as number));
  assert.equal(receipt.footer, NOT_YOUR_RESULT);
  assert.equal(receipt.counts.nightsSoFar, dates.length);
  assert.equal(receipt.counts.cutoffDaysKept, plan.schedule
    .filter(day => day.condition === 'intervention' && day.date <= dates[dates.length - 1])
    .filter(day => {
      const match = entries.find(item => item.date === day.date);
      return match?.lastCaffeineTime === '11:00';
    }).length);
  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(serialized, /control|intervention|average|delta|range/i);
  assertPlain(receipt.countsText);
  assertPlain(receipt.timingText);
});

test('a run-in receipt counts nights only, with no rule sentence', () => {
  const receipt = buildCheckInReceipt({
    entry: RUN_IN[2],
    entries: RUN_IN,
    windowDates: RUN_IN_DATES.slice(0, 3),
    exposure: 'caffeine',
    cutoffTime: null,
  });
  assert.equal(receipt.counts.cutoffDaysKept, null);
  assert.equal(receipt.counts.cutoffDaysSoFar, null);
  assert.equal(receipt.countsText, 'You logged 3 of 3 nights so far.');
  assertPlain(receipt.countsText);
});

test('the receipt names the test’s own exposure', () => {
  const screens = buildCheckInReceipt({
    entry: entry('2026-04-03', 450, null, 'none'),
    entries: [entry('2026-04-03', 450, null, 'none')],
    windowDates: ['2026-04-03'],
    exposure: 'screens',
    cutoffTime: '21:30',
  });
  assert.equal(screens.timingText, 'No screens that evening.');
  assertPlain(screens.timingText);
});

test('test days never reach the range or the recap', () => {
  // An earlier finished test (March) and a fresh run-in (April); the test's own days are
  // deliberately extreme, so any leak would move the range or the usual.
  const earlier = planFor(6, '2026-03-01');
  const testEntries: DailyEntry[] = earlier.schedule.map((day, index) =>
    entry(day.date, day.condition === 'intervention' ? 600 : 300, '10:00'));
  const all = [...testEntries, ...RUN_IN];

  const runInOnly = entriesForRunIn(all, [earlier], '2026-04-15');
  assert.equal(runInOnly.length, RUN_IN.length);
  assert.ok(runInOnly.every(item => !testEntries.some(test => test.date === item.date)));

  assert.deepEqual(buildRunInRange(runInOnly), buildRunInRange(RUN_IN));
  assert.deepEqual(buildRunInRecap(runInOnly, '2026-04-15'), buildRunInRecap(RUN_IN, '2026-04-15'));
});

test('the run-in recap says the weekly count and the user’s usual', () => {
  const recap = buildRunInRecap(RUN_IN, '2026-04-15');
  assert.ok(recap);
  assert.equal(recap.nights, 7);
  assert.equal(recap.sentence, 'You logged 7 nights this week and your usual is about 7 hours 30 minutes.');
  assertPlain(recap.sentence);
  assert.equal(buildRunInRecap([], '2026-04-15'), null);
});

test('weekday cards need four nights of that weekday', () => {
  assert.equal(WEEKDAY_MIN_NIGHTS, 4);
  const saturdays = ['2026-03-07', '2026-03-14', '2026-03-21'];
  const sundays = ['2026-03-08', '2026-03-15', '2026-03-22'];
  const threeEach: DailyEntry[] = [
    ...saturdays.map(date => entry(date, 420, '11:00')),
    ...sundays.map(date => entry(date, 500, '11:00')),
  ];
  const thin = getMilestones({
    entries: threeEach, today: '2026-03-22', exposure: 'caffeine', cutoffTime: '12:00',
  });
  assert.equal(thin.some(item => item.id === 'weekday'), false);

  const fourEach: DailyEntry[] = [
    ...[...saturdays, '2026-03-28'].map(date => entry(date, 420, '11:00')),
    ...[...sundays, '2026-03-29'].map(date => entry(date, 500, '11:00')),
  ];
  const thick = getMilestones({
    entries: fourEach, today: '2026-03-29', exposure: 'caffeine', cutoffTime: '12:00',
  });
  assert.ok(thick.some(item => item.id === 'weekday'));
});

test('no milestone praises a run or a buffer', () => {
  const plan = planFor(8);
  const entries: DailyEntry[] = plan.schedule.map(day =>
    entry(day.date, 450, day.condition === 'intervention' ? '11:00' : '15:00'));
  const ids = getMilestones({
    entries,
    today: entries[entries.length - 1].date,
    exposure: 'caffeine',
    cutoffTime: '12:00',
    schedule: plan.schedule,
  }).map(item => item.id);
  assert.deepEqual(ids.filter(id => id === 'best-run' || id === 'buffer'), []);
  for (const text of getMilestones({
    entries,
    today: entries[entries.length - 1].date,
    exposure: 'caffeine',
    cutoffTime: '12:00',
    schedule: plan.schedule,
  }).flatMap(item => [item.title, item.body])) {
    assertPlain(text);
  }
});

test('the running-test dashboard model exposes counts, never sleep by day type', () => {
  const plan = planFor(6);
  const entries: DailyEntry[] = plan.schedule.slice(0, 3).map((day, index) =>
    entry(day.date, index % 2 === 0 ? 520 : 350, index % 2 === 0 ? '11:00' : '16:00'));

  const consent: ConsentRecord = {
    userId: 'u1',
    consentType: 'health-data',
    policyVersion: CURRENT_CONSENT_VERSION,
    granted: true,
    createdAt: '2026-04-01T00:00:00.000Z',
  };
  const setup: ExperimentSetupRecord = {
    experimentId: 'caffeine-cutoff',
    cutoffTime: '12:00',
    screeningAnswer: 'usually',
    runInStartDate: '2026-04-01',
  };
  const planRecord: StoredExperimentPlan = { id: 'p1', plan, status: 'scheduled' };

  const model = getTodayDashboardModel({
    consent,
    setup,
    entries,
    plan: planRecord,
    plans: [plan],
    today: plan.schedule[2].date,
  });

  assert.equal(model.state, 'plan_active');
  assert.equal(model.progress?.kind, 'experiment');
  if (model.progress?.kind !== 'experiment') return;
  assert.equal(model.progress.nightsLogged, 3);
  assert.equal(model.progress.nightsSoFar, 3);
  assert.deepEqual(Object.keys(model.progress).sort(), [
    'adherenceCounts', 'currentDayNum', 'cutoffDaysKept', 'cutoffDaysSoFar',
    'daysLogged', 'daysRemaining', 'kind', 'nextStepText', 'nightsLogged',
    'nightsSoFar', 'pairsDone', 'pairsPlanned', 'totalDays',
  ]);
  const serialized = JSON.stringify(model.progress);
  // Adherence keys are counts of days, not sleep values: no night's duration may appear.
  assert.doesNotMatch(serialized, /520|350|intervention|average|range|estimate|sleepMinutes/i);
});

test('the new module never imports the result engine', () => {
  for (const file of ['wait-value.ts']) {
    const source = fs.readFileSync(path.resolve(__dirname, `../src/experiment/${file}`), 'utf8');
    assert.doesNotMatch(source, /analyzeExperiment|getVerdict|evaluate\s*\(|result-(summary|plain-language)/);
    assert.doesNotMatch(source, /from '\.\/adapter'/);
  }
});
