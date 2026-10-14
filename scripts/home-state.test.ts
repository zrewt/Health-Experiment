import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getHomeState, HomeStateInputs } from '../src/experiment/home-state';
import { getTodayDashboardModel } from '../src/experiment/today-dashboard';
import { generateSchedule } from '../src/engine';
import { CAFFEINE_TIME_UNREADABLE_MARKER } from '../src/experiment/caffeine-time';
import { getToday, __setDevClockOffset } from '../src/experiment/clock';
import type { StoredExperimentPlan } from '../src/data/plan-persistence';
import type { ExperimentPlan } from '../src/experiment/types';

const defaultConsent = {
  userId: 'user-1',
  consentType: 'health-data' as const,
  policyVersion: '2026-10-health-draft-v1',
  granted: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const defaultSetup = {
  experimentId: 'caffeine-cutoff',
  cutoffTime: '12:00',
  screeningAnswer: 'usually' as const,
  runInStartDate: '2026-01-01',
};

function makePlan(startDate: string, lengthDays = 4, status = 'scheduled'): StoredExperimentPlan {
  const schedule = [
    { date: '2026-01-15', condition: 'intervention' as const, blockIndex: 0 },
    { date: '2026-01-16', condition: 'intervention' as const, blockIndex: 0 },
    { date: '2026-01-17', condition: 'control' as const, blockIndex: 1 },
    { date: '2026-01-18', condition: 'control' as const, blockIndex: 1 },
  ];
  return {
    id: 'plan-1',
    status,
    plan: {
      seed: 1234,
      analysisSeed: 5678,
      startDate,
      chosenDuration: lengthDays,
      schedule,
      assumedAdherence: 0.9,
      assumedContamination: 0.1,
      baselineStats: { sd: 30, assumedAutocorrelation: 0.4, validDays: 14 },
      definition: {
        name: 'Caffeine cutoff',
        startDate,
        lengthDays,
        design: { type: 'randomized-blocks', blockLength: 2, balanceWeekends: true },
        seed: 1234,
        outcomeMetric: 'sleepMinutes',
        conditionRule: { type: 'caffeine-cutoff', cutoffTime: '12:00' },
      },
      feasibilitySnapshot: {} as any,
    },
  };
}

test('getHomeState returns needs_consent when consent is missing or ungranted', () => {
  assert.equal(getHomeState({
    consent: null,
    setup: defaultSetup,
    entries: [],
    plan: null,
    today: '2026-01-01',
  }), 'needs_consent');

  assert.equal(getHomeState({
    consent: { ...defaultConsent, granted: false },
    setup: defaultSetup,
    entries: [],
    plan: null,
    today: '2026-01-01',
  }), 'needs_consent');
});

test('getHomeState returns needs_setup when setup is missing', () => {
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: null,
    entries: [],
    plan: null,
    today: '2026-01-01',
  }), 'needs_setup');
});

test('getHomeState returns run_in during baseline logging', () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({
    date: `2026-01-0${i + 1}`,
    sleepMinutes: 420,
    lastCaffeineTime: '14:00',
  }));
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries,
    plan: null,
    today: '2026-01-06',
  }), 'run_in');
});

test('getHomeState returns feasibility_ready at 14 valid days or nextCheckDate', () => {
  const entries = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    sleepMinutes: 420,
    lastCaffeineTime: '14:00',
  }));
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries,
    plan: null,
    today: '2026-01-15',
  }), 'feasibility_ready');

  // Deferred nextCheckDate in the future
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: { ...defaultSetup, nextCheckDate: '2026-01-20' },
    entries,
    plan: null,
    today: '2026-01-15',
  }), 'run_in');

  // Deferred nextCheckDate reached
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: { ...defaultSetup, nextCheckDate: '2026-01-20' },
    entries,
    plan: null,
    today: '2026-01-20',
  }), 'feasibility_ready');
});

test('getHomeState transitions across scheduled, active, awaiting final, and result ready', () => {
  const plan = makePlan('2026-01-15'); // Last exposure date 2026-01-18

  // Before start date
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan,
    today: '2026-01-14',
  }), 'plan_scheduled');

  // Active during schedule
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan,
    today: '2026-01-15',
  }), 'plan_active');

  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan,
    today: '2026-01-18',
  }), 'plan_active');

  // Day after last exposure date, final night not yet logged
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan,
    today: '2026-01-19',
  }), 'plan_awaiting_final');

  // Day after last exposure date, not yet completed: plan_awaiting_final
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [{ date: '2026-01-18', sleepMinutes: 440, lastCaffeineTime: 'none' }],
    plan,
    today: '2026-01-19',
  }), 'plan_awaiting_final');

  // Completed status (stored snapshot exists): plan_result_ready
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [{ date: '2026-01-18', sleepMinutes: 440, lastCaffeineTime: 'none' }],
    plan: { ...plan, status: 'completed' },
    today: '2026-01-19',
  }), 'plan_result_ready');
});

test('getHomeState returns plan_ended_early when plan status is cancelled', () => {
  const cancelledPlan = makePlan('2026-01-15', 4, 'cancelled');
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan: cancelledPlan,
    today: '2026-01-16',
  }), 'plan_ended_early');
});

test('dev clock offset shifts getToday in dev environment', () => {
  // The dev clock is now strictly fail-closed, so opt into dev mode explicitly.
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  __setDevClockOffset(0);
  const base = getToday();
  __setDevClockOffset(3);
  assert.notEqual(getToday(), base);
  __setDevClockOffset(0);
  assert.equal(getToday(), base);
  delete (globalThis as { __DEV__?: boolean }).__DEV__;
});

function makeValidStoredPlan(startDate: string, lengthDays = 6, cutoffTime = '13:00', status = 'scheduled'): StoredExperimentPlan {
  const seed = 42;
  const analysisSeed = ((seed * 1664525 + 1013904223) >>> 0);
  const design = { type: 'randomized-blocks' as const, blockLength: 2, balanceWeekends: true };
  const schedule = generateSchedule(startDate, lengthDays, design, seed);
  return {
    id: 'plan-valid-1',
    status,
    plan: {
      seed,
      analysisSeed,
      startDate,
      chosenDuration: lengthDays,
      schedule,
      assumedAdherence: 0.9,
      assumedContamination: 0.1,
      baselineStats: { sd: 28, assumedAutocorrelation: 0.3, validDays: 14 },
      definition: {
        name: 'Caffeine cutoff',
        startDate,
        lengthDays,
        design,
        seed,
        outcomeMetric: 'sleepMinutes',
        conditionRule: { type: 'caffeine-cutoff', cutoffTime },
      },
      feasibilitySnapshot: {} as any,
    },
  };
}

test('getTodayDashboardModel handles realistic 14 run-in days + in-window entries without throwing', () => {
  const plan = makeValidStoredPlan('2026-02-15', 6, '13:00', 'scheduled');
  const runInEntries = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-01-${String(15 + i).padStart(2, '0')}`,
    sleepMinutes: 430,
    lastCaffeineTime: '14:30',
    synced: true,
  }));
  const inWindowEntries = [
    { date: '2026-02-15', sleepMinutes: 450, lastCaffeineTime: '11:00', synced: true },
    { date: '2026-02-16', sleepMinutes: 440, lastCaffeineTime: '9:30', synced: false }, // malformed + unsynced
  ];
  const entries = [...runInEntries, ...inWindowEntries];
  const today = '2026-02-17';

  const model = getTodayDashboardModel({
    consent: defaultConsent,
    setup: defaultSetup,
    entries,
    plan,
    today,
  });

  assert.equal(model.state, 'plan_active');
  assert.equal(model.medicalNotice, 'This app is not medical advice.');
  assert.equal(model.checkIn.enabled, true);
  assert.equal(model.checkIn.defaultDate, '2026-02-16');
  assert.equal(model.unsyncedCount, 1);

  // Today's instruction matches exact condition wording for 2026-02-17
  const todayScheduled = plan.plan.schedule.find(s => s.date === today)!;
  const expectedHeading =
    todayScheduled.condition === 'intervention'
      ? 'Today: no caffeine after 13:00.'
      : 'Today: your usual routine.';
  assert.equal(model.instruction.heading, expectedHeading);

  // Recent days surface unreadable marker and unsynced status on 2026-02-16
  const yesterdayItem = model.checkIn.recentDays.find(d => d.date === '2026-02-16')!;
  assert.equal(yesterdayItem.statusTone, 'unreadable');
  assert.match(yesterdayItem.statusText, /not synced yet/);
  assert.ok(
    yesterdayItem.statusText.includes(CAFFEINE_TIME_UNREADABLE_MARKER),
    `expected the unreadable marker in "${yesterdayItem.statusText}"`,
  );

  // The screen collapses the form when the default day is already fully logged, so the
  // check-in carries its own status and one-line reading rather than re-deriving them.
  assert.equal(model.checkIn.status, 'unreadable');
  assert.equal(model.checkIn.summary, '7h 20m · Caffeine time unreadable');
  assert.match(model.instruction.detail, /Day 3 of 6/);
  assert.match(model.instruction.detail, /Cutoff 13:00/);
  // Today already performs the check-in, so the other screen is an optional step.
  assert.equal(model.primaryAction?.tone, 'quiet');

  // Progress has counts only, never interim estimates
  assert.equal(model.progress?.kind, 'experiment');
  if (model.progress?.kind === 'experiment') {
    assert.equal(model.progress.currentDayNum, 3);
    assert.equal(model.progress.totalDays, 6);
    assert.equal(model.progress.daysLogged, 2);
    assert.equal(model.progress.daysRemaining, 3);
    assert.equal('verdict' in model.progress, false);
    assert.equal('conservativeEstimate' in model.progress, false);
  }
});

test('getTodayDashboardModel covers run_in, feasibility_ready, and completed result states', () => {
  const fourRunIn = Array.from({ length: 4 }, (_, i) => ({
    date: `2026-01-0${i + 1}`,
    sleepMinutes: 420,
    lastCaffeineTime: '15:00',
  }));

  const runInModel = getTodayDashboardModel({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: fourRunIn,
    plan: null,
    today: '2026-01-05',
  });
  assert.equal(runInModel.state, 'run_in');
  assert.equal(runInModel.instruction.heading, 'Today: your usual routine.');
  assert.equal(runInModel.checkIn.enabled, true);
  assert.equal(runInModel.checkIn.status, 'logged');
  assert.equal(runInModel.checkIn.summary, '7h 00m · Last caffeine 15:00');
  assert.equal(runInModel.primaryAction?.tone, 'quiet');
  assert.equal(runInModel.progress?.kind, 'run_in');
  if (runInModel.progress?.kind === 'run_in') {
    assert.equal(runInModel.progress.validDays, 4);
    assert.ok(runInModel.progress.descriptiveStats);
  }

  const completedPlan: StoredExperimentPlan = {
    ...makeValidStoredPlan('2026-02-01', 4, '12:00', 'completed'),
    result: {
      verdictLabel: 'SUPPORTED',
      statement: 'Engine verdict statement verbatim.',
      reasons: [],
      conservativeEstimate: 18,
      interval: [8, 28],
      ruledOut: null,
      daysAnalyzed: { intervention: 2, control: 2 },
      daysExcluded: 0,
      missingOutcomeDays: 0,
      unknownExposureDays: 0,
      adherence: {
        estimand: 'itt',
        counts: { ADHERENT: 2, NON_ADHERENT: 0, CONTAMINATED: 0, CONTROL_CLEAN: 2, UNKNOWN: 0 },
        total: 4,
        known: 4,
        overallAdherence: 1,
        knownFraction: 1,
        interventionAdherence: 1,
        controlContamination: 0,
      },
      reducedAdherence: false,
      plannedPowerRecomputed: 0.75,
      plannedPowerSnapshot: 0.75,
      evaluatedAt: '2026-02-05T08:00:00.000Z',
    },
  };

  const resultModel = getTodayDashboardModel({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan: completedPlan,
    today: '2026-02-05',
  });
  assert.equal(resultModel.state, 'plan_result_ready');
  assert.equal(resultModel.instruction.heading, 'Supported');
  assert.equal(resultModel.instruction.body, 'Engine verdict statement verbatim.');
  assert.equal(resultModel.checkIn.enabled, false);
  assert.equal(resultModel.checkIn.recentDays[0].editable, false);
  // A verdict is something the user still has to open, so it stays a required action.
  assert.equal(resultModel.primaryAction?.tone, 'primary');
  assert.match(resultModel.instruction.detail, /4 days analyzed/);
});

test('the Today check-in reports whether last night is already logged', () => {
  const today = '2026-03-10';
  const yesterday = '2026-03-09';
  const cases: Array<[
    string,
    Array<{ date: string; sleepMinutes: number | null; lastCaffeineTime: string | 'none' | null }>,
    string,
    string,
  ]> = [
    ['both values logged', [{ date: yesterday, sleepMinutes: 450, lastCaffeineTime: '14:00' }], 'logged', '7h 30m · Last caffeine 14:00'],
    ['explicitly no caffeine', [{ date: yesterday, sleepMinutes: 450, lastCaffeineTime: 'none' }], 'logged', '7h 30m · No caffeine'],
    ['sleep only', [{ date: yesterday, sleepMinutes: 450, lastCaffeineTime: null }], 'partial', '7h 30m · Caffeine not logged'],
    ['nothing logged', [], 'missing', 'Sleep not logged · Caffeine not logged'],
  ];

  for (const [label, entries, expectedStatus, expectedSummary] of cases) {
    const model = getTodayDashboardModel({
      consent: defaultConsent,
      setup: defaultSetup,
      entries: entries.map(e => ({ ...e, synced: true })),
      plan: null,
      today,
    });
    assert.equal(model.state, 'run_in', `${label}: state`);
    assert.equal(model.checkIn.enabled, true, `${label}: check-in enabled`);
    assert.equal(model.checkIn.defaultDate, yesterday, `${label}: default date`);
    assert.equal(model.checkIn.status, expectedStatus, `${label}: status`);
    assert.equal(model.checkIn.summary, expectedSummary, `${label}: summary`);
  }
});
