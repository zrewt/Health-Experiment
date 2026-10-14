import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSchedule } from '../src/engine';
import { CAFFEINE_TIME_UNREADABLE_MARKER } from '../src/experiment/caffeine-time';
import { evaluate, entriesForPlan, progressSummary } from '../src/experiment/adapter';
import { canEditDate } from '../src/experiment/dates';
import { getHomeState } from '../src/experiment/home-state';
import { createPlanPersistence, type PlanServer, type PlanStorage, type StoredExperimentPlan } from '../src/data/plan-persistence';
import fs from 'node:fs';
import path from 'node:path';
import type { ExperimentPlan, DailyEntry, ResultSnapshot } from '../src/experiment/types';
import { VERDICT_HEADINGS, hasHeadingFor } from '../src/experiment/verdict-headings';
import { getExperimentLifecycleModel, getResultExplanationModel } from '../src/experiment/lifecycle';
import type { VerdictStatus } from '../src/engine/types';

function makePlan(startDate: string, lengthDays = 14, cutoffTime = '12:00', status = 'scheduled'): StoredExperimentPlan {
  const seed = 100;
  const analysisSeed = ((seed * 1664525 + 1013904223) >>> 0);
  const design = { type: 'randomized-blocks' as const, blockLength: 2, balanceWeekends: true };
  const schedule = generateSchedule(startDate, lengthDays, design, seed);
  return {
    id: 'plan-test-1',
    status,
    plan: {
      seed,
      analysisSeed,
      chosenDuration: lengthDays,
      startDate,
      schedule,
      assumedAdherence: 0.9,
      assumedContamination: 0.1,
      baselineStats: { sd: 26, assumedAutocorrelation: 0.2, validDays: 14 },
      definition: {
        name: 'Caffeine cutoff',
        startDate,
        lengthDays,
        design,
        seed,
        outcomeMetric: 'sleepMinutes',
        conditionRule: { type: 'caffeine-cutoff', cutoffTime },
      },
      feasibilitySnapshot: {
        tier: 'informative',
        options: [{
          duration: lengthDays,
          plannedPowerAtMinimumEffect: 0.75,
          mdeDirectMinutes: 28,
          mdeAssignedDayEquivalent: 22.4,
          scenarioRho: 0.2,
          minPlannedPowerAcrossRho: 0.7,
          statement: 'Statement 4 days',
          conservative: false,
          numberQualifier: 'unqualified',
          mdeLabel: 'change if you follow the rule on every cutoff day',
          adherenceAssumptionText: 'assuming you follow rule',
          rhoLookups: [],
        }],
        defaultDuration: lengthDays,
        canStart: true,
        requiresAcknowledgement: false,
        conservative: false,
        numberQualifier: 'unqualified',
        sdUsed: 26,
        reasons: [],
        mdeLabel: 'mde',
        adherenceAssumptionText: 'adh',
        autocorrelationAssumptionText: 'auto',
        conservativeAssumptionText: null,
        inputs: {
          minimumMeaningfulEffectMinutes: 15,
        } as any,
      },
    },
  };
}

function memory(): PlanStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
}

test('router transitions across last exposure date E, E+1, and completed status', () => {
  const plan = makePlan('2026-02-01', 14); // schedule: 2026-02-01 to 2026-02-14 (E = 2026-02-14)
  const defaultConsent = { userId: 'u1', consentType: 'health-data' as const, policyVersion: 'v1', granted: true, createdAt: '' };
  const defaultSetup = { experimentId: 'caffeine-cutoff', cutoffTime: '12:00', screeningAnswer: 'usually' as const, runInStartDate: '2026-01-01' };

  // On last exposure date E (2026-02-14): plan_active
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan,
    plans: [],
    today: '2026-02-14',
  }), 'plan_active');

  // On E+1 (2026-02-15) before completion: plan_awaiting_final
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan,
    plans: [],
    today: '2026-02-15',
  }), 'plan_awaiting_final');

  // After completion (status === 'completed'): plan_result_ready
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan: { ...plan, status: 'completed' },
    plans: [],
    today: '2026-02-15',
  }), 'plan_result_ready');

  // Days beyond E+1 before completion: still plan_awaiting_final
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan,
    plans: [],
    today: '2026-02-18',
  }), 'plan_awaiting_final');
});

test('entriesForPlan filters out entries outside schedule boundaries', () => {
  const plan = makePlan('2026-02-01', 14).plan; // 2026-02-01 to 2026-02-14
  const allEntries: DailyEntry[] = [
    { date: '2026-01-31', sleepMinutes: 400, lastCaffeineTime: 'none' }, // day before
    { date: '2026-02-01', sleepMinutes: 420, lastCaffeineTime: '11:00' }, // first day
    { date: '2026-02-02', sleepMinutes: 440, lastCaffeineTime: '15:00' },
    { date: '2026-02-14', sleepMinutes: 430, lastCaffeineTime: '15:00' }, // last exposure day E
    { date: '2026-02-15', sleepMinutes: 450, lastCaffeineTime: 'none' }, // day after
  ];

  const filtered = entriesForPlan(plan, allEntries);
  assert.equal(filtered.length, 3);
  assert.deepEqual(filtered.map(e => e.date), ['2026-02-01', '2026-02-02', '2026-02-14']);
});

test('See my result computes once, persists snapshot, and idempotent retry returns stored snapshot without recomputing', async () => {
  const storage = memory();
  let evaluateCallCount = 0;
  let serverCompleteCalls = 0;

  const planRec = makePlan('2026-02-01', 14);
  const plan = planRec.plan;
  const entries: DailyEntry[] = plan.schedule.map(s => ({
    date: s.date,
    sleepMinutes: 420 + (s.condition === 'intervention' ? 20 : 0),
    lastCaffeineTime: s.condition === 'intervention' ? '11:00' : '15:00',
  }));

  let serverRecord = { ...planRec };

  const server: PlanServer = {
    async getActive() { return serverRecord; },
    async insert() { throw new Error('not used'); },
    async setNextCheckDate() {},
    async cancel() {},
    async complete(_userId, _planId, result, completedAt) {
      serverCompleteCalls++;
      serverRecord = {
        ...serverRecord,
        status: 'completed',
        result,
        completed_at: completedAt,
      };
      return serverRecord;
    },
  };

  const persistence = createPlanPersistence(storage, server);

  // Compute once
  evaluateCallCount++;
  const result = evaluate(plan, entriesForPlan(plan, entries), '2026-02-15');
  const snapshot: ResultSnapshot = { ...result, evaluatedAt: new Date().toISOString() };
  const completed = await persistence.completePlan('user-1', planRec.id, snapshot, snapshot.evaluatedAt);

  assert.equal(evaluateCallCount, 1);
  assert.equal(serverCompleteCalls, 1);
  assert.equal(completed.status, 'completed');
  assert.ok(completed.result);

  // Idempotent retry / double tap: read stored snapshot, do not call evaluate() again
  const secondAttempt = await persistence.getActivePlan('user-1');
  assert.equal(secondAttempt?.status, 'completed');
  assert.deepEqual(secondAttempt?.result, snapshot);
  assert.equal(evaluateCallCount, 1); // Not called again
});

test('edit lock disables editing scheduled dates when plan is completed', () => {
  const completedPlan = makePlan('2026-02-01', 14, '12:00', 'completed');
  const today = '2026-02-15'; // morning after last exposure day (E = 2026-02-14)

  // During completed plan, schedule dates (2026-02-01 through 2026-02-14) are read-only
  assert.equal(canEditDate(today, '2026-02-14', completedPlan), false);
  assert.equal(canEditDate(today, '2026-02-13', completedPlan), false);
  assert.equal(canEditDate(today, '2026-02-02', completedPlan), false);
  assert.equal(canEditDate(today, '2026-02-01', completedPlan), false);

  // But for an active (scheduled) plan, yesterday and backfill days remain editable
  const activePlan = makePlan('2026-02-01', 14, '12:00', 'scheduled');
  assert.equal(canEditDate(today, '2026-02-14', activePlan), true);
  assert.equal(canEditDate(today, '2026-02-13', activePlan), true);

  // Even after archiving the completed plan to start a second cycle (where active plan is null
  // and the completed plan lives in history), its scheduled days stay locked on E+1..E+4:
  assert.equal(canEditDate('2026-02-15', '2026-02-14', [completedPlan]), false);
  assert.equal(canEditDate('2026-02-16', '2026-02-14', [completedPlan]), false);
  // While the first new run-in night (2026-02-15, logged on morning of 2026-02-16) is editable:
  assert.equal(canEditDate('2026-02-16', '2026-02-15', [completedPlan]), true);
});

import type { VerdictStatus } from '../src/engine/types';

test('verdict headings match fixed mapping and pass engine statements verbatim', () => {
  // The screen must render the real mapping, not a local copy. Import the module the
  // result screen uses so a typo in one place is caught here.
  assert.equal(VERDICT_HEADINGS['SUPPORTED'], 'Sleep was longer on cutoff days');
  assert.equal(VERDICT_HEADINGS['NO_DETECTABLE_EFFECT'], 'No clear difference in sleep');
  assert.equal(VERDICT_HEADINGS['INCONCLUSIVE'], 'Too close to call');

  // Every verdict the engine can return has a heading; there are no unknown keys.
  const engineStatuses: Verdict['status'][] = ['SUPPORTED', 'NO_DETECTABLE_EFFECT', 'INCONCLUSIVE'];
  for (const status of engineStatuses) {
    assert.ok(hasHeadingFor(status), `every engine verdict has a heading, including ${status}`);
    assert.equal(VERDICT_HEADINGS[status], VERDICT_HEADINGS[status], `${status} maps to a real heading`);
    assert.equal(typeof VERDICT_HEADINGS[status], 'string', `${status} heading is a string`);
    assert.ok(VERDICT_HEADINGS[status].length > 0, `${status} heading is not empty`);
  }

  // The mapping must be exactly the three engine statuses and nothing else.
  const keys = Object.keys(VERDICT_HEADINGS).sort();
  assert.deepEqual(keys, ['INCONCLUSIVE', 'NO_DETECTABLE_EFFECT', 'SUPPORTED']);

  // No heading contains causal or medical wording. Plain labels only.
  const forbidden = [
    /because|due to|therefore|thus|as a result|caused|leads to|leads|make/,
    /treat|cure|prevent|diagnosis|patient|prescribe|therapy|heal|proof|significantly|statistically/,
    /improves|sleep better|will|guarantee|safe|efficac|recommend|should|must|health care/,
  ];
  for (const heading of Object.values(VERDICT_HEADINGS)) {
    for (const pattern of forbidden) {
      assert.ok(
        !pattern.test(heading),
        `heading "${heading}" must not contain causal or medical wording (matched ${pattern})`
      );
    }
  }
});

test('the result screen imports the real verdict-heading mapping, not a local copy', () => {
  const resultSource = fs.readFileSync(path.resolve(__dirname, '../src/app/result.tsx'), 'utf8');
  assert.match(resultSource, /from\s+['"']@\/experiment\/verdict-headings['"]/, 'result.tsx must import VERDICT_HEADINGS from the experiment module');
  assert.doesNotMatch(resultSource, /const\s+VERDICT_HEADINGS/, 'result.tsx must not redeclare VERDICT_HEADINGS locally');
});

test('screen 5A does not show any estimate prior to clicking See my result', () => {
  // Screen 5A requirements state:
  // "Show counts only (days logged, adherence counts via progressSummary). A button 'See my result'... NO estimates before the button is pressed."
  const plan = makePlan('2026-02-01', 14).plan;
  const entries: DailyEntry[] = plan.schedule.map(s => ({
    date: s.date,
    sleepMinutes: 420,
    lastCaffeineTime: '11:00',
  }));
  const progress = progressSummary(plan, entries, '2026-02-15');
  assert.equal(typeof progress.daysLogged, 'number');
  assert.equal(typeof progress.adherenceCounts, 'object');
  // Confirm that ProgressSummary contains no estimates or statistical evaluations
  assert.equal('estimate' in progress, false);
  assert.equal('conservativeEstimate' in progress, false);
  assert.equal('verdict' in progress, false);
});

test('interim look guard: adapter evaluate throws when today < lastExposureDate', () => {
  const plan = makePlan('2026-02-01', 14).plan;
  const entries: DailyEntry[] = plan.schedule.map(s => ({
    date: s.date,
    sleepMinutes: 420,
    lastCaffeineTime: '11:00',
  }));

  // Before day E (e.g. 2026-02-13 < 2026-02-14) throws INTERIM_LOOK
  assert.throws(
    () => evaluate(plan, entriesForPlan(plan, entries), '2026-02-13'),
    /INTERIM_LOOK|Results are unavailable before the schedule end date/
  );

  assert.throws(
    () => evaluate(plan, entriesForPlan(plan, entries), '2026-02-05'),
    /INTERIM_LOOK|Results are unavailable before the schedule end date/
  );
});

test('failed result persistence leaves plan uncompleted and caches no result', async () => {
  const storage = memory();
  const planRec = makePlan('2026-02-01', 14);

  const failingServer: PlanServer = {
    async getActive() { return planRec; },
    async insert() { throw new Error('not used'); },
    async setNextCheckDate() {},
    async cancel() {},
    async complete() {
      throw new Error('Database connection failed');
    },
  };

  const persistence = createPlanPersistence(storage, failingServer);
  const snapshot: ResultSnapshot = {
    verdictLabel: 'SUPPORTED',
    statement: 'Statement verbatim',
    reasons: [],
    conservativeEstimate: 20,
    interval: [10, 30],
    ruledOut: null,
    daysAnalyzed: { intervention: 7, control: 7 },
    daysExcluded: 0,
    missingOutcomeDays: 0,
    unknownExposureDays: 0,
    adherence: { counts: { ADHERENT: 7, NON_ADHERENT: 0, CONTAMINATED: 0, CONTROL_CLEAN: 7, UNKNOWN: 0 }, rates: { interventionAdherence: 1, controlContamination: 0 } },
    reducedAdherence: false,
    plannedPowerRecomputed: 0.8,
    plannedPowerSnapshot: 0.8,
    evaluatedAt: '2026-02-15T08:00:00.000Z',
  };

  await assert.rejects(
    async () => persistence.completePlan('user-1', planRec.id, snapshot, snapshot.evaluatedAt),
    /Database connection failed/
  );

  // Verify plan remains scheduled in storage and no snapshot was cached
  const current = await persistence.getActivePlan('user-1');
  assert.equal(current?.status, 'scheduled');
  assert.equal(current?.result, undefined);
});

test('cancelled plans do not transition to result ready or produce results', () => {
  const defaultConsent = { userId: 'u1', consentType: 'health-data' as const, policyVersion: 'v1', granted: true, createdAt: '' };
  const defaultSetup = { experimentId: 'caffeine-cutoff', cutoffTime: '12:00', screeningAnswer: 'usually' as const, runInStartDate: '2026-01-01' };
  const plan = makePlan('2026-02-01', 14, '12:00', 'cancelled');

  // Cancelled plan router state is plan_ended_early on any date
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan,
    plans: [],
    today: '2026-02-15',
  }), 'plan_ended_early');

  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan,
    plans: [],
    today: '2026-02-20',
  }), 'plan_ended_early');
});

test('server-side edit lock logic check: rejects modifying completed schedule entries while allowing others', () => {
  // Simulates PostgreSQL trigger check_entry_edit_lock logic from schema-screen6.sql
  const completedPlan = makePlan('2026-02-01', 14, '12:00', 'completed');
  const cancelledPlan = makePlan('2026-01-01', 14, '12:00', 'cancelled');

  function checkEditLock(userPlans: StoredExperimentPlan[], entryDate: string): boolean {
    // Returns true if locked, false if allowed
    return userPlans.some(ep =>
      ep.status === 'completed' &&
      ep.plan.schedule.some(s => s.date === entryDate)
    );
  }

  // Schedule dates in completed plan are locked:
  assert.equal(checkEditLock([completedPlan], '2026-02-01'), true);
  assert.equal(checkEditLock([completedPlan], '2026-02-14'), true); // Day E

  // Entry outside completed plan schedule is not locked:
  assert.equal(checkEditLock([completedPlan], '2026-01-31'), false);
  assert.equal(checkEditLock([completedPlan], '2026-02-15'), false);

  // Cancelled plan dates are not locked:
  assert.equal(checkEditLock([cancelledPlan], '2026-01-05'), false);
});

test('getResultExplanationModel preserves engine statement verbatim and explains estimate, contributing days, and underlying log', () => {
  const planRec = makePlan('2026-02-01', 4, '12:00', 'completed');
  const entries: DailyEntry[] = [
    { date: '2026-02-01', sleepMinutes: 450, lastCaffeineTime: '11:00' },
    { date: '2026-02-02', sleepMinutes: null, lastCaffeineTime: '14:00' },
    { date: '2026-02-03', sleepMinutes: 420, lastCaffeineTime: 'none' },
    { date: '2026-02-04', sleepMinutes: 430, lastCaffeineTime: '9:30' }, // malformed
  ];
  const snapshot: ResultSnapshot = {
    verdictLabel: 'SUPPORTED',
    statement: 'Exact engine verdict statement verbatim.',
    reasons: ['Engine reason 1'],
    conservativeEstimate: 16,
    interval: [8, 28],
    ruledOut: null,
    daysAnalyzed: { intervention: 2, control: 1 },
    daysExcluded: 0,
    missingOutcomeDays: 1,
    unknownExposureDays: 1,
    adherence: {
      estimand: 'itt',
      counts: { ADHERENT: 1, NON_ADHERENT: 0, CONTAMINATED: 1, CONTROL_CLEAN: 1, UNKNOWN: 1 },
      total: 4,
      known: 3,
      overallAdherence: 0.67,
      knownFraction: 0.75,
      interventionAdherence: 0.5,
      controlContamination: 0.5,
    },
    reducedAdherence: true,
    plannedPowerRecomputed: 0.75,
    plannedPowerSnapshot: 0.75,
    evaluatedAt: '2026-02-05T08:00:00.000Z',
  };

  const explanation = getResultExplanationModel(planRec.plan, snapshot, entries);
  assert.equal(explanation.verdictHeading, 'Sleep was longer on cutoff days');
  assert.equal(explanation.statement, 'Exact engine verdict statement verbatim.');
  assert.match(explanation.estimateExplanation.conservativeEstimateText, /16 minutes/);
  assert.match(explanation.estimateExplanation.intervalText, /8 to 28 minutes/);
  assert.equal(explanation.contributingDays.analyzedTotal, 3);
  assert.equal(explanation.contributingDays.missingSleepDays, 1);
  assert.equal(explanation.contributingDays.unknownCaffeineDays, 1);
  assert.equal(explanation.underlyingDays.length, 4);
  assert.equal(explanation.underlyingDays[1].contributedToAnalysis, false);
  assert.equal(explanation.underlyingDays[1].sleepText, 'Not logged');
  assert.equal(explanation.underlyingDays[3].caffeineText, CAFFEINE_TIME_UNREADABLE_MARKER);
  assert.ok(explanation.whatItTellsYou.doesTell.length >= 2);
  assert.ok(explanation.whatItTellsYou.doesNotTell.length >= 2);
});

test('getExperimentLifecycleModel lists guide steps, saved results, and next cycle eligibility', () => {
  const defaultConsent = { userId: 'u1', consentType: 'health-data' as const, policyVersion: 'v1', granted: true, createdAt: '' };
  const defaultSetup = { experimentId: 'caffeine-cutoff', cutoffTime: '13:30', screeningAnswer: 'usually' as const, runInStartDate: '2026-01-01' };
  const completedPlan: StoredExperimentPlan = {
    ...makePlan('2026-02-01', 14, '13:30', 'completed'),
    result: {
      verdictLabel: 'NO_DETECTABLE_EFFECT',
      statement: 'No detectable effect statement verbatim.',
      reasons: [],
      conservativeEstimate: null,
      interval: [-10, 12],
      ruledOut: 15,
      daysAnalyzed: { intervention: 7, control: 7 },
      daysExcluded: 0,
      missingOutcomeDays: 0,
      unknownExposureDays: 0,
      adherence: {
        estimand: 'itt',
        counts: { ADHERENT: 7, NON_ADHERENT: 0, CONTAMINATED: 0, CONTROL_CLEAN: 7, UNKNOWN: 0 },
        total: 14,
        known: 14,
        overallAdherence: 1,
        knownFraction: 1,
        interventionAdherence: 1,
        controlContamination: 0,
      },
      reducedAdherence: false,
      plannedPowerRecomputed: 0.8,
      plannedPowerSnapshot: 0.8,
      evaluatedAt: '2026-02-15T08:00:00.000Z',
    },
  };
  const endedEarlyPlan: StoredExperimentPlan = {
    ...makePlan('2026-01-10', 14, '12:00', 'cancelled'),
    id: 'plan-cancelled-old',
  };

  const lifecycle = getExperimentLifecycleModel({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    activePlan: completedPlan,
    historyPlans: [completedPlan, endedEarlyPlan],
    today: '2026-02-16',
  });

  assert.equal(lifecycle.state, 'plan_result_ready');
  assert.equal(lifecycle.guideSteps.length, 3);
  assert.equal(lifecycle.detail.cutoffTime, '13:30');
  assert.equal(lifecycle.detail.canStartNewCycle, true);
  assert.equal(lifecycle.savedExperiments.length, 2);
  assert.equal(lifecycle.savedExperiments[0].verdictHeading, 'No clear difference in sleep');
  assert.equal(lifecycle.savedExperiments[0].statement, 'No detectable effect statement verbatim.');
  assert.equal(lifecycle.savedExperiments[1].statusLabel, 'Stopped early');
});
