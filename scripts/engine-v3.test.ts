import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeExperiment, assessFeasibility, displayValues, generateSchedule, getVerdict, normalCdf, randomizedBlockSpace } from '../src/engine';
import type { DayRecord, ExperimentDefinition, GatePolicy } from '../src/engine';
import { selectBlockLength, selectGatePolicy } from './simulation-v3-selection';
import { analyzeExperimentalComplier } from '../src/engine/experimental-complier';
const def: ExperimentDefinition = { name: 'Caffeine', startDate: '2026-01-01', lengthDays: 42,
  design: { type: 'randomized-blocks', blockLength: 3 }, seed: 30000000,
  outcomeMetric: 'sleepMinutes', conditionRule: { type: 'caffeine-cutoff', cutoffTime: '12:00' } };
const baseline = { mean: 420, sd: 45, lag1Autocorrelation: 0.4 };
const config = { permutations: 199, bootstrapSamples: 199, seed: 32000000, baseline };
function records(definition = def): DayRecord[] {
  return generateSchedule(definition.startDate, definition.lengthDays, definition.design, definition.seed).map(d => ({
    date: d.date, assignedCondition: d.condition,
    exposure: { servings: 2, lastCaffeineTime: d.condition === 'intervention' ? '11:00' : '15:00' },
    covariates: { alcohol: null, illness: false, travel: false, lateWorkout: null },
    outcome: { sleepMinutes: d.condition === 'intervention' ? 450 : 420, hrvMs: null }, exclusionReason: null,
  }));
}
test('predeclared selection obeys exact block thresholds, null FPR ceilings, and ties', () => {
  assert.equal(selectBlockLength({ detection: .33, coverage: .94 }, { detection: .30, coverage: .95 }), 2);
  assert.equal(selectBlockLength({ detection: .329, coverage: .95 }, { detection: .30, coverage: .95 }), 3);
  assert.equal(selectBlockLength({ detection: .40, coverage: .939 }, { detection: .30, coverage: .95 }), 3);
  assert.equal(selectGatePolicy([
    { policy: 'A', detection: .4, pooledNullFpr: .04, worstNullFpr: .06 },
    { policy: 'B', detection: .7, pooledNullFpr: .051, worstNullFpr: .06 },
    { policy: 'C', detection: .6, pooledNullFpr: .05, worstNullFpr: .07 },
  ]), 'C');
  assert.equal(selectGatePolicy([{ policy: 'B', detection: 1, pooledNullFpr: .01, worstNullFpr: .071 }]), null);
  assert.equal(selectGatePolicy(['A', 'B', 'C'].map(policy => ({ policy: policy as GatePolicy, detection: .5, pooledNullFpr: .05, worstNullFpr: .07 }))), 'A');
});
test('28 days and every <100 block allocation design are too short, independent of policies', () => {
  for (const lengthDays of [6, 28, 30]) for (const blockLength of [2, 3]) {
    const d = { ...def, lengthDays, design: { type: 'randomized-blocks', blockLength } as const };
    const result = analyzeExperiment(d, records(d), config);
    for (const gatePolicy of ['A', 'B', 'C'] as GatePolicy[]) if (lengthDays <= 28 || randomizedBlockSpace(d.startDate, lengthDays, blockLength).count < 100n) {
      assert.equal(getVerdict(result, { gatePolicy }).status, 'INCONCLUSIVE');
      assert.ok(getVerdict(result, { gatePolicy }).reasons.includes('too short for inference'));
    }
  }
  for (const lengthDays of [42, 56, 70, 84]) for (const blockLength of [2, 3]) {
    const d = { ...def, lengthDays, design: { type: 'randomized-blocks', blockLength } as const };
    const result = analyzeExperiment(d, records(d), config);
    assert.equal(getVerdict(result).status, 'SUPPORTED');
    assert.equal(result.primary.controlCount, lengthDays / 2);
  }
});
test('policies A/B/C keep evidence/day/estimate gates but differ only in compliance gates', () => {
  const data = records();
  for (const d of data.filter(d => d.assignedCondition === 'intervention').slice(0, 5)) d.exposure.lastCaffeineTime = '15:00';
  for (const d of data.filter(d => d.assignedCondition === 'control').slice(0, 4)) d.exposure.lastCaffeineTime = '11:00';
  const result = analyzeExperiment(def, data, config);
  assert.equal(getVerdict(result, { gatePolicy: 'A' }).status, 'INCONCLUSIVE');
  for (const gatePolicy of ['B', 'C'] as GatePolicy[]) {
    const verdict = getVerdict(result, { gatePolicy });
    assert.equal(verdict.status, 'SUPPORTED');
    assert.equal(verdict.effect_likely_understated, true);
    assert.equal(verdict.intervention_adherence, 16 / 21);
    assert.equal(verdict.control_contamination, 4 / 21);
    assert.equal(verdict.gate_policy, gatePolicy);
    assert.equal(getVerdict({ ...result, primary: { ...result.primary, difference: 14 } }, { gatePolicy }).status, 'INCONCLUSIVE');
    assert.equal(getVerdict({ ...result, primary: { ...result.primary, pValue: 1 } }, { gatePolicy }).status, 'INCONCLUSIVE');
    assert.equal(getVerdict({ ...result, primary: { ...result.primary, interval95: [-1, 40] } }, { gatePolicy }).status, 'INCONCLUSIVE');
  }
  for (const d of data.filter(d => d.assignedCondition === 'intervention').slice(0, 12)) d.exposure = { servings: null, lastCaffeineTime: null };
  const missing = analyzeExperiment(def, data, config);
  assert.equal(missing.primary.interventionCount, 21);
  assert.equal(missing.analyzableDays.intervention, 9);
  assert.equal(getVerdict(missing, { gatePolicy: 'B' }).status, 'INCONCLUSIVE');
});
test('analytic feasibility is deterministic, monotone, translation invariant and null-safe', () => {
  const input = { ...baseline, duration: 56, design: def.design, observedEffect: 30 };
  const estimate = assessFeasibility(input);
  assert.deepEqual(estimate, assessFeasibility(input));
  assert.equal(estimate.supportsInference, true);
  assert.ok(Number(estimate.minimumDetectableEffect70!) > 15);
  const atMde = assessFeasibility({ ...input, observedEffect: Number(estimate.minimumDetectableEffect70) });
  assert.ok(Math.abs(atMde.approximatePower! - 0.7) < 1e-6);
  assert.equal(assessFeasibility({ ...input, mean: -100 }).standardError, estimate.standardError);
  assert.ok(assessFeasibility({ ...input, duration: 84 }).minimumDetectableEffect70! < estimate.minimumDetectableEffect70!);
  assert.ok(assessFeasibility({ ...input, sd: 60 }).minimumDetectableEffect70! > estimate.minimumDetectableEffect70!);
  assert.ok(assessFeasibility({ ...input, outcomeRetention: 0.8 }).standardError! > estimate.standardError!);
  assert.equal(assessFeasibility({ ...input, sd: null }).inflation_risk, 'unknown');
  assert.equal(assessFeasibility({ ...input, lag1Autocorrelation: null }).approximatePower, null);
  assert.equal(assessFeasibility({ ...input, observedEffect: 5 }).inflation_risk, 'high');
  assert.equal(assessFeasibility({ ...input, observedEffect: 100 }).inflation_risk, 'low');
  assert.equal(assessFeasibility({ ...input, duration: 28 }).minimumDetectableEffect70, null);
  assert.equal(assessFeasibility({ ...input, design: { type: 'alternating' } }).supportsInference, false);
  assert.equal(assessFeasibility({ ...input, sd: 0, observedEffect: 30 }).approximatePower, 1);
  assert.equal(assessFeasibility({ ...input, sd: 0, observedEffect: 14 }).approximatePower, 0);
  assert.throws(() => assessFeasibility({ ...input, sd: -1 }));
  assert.throws(() => assessFeasibility({ ...input, lag1Autocorrelation: 1 }));
  assert.throws(() => assessFeasibility({ ...input, outcomeRetention: 0 }));
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7);
});
test('every effect display has null-preserving interval/conservative estimate and baseline-based inflation risk', () => {
  const result = analyzeExperiment(def, records(), config);
  for (const value of [result, result.primary, result.secondary, getVerdict(result)]) {
    assert.ok(value.estimand.length > 0);
    assert.deepEqual(value.interval95, [30, 30]);
    assert.equal(value.conservative_estimate, 30);
    assert.ok(['high', 'low'].includes(value.inflation_risk));
  }
  assert.deepEqual(displayValues([-5, 35], 'high'), { interval95: [-5, 35], conservative_estimate: 0, inflation_risk: 'high' });
  const unknown = analyzeExperiment(def, [], config);
  assert.equal(unknown.primary.difference, null);
  assert.equal(unknown.conservative_estimate, null);
  assert.equal(unknown.interval95, null);
  assert.equal(analyzeExperiment(def, records(), { permutations: 199, bootstrapSamples: 199 }).inflation_risk, 'unknown');
});
test('experimental complier has explicit opt-in contract and never influences default verdict', () => {
  const data = records();
  const result = analyzeExperiment(def, data, config);
  assert.equal('complier' in result, false);
  const before = getVerdict(result);
  const experimental = analyzeExperimentalComplier(def, data, config, result);
  assert.equal(experimental.difference, 30);
  assert.match(experimental.label, /EXPERIMENTAL/);
  assert.equal(experimental.conservative_estimate, 30);
  assert.equal(experimental.inflation_risk, 'unknown');
  assert.deepEqual(getVerdict(result), before);
});
