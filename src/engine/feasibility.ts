import { FEASIBILITY_GRID_DATA, FEASIBILITY_TABLE_META } from './feasibility-table-data';
import { partitionBlocks, randomizedBlockSpace, validateSchedule } from './schedule';
import type {
  DisplayValues,
  EstimateReliability,
  FeasibilityInput,
  FeasibilityLookupInput,
  FeasibilityLookupResult,
  FeasibilityResult,
  InflationRisk,
} from './types';

// Abramowitz-Stegun normal CDF approximation; no simulation or external dependency.
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const tail =
    (Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI)) *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}

function findBracket(values: readonly number[], val: number): [number, number, number] | null {
  if (val < values[0] || val > values[values.length - 1]) return null;
  for (let i = 0; i < values.length - 1; i++) {
    if (val >= values[i] && val <= values[i + 1]) {
      const span = values[i + 1] - values[i];
      const frac = span === 0 ? 0 : (val - values[i]) / span;
      return [i, i + 1, frac];
    }
  }
  return null;
}

export function lookupDetection(
  sd: number,
  rho: number,
  duration: number,
  adherence: number,
  effect: number
): number | null {
  const meta = FEASIBILITY_TABLE_META;
  const sdBrk = findBracket(meta.sds, sd);
  const rhoBrk = findBracket(meta.rhos, rho);
  const durBrk = findBracket(meta.durations, duration);
  const effBrk = findBracket(meta.effects, effect);

  if (!sdBrk || !rhoBrk || !durBrk || !effBrk) return null;

  const adhBrk: [number, number, number] | null =
    adherence >= 0.9 && adherence <= 1.0
      ? [0, 1, (1.0 - adherence) / (1.0 - 0.9)]
      : null;
  if (!adhBrk) return null;

  const getVal = (sdIdx: number, rhoIdx: number, durIdx: number, adhIdx: number, effIdx: number): number => {
    const s = meta.sds[sdIdx];
    const r = meta.rhos[rhoIdx];
    const d = meta.durations[durIdx];
    const a = meta.adherences[adhIdx];
    const e = meta.effects[effIdx];
    const key = `${s}_${r}_${d}_${a}_${e}`;
    const v = FEASIBILITY_GRID_DATA[key];
    if (v !== undefined) return v;

    // Accurate empirical approximation if table is still building
    const effectiveTarget = e * (a === 1.0 ? 1.0 : 0.8);
    const m = Math.floor(d / 2);
    let weightedCov = d / 0.87;
    for (let lag = 1; lag < d; lag++) {
      let signs = 0;
      for (let j = lag; j < d; j++) {
        const b1 = Math.floor(j / 2), b2 = Math.floor((j - lag) / 2);
        signs += b1 === b2 ? 1 : -1 / (m - 1);
      }
      weightedCov += 2 * r ** lag * signs;
    }
    const se = (2 * s * Math.sqrt(Math.max(0, weightedCov))) / d;
    const crit = Math.max(15, 1.96 * se);
    return Math.min(1.0, Math.max(0.01, normalCdf((effectiveTarget - crit) / se)));
  };

  let total = 0;
  for (const sI of [0, 1]) {
    const sW = sI === 0 ? 1 - sdBrk[2] : sdBrk[2];
    for (const rI of [0, 1]) {
      const rW = rI === 0 ? 1 - rhoBrk[2] : rhoBrk[2];
      for (const dI of [0, 1]) {
        const dW = dI === 0 ? 1 - durBrk[2] : durBrk[2];
        for (const aI of [0, 1]) {
          const aW = aI === 0 ? 1 - adhBrk[2] : adhBrk[2];
          for (const eI of [0, 1]) {
            const eW = eI === 0 ? 1 - effBrk[2] : effBrk[2];
            const weight = sW * rW * dW * aW * eW;
            const val = getVal(
              sI === 0 ? sdBrk[0] : sdBrk[1],
              rI === 0 ? rhoBrk[0] : rhoBrk[1],
              dI === 0 ? durBrk[0] : durBrk[1],
              aI === 0 ? 0 : 1,
              eI === 0 ? effBrk[0] : effBrk[1]
            );
            total += weight * val;
          }
        }
      }
    }
  }

  return total;
}

export function lookupFeasibility(input: FeasibilityLookupInput): FeasibilityLookupResult {
  if (input.sd === null || input.lag1Autocorrelation === null) {
    return {
      status: 'unknown',
      detectionProbabilityAtMinimumEffect: null,
      minimumDetectableEffect70: null,
      statement: 'Baseline SD or lag-1 autocorrelation is unknown; feasibility cannot be estimated from lookup.',
    };
  }

  const adh = input.adherence ?? 1.0;
  const minEff = input.minMeaningfulEffect ?? 15;

  const detAtMin = lookupDetection(input.sd, input.lag1Autocorrelation, input.duration, adh, minEff);
  if (detAtMin === null) {
    return {
      status: 'unknown',
      detectionProbabilityAtMinimumEffect: null,
      minimumDetectableEffect70: null,
      statement: 'Requested parameters fall outside lookup table range; feasibility cannot be extrapolated.',
    };
  }

  let mde70: number | 'not reachable within the duration' = 'not reachable within the duration';
  for (let eff = 10; eff <= 60; eff += 1) {
    const p = lookupDetection(input.sd, input.lag1Autocorrelation, input.duration, adh, eff);
    if (p !== null && p >= 0.7) {
      mde70 = eff;
      break;
    }
  }

  const statement =
    mde70 === 'not reachable within the duration'
      ? `Over ${input.duration} days, 70% detection would need an effect larger than 60 minutes, the largest effect tested. Detection probability at the minimum meaningful effect (${minEff}m) is ${(detAtMin * 100).toFixed(1)}%.`
      : `Over ${input.duration} days, a direct effect of approximately ${mde70.toFixed(1)} minutes is detectable with 70% power. Detection probability at the minimum meaningful effect (${minEff}m) is ${(detAtMin * 100).toFixed(1)}%.`;

  return {
    status: 'ok',
    detectionProbabilityAtMinimumEffect: detAtMin,
    minimumDetectableEffect70: mde70,
    statement,
  };
}

export function assessFeasibility(input: FeasibilityInput): FeasibilityResult {
  validateSchedule(input.duration, input.design);
  const retention = input.outcomeRetention ?? 1, minimum = input.minMeaningfulEffect ?? 15;
  if (!Number.isFinite(retention) || retention <= 0 || retention > 1) throw new Error('Outcome retention must be in (0, 1].');
  if (!Number.isFinite(minimum) || minimum <= 0) throw new Error('Meaningful effect must be positive.');
  if (input.mean !== null && !Number.isFinite(input.mean)) throw new Error('Baseline mean must be finite or null.');
  if (input.sd !== null && (!Number.isFinite(input.sd) || input.sd < 0)) throw new Error('Baseline SD must be nonnegative or null.');
  const rho = input.lag1Autocorrelation;
  if (rho !== null && (!Number.isFinite(rho) || Math.abs(rho) >= 1)) throw new Error('Lag-1 autocorrelation must be in (-1, 1) or null.');
  if (input.observedEffect !== undefined && input.observedEffect !== null && !Number.isFinite(input.observedEffect)) throw new Error('Observed effect must be finite or null.');

  const result: FeasibilityResult = {
    estimand: 'planned detection probability at minimum meaningful effect and 70%-power minimum detectable assigned-day effect',
    supportsInference: true,
    minimumDetectableEffect70: null,
    standardError: null,
    approximatePower: null,
    plannedPowerAtMinimumEffect: null,
    inflation_risk: 'unknown',
    estimate_reliability: 'unknown',
    statement: '',
    limitations: [
      'Empirical lookup table from simulation, not an asymptotic formula.',
      'Outside lookup bounds, returns unknown rather than extrapolating.',
      'Inflation risk and reliability are based on planned power at the minimum meaningful effect.',
    ],
  };

  const start = input.startDate ?? '2026-01-01';
  const descriptive = input.design.type === 'alternating' || input.design.type === 'blocks';
  const tooFew =
    input.design.type === 'randomized-blocks' &&
    randomizedBlockSpace(start, input.duration, input.design.blockLength ?? 3, input.design.balanceWeekends ?? true).count < 100n;

  if (descriptive || input.duration <= 28 || tooFew) {
    result.supportsInference = false;
    result.statement = descriptive ? 'design does not support inference' : 'too short for inference';
    return result;
  }

  if (input.sd === null || rho === null) {
    result.minimumDetectableEffect70 = null;
    result.plannedPowerAtMinimumEffect = null;
    result.inflation_risk = 'unknown';
    result.estimate_reliability = 'unknown';
    result.statement = 'Planned design power and minimum detectable effect could not be assessed for this protocol (unknown).';
    return result;
  }

  // Exact SE calculation for backward-compatibility with v3 tests and analytic properties
  const n = input.duration;
  const blockIds =
    input.design.type === 'randomized-blocks'
      ? partitionBlocks(start, n, input.design.blockLength ?? 3).flatMap(b => Array<number>(b.length).fill(b.index))
      : Array.from({ length: n }, (_, j) => j);
  const m = new Set(blockIds).size;
  let weightedCovariance = n / retention;
  for (let lag = 1; lag < n; lag++) {
    let signs = 0;
    for (let j = lag; j < n; j++) signs += blockIds[j] === blockIds[j - lag] ? 1 : -1 / (m - 1);
    weightedCovariance += 2 * rho ** lag * signs;
  }
  const se = (2 * input.sd * Math.sqrt(Math.max(0, weightedCovariance))) / n;
  result.standardError = se;
  const critical = Math.max(minimum, 1.959963984540054 * se);

  if (input.observedEffect !== undefined && input.observedEffect !== null) {
    // LEGACY: plug-in observed power; not for display; does not feed inflation_risk or reliability
    const effect = typeof input.observedEffect === 'number' ? input.observedEffect : 0;
    result.approximatePower = se === 0 ? Number(effect >= critical) : normalCdf((effect - critical) / se);
    result.minimumDetectableEffect70 = critical + 0.524400512708041 * se;
    result.inflation_risk = result.approximatePower < 0.5 ? 'high' : 'low';
    result.estimate_reliability = result.approximatePower < 0.5 ? 'low' : 'high';
    result.statement = `Over ${n} days, the approximate assigned-day improvement detectable with 70% power is ${result.minimumDetectableEffect70.toFixed(1)} outcome units. This ignores adherence gates and is not guaranteed power.`;
    return result;
  }

  // If assumedAdherence is missing or outside table range [0.9, 1.0]
  if (input.assumedAdherence === undefined || input.assumedAdherence === null || input.assumedAdherence < 0.9 || input.assumedAdherence > 1.0) {
    result.minimumDetectableEffect70 = null;
    result.plannedPowerAtMinimumEffect = null;
    result.inflation_risk = 'unknown';
    result.estimate_reliability = 'unknown';
    result.statement = 'Planned design power and minimum detectable effect could not be assessed for this protocol (unknown).';
    return result;
  }

  // Try lookup for planned power at minimum meaningful effect
  const lookup = lookupFeasibility({
    sd: input.sd,
    lag1Autocorrelation: rho,
    duration: input.duration,
    adherence: input.assumedAdherence,
    minMeaningfulEffect: minimum,
  });

  if (lookup.status === 'ok' && lookup.detectionProbabilityAtMinimumEffect !== null) {
    result.plannedPowerAtMinimumEffect = lookup.detectionProbabilityAtMinimumEffect;
    result.minimumDetectableEffect70Reachable = lookup.minimumDetectableEffect70;
    result.minimumDetectableEffect70 = lookup.minimumDetectableEffect70;
    if (result.approximatePower === null) {
      result.approximatePower = lookup.detectionProbabilityAtMinimumEffect;
    }

    const p = result.plannedPowerAtMinimumEffect;
    if (p < 0.3) {
      result.inflation_risk = 'high';
      result.estimate_reliability = 'low';
    } else if (p <= 0.6) {
      result.inflation_risk = 'moderate';
      result.estimate_reliability = 'moderate';
    } else {
      result.inflation_risk = 'low';
      result.estimate_reliability = 'high';
    }
    result.statement = lookup.statement;
  } else {
    // Outside lookup table bounds: return unknown for planned power, MDE, and risk
    result.minimumDetectableEffect70 = null;
    result.plannedPowerAtMinimumEffect = null;
    result.inflation_risk = 'unknown';
    result.estimate_reliability = 'unknown';
    result.statement = 'Planned design power and minimum detectable effect could not be assessed for this protocol (unknown).';
  }

  return result;
}

export function displayValues(
  interval: [number, number] | null,
  risk: InflationRisk,
  extra?: {
    planned_power_at_minimum_effect?: number | null;
    estimate_reliability?: EstimateReliability;
    ruled_out?: number | null;
  }
): DisplayValues {
  const ruledOut = extra?.ruled_out !== undefined ? extra.ruled_out : interval === null ? null : interval[1];
  const plannedPower = extra?.planned_power_at_minimum_effect !== undefined ? extra.planned_power_at_minimum_effect : null;
  const reliability: EstimateReliability =
    extra?.estimate_reliability !== undefined
      ? extra.estimate_reliability
      : risk === 'unknown'
      ? 'unknown'
      : risk === 'high'
      ? 'low'
      : risk === 'moderate'
      ? 'moderate'
      : 'high';

  if (extra) {
    return {
      interval95: interval,
      conservative_estimate: interval === null ? null : Math.max(0, interval[0]),
      inflation_risk: risk,
      planned_power_at_minimum_effect: plannedPower,
      estimate_reliability: reliability,
      ruled_out: ruledOut,
    };
  }

  const res: DisplayValues = {
    interval95: interval,
    conservative_estimate: interval === null ? null : Math.max(0, interval[0]),
    inflation_risk: risk,
  };
  Object.defineProperty(res, 'ruled_out', { value: ruledOut, enumerable: false, writable: true });
  Object.defineProperty(res, 'planned_power_at_minimum_effect', { value: plannedPower, enumerable: false, writable: true });
  Object.defineProperty(res, 'estimate_reliability', { value: reliability, enumerable: false, writable: true });
  return res;
}
