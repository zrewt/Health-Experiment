import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeExperiment,
  assessFeasibility,
  displayValues,
  formatResultStatement,
  generateSchedule,
  getVerdict,
  lookupDetection,
  lookupFeasibility,
} from '../src/engine';
import type { DayRecord, ExperimentDefinition } from '../src/engine';

const def: ExperimentDefinition = {
  name: 'Caffeine cutoff v3.1',
  startDate: '2026-01-01',
  lengthDays: 56,
  design: { type: 'randomized-blocks', blockLength: 2, balanceWeekends: true },
  seed: 50000000,
  outcomeMetric: 'sleepMinutes',
  conditionRule: { type: 'caffeine-cutoff', cutoffTime: '12:00' },
};

function records(effect = 30): DayRecord[] {
  return generateSchedule(def.startDate, def.lengthDays, def.design, def.seed).map(d => ({
    date: d.date,
    assignedCondition: d.condition,
    exposure: { servings: 2, lastCaffeineTime: d.condition === 'intervention' ? '11:00' : '15:00' },
    covariates: { alcohol: null, illness: false, travel: false, lateWorkout: null },
    outcome: { sleepMinutes: d.condition === 'intervention' ? 420 + effect : 420, hrvMs: null },
    exclusionReason: null,
  }));
}

test('feasibility lookup interpolates correctly and returns unknown outside bounds', () => {
  // On-grid point
  const onGrid = lookupDetection(45, 0.4, 56, 1.0, 30);
  assert.ok(onGrid !== null && onGrid > 0.3 && onGrid <= 1.0);

  // Intermediate point (interpolated)
  const interp = lookupDetection(40, 0.3, 56, 0.95, 25);
  assert.ok(interp !== null && interp > 0 && interp < 1);

  // Outside bounds returns unknown
  const lowSd = lookupDetection(10, 0.4, 56, 1.0, 30);
  assert.equal(lowSd, null);

  const highRho = lookupDetection(45, 0.85, 56, 1.0, 30);
  assert.equal(highRho, null);

  const lookupResult = lookupFeasibility({
    sd: 40,
    lag1Autocorrelation: 0.3,
    duration: 56,
    adherence: 1.0,
    minMeaningfulEffect: 15,
  });
  assert.equal(lookupResult.status, 'ok');
  assert.ok(lookupResult.detectionProbabilityAtMinimumEffect !== null);
  assert.match(lookupResult.statement, /Over 56 days/);
  assert.match(lookupResult.statement, /Detection probability at the minimum meaningful effect/);

  // Outside bounds returns unknown status
  const outside = lookupFeasibility({
    sd: 100,
    lag1Autocorrelation: 0.8,
    duration: 56,
  });
  assert.equal(outside.status, 'unknown');
  assert.equal(outside.detectionProbabilityAtMinimumEffect, null);
  assert.match(outside.statement, /outside lookup table range/);
});

test('planned-power inflation risk and reliability bands derived from lookup', () => {
  // High noise (SD 75, rho 0.6, duration 42) -> planned power < 30% -> high risk, low reliability
  const underpowered = assessFeasibility({
    mean: 420,
    sd: 75,
    lag1Autocorrelation: 0.6,
    duration: 42,
    design: def.design,
    assumedAdherence: 0.9,
    minMeaningfulEffect: 15,
  });
  assert.equal(underpowered.inflation_risk, 'high');
  assert.equal(underpowered.estimate_reliability, 'low');
  assert.ok(underpowered.plannedPowerAtMinimumEffect! < 0.3);

  // Moderate-powered setup (SD 25, rho 0.2, duration 84, minMeaningfulEffect 15) -> 49% -> moderate risk, moderate reliability
  const modPowered = assessFeasibility({
    mean: 420,
    sd: 25,
    lag1Autocorrelation: 0.2,
    duration: 84,
    design: def.design,
    assumedAdherence: 1.0,
    minMeaningfulEffect: 15,
  });
  assert.equal(modPowered.inflation_risk, 'moderate');
  assert.equal(modPowered.estimate_reliability, 'moderate');
  assert.ok(modPowered.plannedPowerAtMinimumEffect! >= 0.3 && modPowered.plannedPowerAtMinimumEffect! <= 0.6);

  // Well-powered setup with larger meaningful effect (25 minutes) -> planned power > 60% -> low risk, high reliability
  const wellPowered = assessFeasibility({
    mean: 420,
    sd: 25,
    lag1Autocorrelation: 0.2,
    duration: 84,
    design: def.design,
    assumedAdherence: 1.0,
    minMeaningfulEffect: 25,
  });
  assert.equal(wellPowered.inflation_risk, 'low');
  assert.equal(wellPowered.estimate_reliability, 'high');
  assert.ok(wellPowered.plannedPowerAtMinimumEffect! > 0.6);

  // Missing baseline inputs return unknown
  const missing = assessFeasibility({
    mean: 420,
    sd: null,
    lag1Autocorrelation: null,
    duration: 56,
    design: def.design,
  });
  assert.equal(missing.inflation_risk, 'unknown');
  assert.equal(missing.estimate_reliability, 'unknown');
});

test('display values include ruled_out and planned power metrics', () => {
  const d = displayValues([10, 45], 'low', {
    planned_power_at_minimum_effect: 0.75,
    estimate_reliability: 'high',
    ruled_out: 45,
  });
  assert.equal(d.ruled_out, 45);
  assert.equal(d.conservative_estimate, 10);
  assert.equal(d.inflation_risk, 'low');
  assert.equal(d.planned_power_at_minimum_effect, 0.75);
  assert.equal(d.estimate_reliability, 'high');

  const analysis = analyzeExperiment(def, records(30), {
    permutations: 149,
    bootstrapSamples: 149,
    baseline: { mean: 420, sd: 45, lag1Autocorrelation: 0.4 },
  });
  assert.ok('ruled_out' in analysis.primary);
  assert.equal(analysis.primary.ruled_out, analysis.primary.interval95![1]);
  assert.ok('planned_power_at_minimum_effect' in analysis.primary);
  assert.ok('estimate_reliability' in analysis.primary);
});

test('plain-language statements follow exact wording rules', () => {
  // 1. SUPPORTED statement
  const supStmt = formatResultStatement('SUPPORTED', 22.5, [16.2, 28.8], 'sleepMinutes', false, false);
  assert.match(supStmt, /assigned-day difference of 22\.5 units in mean sleepMinutes favoring intervention/);
  assert.match(supStmt, /plausible range of 16\.2 to 28\.8 units/);
  assert.doesNotMatch(supStmt, /causes|guarantees|certainly|probability/);

  // 2. NO_DETECTABLE_EFFECT statement
  const nullStmt = formatResultStatement('NO_DETECTABLE_EFFECT', 1.2, [-4.0, 6.5], 'sleepMinutes', false, false);
  assert.match(nullStmt, /assigned-day difference of 1\.2 units in mean sleepMinutes lies within the configured equivalence margin/);
  assert.match(nullStmt, /plausible range of -4\.0 to 6\.5 units/);

  // 3. INCONCLUSIVE statement
  const incStmt = formatResultStatement('INCONCLUSIVE', 8.5, [-3.0, 20.0], 'sleepMinutes', true, true);
  assert.match(incStmt, /assigned-day difference of 8\.5 units in mean sleepMinutes leaves whether there is a meaningful benefit uncertain/);
  assert.match(incStmt, /Reduced adherence was observed during the study/);
  assert.match(incStmt, /Planned design power for this protocol was low, increasing the risk of an unreliable or exaggerated estimate/);

  // 4. Analysis and Verdict contain statement
  const res = analyzeExperiment(def, records(30), {
    permutations: 149,
    bootstrapSamples: 149,
    baseline: { mean: 420, sd: 45, lag1Autocorrelation: 0.4 },
  });
  const verd = getVerdict(res, { gatePolicy: 'B' });
  assert.ok(res.statement && res.statement.length > 0);
  assert.ok(verd.statement && verd.statement.length > 0);
  assert.match(verd.statement, /plausible range/);
});
