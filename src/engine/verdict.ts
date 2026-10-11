import { displayValues } from './feasibility';
import type { AnalysisResult, Verdict, VerdictConfig } from './types';

export const DEFAULT_VERDICT: VerdictConfig = {
  gatePolicy: 'A',
  minDaysPerCondition: 10,
  minInterventionAdherence: 0.85,
  maxControlContamination: 0.15,
  minMeaningfulEffect: 15,
  significanceLevel: 0.05,
};

export function formatResultStatement(
  status: 'SUPPORTED' | 'NO_DETECTABLE_EFFECT' | 'INCONCLUSIVE',
  difference: number | null,
  interval: [number, number] | null,
  metric: string,
  reducedAdherence: boolean,
  plannedPowerState: boolean | 'low' | 'unknown' | 'not-low' | null
): string {
  let rangeStr: string;
  if (interval) {
    if (status === 'NO_DETECTABLE_EFFECT' || status === 'INCONCLUSIVE') {
      rangeStr = `plausible range of ${interval[0].toFixed(1)} to ${interval[1].toFixed(1)} units (effects larger than ${interval[1].toFixed(1)} units are ruled out)`;
    } else {
      rangeStr = `plausible range of ${interval[0].toFixed(1)} to ${interval[1].toFixed(1)} units`;
    }
  } else {
    rangeStr = 'unestimated plausible range';
  }
  const diffStr = difference !== null ? `${difference.toFixed(1)} units` : 'unestimated';
  let statement = '';

  if (status === 'SUPPORTED') {
    statement = `The trial observed an assigned-day difference of ${diffStr} in mean ${metric} favoring intervention, with a ${rangeStr}.`;
  } else if (status === 'NO_DETECTABLE_EFFECT') {
    statement = `The trial observed no detectable effect; the assigned-day difference of ${diffStr} in mean ${metric} lies within the configured equivalence margin, with a ${rangeStr}.`;
  } else {
    statement = `The trial results are inconclusive; the assigned-day difference of ${diffStr} in mean ${metric} leaves whether there is a meaningful benefit uncertain, with a ${rangeStr}.`;
  }

  if (reducedAdherence) {
    statement += ' Reduced adherence was observed during the study, so actual treatment effects under full compliance may differ.';
  }

  // Determine low / unknown / not-low power state
  if (typeof plannedPowerState === 'boolean') {
    if (plannedPowerState) {
      if (status === 'SUPPORTED') {
        statement += ' Note: planned design power for this protocol was low, so this estimate is likely to be exaggerated.';
      } else {
        statement += ' Note: Planned design power for this protocol was low, increasing the risk of an unreliable or exaggerated estimate.';
      }
    }
  } else {
    const isLow = plannedPowerState === 'low';
    const isUnknown = plannedPowerState === 'unknown' || plannedPowerState === null;

    if (isLow) {
      if (status === 'SUPPORTED') {
        statement += ' Note: planned design power for this protocol was low, so this estimate is likely to be exaggerated.';
      } else {
        statement += ' Note: planned design power for this protocol was low, so a real effect could have gone undetected.';
      }
    } else if (isUnknown) {
      statement += ' Planned design power could not be assessed for this protocol.';
    }
  }

  return statement;
}

export function getVerdict(result: AnalysisResult, overrides: Partial<VerdictConfig> = {}): Verdict {
  const policy = overrides.gatePolicy ?? DEFAULT_VERDICT.gatePolicy;
  if (!['A', 'B', 'C'].includes(policy)) throw new Error('Unknown gate policy.');
  const policyDefaults = policy === 'C' ? { minInterventionAdherence: 0.75, maxControlContamination: 0.25 } : {};
  const config = { ...DEFAULT_VERDICT, ...policyDefaults, ...overrides };

  // Support backward-compatible minAdherence override if passed
  const minIntAdh = overrides.minInterventionAdherence ?? overrides.minAdherence ?? config.minInterventionAdherence;
  const maxCtrlContam = config.maxControlContamination ?? 0.15;

  for (const value of [minIntAdh, maxCtrlContam, config.significanceLevel]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Rate thresholds must be between 0 and 1.');
  }
  if (!Number.isInteger(config.minDaysPerCondition) || config.minDaysPerCondition < 1 || !Number.isFinite(config.minMeaningfulEffect) || config.minMeaningfulEffect <= 0) {
    throw new Error('Day minimum must be a positive integer and meaningful effect must be positive.');
  }
  const sizeUncertain = result.primary.interval95 !== null && result.primary.interval95[0] < config.minMeaningfulEffect;
  const a = result.adherence;
  // ruled_out: upper bound U of the 95% interval; effects larger than U minutes are ruled out
  const ruledOut = result.primary.interval95 === null ? null : result.primary.interval95[1];
  const metadata = {
    estimand: result.estimand, size_uncertain: sizeUncertain, sizeUncertain, gate_policy: policy,
    ...displayValues(result.primary.interval95, result.primary.inflation_risk, {
      planned_power_at_minimum_effect: result.feasibility?.plannedPowerAtMinimumEffect,
      estimate_reliability: result.feasibility?.estimate_reliability,
      ruled_out: ruledOut,
    }),
    effect_likely_understated: a.interventionAdherence === null || a.controlContamination === null ? null
      : a.interventionAdherence - a.controlContamination < 1 - 1e-10,
    intervention_adherence: a.interventionAdherence, control_contamination: a.controlContamination,
  };
  const reasons: string[] = [];

  // Check 1: Design support for inference
  if (result.design.type === 'alternating' || result.design.type === 'blocks') {
    const verdict: Verdict = {
      status: 'INCONCLUSIVE',
      reasons: ['design does not support inference'],
      statement: formatResultStatement('INCONCLUSIVE', result.primary.difference, result.primary.interval95, result.outcomeMetric, false, false),
      ...metadata,
    };
    return verdict;
  }

  // Check 2: Sample size
  const p = result.primary;
  if (result.days.length <= 28 || (p.admissibleAssignmentsExact !== undefined && BigInt(p.admissibleAssignmentsExact) < 100n)) {
    reasons.push('too short for inference');
  }
  const counts = result.analyzableDays;
  if (counts.control < config.minDaysPerCondition || counts.intervention < config.minDaysPerCondition) {
    reasons.push(
      `Need at least ${config.minDaysPerCondition} analyzable days per condition; have ${counts.control} control and ${counts.intervention} intervention with observed outcomes and known exposure.`
    );
  }

  // Check 3: Adherence and contamination gates
  if (policy !== 'B' && (a.interventionAdherence === null || a.interventionAdherence < minIntAdh)) {
    const val = a.interventionAdherence !== null ? `${Math.round(a.interventionAdherence * 100)}%` : 'unknown';
    reasons.push(`Intervention-day adherence is ${val}, below the required ${Math.round(minIntAdh * 100)}%.`);
  }

  if (policy !== 'B' && a.controlContamination === null) reasons.push('Control-day contamination is unknown.');
  else if (policy !== 'B' && a.controlContamination !== null && a.controlContamination > maxCtrlContam) {
    const val = Math.round(a.controlContamination * 100);
    reasons.push(`Control-day contamination is ${val}%, above the allowable maximum ${Math.round(maxCtrlContam * 100)}%.`);
  }

  // Check 4: Admissible permutation power limit
  if (p.minAchievablePValue !== undefined && p.minAchievablePValue > config.significanceLevel) {
    reasons.push(
      `Design has too few admissible allocations (${p.admissibleAssignmentsCount}) to reach significance level ${config.significanceLevel} (minimum achievable p-value is ${p.minAchievablePValue.toFixed(4)}).`
    );
  }

  // Check 5: Basic estimability
  if (p.difference === null || p.interval95 === null || p.pValue === null) {
    reasons.push('The effect, interval, or randomization test could not be estimated.');
  }

  const reducedAdh = metadata.effect_likely_understated === true;
  const powerVal = result.feasibility?.plannedPowerAtMinimumEffect;
  const powerState: 'low' | 'unknown' | 'not-low' =
    powerVal === null || powerVal === undefined
      ? 'unknown'
      : powerVal < 0.3
      ? 'low'
      : 'not-low';

  if (reasons.length > 0) {
    return {
      status: 'INCONCLUSIVE',
      reasons,
      statement: formatResultStatement('INCONCLUSIVE', p.difference, p.interval95, result.outcomeMetric, reducedAdh, powerState),
      ...metadata,
    };
  }

  const [low, high] = p.interval95!;
  const threshold = config.minMeaningfulEffect;

  // Interval spans zero and meaningful effect
  if (low <= 0 && high >= threshold) {
    return {
      status: 'INCONCLUSIVE',
      reasons: ['The interval includes both no improvement and a meaningful improvement.'],
      statement: formatResultStatement('INCONCLUSIVE', p.difference, p.interval95, result.outcomeMetric, reducedAdh, powerState),
      ...metadata,
    };
  }

  if (low <= -threshold && high >= 0) {
    return {
      status: 'INCONCLUSIVE',
      reasons: ['The interval includes both meaningful worsening and no effect.'],
      statement: formatResultStatement('INCONCLUSIVE', p.difference, p.interval95, result.outcomeMetric, reducedAdh, powerState),
      ...metadata,
    };
  }

  if (p.difference! >= threshold && p.pValue! <= config.significanceLevel && low > 0) {
    const resReasons = [
      `Assigned intervention days increased mean ${result.outcomeMetric} by ${p.difference!.toFixed(1)} units.`,
      'The estimate meets the meaningful-effect threshold, the interval excludes zero, and the randomized test meets the significance threshold.',
    ];
    if (sizeUncertain) {
      resReasons.push(`Note: The lower bound of the 95% interval (${low.toFixed(1)} units) is below the minimum meaningful effect (${threshold} units).`);
    }
    return {
      status: 'SUPPORTED',
      reasons: resReasons,
      statement: formatResultStatement('SUPPORTED', p.difference, p.interval95, result.outcomeMetric, reducedAdh, powerState),
      ...metadata,
    };
  }

  if (low > -threshold && high < threshold) {
    return {
      status: 'NO_DETECTABLE_EFFECT',
      reasons: ['The 95% interval lies inside the configured meaningful-effect bounds.'],
      statement: formatResultStatement('NO_DETECTABLE_EFFECT', p.difference, p.interval95, result.outcomeMetric, reducedAdh, powerState),
      ...metadata,
    };
  }

  return {
    status: 'INCONCLUSIVE',
    reasons: [
      ...(p.difference! < 0 ? ['The estimate points toward a lower outcome, not the configured positive benefit.'] : []),
      'Evidence does not meet the benefit criteria and does not rule out a meaningful effect.',
    ],
    statement: formatResultStatement('INCONCLUSIVE', p.difference, p.interval95, result.outcomeMetric, reducedAdh, powerState),
    ...metadata,
  };
}
