import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adherenceStatus,
  analyzeExperiment,
  applyExclusions,
  checkCaffeineEligibility,
  generateSchedule,
  getVerdict,
  prepareDays,
  scoreAdherence,
  partitionBlocks,
} from '../src/engine';
import { analyzeExperimentalComplier } from '../src/engine/experimental-complier';
import type { AnalysisResult, DayRecord, ExperimentDefinition } from '../src/engine';

const definition: ExperimentDefinition = {
  name: 'Caffeine cutoff',
  startDate: '2026-01-01',
  lengthDays: 28,
  design: { type: 'randomized', maxConsecutiveDays: 3 },
  seed: 7,
  outcomeMetric: 'sleepMinutes',
  conditionRule: { type: 'caffeine-cutoff', cutoffTime: '12:00' },
};

function days(effect = 0, def = definition): DayRecord[] {
  return generateSchedule(def.startDate, def.lengthDays, def.design, def.seed).map(day => ({
    date: day.date,
    assignedCondition: day.condition,
    exposure: { servings: 2, lastCaffeineTime: day.condition === 'intervention' ? '12:00' : '15:00' },
    covariates: { alcohol: null, illness: false, travel: false, lateWorkout: null },
    outcome: { sleepMinutes: 420 + (day.condition === 'intervention' ? effect : 0), hrvMs: null },
    exclusionReason: null,
  }));
}
const config = { permutations: 199, bootstrapSamples: 199, seed: 12 };

test('seeded randomized schedules are deterministic, balanced and capped across 100 seeds', () => {
  for (let seed = 0; seed < 100; seed++) {
    for (const length of [27, 28]) {
      const schedule = generateSchedule('2024-02-20', length, definition.design, seed);
      assert.deepEqual(schedule, generateSchedule('2024-02-20', length, definition.design, seed));
      const count = schedule.filter(d => d.condition === 'control').length;
      assert.ok(Math.abs(count - (length - count)) <= 1);
      let run = 0, last = '';
      for (const day of schedule) {
        run = day.condition === last ? run + 1 : 1;
        last = day.condition;
        assert.ok(run <= 3);
      }
      assert.equal(schedule[9].date, '2024-02-29');
    }
  }
  assert.notDeepEqual(generateSchedule('2026-01-01', 28, definition.design, 1), generateSchedule('2026-01-01', 28, definition.design, 2));
});

test('alternating and block designs respect patterns and deterministic phases', () => {
  for (const design of [{ type: 'alternating' } as const, { type: 'blocks', blockLength: 4 } as const]) {
    const schedule = generateSchedule('2026-01-01', 28, design, 2);
    assert.deepEqual(schedule, generateSchedule('2026-01-01', 28, design, 2));
    const block = design.type === 'blocks' ? 4 : 1;
    for (let n = 1; n < schedule.length; n++) assert.equal(schedule[n].condition === schedule[n - 1].condition, n % block !== 0);
  }
  const capped = generateSchedule('2026-01-01', 28, { type: 'randomized', maxConsecutiveDays: 1 }, 2);
  for (let n = 1; n < capped.length; n++) assert.notEqual(capped[n].condition, capped[n - 1].condition);
});

test('invalid dates, lengths, seeds and caps are rejected', () => {
  assert.throws(() => generateSchedule('2026-02-30', 28, definition.design, 7));
  assert.throws(() => generateSchedule('2026-01-01', 0, definition.design, 7));
  assert.throws(() => generateSchedule('2026-01-01', 28, { type: 'randomized', maxConsecutiveDays: 0 }, 7));
  assert.throws(() => generateSchedule('2026-01-01', 28, definition.design, -1));
});

test('adherence handles exact noon, no caffeine, missing times, contamination and contradictions', () => {
  const day = days().find(d => d.assignedCondition === 'intervention')!;
  assert.equal(adherenceStatus(day), 'ADHERENT');
  assert.equal(adherenceStatus({ ...day, exposure: { servings: 0, lastCaffeineTime: null } }), 'ADHERENT');
  assert.equal(adherenceStatus({ ...day, exposure: { servings: null, lastCaffeineTime: null } }), 'UNKNOWN');
  assert.equal(adherenceStatus({ ...day, exposure: { servings: 2, lastCaffeineTime: null } }), 'UNKNOWN');
  assert.equal(adherenceStatus({ ...day, exposure: { servings: null, lastCaffeineTime: '12:01' } }), 'NON_ADHERENT');
  assert.equal(adherenceStatus({ ...day, assignedCondition: 'control' }), 'CONTAMINATED');
  assert.throws(() => adherenceStatus({ ...day, exposure: { servings: 0, lastCaffeineTime: '10:00' } }));
  assert.equal(scoreAdherence([]).overallAdherence, null);
  assert.equal(scoreAdherence([{ ...day, exposure: { servings: null, lastCaffeineTime: null } }]).overallAdherence, null);
});

test('exclusions preserve all reasons, null flags, and input immutability', () => {
  const day = days()[0];
  day.covariates.illness = true;
  day.covariates.travel = true;
  day.exclusionReason = 'User excluded';
  const result = applyExclusions([day]);
  assert.equal(result[0].exclusionReason, 'User excluded; Illness; Travel');
  assert.equal(day.exclusionReason, 'User excluded');
  assert.equal(applyExclusions([{ ...day, exclusionReason: null }], { illness: false, travel: false })[0].exclusionReason, null);
  assert.equal(applyExclusions([{ ...day, exclusionReason: null, covariates: { alcohol: null, illness: null, travel: null, lateWorkout: null } }])[0].exclusionReason, null);
});

test('missing records stay null, zero is observed, duplicates and assignment mismatch rejected', () => {
  const records = days();
  records[0].outcome.sleepMinutes = 0;
  records[1].outcome.sleepMinutes = null;
  const prepared = prepareDays(definition, records.slice(0, 27));
  assert.equal(prepared[0].outcome.sleepMinutes, 0);
  assert.equal(prepared[27].outcome.sleepMinutes, null);
  assert.equal(prepared[27].exposure.servings, null);
  const result = analyzeExperiment(definition, records.slice(0, 27), config);
  assert.equal(result.primary.controlCount + result.primary.interventionCount, 26);
  assert.equal(result.missingOutcomeDays, 2);
  assert.throws(() => prepareDays(definition, [...records, records[0]]));
  assert.throws(() => prepareDays(definition, [{ ...records[0], assignedCondition: records[0].assignedCondition === 'control' ? 'intervention' : 'control' }]));
});

test('known beneficial/no-effect datasets yield exact estimates and verdicts, deterministically', () => {
  const def = { ...definition, lengthDays: 42 };
  const benefit = analyzeExperiment(def, days(30, def), config);
  assert.equal(benefit.primary.difference, 30);
  assert.deepEqual(benefit.primary.interval95, [30, 30]);
  assert.equal(getVerdict(benefit).status, 'SUPPORTED');
  assert.deepEqual(benefit, analyzeExperiment(def, days(30, def), config));
  const zero = analyzeExperiment(def, days(0, def), config);
  assert.equal(zero.primary.pValue, 1);
  assert.equal(getVerdict(zero).status, 'NO_DETECTABLE_EFFECT');
  assert.equal(getVerdict(analyzeExperiment(def, days(-30, def), config)).status, 'INCONCLUSIVE');
});

test('insufficient, unknown and low-adherence data are inconclusive', () => {
  assert.equal(getVerdict(analyzeExperiment(definition, days(30).slice(0, 10), config)).status, 'INCONCLUSIVE');
  const records = days(30);
  for (const day of records) day.exposure = { servings: null, lastCaffeineTime: null };
  assert.equal(getVerdict(analyzeExperiment(definition, records, config)).status, 'INCONCLUSIVE');
  for (const day of records) day.exposure = { servings: 2, lastCaffeineTime: day.assignedCondition === 'control' ? '10:00' : '15:00' };
  assert.equal(getVerdict(analyzeExperiment(definition, records, config)).status, 'INCONCLUSIVE');
});

test('interval ambiguity, configurable thresholds and secondary labels', () => {
  const result = analyzeExperiment(definition, days(30), config);
  const wide: AnalysisResult = { ...result, primary: { ...result.primary, interval95: [-5, 50] } };
  assert.equal(getVerdict(wide).status, 'INCONCLUSIVE');
  assert.equal(getVerdict(result, { minDaysPerCondition: 15 }).status, 'INCONCLUSIVE');
  assert.match(result.secondary.label, /Secondary per-protocol/);
  const records = days(30);
  records[0].exposure.lastCaffeineTime = records[0].assignedCondition === 'control' ? '10:00' : '15:00';
  const mixed = analyzeExperiment(definition, records, config);
  assert.equal(mixed.secondary.controlCount + mixed.secondary.interventionCount, 27);
  assert.equal(mixed.primary.controlCount + mixed.primary.interventionCount, 28);
});

test('alternating and fixed block designs return inconclusive with "design does not support inference"', () => {
  for (const design of [{ type: 'alternating' } as const, { type: 'blocks', blockLength: 4 } as const]) {
    const def = { ...definition, design };
    const records = generateSchedule(def.startDate, 28, design, def.seed).map((day, n) => ({
      ...days()[n],
      assignedCondition: day.condition,
      outcome: { sleepMinutes: day.condition === 'intervention' ? 480 : 420, hrvMs: null },
    }));
    const res = analyzeExperiment(def, records, config);
    assert.equal(res.primary.pValue, null);
    const verd = getVerdict(res);
    assert.equal(verd.status, 'INCONCLUSIVE');
    assert.ok(verd.reasons.includes('design does not support inference'));
  }
});

test('randomized blocks: determinism, balance, weekend stratification, and admissible counting', () => {
  const rbDef: ExperimentDefinition = {
    ...definition,
    design: { type: 'randomized-blocks', blockLength: 3, balanceWeekends: true },
  };
  const s1 = generateSchedule(rbDef.startDate, 28, rbDef.design, 42);
  const s2 = generateSchedule(rbDef.startDate, 28, rbDef.design, 42);
  assert.deepEqual(s1, s2);

  // Nominal 3-day blocks plus an equal-length residual pair preserve exact day balance.
  for (const block of partitionBlocks(rbDef.startDate, 28, 3)) {
    for (let j = block.startIndex; j < block.endIndex; j++) assert.equal(s1[j].condition, s1[block.startIndex].condition);
  }
  assert.equal(s1.filter(day => day.condition === 'intervention').length, 14);

  // Count admissible allocations
  const rbRecords = generateSchedule(rbDef.startDate, 28, rbDef.design, rbDef.seed).map(day => ({
    date: day.date,
    assignedCondition: day.condition,
    exposure: { servings: 2, lastCaffeineTime: day.condition === 'intervention' ? '12:00' : '15:00' },
    covariates: { alcohol: null, illness: false, travel: false, lateWorkout: null },
    outcome: { sleepMinutes: 420 + (day.condition === 'intervention' ? 25 : 0), hrvMs: null },
    exclusionReason: null,
  }));
  const res = analyzeExperiment(rbDef, rbRecords, config);
  assert.ok(typeof res.primary.admissibleAssignmentsCount === 'number');
  assert.ok(res.primary.admissibleAssignmentsCount > 0);
  assert.ok(res.primary.pValue !== null);

  // Short design with few admissible permutations warns and returns INCONCLUSIVE when cannot reach alpha
  const shortDef: ExperimentDefinition = {
    ...definition,
    lengthDays: 6,
    seed: 1,
    design: { type: 'randomized-blocks', blockLength: 3, balanceWeekends: true },
  };
  const shortRecords = generateSchedule(shortDef.startDate, 6, shortDef.design, 1).map(day => ({
    ...days()[0],
    date: day.date,
    assignedCondition: day.condition,
    outcome: { sleepMinutes: day.condition === 'intervention' ? 450 : 420, hrvMs: null },
  }));
  const shortRes = analyzeExperiment(shortDef, shortRecords, config);
  assert.ok(shortRes.primary.permutationWarning !== undefined);
  assert.ok(shortRes.primary.admissibleAssignmentsCount! < 100);
  const shortVerd = getVerdict(shortRes);
  assert.equal(shortVerd.status, 'INCONCLUSIVE');
  assert.ok(shortVerd.reasons.some(r => r.includes('too few admissible allocations')));
});

test('baseline run-in eligibility: checks 50% late caffeine rule, unknown handling, mean and SD', () => {
  const mockRunIn: DayRecord[] = [
    { date: '2026-01-01', assignedCondition: 'control', exposure: { servings: 2, lastCaffeineTime: '14:00' }, covariates: { alcohol: null, illness: null, travel: null, lateWorkout: null }, outcome: { sleepMinutes: 400, hrvMs: null }, exclusionReason: null },
    { date: '2026-01-02', assignedCondition: 'control', exposure: { servings: 1, lastCaffeineTime: '13:30' }, covariates: { alcohol: null, illness: null, travel: null, lateWorkout: null }, outcome: { sleepMinutes: 420, hrvMs: null }, exclusionReason: null },
    { date: '2026-01-03', assignedCondition: 'control', exposure: { servings: 2, lastCaffeineTime: '11:00' }, covariates: { alcohol: null, illness: null, travel: null, lateWorkout: null }, outcome: { sleepMinutes: 450, hrvMs: null }, exclusionReason: null },
    { date: '2026-01-04', assignedCondition: 'control', exposure: { servings: 0, lastCaffeineTime: null }, covariates: { alcohol: null, illness: null, travel: null, lateWorkout: null }, outcome: { sleepMinutes: 410, hrvMs: null }, exclusionReason: null },
    { date: '2026-01-05', assignedCondition: 'control', exposure: { servings: 2, lastCaffeineTime: '15:00' }, covariates: { alcohol: null, illness: null, travel: null, lateWorkout: null }, outcome: { sleepMinutes: 390, hrvMs: null }, exclusionReason: null },
    { date: '2026-01-06', assignedCondition: 'control', exposure: { servings: 2, lastCaffeineTime: '12:00' }, covariates: { alcohol: null, illness: null, travel: null, lateWorkout: null }, outcome: { sleepMinutes: 430, hrvMs: null }, exclusionReason: null }, // exactly 12:00 is NOT late
    { date: '2026-01-07', assignedCondition: 'control', exposure: { servings: 2, lastCaffeineTime: '16:00' }, covariates: { alcohol: null, illness: null, travel: null, lateWorkout: null }, outcome: { sleepMinutes: 400, hrvMs: null }, exclusionReason: null },
  ];

  // 4 days late out of 7 (14:00, 13:30, 15:00, 16:00) = 4/7 = 57.1% >= 50% -> Eligible
  const el1 = checkCaffeineEligibility(mockRunIn);
  assert.equal(el1.eligible, true);
  assert.equal(el1.lateCaffeineDaysCount, 4);
  assert.ok(el1.baselineOutcomeMean !== null && el1.baselineOutcomeMean > 0);
  assert.ok(el1.baselineOutcomeSd !== null && el1.baselineOutcomeSd > 0);

  // If one of the late days is missing exposure data, it must NOT count as late
  const mockWithUnknown = [...mockRunIn];
  mockWithUnknown[0] = { ...mockWithUnknown[0], exposure: { servings: null, lastCaffeineTime: null } };
  // Now 3 late out of 7 = 42.9% < 50% -> Ineligible
  const el2 = checkCaffeineEligibility(mockWithUnknown);
  assert.equal(el2.eligible, false);
  assert.equal(el2.unknownExposureDaysCount, 1);
  assert.equal(el2.lateCaffeineDaysCount, 3);
});

test('adherence gates: 85% intervention adherence and 15% contamination max', () => {
  const records = days(30);
  // Introduce 20% control contamination (e.g. 3 of 14 control days)
  let ctrlCount = 0;
  for (const day of records) {
    if (day.assignedCondition === 'control' && ctrlCount < 3) {
      day.exposure.lastCaffeineTime = '11:00'; // contaminated
      ctrlCount++;
    }
  }
  const res = analyzeExperiment(definition, records, config);
  assert.ok(res.adherence.controlContamination! > 0.15);
  const verd = getVerdict(res);
  assert.equal(verd.status, 'INCONCLUSIVE');
  assert.ok(verd.reasons.some(r => r.includes('Control-day contamination')));
});

test('compliance-adjusted estimate (CACE/IV) and weak instrument refusal', () => {
  const records = days(30);
  const res = analyzeExperimentalComplier(definition, records, config);
  assert.equal(res.weakInstrument, false);
  assert.ok(res.difference !== null);
  assert.equal(res.adherenceDifference, 1.0);

  // Weak instrument test: both conditions adhere equally or adherence difference < 0.5
  for (let i = 0; i < records.length; i++) {
    // 60% adherence in intervention, 40% contamination in control -> diff = 0.2 < 0.5
    if (records[i].assignedCondition === 'intervention') {
      records[i].exposure.lastCaffeineTime = i % 10 < 6 ? '11:00' : '15:00';
    } else {
      records[i].exposure.lastCaffeineTime = i % 10 < 4 ? '11:00' : '15:00';
    }
  }
  const weakRes = analyzeExperimentalComplier(definition, records, config);
  assert.equal(weakRes.weakInstrument, true);
  assert.equal(weakRes.difference, null);
  assert.ok(weakRes.reason?.includes('weak instrument'));
});

test('size_uncertain flag is true when lower bound of 95% CI is below minMeaningfulEffect', () => {
  const def = { ...definition, lengthDays: 42 };
  const res = analyzeExperiment(def, days(30, def), config);
  // Artificially test size_uncertain logic in verdict
  const verd = getVerdict({
    ...res,
    primary: {
      ...res.primary,
      difference: 20,
      pValue: 0.01,
      interval95: [5, 35], // 5 > 0, but 5 < 15 (minMeaningfulEffect)
    },
  });
  assert.equal(verd.status, 'SUPPORTED');
  assert.equal(verd.size_uncertain, true);
  assert.equal(verd.sizeUncertain, true);
  assert.ok(verd.reasons.some(r => r.includes('below the minimum meaningful effect')));

  // Lower bound above 15 -> size_uncertain is false
  const verdCertain = getVerdict({
    ...res,
    primary: {
      ...res.primary,
      difference: 25,
      pValue: 0.01,
      interval95: [16, 34],
    },
  });
  assert.equal(verdCertain.status, 'SUPPORTED');
  assert.equal(verdCertain.size_uncertain, false);
});
