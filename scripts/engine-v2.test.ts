import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeExperiment, checkCaffeineEligibility, generateSchedule, getVerdict, isWeekend, partitionBlocks, randomizedBlockSpace, seededRandom } from '../src/engine';
import { analyzeExperimentalComplier } from '../src/engine/experimental-complier';
import type { DayRecord, ExperimentDefinition, ExposureRule } from '../src/engine';
const definition: ExperimentDefinition = {
  name: 'Caffeine cutoff', startDate: '2026-01-01', lengthDays: 28,
  design: { type: 'randomized-blocks', blockLength: 3 }, seed: 42,
  outcomeMetric: 'sleepMinutes', conditionRule: { type: 'caffeine-cutoff', cutoffTime: '12:00' },
};
const config = { permutations: 199, bootstrapSamples: 199, seed: 8 };
function records(def = definition, effect = 30): DayRecord[] {
  return generateSchedule(def.startDate, def.lengthDays, def.design, def.seed).map(d => ({
    date: d.date, assignedCondition: d.condition,
    exposure: { servings: 2, lastCaffeineTime: d.condition === 'intervention' ? '11:00' : '15:00' },
    covariates: { alcohol: null, illness: false, travel: false, lateWorkout: null },
    outcome: { sleepMinutes: 420 + (d.condition === 'intervention' ? effect : 0), hrvMs: null }, exclusionReason: null,
  }));
}
test('randomized blocks preserve equal blocks/days and optimal weekend balance across lengths, starts, stratifications and seeds', () => {
  for (const duration of [28, 42, 56]) for (const blockLength of [2, 3]) for (const start of ['2026-01-01', '2026-01-05']) {
    const space = randomizedBlockSpace(start, duration, blockLength);
    for (let seed = 0; seed < 40; seed++) {
      const schedule = generateSchedule(start, duration, { type: 'randomized-blocks', blockLength }, seed);
      assert.deepEqual(schedule, generateSchedule(start, duration, { type: 'randomized-blocks', blockLength }, seed));
      assert.equal(schedule.filter(d => d.condition === 'intervention').length, duration / 2);
      const assignment = space.sampleBlocks(seededRandom(seed));
      assert.equal(assignment.filter(c => c === 'intervention').length, space.blocks.length / 2);
      const weekend = schedule.filter(d => isWeekend(d.date));
      const iw = weekend.filter(d => d.condition === 'intervention').length;
      assert.equal(Math.abs(2 * iw - weekend.length), space.minWeekendDiff);
      for (const b of space.blocks) for (let j = b.startIndex; j < b.endIndex; j++) assert.equal(schedule[j].condition, schedule[b.startIndex].condition);
    }
  }
  assert.throws(() => partitionBlocks('2026-01-01', 27, 3), /even/);
  assert.throws(() => partitionBlocks('2026-01-01', 28, 0));
  assert.throws(() => partitionBlocks('2026-01-01', 28, 5));
});
test('DP count equals independently brute-forced admissible assignments, with stratification on and off', () => {
  for (const balanced of [false, true]) {
    const space = randomizedBlockSpace('2026-01-01', 28, 3, balanced);
    const candidates: { mask: number; diff: number }[] = [];
    for (let mask = 0; mask < 2 ** space.blocks.length; mask++) {
      let count = 0, days = 0, iw = 0, totalW = 0;
      for (const b of space.blocks) {
        totalW += b.weekendDays;
        if (mask & (1 << b.index)) { count++; days += b.length; iw += b.weekendDays; }
      }
      if (count === space.blocks.length / 2 && days === 14) candidates.push({ mask, diff: Math.abs(2 * iw - totalW) });
    }
    const minDiff = Math.min(...candidates.map(c => c.diff));
    const expected = candidates.filter(c => !balanced || c.diff === minDiff);
    assert.equal(space.count, BigInt(expected.length));
    assert.equal(space.enumerate().length, expected.length);
    for (const a of space.enumerate()) {
      const mask = a.reduce((sum, c, j) => sum + (c === 'intervention' ? 2 ** j : 0), 0);
      assert.ok(expected.some(c => c.mask === mask));
    }
  }
  assert.equal(randomizedBlockSpace('2026-01-01', 28).count, 42n);
  const large = randomizedBlockSpace('2026-01-01', 366, 2);
  assert.ok(large.count > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(large.sampleBlocks(seededRandom(1)).length, large.blocks.length);
  assert.throws(() => large.enumerate(), /too large/);
});
test('exact two-sided test counts complement, warns, and refuses alpha below achievable resolution', () => {
  const result = analyzeExperiment(definition, records(), config);
  assert.equal(result.primary.admissibleAssignmentsExact, '42');
  assert.equal(result.primary.minAchievablePValue, 2 / 42);
  assert.equal(result.primary.pValue, 2 / 42);
  assert.match(result.primary.permutationWarning!, /Fewer than 100/);
  assert.equal(getVerdict(result).status, 'INCONCLUSIVE');
  assert.ok(getVerdict(result).reasons.includes('too short for inference'));
  const verdict = getVerdict(result, { significanceLevel: 0.01 });
  assert.equal(verdict.status, 'INCONCLUSIVE');
  assert.ok(verdict.reasons.some(r => r.includes('too few')));
  assert.deepEqual(result, analyzeExperiment(definition, records(), config));
});
test('eligibility thresholds, sample SD, missing outcomes, unknown exposure, and contradictions', () => {
  const runIn = records().slice(0, 7);
  for (let j = 0; j < 7; j++) {
    runIn[j].exposure.lastCaffeineTime = j < 4 ? '12:01' : '12:00';
    runIn[j].outcome.sleepMinutes = j === 0 ? 0 : null;
  }
  const result = checkCaffeineEligibility(runIn);
  assert.equal(result.lateCaffeineShare, 4 / 7);
  assert.equal(result.baselineOutcomeMean, 0);
  assert.equal(result.baselineOutcomeSd, null);
  assert.equal(result.eligible, true);
  assert.equal(checkCaffeineEligibility(runIn, { minLateCaffeineShare: 0.6 }).eligible, false);
  assert.equal(checkCaffeineEligibility(runIn.slice(0, 6)).eligible, false);
  runIn[0].exposure = { servings: null, lastCaffeineTime: null };
  assert.equal(checkCaffeineEligibility(runIn).eligible, false);
  assert.equal(checkCaffeineEligibility(runIn).unknownExposureDaysCount, 1);
  runIn[1].exposure = { servings: 0, lastCaffeineTime: '15:00' };
  assert.throws(() => checkCaffeineEligibility(runIn), /conflicts/);
  assert.throws(() => checkCaffeineEligibility([], { minLateCaffeineShare: -1 }));
});
test('85%/15% gates include boundary overrides; unknown exposure reduces analyzable days but preserves ITT outcomes', () => {
  const data = records();
  const intervention = data.filter(d => d.assignedCondition === 'intervention');
  for (const day of intervention.slice(0, 3)) day.exposure.lastCaffeineTime = '15:00';
  const low = analyzeExperiment(definition, data, config);
  assert.equal(getVerdict(low).status, 'INCONCLUSIVE');
  // The new duration rule prevents support even after adherence overrides.
  assert.equal(getVerdict(low, { minInterventionAdherence: 11 / 14 }).status, 'INCONCLUSIVE');
  assert.equal(getVerdict(low, { minAdherence: 11 / 14 }).status, 'INCONCLUSIVE');
  const long = { ...definition, lengthDays: 42 };
  const longData = records(long);
  for (const day of longData.filter(d => d.assignedCondition === 'intervention').slice(0, 4)) day.exposure.lastCaffeineTime = '15:00';
  const longResult = analyzeExperiment(long, longData, config);
  assert.equal(getVerdict(longResult).status, 'INCONCLUSIVE');
  assert.equal(getVerdict(longResult, { minInterventionAdherence: 17 / 21 }).status, 'SUPPORTED');
  assert.equal(getVerdict(longResult, { minAdherence: 17 / 21 }).status, 'SUPPORTED');
  for (const day of intervention.slice(0, 5)) day.exposure = { servings: null, lastCaffeineTime: null };
  const unknown = analyzeExperiment(definition, data, config);
  assert.equal(unknown.primary.interventionCount, 14);
  assert.equal(unknown.analyzableDays.intervention, 9);
  assert.equal(unknown.unknownExposureDays, 5);
  assert.equal(getVerdict(unknown).status, 'INCONCLUSIVE');
});
test('joint whole-block IV ratio recovers known exposure effect and refuses weak instruments at <0.5', () => {
  const data = records();
  let i = 0, c = 0;
  for (const block of partitionBlocks(definition.startDate, 28)) {
    for (let j = block.startIndex; j < block.endIndex; j++) {
      const d = data[j];
      // Spread exposure within blocks: every intervention block has >50%
      // exposure and every control block <50%, so all joint draws are stable.
      const exposed = d.assignedCondition === 'intervention'
        ? true
        : block.length === 3 && j === block.startIndex;
      d.exposure.lastCaffeineTime = exposed ? '11:00' : '15:00';
      d.outcome.sleepMinutes = 420 + (exposed ? 30 : 0);
    }
  }
  const result = analyzeExperimentalComplier(definition, data, config);
  assert.ok(Math.abs(result.difference! - 30) < 1e-9);
  assert.ok(result.interval95 !== null);
  assert.ok(result.interval95![0] <= 30 + 1e-9 && result.interval95![1] >= 30 - 1e-9);
  assert.match(result.intervalMethod!, /joint whole/);
  const weakData = records();
  i = 0; c = 0;
  for (const d of weakData) d.exposure.lastCaffeineTime = (d.assignedCondition === 'intervention' ? i++ < 9 : c++ < 3) ? '11:00' : '15:00';
  const weak = analyzeExperimentalComplier(definition, weakData, config);
  assert.equal(weak.difference, null);
  assert.equal(weak.interval95, null);
  assert.match(weak.reason!, /weak instrument/);
  weakData[weakData.findIndex(d => d.assignedCondition === 'intervention' && d.exposure.lastCaffeineTime === '15:00')].exposure.lastCaffeineTime = '11:00';
  assert.equal(analyzeExperimentalComplier(definition, weakData, config).weakInstrument, false);
  // Clustering all noncompliance into a few blocks can create nonpositive
  // replicate first stages; they must not be trimmed out of an apparently valid CI.
  i = 0; c = 0;
  const clustered = records();
  for (const d of clustered) {
    const exposed = d.assignedCondition === 'intervention' ? i++ < 11 : c++ < 2;
    d.exposure.lastCaffeineTime = exposed ? '11:00' : '15:00';
  }
  const unstable = analyzeExperimentalComplier(definition, clustered, config);
  assert.equal(unstable.interval95, null);
  assert.match(unstable.reason!, /no tail trimming/);
});
test('outcome metric and exposure rule are pluggable without caffeine/sleep assumptions', () => {
  // A stub interface contract test, not another experiment implementation.
  const rule: ExposureRule<{ flag: boolean | null }> = {
    type: 'test-stub', adherenceStatus(day) {
      if (day.exposure.flag === null || day.exposure.flag === undefined) return 'UNKNOWN';
      return day.assignedCondition === 'intervention' ? day.exposure.flag ? 'ADHERENT' : 'NON_ADHERENT' : day.exposure.flag ? 'CONTAMINATED' : 'CONTROL_CLEAN';
    },
  };
  const def = { ...definition, conditionRule: rule, outcomeMetric: 'stubMetric' };
  const data = records().map(d => ({ ...d, exposure: { flag: d.assignedCondition === 'intervention' }, outcome: { ...d.outcome, sleepMinutes: null, stubMetric: d.assignedCondition === 'intervention' ? 20 : -10 } }));
  const result = analyzeExperiment(def, data, config);
  assert.equal(result.primary.difference, 30);
  assert.equal(result.missingOutcomeDays, 0);
  const experimental = analyzeExperimentalComplier(def, data, config);
  for (const estimate of [result, result.primary, result.secondary, experimental, getVerdict(result)]) assert.match(estimate.estimand, /stubMetric/);
  assert.equal(experimental.difference, 30);
  assert.equal('complier' in result, false);
});
test('size flag remains true when other gates fail and intervals exclude zero below meaningful threshold', () => {
  const result = analyzeExperiment(definition, records(), config);
  const modified = { ...result, primary: { ...result.primary, difference: 20, interval95: [5, 35] as [number, number] } };
  assert.equal(getVerdict(modified).size_uncertain, true);
  assert.equal(getVerdict(modified, { minDaysPerCondition: 30 }).size_uncertain, true);
  assert.throws(() => analyzeExperiment(definition, records(), { bootstrapSamples: 0 }));
  assert.throws(() => getVerdict(result, { maxControlContamination: -1 }));
});
