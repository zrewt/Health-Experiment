import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSamplePlanRows,
  buildSampleRunInRows,
  isScreenPlan,
} from '../src/dev/fixtures';
import { buildDevDiagnostics } from '../src/dev/dev-diagnostics';
import { computeExperimentBaseline, progressSummary } from '../src/experiment/adapter';
import { CURRENT_CONSENT_VERSION } from '../src/experiment/consent';
import { addDaysToLocalDate } from '../src/experiment/dates';
import { generateSchedule } from '../src/engine';
import { runInMinValidDays } from '../src/experiment/config';
import type { DailyEntry } from '../src/experiment/types';
import type { ConsentRecord, ExperimentSetupRecord } from '../src/data/experiment-store';
import type { StoredExperimentPlan } from '../src/data/plan-persistence';

/**
 * Dev tooling is what makes the two experiments testable by hand. These tests pin the
 * fixtures to the test being prepared and the diagnostics to the state the app would show.
 */

const TODAY = '2026-04-20';

function setup(overrides: Partial<ExperimentSetupRecord> = {}): ExperimentSetupRecord {
  return {
    experimentId: 'caffeine-cutoff',
    cutoffTime: '12:00',
    screeningAnswer: 'usually',
    runInStartDate: addDaysToLocalDate(TODAY, -14),
    ...overrides,
  };
}

function consent(granted = true): ConsentRecord {
  return {
    userId: 'dev-user',
    consentType: 'health-data',
    policyVersion: CURRENT_CONSENT_VERSION,
    granted,
    createdAt: '2026-03-01T00:00:00.000Z',
  };
}

function asEntries(rows: ReturnType<typeof buildSampleRunInRows>): DailyEntry[] {
  return rows.map(row => ({
    date: row.date,
    sleepMinutes: row.sleep_minutes,
    lastCaffeineTime: row.last_caffeine_time ?? null,
    lastScreenTime: row.last_screen_time ?? null,
  }));
}

test('run-in fixtures carry only the exposure of the test they prepare', () => {
  const caffeine = buildSampleRunInRows('u1', TODAY, 'caffeine', '2026-04-19T08:00:00.000Z');
  assert.equal(caffeine.length, runInMinValidDays);
  assert.equal(caffeine[0].date, addDaysToLocalDate(TODAY, -14));
  assert.equal(caffeine[caffeine.length - 1].date, addDaysToLocalDate(TODAY, -1));
  assert.ok(caffeine.every(row => row.is_sample && row.edited_at === '2026-04-19T08:00:00.000Z'));
  assert.ok(caffeine.every(row => typeof row.last_caffeine_time === 'string'));
  assert.ok(caffeine.every(row => row.last_screen_time === undefined));

  const screens = buildSampleRunInRows('u1', TODAY, 'screens');
  assert.ok(screens.every(row => typeof row.last_screen_time === 'string'));
  assert.ok(screens.every(row => row.last_caffeine_time === undefined));
});

test('the run-in fixture clears eligibility for both tests', () => {
  const caffeine = computeExperimentBaseline('caffeine', asEntries(buildSampleRunInRows('u1', TODAY)), {
    cutoffTime: '12:00',
  });
  assert.equal(caffeine.eligible, true);
  assert.equal(caffeine.validDays, runInMinValidDays);
  assert.equal(caffeine.lateCaffeineDays >= 7, true);
  assert.equal(caffeine.unknownExposureDays, 0);
  assert.ok(caffeine.sd !== null);

  const screens = computeExperimentBaseline('screens', asEntries(buildSampleRunInRows('u1', TODAY, 'screens')), {
    cutoffTime: '21:30',
  });
  assert.equal(screens.eligible, true);
  assert.equal(screens.validDays, runInMinValidDays);
  assert.equal(screens.lateCaffeineDays >= 7, true);
  assert.equal(screens.unknownExposureDays, 0);
});

test('a screens run-in fixture never simulates caffeine, and vice versa', () => {
  const rows = buildSampleRunInRows('u1', TODAY, 'screens');
  const asCaffeine = computeExperimentBaseline('caffeine', asEntries(rows), { cutoffTime: '12:00' });
  // The screens rows have no caffeine at all: every day must read as unknown, not as clean.
  assert.equal(asCaffeine.knownExposureDays, 0);
  assert.equal(asCaffeine.unknownExposureDays, runInMinValidDays);

  const mixed = asEntries(buildSampleRunInRows('u1', TODAY, 'caffeine'));
  const asScreens = computeExperimentBaseline('screens', mixed, { cutoffTime: '21:30' });
  assert.equal(asScreens.knownExposureDays, 0);
  assert.equal(asScreens.unknownExposureDays, runInMinValidDays);
});

function planFor(exposure: 'caffeine-cutoff' | 'screen-cutoff', lengthDays = 42): StoredExperimentPlan['plan'] {
  const design = { type: 'randomized-blocks' as const, blockLength: 2, balanceWeekends: true };
  return {
    seed: 7,
    // Same derivation the plan writer uses; endDate() rejects any other value.
    analysisSeed: ((7 * 1664525 + 1013904223) >>> 0),
    schedule: generateSchedule('2026-05-01', lengthDays, design, 7),
    chosenDuration: lengthDays,
    startDate: '2026-05-01',
    assumedAdherence: 0.9,
    assumedContamination: 0.1,
    baselineStats: { sd: 30, assumedAutocorrelation: 0.2, validDays: 14 },
    definition: {
      name: exposure === 'screen-cutoff' ? 'Screens-off cutoff' : 'Caffeine cutoff',
      startDate: '2026-05-01',
      lengthDays,
      design,
      seed: 7,
      outcomeMetric: 'sleepMinutes',
      conditionRule: { type: exposure, cutoffTime: exposure === 'screen-cutoff' ? '21:30' : '12:00' },
    },
    feasibilitySnapshot: {} as StoredExperimentPlan['plan']['feasibilitySnapshot'],
  };
}

test('plan fixtures follow the plan rule and include a missed cutoff day', () => {
  const caffeinePlan = planFor('caffeine-cutoff');
  assert.equal(isScreenPlan(caffeinePlan), false);
  const caffeineRows = buildSamplePlanRows('u1', caffeinePlan);
  assert.equal(caffeineRows.length, caffeinePlan.schedule.length);
  assert.ok(caffeineRows.every(row => typeof row.last_caffeine_time === 'string'));
  assert.ok(caffeineRows.every(row => row.last_screen_time === undefined));
  // The intervention days mostly keep the rule; every seventh day misses it.
  const intervention = caffeinePlan.schedule.map((day, index) => ({ day, index }))
    .filter(item => item.day.condition === 'intervention');
  const misses = intervention.filter(item => caffeineRows[item.index].last_caffeine_time === '15:00');
  assert.ok(misses.length > 0, 'fixture must contain a missed cutoff day');

  const screensPlan = planFor('screen-cutoff');
  assert.equal(isScreenPlan(screensPlan), true);
  const screenRows = buildSamplePlanRows('u1', screensPlan);
  assert.ok(screenRows.every(row => typeof row.last_screen_time === 'string'));
  assert.ok(screenRows.every(row => row.last_caffeine_time === undefined));
});

test('sample test days fill the whole plan, so the end screen counts every day', () => {
  const plan = planFor('caffeine-cutoff', 42);
  const entries: DailyEntry[] = buildSamplePlanRows('u1', plan).map(row => ({
    date: row.date,
    sleepMinutes: row.sleep_minutes,
    lastCaffeineTime: row.last_caffeine_time ?? null,
    lastScreenTime: row.last_screen_time ?? null,
  }));
  const lastDay = plan.schedule[plan.schedule.length - 1].date;

  // This is the state the dev "jump to the last day + 1" button must land on: every
  // scheduled day has a night, so the final screen cannot read "0 of 42".
  const progress = progressSummary(plan, entries, addDaysToLocalDate(lastDay, 1));
  assert.equal(progress.daysLogged, 42);
  assert.equal(progress.daysRemaining, 0);
});

test('diagnostics name the screens test and its own numbers', () => {
  const rows = buildSampleRunInRows('u1', TODAY, 'screens');
  const diagnostics = buildDevDiagnostics({
    consent: consent(),
    setup: setup({ experimentId: 'screens-off-cutoff', cutoffTime: '21:30' }),
    entries: asEntries(rows),
    plans: [],
    plan: null,
    today: TODAY,
  });

  assert.match(diagnostics.headline, /Screens-off cutoff/);
  assert.match(diagnostics.headline, /Check is ready/);

  const value = (label: string) => diagnostics.rows.find(row => row.label === label)?.value;
  assert.equal(value('Cutoff'), '21:30');
  assert.equal(value('Valid run-in nights'), `14 of ${runInMinValidDays}`);
  assert.equal(value('Exposure not logged'), '0');
  assert.equal(value('Plan'), 'none');
  assert.ok(diagnostics.warnings.some(warning => /Run-in is complete/.test(warning)));
});

test('diagnostics report the plan position and adherence for a running test', () => {
  const plan = planFor('caffeine-cutoff', 4);
  const record: StoredExperimentPlan = { id: 'p1', status: 'scheduled', plan };
  const entries: DailyEntry[] = plan.schedule.map((day, index) => ({
    date: day.date,
    sleepMinutes: 440 + index,
    lastCaffeineTime: day.condition === 'intervention' ? '11:30' : '15:30',
  }));

  const diagnostics = buildDevDiagnostics({
    consent: consent(),
    setup: setup(),
    entries,
    plans: [record],
    plan: record,
    today: plan.schedule[2].date,
  });

  const value = (label: string) => diagnostics.rows.find(row => row.label === label)?.value;
  assert.equal(value('Plan'), 'scheduled · day 3 of 4');
  assert.equal(value('Home state'), 'Test running');
  assert.match(value('Plan adherence') ?? '', /^[0-9]+ kept · [0-9]+ missed/);
  assert.match(value('Plan adherence') ?? '', /\(3 logged days\)$/);
  assert.equal(value('Days remaining'), '1');
});

test('diagnostics flag a setup row and plan that disagree', () => {
  const plan = planFor('screen-cutoff', 4);
  const record: StoredExperimentPlan = { id: 'p2', status: 'scheduled', plan };
  const diagnostics = buildDevDiagnostics({
    consent: consent(),
    setup: setup(), // caffeine setup against a screens plan
    entries: [{ date: plan.schedule[0].date, sleepMinutes: 450, lastCaffeineTime: '15:00' }],
    plans: [record],
    plan: record,
    today: plan.schedule[0].date,
  });

  assert.ok(diagnostics.warnings.some(warning => /Setup says Caffeine cutoff/.test(warning)));
  assert.equal(diagnostics.rows.find(row => row.label === 'Test')?.value, 'Caffeine cutoff (caffeine-cutoff)');
});

test('a missing consent still reports a readable state instead of throwing', () => {
  const diagnostics = buildDevDiagnostics({
    consent: null,
    setup: null,
    entries: [],
    plans: [],
    plan: null,
    today: TODAY,
  });
  assert.equal(diagnostics.rows.find(row => row.label === 'Home state')?.value, 'Needs consent');
  assert.equal(diagnostics.rows.find(row => row.label === 'Test')?.value, 'Caffeine cutoff (caffeine-cutoff)');
});
