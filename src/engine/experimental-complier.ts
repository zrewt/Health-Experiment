import { adherenceStatus } from './adherence';
import { analyzeExperiment } from './analysis';
import { displayValues } from './feasibility';
import { partitionBlocks, seededRandom } from './schedule';
import type { AnalysisConfig, AnalysisResult, ComplierEstimate, DayRecord, ExperimentDefinition } from './types';

/** EXPERIMENTAL, never part of the default result or verdict.
 * Assumes exclusion restriction (assignment acts only via exposure), monotonicity
 * (no systematic defiers), no carryover/interference, ignorable missingness.
 * Resample exposure/outcome jointly in whole assignment blocks. Nonpositive
 * replicate first stages are NOT trimmed; any unstable draws withhold the CI.
 */
export function analyzeExperimentalComplier(
  definition: ExperimentDefinition, records: DayRecord<any>[], overrides: Partial<AnalysisConfig> = {},
  preparedAnalysis?: AnalysisResult,
): ComplierEstimate {
  const analysis = preparedAnalysis ?? analyzeExperiment(definition, records, overrides);
  const points = analysis.days.map(day => {
    const status = adherenceStatus(day, definition.conditionRule);
    return { condition: day.assignedCondition, value: day.exclusionReason === null ? day.outcome[definition.outcomeMetric] ?? null : null,
      exposed: status === 'UNKNOWN' ? null : status === 'ADHERENT' || status === 'CONTAMINATED' };
  });
  type Point = typeof points[number];
  const difference = (sample: Point[], exposure = false) => {
    let c = 0, i = 0, cs = 0, is = 0;
    for (const p of sample) {
      if (p.value === null || (exposure && p.exposed === null)) continue;
      const value = exposure ? Number(p.exposed) : p.value;
      if (p.condition === 'control') { c++; cs += value; } else { i++; is += value; }
    }
    return c && i ? is / i - cs / c : null;
  };
  const delta = difference(points, true), diff = difference(points);
  const result: ComplierEstimate = {
    estimand: `experimental secondary Wald/IV effect of actual exposure on ${definition.outcomeMetric} among compliers under exclusion restriction and monotonicity`,
    controlCount: analysis.primary.controlCount, interventionCount: analysis.primary.interventionCount,
    controlMean: null, interventionMean: null, difference: null, bootstrapValidSamples: 0,
    ...displayValues(null, 'unknown'),
    label: 'EXPERIMENTAL compliance-adjusted estimate; not used for verdicts',
    adherenceDifference: delta, weakInstrument: delta === null || delta < 0.5,
    intervalMethod: 'joint whole-assignment-block percentile bootstrap',
  };
  if (delta === null || diff === null) { result.reason = 'Insufficient outcome or known exposure data.'; return result; }
  if (delta < 0.5) { result.reason = `Adherence difference ${delta.toFixed(3)} is below 0.5 (weak instrument).`; return result; }
  result.difference = diff / delta;
  const length = overrides.bootstrapBlockLength ?? 3, samples = overrides.bootstrapSamples ?? 999;
  const units = definition.design.type === 'randomized-blocks'
    ? partitionBlocks(definition.startDate, points.length, definition.design.blockLength ?? 3).map(b => points.slice(b.startIndex, b.endIndex))
    : Array.from({ length: Math.ceil(points.length / length) }, (_, j) => points.slice(j * length, (j + 1) * length));
  const strata = units.every(unit => unit.every(p => p.condition === unit[0].condition))
    ? [units.filter(u => u[0].condition === 'control'), units.filter(u => u[0].condition === 'intervention')] : [units];
  const random = seededRandom(((overrides.seed ?? 12345) ^ 0x3c6ef35f) >>> 0);
  const ratios: number[] = [];
  let unstable = 0;
  for (let b = 0; b < samples; b++) {
    const sample: Point[] = [];
    for (const stratum of strata) for (let j = 0; j < stratum.length; j++) sample.push(...stratum[Math.floor(random() * stratum.length)]);
    const d = difference(sample, true), numerator = difference(sample);
    if (d === null || numerator === null || d <= 0) { unstable++; continue; }
    ratios.push(numerator / d);
  }
  result.bootstrapValidSamples = ratios.length;
  if (unstable) result.reason = `${unstable} joint bootstrap replicates had unavailable or nonpositive first stages; ratio interval is unstable and withheld (no tail trimming).`;
  else {
    ratios.sort((a, b) => a - b);
    const q = (p: number) => {
      const x = (ratios.length - 1) * p, lo = Math.floor(x), hi = Math.ceil(x);
      return ratios[lo] + (ratios[hi] - ratios[lo]) * (x - lo);
    };
    Object.assign(result, displayValues([q(0.025), q(0.975)], 'unknown'));
  }
  return result;
}
