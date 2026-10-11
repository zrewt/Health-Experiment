import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessFeasibility,
  formatResultStatement,
  lookupDetection,
  lookupFeasibility,
} from '../src/engine';

const baseDesign = {
  type: 'randomized-blocks' as const,
  blockLength: 2,
  balanceWeekends: true,
};

test('assessFeasibility returns unknown outside table bounds and for missing inputs', () => {
  // Valid in-range parameters: SD 45, rho 0.4, duration 56, adherence 1.0 -> High risk (<30%)
  const inRange = assessFeasibility({
    mean: 420,
    sd: 45,
    lag1Autocorrelation: 0.4,
    duration: 56,
    design: baseDesign,
    assumedAdherence: 1.0,
    minMeaningfulEffect: 15,
  });
  assert.equal(inRange.inflation_risk, 'high');
  assert.equal(inRange.estimate_reliability, 'low');
  assert.ok(inRange.plannedPowerAtMinimumEffect !== null);

  // In-range moderate: SD 25, rho 0.2, duration 84, adherence 1.0 -> 49% -> Moderate risk
  const inRangeMod = assessFeasibility({
    mean: 420,
    sd: 25,
    lag1Autocorrelation: 0.2,
    duration: 84,
    design: baseDesign,
    assumedAdherence: 1.0,
    minMeaningfulEffect: 15,
  });
  assert.equal(inRangeMod.inflation_risk, 'moderate');
  assert.equal(inRangeMod.estimate_reliability, 'moderate');
  assert.ok(inRangeMod.plannedPowerAtMinimumEffect !== null);

  // 1. SD 20 -> outside table range [25, 75] -> unknown
  const sd20 = assessFeasibility({
    mean: 420,
    sd: 20,
    lag1Autocorrelation: 0.4,
    duration: 56,
    design: baseDesign,
    assumedAdherence: 1.0,
  });
  assert.equal(sd20.inflation_risk, 'unknown');
  assert.equal(sd20.estimate_reliability, 'unknown');
  assert.equal(sd20.plannedPowerAtMinimumEffect, null);

  // 2. SD 90 -> outside table range [25, 75] -> unknown
  const sd90 = assessFeasibility({
    mean: 420,
    sd: 90,
    lag1Autocorrelation: 0.4,
    duration: 56,
    design: baseDesign,
    assumedAdherence: 1.0,
  });
  assert.equal(sd90.inflation_risk, 'unknown');
  assert.equal(sd90.estimate_reliability, 'unknown');
  assert.equal(sd90.plannedPowerAtMinimumEffect, null);

  // 3. duration 30 -> outside table range [42, 84] -> unknown
  const dur30 = assessFeasibility({
    mean: 420,
    sd: 45,
    lag1Autocorrelation: 0.4,
    duration: 30,
    design: baseDesign,
    assumedAdherence: 1.0,
  });
  assert.equal(dur30.inflation_risk, 'unknown');
  assert.equal(dur30.estimate_reliability, 'unknown');
  assert.equal(dur30.plannedPowerAtMinimumEffect, null);

  // 4. duration 100 -> outside table range [42, 84] -> unknown
  const dur100 = assessFeasibility({
    mean: 420,
    sd: 45,
    lag1Autocorrelation: 0.4,
    duration: 100,
    design: baseDesign,
    assumedAdherence: 1.0,
  });
  assert.equal(dur100.inflation_risk, 'unknown');
  assert.equal(dur100.estimate_reliability, 'unknown');
  assert.equal(dur100.plannedPowerAtMinimumEffect, null);

  // 5. missing autocorrelation -> null -> unknown
  const missingRho = assessFeasibility({
    mean: 420,
    sd: 45,
    lag1Autocorrelation: null,
    duration: 56,
    design: baseDesign,
    assumedAdherence: 1.0,
  });
  assert.equal(missingRho.inflation_risk, 'unknown');
  assert.equal(missingRho.estimate_reliability, 'unknown');
  assert.equal(missingRho.plannedPowerAtMinimumEffect, null);

  // 6. missing assumed adherence -> undefined -> unknown
  const missingAdh = assessFeasibility({
    mean: 420,
    sd: 45,
    lag1Autocorrelation: 0.4,
    duration: 56,
    design: baseDesign,
  });
  assert.equal(missingAdh.inflation_risk, 'unknown');
  assert.equal(missingAdh.estimate_reliability, 'unknown');
  assert.equal(missingAdh.plannedPowerAtMinimumEffect, null);

  // For all unknown cases, assert neither 'low' nor 'moderate' is returned
  for (const res of [sd20, sd90, dur30, dur100, missingRho, missingAdh]) {
    assert.equal(res.plannedPowerAtMinimumEffect, null);
    assert.notEqual(res.inflation_risk, 'low');
    assert.notEqual(res.inflation_risk, 'moderate');
    assert.notEqual(res.estimate_reliability, 'low');
    assert.notEqual(res.estimate_reliability, 'moderate');
  }
});

test('exact full-string equality tests for formatResultStatement matrix', () => {
  const diff = 18.5;
  const interval: [number, number] = [12.0, 25.0];
  const metric = 'sleepMinutes';

  // Base range strings
  const supportedRange = 'plausible range of 12.0 to 25.0 units';
  const nonSupportedRange = 'plausible range of 12.0 to 25.0 units (effects larger than 25.0 units are ruled out)';

  const redAdhSuffix = ' Reduced adherence was observed during the study, so actual treatment effects under full compliance may differ.';
  const lowSupSuffix = ' Note: planned design power for this protocol was low, so this estimate is likely to be exaggerated.';
  const lowNonSupSuffix = ' Note: planned design power for this protocol was low, so a real effect could have gone undetected.';
  const unkSuffix = ' Planned design power could not be assessed for this protocol.';

  // 1. SUPPORTED
  // (a) planned power low, reduced-adh false
  assert.equal(
    formatResultStatement('SUPPORTED', diff, interval, metric, false, 'low'),
    `The trial observed an assigned-day difference of 18.5 units in mean sleepMinutes favoring intervention, with a ${supportedRange}.${lowSupSuffix}`
  );
  // (b) planned power low, reduced-adh true
  assert.equal(
    formatResultStatement('SUPPORTED', diff, interval, metric, true, 'low'),
    `The trial observed an assigned-day difference of 18.5 units in mean sleepMinutes favoring intervention, with a ${supportedRange}.${redAdhSuffix}${lowSupSuffix}`
  );
  // (c) planned power not-low, reduced-adh false
  assert.equal(
    formatResultStatement('SUPPORTED', diff, interval, metric, false, 'not-low'),
    `The trial observed an assigned-day difference of 18.5 units in mean sleepMinutes favoring intervention, with a ${supportedRange}.`
  );
  // (d) planned power not-low, reduced-adh true
  assert.equal(
    formatResultStatement('SUPPORTED', diff, interval, metric, true, 'not-low'),
    `The trial observed an assigned-day difference of 18.5 units in mean sleepMinutes favoring intervention, with a ${supportedRange}.${redAdhSuffix}`
  );
  // (e) planned power unknown, reduced-adh false
  assert.equal(
    formatResultStatement('SUPPORTED', diff, interval, metric, false, 'unknown'),
    `The trial observed an assigned-day difference of 18.5 units in mean sleepMinutes favoring intervention, with a ${supportedRange}.${unkSuffix}`
  );
  // (f) planned power unknown, reduced-adh true
  assert.equal(
    formatResultStatement('SUPPORTED', diff, interval, metric, true, 'unknown'),
    `The trial observed an assigned-day difference of 18.5 units in mean sleepMinutes favoring intervention, with a ${supportedRange}.${redAdhSuffix}${unkSuffix}`
  );

  // 2. NO_DETECTABLE_EFFECT
  const nullDiff = 2.1;
  const nullInterval: [number, number] = [-3.0, 7.0];
  const nullRange = 'plausible range of -3.0 to 7.0 units (effects larger than 7.0 units are ruled out)';

  // (a) planned power low, reduced-adh false
  assert.equal(
    formatResultStatement('NO_DETECTABLE_EFFECT', nullDiff, nullInterval, metric, false, 'low'),
    `The trial observed no detectable effect; the assigned-day difference of 2.1 units in mean sleepMinutes lies within the configured equivalence margin, with a ${nullRange}.${lowNonSupSuffix}`
  );
  // (b) planned power low, reduced-adh true
  assert.equal(
    formatResultStatement('NO_DETECTABLE_EFFECT', nullDiff, nullInterval, metric, true, 'low'),
    `The trial observed no detectable effect; the assigned-day difference of 2.1 units in mean sleepMinutes lies within the configured equivalence margin, with a ${nullRange}.${redAdhSuffix}${lowNonSupSuffix}`
  );
  // (c) planned power not-low, reduced-adh false
  assert.equal(
    formatResultStatement('NO_DETECTABLE_EFFECT', nullDiff, nullInterval, metric, false, 'not-low'),
    `The trial observed no detectable effect; the assigned-day difference of 2.1 units in mean sleepMinutes lies within the configured equivalence margin, with a ${nullRange}.`
  );
  // (d) planned power not-low, reduced-adh true
  assert.equal(
    formatResultStatement('NO_DETECTABLE_EFFECT', nullDiff, nullInterval, metric, true, 'not-low'),
    `The trial observed no detectable effect; the assigned-day difference of 2.1 units in mean sleepMinutes lies within the configured equivalence margin, with a ${nullRange}.${redAdhSuffix}`
  );
  // (e) planned power unknown, reduced-adh false
  assert.equal(
    formatResultStatement('NO_DETECTABLE_EFFECT', nullDiff, nullInterval, metric, false, 'unknown'),
    `The trial observed no detectable effect; the assigned-day difference of 2.1 units in mean sleepMinutes lies within the configured equivalence margin, with a ${nullRange}.${unkSuffix}`
  );
  // (f) planned power unknown, reduced-adh true
  assert.equal(
    formatResultStatement('NO_DETECTABLE_EFFECT', nullDiff, nullInterval, metric, true, 'unknown'),
    `The trial observed no detectable effect; the assigned-day difference of 2.1 units in mean sleepMinutes lies within the configured equivalence margin, with a ${nullRange}.${redAdhSuffix}${unkSuffix}`
  );

  // 3. INCONCLUSIVE
  const incDiff = 8.0;
  const incInterval: [number, number] = [-2.0, 18.0];
  const incRange = 'plausible range of -2.0 to 18.0 units (effects larger than 18.0 units are ruled out)';

  // (a) planned power low, reduced-adh false
  assert.equal(
    formatResultStatement('INCONCLUSIVE', incDiff, incInterval, metric, false, 'low'),
    `The trial results are inconclusive; the assigned-day difference of 8.0 units in mean sleepMinutes leaves whether there is a meaningful benefit uncertain, with a ${incRange}.${lowNonSupSuffix}`
  );
  // (b) planned power low, reduced-adh true
  assert.equal(
    formatResultStatement('INCONCLUSIVE', incDiff, incInterval, metric, true, 'low'),
    `The trial results are inconclusive; the assigned-day difference of 8.0 units in mean sleepMinutes leaves whether there is a meaningful benefit uncertain, with a ${incRange}.${redAdhSuffix}${lowNonSupSuffix}`
  );
  // (c) planned power not-low, reduced-adh false
  assert.equal(
    formatResultStatement('INCONCLUSIVE', incDiff, incInterval, metric, false, 'not-low'),
    `The trial results are inconclusive; the assigned-day difference of 8.0 units in mean sleepMinutes leaves whether there is a meaningful benefit uncertain, with a ${incRange}.`
  );
  // (d) planned power not-low, reduced-adh true
  assert.equal(
    formatResultStatement('INCONCLUSIVE', incDiff, incInterval, metric, true, 'not-low'),
    `The trial results are inconclusive; the assigned-day difference of 8.0 units in mean sleepMinutes leaves whether there is a meaningful benefit uncertain, with a ${incRange}.${redAdhSuffix}`
  );
  // (e) planned power unknown, reduced-adh false
  assert.equal(
    formatResultStatement('INCONCLUSIVE', incDiff, incInterval, metric, false, 'unknown'),
    `The trial results are inconclusive; the assigned-day difference of 8.0 units in mean sleepMinutes leaves whether there is a meaningful benefit uncertain, with a ${incRange}.${unkSuffix}`
  );
  // (f) planned power unknown, reduced-adh true
  assert.equal(
    formatResultStatement('INCONCLUSIVE', incDiff, incInterval, metric, true, 'unknown'),
    `The trial results are inconclusive; the assigned-day difference of 8.0 units in mean sleepMinutes leaves whether there is a meaningful benefit uncertain, with a ${incRange}.${redAdhSuffix}${unkSuffix}`
  );
});

test('wording rules: forbidden terms, exaggerated restriction, ruled-out clause presence', () => {
  const verdicts = ['SUPPORTED', 'NO_DETECTABLE_EFFECT', 'INCONCLUSIVE'] as const;
  const powerStates = ['low', 'not-low', 'unknown'] as const;
  const adhFlags = [false, true] as const;
  const interval: [number, number] = [5.0, 20.0];

  const forbiddenTerms = [
    /\bcause\b/i,
    /\bcaused\b/i,
    /\bproves\b/i,
    /\bproven\b/i,
    /\bcertain\b/i,
    /\bcertainly\b/i,
    /\bconfident\b/i,
    /\bguarantee\b/i,
  ];

  for (const v of verdicts) {
    for (const p of powerStates) {
      for (const a of adhFlags) {
        const stmt = formatResultStatement(v, 10.0, interval, 'sleepMinutes', a, p);

        // Rule: no statement contains forbidden causal or certainty terms
        for (const term of forbiddenTerms) {
          assert.doesNotMatch(stmt, term, `Statement contains forbidden term ${term}: ${stmt}`);
        }

        // Rule: 'exaggerated' appears only in SUPPORTED + low
        if (v === 'SUPPORTED' && p === 'low') {
          assert.match(stmt, /exaggerated/);
        } else {
          assert.doesNotMatch(stmt, /exaggerated/, `'exaggerated' must not appear in ${v} with power ${p}`);
        }

        // Rule: ruled-out clause appears only in NO_DETECTABLE_EFFECT and INCONCLUSIVE with non-null interval
        if (v === 'NO_DETECTABLE_EFFECT' || v === 'INCONCLUSIVE') {
          assert.match(stmt, /\(effects larger than 20\.0 units are ruled out\)/);
        } else {
          assert.doesNotMatch(stmt, /effects larger than/);
        }
      }
    }
  }

  // Null interval statement test: no ruled-out clause
  const nullIntStmt = formatResultStatement('INCONCLUSIVE', 10.0, null, 'sleepMinutes', false, 'low');
  assert.match(nullIntStmt, /unestimated plausible range/);
  assert.doesNotMatch(nullIntStmt, /ruled out/);
});

test('assessFeasibility conformance for MDE: unknown outside bounds, unreachable string, and formatted ruled-out bounds', () => {
  // 1. SD 90, SD 20, duration 30, duration 100, missing autocorrelation, missing adherence
  // -> minimumDetectableEffect70 === null and statement contains no digits for an MDE
  const outOfRangeInputs = [
    { mean: 420, sd: 90, lag1Autocorrelation: 0.4, duration: 56, design: baseDesign, assumedAdherence: 1.0 },
    { mean: 420, sd: 20, lag1Autocorrelation: 0.4, duration: 56, design: baseDesign, assumedAdherence: 1.0 },
    { mean: 420, sd: 45, lag1Autocorrelation: 0.4, duration: 30, design: baseDesign, assumedAdherence: 1.0 },
    { mean: 420, sd: 45, lag1Autocorrelation: 0.4, duration: 100, design: baseDesign, assumedAdherence: 1.0 },
    { mean: 420, sd: 45, lag1Autocorrelation: null, duration: 56, design: baseDesign, assumedAdherence: 1.0 },
    { mean: 420, sd: 45, lag1Autocorrelation: 0.4, duration: 56, design: baseDesign }, // missing adherence
  ];

  for (const input of outOfRangeInputs) {
    const res = assessFeasibility(input);
    assert.equal(res.minimumDetectableEffect70, null);
    assert.doesNotMatch(res.statement, /\d+(\.\d+)?\s*(minutes|outcome units|m\b)/i);
    assert.match(res.statement, /could not be assessed for this protocol \(unknown\)/);
  }

  // 2. A design from the 37 unreachable designs (duration 42, SD 75, rho 0.6, adherence 0.9)
  // -> minimumDetectableEffect70 === 'not reachable within the duration' and no numeric MDE appears
  const unreachableRes = assessFeasibility({
    mean: 420,
    sd: 75,
    lag1Autocorrelation: 0.6,
    duration: 42,
    design: baseDesign,
    assumedAdherence: 0.9,
    minMeaningfulEffect: 15,
  });
  assert.equal(unreachableRes.minimumDetectableEffect70, 'not reachable within the duration');
  assert.doesNotMatch(unreachableRes.statement, /effect of approximately \d+(\.\d+)? minutes is detectable/i);
  assert.match(unreachableRes.statement, /70% detection would need an effect larger than 60 minutes, the largest effect tested/);

  // 3. ruled-out clause with U = 0, U negative, and U fractional (for example 12.5): assert the exact formatted string for NO_DETECTABLE_EFFECT
  // (a) U = 0 (e.g. interval [-10.0, 0.0], diff -4.0)
  const stmtU0 = formatResultStatement('NO_DETECTABLE_EFFECT', -4.0, [-10.0, 0.0], 'sleepMinutes', false, 'not-low');
  assert.equal(
    stmtU0,
    'The trial observed no detectable effect; the assigned-day difference of -4.0 units in mean sleepMinutes lies within the configured equivalence margin, with a plausible range of -10.0 to 0.0 units (effects larger than 0.0 units are ruled out).'
  );

  // (b) U negative (e.g. interval [-14.0, -2.5], diff -8.0)
  const stmtUNeg = formatResultStatement('NO_DETECTABLE_EFFECT', -8.0, [-14.0, -2.5], 'sleepMinutes', false, 'not-low');
  assert.equal(
    stmtUNeg,
    'The trial observed no detectable effect; the assigned-day difference of -8.0 units in mean sleepMinutes lies within the configured equivalence margin, with a plausible range of -14.0 to -2.5 units (effects larger than -2.5 units are ruled out).'
  );

  // (c) U fractional = 12.5 (e.g. interval [-5.0, 12.5], diff 3.2)
  const stmtUFrac = formatResultStatement('NO_DETECTABLE_EFFECT', 3.2, [-5.0, 12.5], 'sleepMinutes', false, 'not-low');
  assert.equal(
    stmtUFrac,
    'The trial observed no detectable effect; the assigned-day difference of 3.2 units in mean sleepMinutes lies within the configured equivalence margin, with a plausible range of -5.0 to 12.5 units (effects larger than 12.5 units are ruled out).'
  );
});

