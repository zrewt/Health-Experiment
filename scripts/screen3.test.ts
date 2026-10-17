import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as engine from '../src/engine';
import { assessFeasibility, computeBaseline, ExperimentAdapterError } from '../src/experiment/adapter';
import { getFeasibilityScreenState } from '../src/experiment/view-model';
import { getStartAttempt, isFeasibilityDue } from '../src/experiment/start-attempt';
import { createPlanPersistence, type PlanServer, type PlanStorage, type StoredExperimentPlan } from '../src/data/plan-persistence';
import type { BaselineSummary, FeasibilityLookup } from '../src/experiment/types';

const baseline: BaselineSummary = {
  validDays: 14, targetDays: 14, sd: 25, eligible: true, reasons: ['engine reason\nverbatim'],
  engineReasons: ['engine reason\nverbatim'], lateCaffeineDays: 9, knownExposureDays: 12, unknownExposureDays: 2,
};
const setup = { cutoffTime: '12:00' };
function lookup(mde: number | 'not reachable within the duration' | null): FeasibilityLookup {
  return input => ({ status: mde === null ? 'unknown' : 'ok',
    minimumDetectableEffect70: mde, detectionProbabilityAtMinimumEffect: mde === null ? null : 0.3,
    statement: `Engine sentence for ${input.duration}.\nPreserve every character.`,
  });
}
function input(mde = 30, today = '2026-01-31') {
  return { baseline, feasibility: assessFeasibility(baseline, lookup(mde)), duration: 42,
    today, acknowledged: true, cutoffTime: '10:00' };
}
function memory(): PlanStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); }, async removeItem(key) { values.delete(key); } };
}

for (const [mde, kind] of [[30, 'informative'], [31, 'long_shot'], [45, 'long_shot'],
  [46, 'not_informative'], [61, 'not_informative'], ['not reachable within the duration', 'not_informative'], [null, 'cannot_assess']] as const) {
  test(`Screen 3 stubbed engine: MDE ${mde} gives ${kind}`, () => {
    const feasibility = assessFeasibility(baseline, lookup(mde));
    const state = getFeasibilityScreenState(baseline, feasibility, setup);
    assert.equal(state.kind, kind);
    if (state.kind === 'informative' || state.kind === 'long_shot') {
      assert.deepEqual(state.options.map(option => option.duration), [42, 56, 70, 84]);
      assert.equal(state.defaultDuration, feasibility.defaultDuration);
      assert.equal(state.requiresAcknowledgement, kind === 'long_shot');
      for (const option of state.options) {
        assert.equal(option.statement, lookup(mde)({ duration: option.duration, sd: 25, lag1Autocorrelation: option.scenarioRho }).statement);
        assert.equal(option.mdeLabel, 'change if you follow the rule on every cutoff day');
        assert.equal(option.adherenceAssumptionText, 'if you follow the rule on about 9 of 10 cutoff days');
        assert.equal(option.mdeAssignedDayEquivalent, typeof mde === 'number' ? mde * 0.8 : null);
      }
      assert.equal(state.approximateLabel, 'Rough');
      assert.equal(state.simulationNote, 'These numbers come from computer simulations of your log, so they are rough — about six points either way.');
      assert.match(state.startInstruction, /picked at random/);
      assert.match(state.startInstruction, /12:00/);
    } else {
      assert.equal('options' in state, false);
      assert.equal('canStart' in state, false);
      assert.ok('actions' in state);
      assert.deepEqual(state.actions, ['Keep logging for now', 'Not now']);
      assert.deepEqual(state.reasons, baseline.engineReasons);
      if (state.kind === 'not_informative') {
        // The screen leads with one plain reason. The engine's own sentence for this tier
        // is still reachable verbatim through feasibility.options and is shown under Details.
        if (typeof mde === 'number' && mde <= 60) assert.equal(state.message,
          'Sleep changes would have to be large before this test could show them.');
        else assert.equal(state.message, 'Your nightly sleep varies too much for this test to show a real difference.');
      }
    }
  });
}

test('ineligible facts are baseline counts only and reasons pass through the stubbed engine verbatim', () => {
  const facade = { ...engine, checkCaffeineEligibility: () => ({
    estimand: 'stub', eligible: false, runInDaysCount: 14, lateCaffeineDaysCount: 3,
    knownExposureDaysCount: 9, unknownExposureDaysCount: 5, lateCaffeineShare: 3 / 14,
    baselineOutcomeMean: null, baselineOutcomeSd: null, reasons: ['Exact engine reason.\nNo edits.'],
  }) };
  const summary = computeBaseline([], facade);
  const state = getFeasibilityScreenState(summary, assessFeasibility(summary), setup);
  assert.equal(state.kind, 'ineligible');
  if (state.kind !== 'ineligible') assert.fail();
  assert.equal(state.message, "We can't set up this test yet.");
  assert.equal(state.detailsHeading, 'Details');
  assert.deepEqual(state.reasons, ['Exact engine reason.\nNo edits.']);
  assert.deepEqual(state.detailFacts, [
    'You logged caffeine after 12:00 on 3 of 14 days.',
    '5 days had no caffeine time logged, so they do not count. Log it every morning.',
  ]);
});

test('zero unknown days omit the missing-time line; null SD cannot assess', () => {
  const summary = { ...baseline, sd: null, unknownExposureDays: 0, knownExposureDays: 14 };
  const state = getFeasibilityScreenState(summary, assessFeasibility(summary), setup);
  assert.equal(state.kind, 'cannot_assess');
  if (state.kind !== 'cannot_assess') assert.fail();
  assert.deepEqual(state.detailFacts, ['You logged caffeine after 12:00 on 9 of 14 days.']);
});

test('SD 24 shows conservative notice and SD 76 shows no unsupported numbers or start option', () => {
  const low = { ...baseline, sd: 24 };
  const lowState = getFeasibilityScreenState(low, assessFeasibility(low, lookup(30)), setup);
  assert.equal(lowState.kind, 'informative');
  if (lowState.kind !== 'informative') assert.fail();
  assert.equal(lowState.conservativeNote, 'Your sleep is steadier than the range we tested, so read these as the low end.');
  assert.ok(lowState.options.every(option => option.numberQualifier === 'at least'));
  const high = { ...baseline, sd: 76 };
  const highState = getFeasibilityScreenState(high, assessFeasibility(high, () => assert.fail('no out-of-range lookup')), setup);
  assert.equal(highState.kind, 'not_informative');
  if (highState.kind !== 'not_informative') assert.fail();
  assert.equal(highState.mde, null);
  assert.equal(highState.duration, null);
  assert.equal('options' in highState, false);
});

test('start seed is generated once and the identical plan is reused after a failed save', async () => {
  let draws = 0;
  const random = () => { draws++; return 0.25; };
  const first = getStartAttempt(null, input(), random);
  assert.equal(first.seed, 0x40000000);
  assert.equal(first.definition.conditionRule.type, 'caffeine-cutoff');
  assert.ok('cutoffTime' in first.definition.conditionRule);
  assert.equal(first.definition.conditionRule.cutoffTime, '10:00');
  const storage = memory();
  let fail = true;
  let active: StoredExperimentPlan | null = null;
  const persistence = createPlanPersistence(storage, {
    async getActive() { return active; },
    async insert(_userId, plan) { if (fail) throw new Error('offline'); active = { id: 'id', status: 'scheduled', plan }; return active; },
    async setNextCheckDate() {},
  });
  await assert.rejects(persistence.savePlan('user', first), /offline/);
  assert.deepEqual(await persistence.getPendingPlan('user'), first);
  assert.equal(await persistence.getActivePlan('user'), null);
  fail = false;
  const retry = getStartAttempt(first, { ...input(), today: '2026-02-02', duration: 84 }, random);
  assert.equal(retry, first);
  assert.equal(draws, 1);
  assert.equal((await persistence.savePlan('user', retry)).status, 'scheduled');
  assert.equal(await persistence.getPendingPlan('user'), null);
});

for (const [today, tomorrow] of [['2026-01-31', '2026-02-01'], ['2026-02-28', '2026-03-01'],
  ['2026-03-07', '2026-03-08'], ['2026-03-08', '2026-03-09'], ['2026-11-01', '2026-11-02']]) {
  test(`start uses local tomorrow across month end or DST: ${today}`, () => {
    assert.equal(getStartAttempt(null, input(30, today), () => 0).startDate, tomorrow);
  });
}

test('long-shot start and retry refuse unchecked acknowledgement without generating a seed', () => {
  let draws = 0;
  const longShot = { ...input(31), acknowledged: false };
  assert.throws(() => getStartAttempt(null, longShot, () => { draws++; return 0.5; }),
    (e: unknown) => e instanceof ExperimentAdapterError && e.code === 'ACKNOWLEDGEMENT_REQUIRED');
  const existing = getStartAttempt(null, { ...longShot, acknowledged: true }, () => 0.5);
  assert.throws(() => getStartAttempt(existing, longShot), /acknowledgement/);
  assert.equal(draws, 0);
});

test('plan round trip preserves nulls and idempotent retry compares jsonb independent of key order', async () => {
  const storage = memory();
  const plan = getStartAttempt(null, input(), () => 0);
  plan.feasibilitySnapshot.options[0].plannedPowerAtMinimumEffect = null;
  plan.feasibilitySnapshot.options[0].mdeAssignedDayEquivalent = null;
  let active: StoredExperimentPlan | null = null;
  let inserts = 0;
  const persistence = createPlanPersistence(storage, {
    async getActive() { return active; },
    async insert(_user, value) { inserts++; active = JSON.parse(JSON.stringify({ id: 'id', plan: value, status: 'scheduled' })); return active!; },
    async setNextCheckDate() {},
  });
  await persistence.savePlan('user', plan);
  const roundTrip = await persistence.getActivePlan('user');
  assert.deepEqual(roundTrip?.plan, plan);
  assert.equal(roundTrip?.plan.feasibilitySnapshot.options[0].plannedPowerAtMinimumEffect, null);
  assert.equal(roundTrip?.plan.feasibilitySnapshot.options[0].mdeAssignedDayEquivalent, null);
  active!.plan = Object.fromEntries(Object.entries(active!.plan).reverse()) as typeof plan;
  await persistence.savePlan('user', plan);
  assert.equal(inserts, 1);
  await assert.rejects(persistence.savePlan('user', { ...plan, seed: 1 }), /already have/);
});

test('lost insert response is recovered only by matching confirmed server data', async () => {
  let active: StoredExperimentPlan | null = null;
  const plan = getStartAttempt(null, input(), () => 0);
  const persistence = createPlanPersistence(memory(), {
    async getActive() { return active; },
    async insert(_user, value) { active = { id: 'id', plan: value, status: 'scheduled' }; throw new Error('response lost'); },
    async setNextCheckDate() {},
  });
  assert.deepEqual((await persistence.savePlan('user', plan)).plan, plan);
});

test('failed server read cannot present a cached plan as stored', async () => {
  const storage = memory();
  const plan = getStartAttempt(null, input(), () => 0);
  storage.values.set('@experiment_active_plan:user', JSON.stringify({ id: 'id', plan, status: 'scheduled' }));
  const persistence = createPlanPersistence(storage, {
    async getActive() { throw new Error('offline'); }, async insert() { assert.fail(); }, async setNextCheckDate() {},
  });
  await assert.rejects(persistence.getActivePlan('user'), /offline/);
});

test('re-check persists only after server confirmation and defers the 14-day gate for seven days', async () => {
  const storage = memory();
  storage.values.set('@experiment_setup:user', JSON.stringify({ nextCheckDate: null }));
  let fail = true;
  const server: PlanServer = { async getActive() { return null; }, async insert() { assert.fail(); },
    async setNextCheckDate(_user, date) { assert.equal(date, '2026-02-07'); if (fail) throw new Error('offline'); } };
  const persistence = createPlanPersistence(storage, server);
  await assert.rejects(persistence.saveNextCheckDate('user', '2026-02-07'), /offline/);
  assert.equal(JSON.parse((await storage.getItem('@experiment_setup:user'))!).nextCheckDate, null);
  fail = false;
  await persistence.saveNextCheckDate('user', '2026-02-07');
  assert.equal(JSON.parse((await storage.getItem('@experiment_setup:user'))!).nextCheckDate, '2026-02-07');
  assert.equal(isFeasibilityDue(14, null, '2026-01-31'), true);
  assert.equal(isFeasibilityDue(13, null, '2026-01-31'), false);
  assert.equal(isFeasibilityDue(21, '2026-02-07', '2026-02-06'), false);
  assert.equal(isFeasibilityDue(21, '2026-02-07', '2026-02-07'), true);
  assert.equal(isFeasibilityDue(13, '2026-02-07', '2026-02-08'), true);
});
