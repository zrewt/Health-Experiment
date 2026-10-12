import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as engine from '../src/engine';
import { FEASIBILITY_TABLE_META } from '../src/engine/feasibility-table-data';
import * as config from '../src/experiment/config';
import {
  assessFeasibility, computeBaseline, evaluate, ExperimentAdapterError,
  progressSummary, startExperiment, toEngineRecord,
} from '../src/experiment/adapter';
import type {
  BaselineSummary, DailyEntry, EngineFacade, FeasibilityLookup, FeasibilityViewModel,
} from '../src/experiment/types';
import { verifyEngineFreeze } from './verify-engine-freeze';

const baseline: BaselineSummary = {
  validDays: 14, targetDays: 14, sd: 25, eligible: true, reasons: [], engineReasons: [],
  lateCaffeineDays: 14, knownExposureDays: 14, unknownExposureDays: 0,
};
const startDate = '2026-02-01';
const seed = 9988;
function constantLookup(mde: number | 'not reachable within the duration' | null): FeasibilityLookup {
  return input => ({
    status: mde === null ? 'unknown' : 'ok',
    detectionProbabilityAtMinimumEffect: mde === null ? null : 0.2,
    minimumDetectableEffect70: mde,
    statement: `Engine statement: ${input.duration}; rho ${input.lag1Autocorrelation}.\nKeep verbatim.`,
  });
}
function canStart(mde = 30): FeasibilityViewModel {
  return assessFeasibility(baseline, constantLookup(mde));
}
function isError(code: ExperimentAdapterError['code']) {
  return (error: unknown) => error instanceof ExperimentAdapterError && error.code === code;
}
function runIn(count = 14): DailyEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    date: engine.dateAt('2026-01-01', index),
    sleepMinutes: index % 2 ? 440 : 400,
    lastCaffeineTime: '15:00',
  }));
}
function realPlan() {
  const summary = computeBaseline(runIn());
  const feasibility = assessFeasibility(summary);
  assert.equal(feasibility.canStart, true);
  return startExperiment(summary, feasibility, 84, startDate, true, seed);
}

for (const [mde, tier] of [
  [30, 'informative'], [31, 'long_shot'], [45, 'long_shot'], [46, 'not_informative'],
  ['not reachable within the duration', 'not_informative'], [null, 'cannot_assess'],
] as const) {
  test(`tier boundary: MDE ${mde} -> ${tier}`, () => {
    const result = assessFeasibility(baseline, constantLookup(mde));
    assert.equal(result.tier, tier);
    assert.equal(result.canStart, tier === 'informative' || tier === 'long_shot');
    assert.equal(result.requiresAcknowledgement, tier === 'long_shot');
    assert.equal(result.defaultDuration, tier === 'informative' ? 42 : tier === 'long_shot' ? 84 : null);
    assert.equal(result.options[0].mdeDirectMinutes, mde === 'not reachable within the duration' ? 'larger_than_60' : mde);
    if (typeof mde !== 'number') assert.equal(result.options[0].mdeAssignedDayEquivalent, null);
  });
}

test('config reuses engine bounds and defaults; assumption labels match the contract', () => {
  assert.equal(config.minimumMeaningfulEffectMinutes, engine.DEFAULT_VERDICT.minMeaningfulEffect);
  assert.deepEqual(config.durations, FEASIBILITY_TABLE_META.durations);
  assert.deepEqual(config.autocorrelationGrid, FEASIBILITY_TABLE_META.rhos);
  assert.equal(config.sdLowerBound, Math.min(...FEASIBILITY_TABLE_META.sds));
  assert.equal(config.sdUpperBound, Math.max(...FEASIBILITY_TABLE_META.sds));
  assert.deepEqual(config.experimentDesign, { type: 'randomized-blocks', blockLength: 2, balanceWeekends: true });
  assert.equal(config.runInMinValidDays, 14);
  assert.equal(config.assumedAdherence, 0.9);
  assert.equal(config.assumedContamination, 0.1);
  assert.equal(config.mdeLabel, 'effect if you follow the rule fully');
  assert.equal(config.adherenceAssumptionText, 'assuming you follow the rule on about 9 of 10 assigned days');
  assert.equal(config.autocorrelationAssumptionText, 'We did not estimate autocorrelation from your run-in; numbers use the least favourable value in the tested range (0.2 to 0.6).');
  assert.equal('autocorrelationClamp' in config, false);
});

test('SD 76, null SD, and an ineligible baseline skip every lookup and hide output numbers', () => {
  const never: FeasibilityLookup = () => { assert.fail('lookup must not run'); };
  for (const summary of [{ ...baseline, sd: 76 }, { ...baseline, sd: null }, { ...baseline, eligible: false }]) {
    const result = assessFeasibility(summary, never);
    assert.equal(result.tier, summary.sd === 76 ? 'not_informative' : 'cannot_assess');
    assert.deepEqual(result.options, []);
    assert.equal(result.sdUsed, null);
    assert.equal(result.defaultDuration, null);
    assert.equal(result.canStart, false);
  }
});

test('SD 24 uses SD 25 for every lookup, flags each number at least, and preserves the engine statement', () => {
  const calls: Parameters<FeasibilityLookup>[0][] = [];
  const spy: FeasibilityLookup = input => {
    calls.push(input);
    return engine.lookupFeasibility(input);
  };
  const result = assessFeasibility({ ...baseline, sd: 24 }, spy);
  const at25 = assessFeasibility(baseline);
  assert.equal(calls.length, config.durations.length * config.autocorrelationGrid.length);
  assert.ok(calls.every(input => input.sd === 25));
  assert.equal(result.tier, at25.tier);
  assert.equal(result.conservative, true);
  assert.equal(result.numberQualifier, 'at least');
  assert.equal(result.sdUsed, 25);
  assert.match(result.conservativeAssumptionText!, /unvalidated/);
  assert.equal(result.inputs.baseline.sd, 24);
  for (const [index, option] of result.options.entries()) {
    assert.equal(option.conservative, true);
    assert.equal(option.numberQualifier, 'at least');
    assert.equal(option.mdeDirectMinutes, at25.options[index].mdeDirectMinutes);
    const own = engine.lookupFeasibility({
      sd: 25, lag1Autocorrelation: option.scenarioRho,
      duration: option.duration, adherence: 0.9, minMeaningfulEffect: 15,
    });
    assert.equal(option.statement, own.statement);
  }
});

test('scenario selection keeps maximum MDE, its power and statement together when rho outputs disagree', () => {
  const powers = [0.3, 0.1, 0.2];
  const mdes = [30, 37, 45];
  const calls: Parameters<FeasibilityLookup>[0][] = [];
  const lookup: FeasibilityLookup = input => {
    calls.push(input);
    const index = config.autocorrelationGrid.findIndex(rho => rho === input.lag1Autocorrelation);
    return {
      status: 'ok', detectionProbabilityAtMinimumEffect: powers[index],
      minimumDetectableEffect70: mdes[index], statement: `rho=${input.lag1Autocorrelation}\nverbatim`,
    };
  };
  const result = assessFeasibility(baseline, lookup);
  assert.equal(calls.length, 12);
  for (const option of result.options) {
    assert.equal(option.plannedPowerAtMinimumEffect, 0.2);
    assert.equal(option.minPlannedPowerAcrossRho, 0.1);
    assert.equal(option.mdeDirectMinutes, 45);
    assert.equal(option.scenarioRho, config.autocorrelationGrid[2]);
    assert.equal(option.statement, 'rho=0.6\nverbatim');
    const own = lookup({ sd: 25, lag1Autocorrelation: option.scenarioRho, duration: option.duration });
    assert.equal(option.plannedPowerAtMinimumEffect, own.detectionProbabilityAtMinimumEffect);
    assert.equal(option.mdeDirectMinutes, own.minimumDetectableEffect70);
    assert.equal(option.statement, own.statement);
    assert.deepEqual(option.rhoLookups.map(row => row.input.lag1Autocorrelation), config.autocorrelationGrid);
  }
});

test('null power or MDE at any rho nulls the entire duration scenario, including rho and statement', () => {
  for (const field of ['power', 'mde', 'both'] as const) {
    const lookup: FeasibilityLookup = input => ({
      status: 'ok',
      detectionProbabilityAtMinimumEffect: input.lag1Autocorrelation === 0.4 && field !== 'mde' ? null : 0.2,
      minimumDetectableEffect70: input.lag1Autocorrelation === 0.4 && field !== 'power' ? null : 'not reachable within the duration',
      statement: `rho ${input.lag1Autocorrelation}`,
    });
    const result = assessFeasibility(baseline, lookup);
    for (const option of result.options) {
      assert.equal(option.plannedPowerAtMinimumEffect, null);
      assert.equal(option.mdeDirectMinutes, null);
      assert.equal(option.mdeAssignedDayEquivalent, null);
      assert.equal(option.scenarioRho, null);
      assert.equal(option.statement, null);
      assert.equal(option.minPlannedPowerAcrossRho, field === 'mde' ? 0.2 : null);
    }
  }
});

test('unreachable MDE outranks numeric MDE regardless of power; equal scenarios pick higher rho', () => {
  const lookup: FeasibilityLookup = input => ({
    status: 'ok', detectionProbabilityAtMinimumEffect: 0.2,
    minimumDetectableEffect70: input.lag1Autocorrelation === 0.2 ? 'not reachable within the duration' : 30,
    statement: `tie ${input.lag1Autocorrelation}`,
  });
  for (const option of assessFeasibility(baseline, lookup).options) {
    assert.equal(option.scenarioRho, 0.2);
    assert.equal(option.statement, 'tie 0.2');
    assert.equal(option.mdeDirectMinutes, 'larger_than_60');
  }
  for (const option of assessFeasibility(baseline, constantLookup(30)).options) {
    assert.equal(option.scenarioRho, Math.max(...config.autocorrelationGrid));
  }
});

test('equal MDE scenarios choose lower power before higher rho, including unreachable ties', () => {
  for (const mde of [45, 'not reachable within the duration'] as const) {
    const lookup: FeasibilityLookup = input => ({
      status: 'ok', minimumDetectableEffect70: mde,
      detectionProbabilityAtMinimumEffect: input.lag1Autocorrelation === 0.4 ? 0.1 : 0.3,
      statement: `MDE=${mde}; rho=${input.lag1Autocorrelation}`,
    });
    for (const option of assessFeasibility(baseline, lookup).options) {
      assert.equal(option.scenarioRho, 0.4);
      assert.equal(option.plannedPowerAtMinimumEffect, 0.1);
      assert.equal(option.minPlannedPowerAcrossRho, 0.1);
      assert.equal(option.statement, `MDE=${mde}; rho=0.4`);
    }
  }
});

for (const mde of [30, 37]) {
  test(`assigned-day equivalent for MDE ${mde} is MDE times 0.8`, () => {
    for (const option of assessFeasibility(baseline, constantLookup(mde)).options) {
      assert.equal(option.mdeAssignedDayEquivalent, mde * 0.8);
      assert.equal(option.mdeLabel, config.mdeLabel);
      assert.equal(option.adherenceAssumptionText, config.adherenceAssumptionText);
    }
  });
}

test('default duration is the shortest qualifying option, otherwise 84 for startable tiers', () => {
  const lookup: FeasibilityLookup = input => constantLookup(input.duration < 70 ? 37 : 30)(input);
  assert.equal(assessFeasibility(baseline, lookup).defaultDuration, 70);
  assert.equal(canStart(37).defaultDuration, 84);
});

test('start refuses both blocked tiers, unacknowledged long-shot, and duration 49 with typed errors', () => {
  assert.throws(() => startExperiment(baseline, canStart(46), 84, startDate, true, seed), isError('CANNOT_START'));
  assert.throws(() => startExperiment(baseline, assessFeasibility({ ...baseline, sd: null }), 84, startDate, true, seed), isError('CANNOT_START'));
  assert.throws(() => startExperiment(baseline, canStart(37), 84, startDate, false, seed), isError('ACKNOWLEDGEMENT_REQUIRED'));
  assert.throws(() => startExperiment(baseline, canStart(), 49, startDate, true, seed), isError('INVALID_DURATION'));
  assert.equal(startExperiment(baseline, canStart(37), 84, startDate, true, seed).chosenDuration, 84);
});

test('explicit seed is required; missing, noninteger, negative, and out-of-range seeds refuse', () => {
  assert.equal('defaultScheduleSeed' in config, false);
  assert.throws(() => Reflect.apply(startExperiment, undefined,
    [baseline, canStart(), 42, startDate, false]), isError('INVALID_SEED'));
  for (const invalidSeed of [0.5, -1, 0x100000000, NaN, Infinity]) {
    assert.throws(() => startExperiment(baseline, canStart(), 42, startDate, false, invalidSeed), isError('INVALID_SEED'));
  }
});

test('the same explicit seed reproduces the schedule and uint32 boundaries are accepted', () => {
  const feasibility = canStart();
  for (const explicitSeed of [0, seed, 0xffffffff]) {
    const first = startExperiment(baseline, feasibility, 42, startDate, false, explicitSeed);
    const second = startExperiment(baseline, feasibility, 42, startDate, false, explicitSeed);
    assert.equal(first.seed, explicitSeed);
    assert.equal(first.analysisSeed, ((explicitSeed * 1664525 + 1013904223) >>> 0));
    assert.equal(first.analysisSeed, second.analysisSeed);
    assert.notEqual(first.analysisSeed, explicitSeed);
    assert.ok(Number.isInteger(first.analysisSeed) && first.analysisSeed >= 0 && first.analysisSeed <= 0xffffffff);
    assert.deepEqual(first.schedule, second.schedule);
  }
});

test('start stores seed, engine schedule, assumptions, and deep snapshots without mutating inputs', () => {
  const input = { ...baseline, reasons: ['engine reason'] };
  const feasibility = assessFeasibility(input, constantLookup(30));
  const before = JSON.stringify({ input, feasibility });
  const plan = startExperiment(input, feasibility, 42, startDate, false, seed, engine);
  assert.equal(JSON.stringify({ input, feasibility }), before);
  assert.equal(plan.seed, 9988);
  assert.deepEqual(plan.schedule, engine.generateSchedule(startDate, 42, config.experimentDesign, 9988));
  assert.deepEqual(plan.baselineStats, { sd: 25, assumedAutocorrelation: 0.6, validDays: 14 });
  assert.equal(plan.assumedAdherence, 0.9);
  assert.equal(plan.assumedContamination, 0.1);
  assert.notEqual(plan.feasibilitySnapshot, feasibility);
  assert.notEqual(plan.feasibilitySnapshot.options[0].rhoLookups[0].input, feasibility.options[0].rhoLookups[0].input);
  input.reasons.push('later change');
  feasibility.inputs.baseline.reasons.push('later baseline change');
  feasibility.options[0].rhoLookups[0].output.statement = 'later output change';
  assert.deepEqual(plan.feasibilitySnapshot.inputs.baseline.reasons, ['engine reason']);
  assert.notEqual(plan.feasibilitySnapshot.options[0].rhoLookups[0].output.statement, 'later output change');
  assert.throws(() => startExperiment({ ...baseline, sd: 35 }, canStart(), 42, startDate, false, seed), isError('INVALID_FEASIBILITY'));
});

test('missing sleep and servings stay null, explicit none alone maps to zero servings, and time exposure is known', () => {
  const missing = toEngineRecord({ date: startDate, sleepMinutes: null, lastCaffeineTime: null }, 'intervention');
  assert.equal(missing.outcome.sleepMinutes, null);
  assert.deepEqual(missing.exposure, { servings: null, lastCaffeineTime: null });
  assert.equal(engine.adherenceStatus(missing), 'UNKNOWN');
  const timed = toEngineRecord({ date: startDate, sleepMinutes: 0, lastCaffeineTime: '11:00' }, 'intervention');
  assert.equal(timed.outcome.sleepMinutes, 0);
  assert.equal(timed.exposure.servings, null);
  assert.equal(engine.adherenceStatus(timed), 'ADHERENT');
  const none = toEngineRecord({ date: startDate, sleepMinutes: null, lastCaffeineTime: 'none' }, 'intervention');
  assert.deepEqual(none.exposure, { servings: 0, lastCaffeineTime: null });
  assert.equal(engine.adherenceStatus(none), 'ADHERENT');
  let called = false;
  const facade: EngineFacade = {
    ...engine,
    checkCaffeineEligibility(records, options) {
      called = true;
      assert.equal(options?.minRunInDays, 14);
      assert.equal(records[0].outcome.sleepMinutes, null);
      assert.equal(records[0].exposure.servings, null);
      return engine.checkCaffeineEligibility(records, options);
    },
  };
  computeBaseline([{ date: startDate, sleepMinutes: null, lastCaffeineTime: '15:00' }], facade);
  assert.equal(called, true);
});

test('baseline preserves engine reasons and returns no autocorrelation, power, or effect fields', () => {
  const entries = runIn();
  const own = engine.checkCaffeineEligibility(entries.map(entry => toEngineRecord(entry, 'control')), { minRunInDays: 14, cutoffTime: '12:00' });
  const result = computeBaseline(entries);
  assert.deepEqual(Object.keys(result).sort(), [
    'eligible', 'engineReasons', 'knownExposureDays', 'lateCaffeineDays', 'reasons',
    'sd', 'targetDays', 'unknownExposureDays', 'validDays',
  ]);
  assert.deepEqual(result.engineReasons, own.reasons);
  assert.equal(result.lateCaffeineDays, own.lateCaffeineDaysCount);
  assert.equal(result.knownExposureDays, own.knownExposureDaysCount);
  assert.equal(result.unknownExposureDays, own.unknownExposureDaysCount);
  assert.deepEqual(result.reasons, own.reasons);
  assert.equal(result.sd, own.baselineOutcomeSd);
  assert.equal(result.eligible, true);
  assert.equal(result.validDays, 14);
  assert.equal(own.knownExposureDaysCount, 14);
});

test('fewer than 14 valid sleep days cannot assess even when the engine finds enough run-in records', () => {
  const entries = runIn();
  entries[0].sleepMinutes = null;
  const summary = computeBaseline(entries);
  assert.equal(summary.validDays, 13);
  assert.equal(summary.targetDays, 14);
  assert.equal(summary.eligible, false);
  assert.ok(summary.reasons.includes('need 1 more valid days'));
  assert.equal(assessFeasibility(summary).tier, 'cannot_assess');
  const empty = computeBaseline([]);
  assert.equal(empty.sd, null);
  assert.equal(empty.eligible, false);
  assert.ok(empty.reasons.includes('need 14 more valid days'));
});

test('evaluate refuses before end without calling analysis, accepts on end, preserves statements and recomputes snapshot power', () => {
  const plan = realPlan();
  const end = plan.schedule[plan.schedule.length - 1].date;
  const noInterim: EngineFacade = { ...engine, analyzeExperiment() { assert.fail('no interim analysis'); } };
  assert.throws(() => evaluate(plan, [], engine.dateAt(end, -1), noInterim), isError('INTERIM_LOOK'));
  const entries: DailyEntry[] = plan.schedule.map(day => ({
    date: day.date, sleepMinutes: day.condition === 'intervention' ? 450 : 420,
    lastCaffeineTime: day.condition === 'intervention' ? '11:00' : '15:00',
  }));
  entries[0].sleepMinutes = null;
  let ownAnalysis: ReturnType<typeof engine.analyzeExperiment> | undefined;
  let ownVerdict: ReturnType<typeof engine.getVerdict> | undefined;
  const facade: EngineFacade = {
    ...engine,
    analyzeExperiment(definition, records, options) {
      assert.equal(records[0].outcome.sleepMinutes, null);
      assert.ok(records.every(record => record.exposure.servings === null));
      assert.equal(options?.baseline?.mean, null);
      assert.equal(options?.baseline?.sd, plan.baselineStats.sd);
      assert.equal(options?.baseline?.lag1Autocorrelation, plan.baselineStats.assumedAutocorrelation);
      assert.equal(options?.assumedAdherence, plan.assumedAdherence);
      assert.equal(options?.seed, plan.analysisSeed);
      assert.notEqual(options?.seed, plan.seed);
      assert.deepEqual({
        permutations: options?.permutations, bootstrapSamples: options?.bootstrapSamples,
        bootstrapMethod: options?.bootstrapMethod, bootstrapBlockLength: options?.bootstrapBlockLength,
      }, config.selectedPolicyOverrides.analysis);
      ownAnalysis = engine.analyzeExperiment(definition, records, options);
      return ownAnalysis;
    },
    getVerdict(result, options) {
      assert.equal(options?.gatePolicy, 'B');
      ownVerdict = engine.getVerdict(result, options);
      return ownVerdict;
    },
  };
  const before = JSON.stringify({ plan, entries });
  const result = evaluate(plan, entries, end, facade);
  assert.equal(JSON.stringify({ plan, entries }), before);
  assert.ok(ownAnalysis && ownVerdict);
  assert.equal(result.verdictLabel, ownVerdict.status);
  assert.equal(result.statement, ownVerdict.statement);
  assert.equal(result.conservativeEstimate, ownVerdict.conservative_estimate);
  assert.deepEqual(result.interval, ownVerdict.interval95);
  assert.equal(result.ruledOut, ownVerdict.ruled_out);
  assert.deepEqual(result.adherence, ownAnalysis.adherence);
  assert.deepEqual(result.daysAnalyzed, ownAnalysis.analyzableDays);
  assert.equal(result.daysExcluded, ownAnalysis.excludedDays);
  assert.equal(result.missingOutcomeDays, 1);
  assert.notEqual(result.plannedPowerRecomputed, null);
  assert.equal(result.plannedPowerRecomputed, result.plannedPowerSnapshot);
  assert.equal(plan.baselineStats.sd, 25); // Conservative lookup floor survives through analysis.
});

test('repeated evaluation of the same plan and entries has identical intervals', () => {
  const plan = realPlan();
  const entries = plan.schedule.map((day, index) => ({
    date: day.date, sleepMinutes: 420 + (index % 7) * 5 + (day.condition === 'intervention' ? 20 : 0),
    lastCaffeineTime: day.condition === 'intervention' ? '11:00' : '15:00',
  }));
  const end = plan.schedule.at(-1)!.date;
  const first = evaluate(plan, entries, end);
  const second = evaluate(plan, entries, end);
  assert.notEqual(first.interval, null);
  assert.deepEqual(first.interval, second.interval);
  assert.deepEqual(first, second);
});

test('baseline uses all entries beyond 14, including unknown exposure in the eligibility denominator', () => {
  const entries = runIn(21);
  for (let i = 7; i < entries.length; i++) entries[i].lastCaffeineTime = null;
  const own = engine.checkCaffeineEligibility(entries.map(entry => toEngineRecord(entry, 'control')), {
    minRunInDays: 14, cutoffTime: '12:00',
  });
  const summary = computeBaseline(entries);
  assert.equal(summary.validDays, 21);
  assert.equal(summary.lateCaffeineDays, 7);
  assert.equal(summary.knownExposureDays, 7);
  assert.equal(summary.unknownExposureDays, 14);
  assert.equal(summary.eligible, false);
  assert.equal(summary.sd, own.baselineOutcomeSd);
  assert.deepEqual(summary.engineReasons, own.reasons);
});

test('a modified schedule cannot bypass the interim-look guard', () => {
  const plan = realPlan();
  plan.schedule[plan.schedule.length - 1].date = startDate;
  assert.throws(() => evaluate(plan, [], startDate), isError('INVALID_PLAN'));
});

test('progress is counts only, uses engine adherence, ignores future logs, and counts unlogged exposure as unknown', () => {
  const plan = startExperiment(baseline, canStart(), 42, startDate, false, seed);
  const today = plan.schedule[2].date;
  const entries: DailyEntry[] = [
    { date: plan.schedule[0].date, sleepMinutes: 420, lastCaffeineTime: '11:00' },
    { date: plan.schedule[1].date, sleepMinutes: null, lastCaffeineTime: null },
    { date: plan.schedule[3].date, sleepMinutes: 420, lastCaffeineTime: 'none' },
  ];
  const neverAnalyze: EngineFacade = { ...engine, analyzeExperiment() { assert.fail('progress cannot analyze'); } };
  const result = progressSummary(plan, entries, today, neverAnalyze);
  assert.deepEqual(Object.keys(result).sort(), ['adherenceCounts', 'daysLogged', 'daysRemaining']);
  assert.deepEqual(Object.keys(result.adherenceCounts).sort(), ['ADHERENT', 'CONTAMINATED', 'CONTROL_CLEAN', 'NON_ADHERENT', 'UNKNOWN']);
  assert.equal(result.daysLogged, 1);
  assert.equal(result.daysRemaining, 39);
  assert.equal(result.adherenceCounts.UNKNOWN, 2);
  const status = engine.adherenceStatus(toEngineRecord(entries[0], plan.schedule[0].condition));
  assert.equal(result.adherenceCounts[status], 1);
  const before = progressSummary(plan, entries, engine.dateAt(startDate, -1));
  assert.equal(before.daysLogged, 0);
  assert.equal(before.daysRemaining, 42);
  assert.ok(Object.values(before.adherenceCounts).every(value => value === 0));
});

test('invalid and duplicate entries are rejected rather than silently counted or defaulted', () => {
  assert.throws(() => computeBaseline([{ date: startDate, sleepMinutes: -1, lastCaffeineTime: null }]), isError('INVALID_ENTRY'));
  assert.throws(() => computeBaseline([{ date: startDate, sleepMinutes: NaN, lastCaffeineTime: null }]), isError('INVALID_ENTRY'));
  assert.throws(() => computeBaseline([runIn()[0], runIn()[0]]), /Duplicate run-in date/);
  const plan = realPlan();
  const entry = { date: startDate, sleepMinutes: 420, lastCaffeineTime: null };
  assert.throws(() => progressSummary(plan, [entry, entry], startDate), isError('INVALID_ENTRY'));
  assert.throws(() => progressSummary(plan, [{ ...entry, date: '2025-01-01' }], startDate), isError('INVALID_ENTRY'));
});

test('selected policy overrides match the lookup harness while engine defaults remain unchanged', () => {
  const selection = JSON.parse(readFileSync(resolve(__dirname, '../reports/caffeine-simulation-v3-selection.json'), 'utf8'));
  assert.equal(selection.gatePolicy, 'B');
  assert.equal(selection.blockLength, config.experimentDesign.blockLength);
  assert.deepEqual(config.selectedPolicyOverrides, {
    analysis: { permutations: 149, bootstrapSamples: 149, bootstrapMethod: 'studentized', bootstrapBlockLength: 5 },
    verdict: { gatePolicy: 'B' },
  });
  const source = readFileSync(resolve(__dirname, 'simulate-engine-v3-1-helpers.ts'), 'utf8');
  assert.match(source, /draws: 149/);
  assert.match(source, /bootstrapBlockLength: 5/);
  assert.match(source, /getVerdict\(analysis, \{ gatePolicy: 'B' \}\)/);
  assert.equal(engine.DEFAULT_ANALYSIS.permutations, 999);
  assert.equal(engine.DEFAULT_ANALYSIS.bootstrapSamples, 999);
  assert.equal(engine.DEFAULT_ANALYSIS.bootstrapBlockLength, 3);
  assert.equal(engine.DEFAULT_VERDICT.gatePolicy, 'A');
  assert.equal(engine.DEFAULT_VERDICT.minInterventionAdherence, 0.85);
});

for (const [percent, adherentDays] of [[95, 38], [80, 32], [50, 20]] as const) {
  test(`Policy B real fixture at ${percent}% adherence labels reduced adherence without blocking support`, () => {
    const plan = realPlan();
    let interventionIndex = 0;
    // Forty known intervention exposures give exact 95/80/50 percent adherence.
    // The two remaining exposures stay unknown, never fabricated as compliant.
    const entries: DailyEntry[] = plan.schedule.map(day => {
      let lastCaffeineTime: string | null = '15:00';
      if (day.condition === 'intervention') {
        lastCaffeineTime = interventionIndex >= 40 ? null
          : interventionIndex < adherentDays ? '11:00' : '15:00';
        interventionIndex++;
      }
      return { date: day.date, sleepMinutes: day.condition === 'intervention' ? 480 : 420, lastCaffeineTime };
    });
    const records = entries.map((entry, index) => toEngineRecord(entry, plan.schedule[index].condition));
    const ownAnalysis = engine.analyzeExperiment(plan.definition, records, {
      ...config.selectedPolicyOverrides.analysis, seed: plan.analysisSeed,
      baseline: { mean: null, sd: plan.baselineStats.sd, lag1Autocorrelation: plan.baselineStats.assumedAutocorrelation },
      assumedAdherence: plan.assumedAdherence,
    });
    const ownVerdict = engine.getVerdict(ownAnalysis, config.selectedPolicyOverrides.verdict);
    const result = evaluate(plan, entries, plan.schedule[plan.schedule.length - 1].date);
    assert.equal(result.adherence.interventionAdherence, percent / 100);
    assert.equal(result.adherence.controlContamination, 0);
    assert.equal(result.adherence.counts.UNKNOWN, 2);
    assert.equal(result.verdictLabel, 'SUPPORTED');
    assert.equal(result.verdictLabel, ownVerdict.status);
    assert.equal(result.reducedAdherence, true);
    assert.equal(result.reducedAdherence, ownVerdict.effect_likely_understated);
    assert.equal(result.statement, ownVerdict.statement);
    assert.ok(result.statement.includes(' Reduced adherence was observed during the study, so actual treatment effects under full compliance may differ.'));
    assert.ok(result.reasons.every(reason => !/below the required|above the allowable/.test(reason)));
    if (percent < 85) assert.equal(engine.getVerdict(ownAnalysis).status, 'INCONCLUSIVE');
  });
}

test('default engine policy blocks 80 percent intervention adherence; B labels only and C uses 75 percent', () => {
  const plan = realPlan();
  const records = plan.schedule.map(day => toEngineRecord({
    date: day.date, sleepMinutes: day.condition === 'intervention' ? 450 : 420,
    lastCaffeineTime: day.condition === 'intervention' ? '11:00' : '15:00',
  }, day.condition));
  const analysis = engine.analyzeExperiment(plan.definition, records);
  analysis.adherence.interventionAdherence = 0.8;
  assert.equal(engine.getVerdict(analysis).status, 'INCONCLUSIVE');
  assert.ok(engine.getVerdict(analysis).reasons.includes('Intervention-day adherence is 80%, below the required 85%.'));
  for (const gatePolicy of ['B', 'C'] as const) {
    const verdict = engine.getVerdict(analysis, { gatePolicy });
    assert.equal(verdict.status, 'SUPPORTED');
    assert.equal(verdict.effect_likely_understated, true);
  }
});

test('adapter import scan permits only local engine/module imports and no React, Supabase, network, or AI calls', () => {
  const directory = resolve(__dirname, '../src/experiment');
  for (const file of readdirSync(directory).filter(file => file.endsWith('.ts'))) {
    const text = readFileSync(join(directory, file), 'utf8');
    const imports = [...text.matchAll(/\b(?:from\s*|import\s*)(['"])([^'"]+)\1/g)].map(match => match[2]);
    assert.ok(imports.every(specifier => specifier.startsWith('.')), `${file}: nonlocal import`);
    assert.ok(imports.every(specifier => !/react|supabase|fetch|openai|anthropic/i.test(specifier)), `${file}: forbidden import`);
    assert.doesNotMatch(text, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/, `${file}: network call`);
    assert.doesNotMatch(text, /\b(?:require|import)\s*\(\s*['"](?:react|@supabase|https?:|openai|@anthropic)/);
  }
});

test('freeze verifier passes real files and reports changed or missing files with nonzero CLI exit', () => {
  const real = verifyEngineFreeze(resolve(__dirname, '..'));
  assert.equal(real.checked, 10);
  assert.deepEqual(real.mismatches, []);
  const root = mkdtempSync(join(tmpdir(), 'experiment-freeze-'));
  try {
    mkdirSync(join(root, 'reports'));
    mkdirSync(join(root, 'src/engine'), { recursive: true });
    mkdirSync(join(root, 'scripts'));
    const file = 'src/engine/fixture.ts';
    const original = 'export const frozen = true;\n';
    const sha256 = createHash('sha256').update(original).digest('hex');
    writeFileSync(join(root, file), original);
    writeFileSync(join(root, 'reports/caffeine-simulation-v3.2-manifest.json'), JSON.stringify({
      reports: [{ path: 'reports/ignored.txt', sha256: 'ignored' }], engine: [{ path: file, sha256 }],
    }));
    assert.deepEqual(verifyEngineFreeze(root), { checked: 1, mismatches: [] });
    writeFileSync(join(root, file), 'changed\n');
    assert.equal(verifyEngineFreeze(root).mismatches[0].path, file);
    const cli = join(root, 'scripts/verify-engine-freeze.ts');
    writeFileSync(cli, readFileSync(join(__dirname, 'verify-engine-freeze.ts')));
    const child = spawnSync(process.execPath, [require.resolve('tsx/cli'), cli], { encoding: 'utf8' });
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stdout, /fixture\.ts/);
    rmSync(join(root, file));
    assert.match(verifyEngineFreeze(root).mismatches[0].actual, /READ ERROR/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
