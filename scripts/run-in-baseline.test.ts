import { CURRENT_CONSENT_VERSION } from '../src/experiment/consent';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSchedule } from '../src/engine';
import {
  computeBaseline,
  entriesForRunIn,
  lastPlannedDate,
  validRunInDays,
} from '../src/experiment/adapter';
import { getHomeState } from '../src/experiment/home-state';
import { getTodayDashboardModel } from '../src/experiment/today-dashboard';
import { getJournalViewModel } from '../src/experiment/journal';
import { addDaysToLocalDate, canEditDate } from '../src/experiment/dates';
import { runInMinValidDays } from '../src/experiment/config';
import type { DailyEntry, ExperimentPlan } from '../src/experiment/types';
import type { StoredExperimentPlan } from '../src/data/plan-persistence';

/**
 * A new cycle's baseline must be its own run-in, not the tail of the test before it.
 *
 * Dataset: one finished 42-day test (cutoff days at 11:00 caffeine, normal days at 15:30,
 * with a large sleep difference between them, as a real cutoff would produce), then a fresh
 * 14-night run-in after its last scheduled day. Every night is logged.
 */

const PLAN_START = '2026-01-05';
const PLAN_LENGTH = 42;
const PLAN_SEED = 20260105;
const RUN_IN_NIGHTS = 14;

function completedPlan(): StoredExperimentPlan {
  const design = { type: 'randomized-blocks' as const, blockLength: 2, balanceWeekends: true };
  const schedule = generateSchedule(PLAN_START, PLAN_LENGTH, design, PLAN_SEED);
  const plan: ExperimentPlan = {
    seed: PLAN_SEED,
    analysisSeed: 12345,
    chosenDuration: PLAN_LENGTH,
    startDate: PLAN_START,
    schedule,
    assumedAdherence: 0.9,
    assumedContamination: 0.1,
    baselineStats: { sd: 30, assumedAutocorrelation: 0.4, validDays: 14 },
    definition: {
      name: 'Caffeine cutoff',
      startDate: PLAN_START,
      lengthDays: PLAN_LENGTH,
      design,
      seed: PLAN_SEED,
      outcomeMetric: 'sleepMinutes',
      conditionRule: { type: 'caffeine-cutoff', cutoffTime: '12:00' },
    },
    feasibilitySnapshot: {} as ExperimentPlan['feasibilitySnapshot'],
  };
  return { id: 'plan-finished', status: 'completed', plan };
}

const finishedPlan = completedPlan();
const LAST_PLANNED_DAY = finishedPlan.plan.schedule[finishedPlan.plan.schedule.length - 1].date;
/** The first night of the new cycle: the day after the finished test's last scheduled day. */
const FIRST_RUN_IN_NIGHT = addDaysToLocalDate(LAST_PLANNED_DAY, 1);

/** The finished test's log: a cutoff morning against a normal morning. */
function planLogs(): DailyEntry[] {
  return finishedPlan.plan.schedule.map((day) =>
    day.condition === 'intervention'
      ? { date: day.date, sleepMinutes: 500, lastCaffeineTime: '11:00' }
      : { date: day.date, sleepMinutes: 430, lastCaffeineTime: '15:30' });
}

const RUN_IN_SLEEP = [430, 480, 445, 465, 420, 490, 450, 470, 435, 475, 440, 485, 455, 460];

/** The new cycle's log: ordinary nights, caffeine every afternoon, past the cutoff. */
function runInLogs(nights = RUN_IN_NIGHTS): DailyEntry[] {
  return Array.from({ length: nights }, (_, index) => ({
    date: addDaysToLocalDate(FIRST_RUN_IN_NIGHT, index),
    sleepMinutes: RUN_IN_SLEEP[index % RUN_IN_SLEEP.length],
    lastCaffeineTime: '15:00',
  }));
}

const allEntries: DailyEntry[] = [...planLogs(), ...runInLogs()];
const plannedDates = new Set(finishedPlan.plan.schedule.map((day) => day.date));
const today = addDaysToLocalDate(FIRST_RUN_IN_NIGHT, RUN_IN_NIGHTS - 1);

const planWindows = [finishedPlan.plan];
const runInOnly = entriesForRunIn(allEntries, planWindows, today);

// Printed once for the report: the numbers the leak used to produce against the numbers now.
const before = computeBaseline(allEntries);
const after = computeBaseline(runInOnly);
console.log('');
console.log('BASELINE NUMBERS ON THE TEST DATASET');
console.log(`  before (every logged day): validDays ${before.validDays}, SD ${before.sd}, eligible ${before.eligible}, late-caffeine days ${before.lateCaffeineDays} of ${before.knownExposureDays + before.unknownExposureDays}`);
console.log(`  after  (run-in window)   : validDays ${after.validDays}, SD ${after.sd}, eligible ${after.eligible}, late-caffeine days ${after.lateCaffeineDays} of ${after.knownExposureDays + after.unknownExposureDays}`);

test('the run-in window holds only nights after the finished test', () => {
  assert.equal(lastPlannedDate(planWindows), LAST_PLANNED_DAY);
  assert.equal(runInOnly.length, RUN_IN_NIGHTS);
  assert.equal(runInOnly.some((entry) => plannedDates.has(entry.date)), false);
  assert.equal(runInOnly[0].date, FIRST_RUN_IN_NIGHT);
  assert.equal(runInOnly[runInOnly.length - 1].date, today);
  assert.equal(allEntries.length, PLAN_LENGTH + RUN_IN_NIGHTS);
});

test('the baseline and the eligibility check use the new cycle only', () => {
  assert.equal(after.validDays, RUN_IN_NIGHTS);
  assert.equal(after.eligible, true);
  // Every run-in night has caffeine after the cutoff, and nothing from the test is mixed in.
  assert.equal(after.lateCaffeineDays, RUN_IN_NIGHTS);
  assert.equal(after.knownExposureDays, RUN_IN_NIGHTS);
  assert.equal(after.unknownExposureDays, 0);
});

test('negative control: the old all-entries baseline differs on this dataset', () => {
  // The previous behaviour fed every logged night in.
  assert.equal(before.validDays, PLAN_LENGTH + RUN_IN_NIGHTS);
  assert.ok(before.sd !== null && after.sd !== null);
  // The finished test's own cutoff effect inflates the spread the feasibility verdict reads.
  assert.ok(before.sd > after.sd, `expected the leaked baseline to be wider: ${before.sd} vs ${after.sd}`);
  assert.equal(before.lateCaffeineDays, RUN_IN_NIGHTS + finishedPlan.plan.schedule.filter((d) => d.condition === 'control').length);
  assert.notEqual(before.validDays, after.validDays);
});

test('boundary: the last scheduled day is out, the day after it is in', () => {
  const lastDayOfTest: DailyEntry = { date: LAST_PLANNED_DAY, sleepMinutes: 470, lastCaffeineTime: '15:00' };
  const firstNightOfRunIn: DailyEntry = { date: FIRST_RUN_IN_NIGHT, sleepMinutes: 455, lastCaffeineTime: '15:00' };
  const boundary = entriesForRunIn([lastDayOfTest, firstNightOfRunIn], planWindows, today);
  assert.deepEqual(boundary.map((entry) => entry.date), [FIRST_RUN_IN_NIGHT]);
  // A night inside the test, and the last night of it, are both excluded.
  assert.deepEqual(entriesForRunIn([lastDayOfTest], planWindows, today), []);
  const insideTest: DailyEntry = { date: finishedPlan.plan.schedule[0].date, sleepMinutes: 480, lastCaffeineTime: '11:00' };
  assert.deepEqual(entriesForRunIn([insideTest], planWindows, today), []);
});

test('a night dated in the future is not part of the run-in', () => {
  const tomorrow = addDaysToLocalDate(today, 1);
  const future: DailyEntry = { date: tomorrow, sleepMinutes: 450, lastCaffeineTime: '15:00' };
  assert.equal(entriesForRunIn([...runInOnly, future], planWindows, today).length, RUN_IN_NIGHTS);
});

test('the first cycle is unchanged: with no earlier plan every logged night counts', () => {
  assert.deepEqual(entriesForRunIn(allEntries, [], today), allEntries);
  assert.equal(validRunInDays(allEntries, [], today), PLAN_LENGTH + RUN_IN_NIGHTS);
  // Same rule as before for an account that has never run a test.
  assert.equal(getHomeState({
    consent: { userId: 'u', consentType: 'health-data', policyVersion: CURRENT_CONSENT_VERSION, granted: true, createdAt: '2026-01-01T00:00:00.000Z' },
    setup: { experimentId: 'caffeine-cutoff', cutoffTime: '12:00', screeningAnswer: 'usually', runInStartDate: '2026-01-01' },
    entries: runInLogs(),
    plan: null,
    plans: [],
    today,
  }), 'feasibility_ready');
});

test('missing stays missing: a skipped night is not a valid day and is not a zero', () => {
  const skipped: DailyEntry = { date: addDaysToLocalDate(today, -1), sleepMinutes: null, lastCaffeineTime: null };
  const withSkipped = [...runInOnly.filter((entry) => entry.date !== skipped.date), skipped];
  const baseline = computeBaseline(entriesForRunIn(withSkipped, planWindows, today));
  assert.equal(baseline.validDays, RUN_IN_NIGHTS - 1);
  assert.equal(baseline.unknownExposureDays, 1);
  assert.equal(baseline.knownExposureDays, RUN_IN_NIGHTS - 1);
});

test('the gate follows the same rule: a finished test cannot unlock the next run-in', () => {
  const threeNights = runInLogs(3);
  const entries = [...planLogs(), ...threeNights];
  const gateToday = threeNights[threeNights.length - 1].date;
  const inputs = {
    consent: { userId: 'u', consentType: 'health-data' as const, policyVersion: CURRENT_CONSENT_VERSION, granted: true, createdAt: '2026-01-01T00:00:00.000Z' },
    setup: { experimentId: 'caffeine-cutoff', cutoffTime: '12:00', screeningAnswer: 'usually' as const, runInStartDate: '2026-01-01' },
    entries,
    plan: null,
    plans: planWindows,
    today: gateToday,
  };

  assert.equal(validRunInDays(entries, planWindows, gateToday), 3);
  assert.ok(validRunInDays(entries, planWindows, gateToday) < runInMinValidDays);
  assert.equal(getHomeState(inputs), 'run_in');
  // The old count (every logged night) is what used to unlock the check: 42 + 3 >= 14.
  assert.equal(entries.filter((entry) => entry.sleepMinutes !== null).length, PLAN_LENGTH + 3);
  assert.ok(entries.filter((entry) => entry.sleepMinutes !== null).length >= runInMinValidDays);
});

test('archived completed plan dates stay edit-locked on Today and Journal during the new run-in', () => {
  // On the morning of FIRST_RUN_IN_NIGHT (the day after E), yesterday is LAST_PLANNED_DAY (E).
  // Even after the user archives the completed plan to start a second cycle (plan = null,
  // plans = [finishedPlan.plan]), LAST_PLANNED_DAY and earlier schedule days must remain locked.
  const dayAfterTest = FIRST_RUN_IN_NIGHT;
  assert.equal(canEditDate(dayAfterTest, LAST_PLANNED_DAY, [finishedPlan]), false);

  const dashboardOnDayAfter = getTodayDashboardModel({
    consent: { userId: 'u', consentType: 'health-data', policyVersion: CURRENT_CONSENT_VERSION, granted: true, createdAt: '2026-01-01T00:00:00.000Z' },
    setup: { experimentId: 'caffeine-cutoff', cutoffTime: '12:00', screeningAnswer: 'usually', runInStartDate: '2026-01-01' },
    entries: planLogs(),
    plan: null,
    plans: planWindows,
    today: dayAfterTest,
  });
  for (const recent of dashboardOnDayAfter.checkIn.recentDays) {
    assert.equal(recent.editable, false, `completed test day ${recent.date} must stay locked on Today`);
  }

  const journalOnDayAfter = getJournalViewModel({
    entries: planLogs(),
    today: dayAfterTest,
    setup: { experimentId: 'caffeine-cutoff', cutoffTime: '12:00', screeningAnswer: 'usually', runInStartDate: '2026-01-01' },
    plan: null,
    plans: [finishedPlan],
  });
  const lastScheduledInJournal = journalOnDayAfter.days.find((d) => d.date === LAST_PLANNED_DAY);
  assert.ok(lastScheduledInJournal);
  assert.equal(lastScheduledInJournal.editable, false, 'completed test day must stay locked in Journal');
  assert.equal(lastScheduledInJournal.phaseLabel, 'Test day');
});

