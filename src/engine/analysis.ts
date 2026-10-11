import { adherenceStatus, applyExclusions, scoreAdherence } from './adherence';
import { assignmentSampler, generateSchedule, parseDate, randomizedBlockSpace, seededRandom } from './schedule';
import { assessFeasibility, displayValues } from './feasibility';
import { formatResultStatement } from './verdict';
import type { AnalysisConfig, AnalysisResult, Condition, DayRecord, Estimate, ExperimentDefinition } from './types';

export const DEFAULT_ANALYSIS: AnalysisConfig = {
  permutations: 999, bootstrapSamples: 999, bootstrapBlockLength: 3,
  bootstrapMethod: 'studentized', seed: 12345, exclusions: { illness: true, travel: true },
};
type Point = { value: number | null; condition: Condition; exposed: boolean | null };

function estimate(points: Point[], estimand: string): Estimate {
  let c = 0, i = 0, cs = 0, is = 0;
  for (const p of points) {
    if (p.value === null) continue;
    if (p.condition === 'control') { c++; cs += p.value; }
    else { i++; is += p.value; }
  }
  return {
    estimand, controlCount: c, interventionCount: i,
    controlMean: c ? cs / c : null, interventionMean: i ? is / i : null,
    difference: c && i ? is / i - cs / c : null,
    ...displayValues(null, 'unknown'), bootstrapValidSamples: 0,
  };
}
function quantile(sorted: number[], p: number): number {
  const x = (sorted.length - 1) * p, lo = Math.floor(x), hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}
function standardError(points: Point[], est: Estimate, length: number): number {
  if (est.difference === null || est.controlCount < 2 || est.interventionCount < 2) return 0;
  const influence = points.map(p => p.value === null ? 0 : p.condition === 'intervention'
    ? (p.value - est.interventionMean!) / est.interventionCount
    : -(p.value - est.controlMean!) / est.controlCount);
  let variance = 0;
  for (let j = 0; j < influence.length; j++) variance += influence[j] ** 2;
  for (let lag = 1; lag < length; lag++) {
    let covariance = 0;
    for (let j = lag; j < influence.length; j++) covariance += influence[j] * influence[j - lag];
    variance += 2 * (1 - lag / length) * covariance;
  }
  return Math.sqrt(Math.max(0, variance * points.length / (points.length - 2)));
}
function movingSample(points: Point[], length: number, random: () => number): Point[] {
  const sample: Point[] = [];
  while (sample.length < points.length) {
    const start = Math.floor(random() * points.length);
    for (let j = 0; j < length && sample.length < points.length; j++) sample.push(points[(start + j) % points.length]);
  }
  return sample;
}
function bootstrap(points: Point[], config: AnalysisConfig, seed: number, estimand: string): Estimate {
  const est = estimate(points, estimand);
  const method = config.bootstrapMethod ?? 'percentile';
  est.intervalMethod = `${method} circular moving-block bootstrap (length ${config.bootstrapBlockLength})`;
  if (est.difference === null) return est;
  const se = standardError(points, est, config.bootstrapBlockLength);
  const random = seededRandom(seed);
  const statistics: number[] = [];
  const differences: number[] = [];
  for (let b = 0; b < config.bootstrapSamples; b++) {
    const sample = movingSample(points, config.bootstrapBlockLength, random);
    const boot = estimate(sample, estimand);
    if (boot.difference === null) continue;
    differences.push(boot.difference);
    if (method === 'studentized' && se > 0) {
      const bootSe = standardError(sample, boot, config.bootstrapBlockLength);
      if (bootSe > 0) statistics.push((boot.difference - est.difference) / bootSe);
    }
  }
  const minValid = Math.ceil(config.bootstrapSamples * 0.9);
  const degenerate = differences.length >= minValid && differences.every(d => Math.abs(d - est.difference!) < 1e-9);
  const valid = method === 'studentized' && !degenerate ? statistics : differences;
  est.bootstrapValidSamples = valid.length;
  if (degenerate) est.interval95 = [est.difference, est.difference];
  else if (valid.length >= minValid) {
    valid.sort((a, b) => a - b);
    est.interval95 = method === 'studentized'
      ? [est.difference - quantile(valid, 0.975) * se, est.difference - quantile(valid, 0.025) * se]
      : [quantile(valid, 0.025), quantile(valid, 0.975)];
  }
  return est;
}
function emptyDay(date: string, assignedCondition: Condition): DayRecord {
  return {
    date, assignedCondition, exposure: { lastCaffeineTime: null, servings: null },
    covariates: { alcohol: null, illness: null, travel: null, lateWorkout: null },
    outcome: { sleepMinutes: null, hrvMs: null }, exclusionReason: null,
  };
}
export function prepareDays(definition: ExperimentDefinition, records: DayRecord<any>[]): DayRecord<any>[] {
  const schedule = generateSchedule(definition.startDate, definition.lengthDays, definition.design, definition.seed);
  const byDate = new Map<string, DayRecord<any>>(), dates = new Set(schedule.map(d => d.date));
  for (const record of records) {
    parseDate(record.date);
    if (!dates.has(record.date) || byDate.has(record.date)) throw new Error('Duplicate or out-of-experiment date.');
    for (const [metric, value] of Object.entries(record.outcome)) {
      if (value !== null && value !== undefined && (!Number.isFinite(value) || (['sleepMinutes', 'hrvMs'].includes(metric) && value < 0))) {
        throw new Error('Outcome must be finite or missing; sleep/HRV must be nonnegative.');
      }
    }
    for (const flag of Object.values(record.covariates)) {
      if (flag !== null && flag !== undefined && typeof flag !== 'boolean') throw new Error('Covariates must be boolean or null.');
    }
    if (record.exclusionReason !== null && (typeof record.exclusionReason !== 'string' || !record.exclusionReason.trim())) throw new Error('Exclusion reason must be nonempty or null.');
    adherenceStatus(record, definition.conditionRule);
    byDate.set(record.date, record);
  }
  return schedule.map(day => {
    const record = byDate.get(day.date);
    if (!record) return emptyDay(day.date, day.condition);
    if (record.assignedCondition !== day.condition) throw new Error('Assigned condition conflicts with seeded schedule.');
    return { ...record, exposure: { ...record.exposure }, covariates: { ...record.covariates }, outcome: { ...record.outcome } };
  });
}
export function analyzeExperiment(definition: ExperimentDefinition, records: DayRecord<any>[], overrides: Partial<AnalysisConfig> = {}): AnalysisResult {
  const config = { ...DEFAULT_ANALYSIS, ...overrides, exclusions: { ...DEFAULT_ANALYSIS.exclusions, ...overrides.exclusions } };
  for (const [label, count] of Object.entries({ permutations: config.permutations, bootstrapSamples: config.bootstrapSamples, bootstrapBlockLength: config.bootstrapBlockLength })) {
    if (!Number.isInteger(count) || count < 1) throw new Error(`${label} must be a positive integer.`);
  }
  if (config.bootstrapBlockLength > definition.lengthDays) throw new Error('Bootstrap block length exceeds experiment duration.');
  if (!['percentile', 'studentized'].includes(config.bootstrapMethod!)) throw new Error('Unknown bootstrap method.');
  const days = applyExclusions(prepareDays(definition, records), config.exclusions);
  const metric = definition.outcomeMetric;
  const points: Point[] = days.map(day => {
    const status = adherenceStatus(day, definition.conditionRule);
    return {
      value: day.exclusionReason !== null ? null : day.outcome[metric] ?? null,
      condition: day.assignedCondition,
      exposed: status === 'UNKNOWN' ? null : status === 'ADHERENT' || status === 'CONTAMINATED',
    };
  });
  const primaryEstimand = `difference in mean ${metric} between assigned intervention days and assigned control days (ITT; observed nonexcluded outcomes)`;
  const primary = bootstrap(points, config, config.seed, primaryEstimand);
  let pValue: number | null = null, method = 'Descriptive design only: design does not support inference';
  let admissibleAssignmentsCount: number | undefined, admissibleAssignmentsExact: string | undefined;
  let minAchievablePValue: number | undefined, permutationWarning: string | undefined;
  if (definition.design.type === 'randomized-blocks') {
    const space = randomizedBlockSpace(definition.startDate, days.length, definition.design.blockLength ?? 3, definition.design.balanceWeekends ?? true);
    admissibleAssignmentsCount = Number(space.count);
    admissibleAssignmentsExact = space.count.toString();
    minAchievablePValue = 2 / Number(space.count);
    if (space.count < 100n) permutationWarning = `Fewer than 100 admissible assignments (${space.count}); smallest achievable two-sided p-value ${minAchievablePValue.toFixed(4)}.`;
    const totals = space.blocks.map(b => {
      let sum = 0, n = 0;
      for (let j = b.startIndex; j < b.endIndex; j++) if (points[j].value !== null) { sum += points[j].value!; n++; }
      return { sum, n };
    });
    const statistic = (assignment: Condition[]) => {
      let cs = 0, is = 0, c = 0, i = 0;
      for (let j = 0; j < totals.length; j++) {
        if (assignment[j] === 'intervention') { is += totals[j].sum; i += totals[j].n; }
        else { cs += totals[j].sum; c += totals[j].n; }
      }
      return c && i ? is / i - cs / c : null;
    };
    const exact = space.count <= BigInt(config.permutations);
    method = `${exact ? 'Exact' : 'Monte Carlo plus-one'} two-sided block randomization; equal blocks/days; weekend balance=${definition.design.balanceWeekends ?? true}`;
    if (primary.difference !== null) {
      let extreme = 0;
      const evaluate = (assignment: Condition[]) => {
        const diff = statistic(assignment);
        if (diff === null || Math.abs(diff) >= Math.abs(primary.difference!) - 1e-10) extreme++;
      };
      if (exact) {
        for (const assignment of space.enumerate(config.permutations)) evaluate(assignment);
        pValue = extreme / Number(space.count);
      } else {
        const random = seededRandom((config.seed ^ 0x9e3779b9) >>> 0);
        for (let b = 0; b < config.permutations; b++) evaluate(space.sampleBlocks(random));
        pValue = (extreme + 1) / (config.permutations + 1);
      }
    }
  } else if (definition.design.type === 'randomized') {
    method = 'Two-sided Monte Carlo balanced run-cap randomization; plus-one correction';
    const sampleAssignment = assignmentSampler(days.length, definition.design, definition.startDate);
    const random = seededRandom((config.seed ^ 0x9e3779b9) >>> 0);
    if (primary.difference !== null) {
      let extreme = 0;
      for (let b = 0; b < config.permutations; b++) {
        const assignment = sampleAssignment(random);
        const diff = estimate(points.map((p, n) => ({ ...p, condition: assignment[n] })), primaryEstimand).difference;
        if (diff === null || Math.abs(diff) >= Math.abs(primary.difference) - 1e-10) extreme++;
      }
      pValue = (extreme + 1) / (config.permutations + 1);
    }
  }
  const secondaryPoints = points.map((p, n) => {
    const status = adherenceStatus(days[n], definition.conditionRule);
    return { ...p, value: status === 'ADHERENT' || status === 'CONTROL_CLEAN' ? p.value : null };
  });
  const secondary = bootstrap(secondaryPoints, config, (config.seed ^ 0x85ebca6b) >>> 0,
    `secondary non-causal difference in mean ${metric} between adherent intervention days and uncontaminated control days`);
  const baseline = config.baseline ?? { mean: null, sd: null, lag1Autocorrelation: null };
  const planning = {
    ...baseline,
    duration: definition.lengthDays,
    startDate: definition.startDate,
    design: definition.design,
    assumedAdherence: config.assumedAdherence ?? 1.0,
  };
  const feasibility = assessFeasibility(planning);
  const ruledOut = primary.interval95 === null ? null : primary.interval95[1];
  const extra = {
    planned_power_at_minimum_effect: feasibility.plannedPowerAtMinimumEffect,
    estimate_reliability: feasibility.estimate_reliability,
    ruled_out: ruledOut,
  };

  Object.assign(primary, displayValues(primary.interval95, feasibility.inflation_risk, extra));
  Object.assign(secondary, displayValues(secondary.interval95, feasibility.inflation_risk, extra));
  const analyzableDays = { control: 0, intervention: 0 };
  for (const p of points) if (p.value !== null && p.exposed !== null) analyzableDays[p.condition]++;

  const adherence = scoreAdherence(days.filter(d => d.exclusionReason === null), definition.conditionRule);
  const reducedAdh = adherence.interventionAdherence !== null && adherence.controlContamination !== null
    ? adherence.interventionAdherence - adherence.controlContamination < 1 - 1e-10
    : false;
  const powerVal = feasibility.plannedPowerAtMinimumEffect;
  const powerState: 'low' | 'unknown' | 'not-low' =
    powerVal === null || powerVal === undefined
      ? 'unknown'
      : powerVal < 0.3
      ? 'low'
      : 'not-low';
  const statement = formatResultStatement(
    primary.difference !== null && primary.difference >= 15 && pValue !== null && pValue <= 0.05 && primary.interval95 !== null && primary.interval95[0] > 0
      ? 'SUPPORTED'
      : primary.interval95 !== null && primary.interval95[0] > -15 && primary.interval95[1] < 15
      ? 'NO_DETECTABLE_EFFECT'
      : 'INCONCLUSIVE',
    primary.difference,
    primary.interval95,
    metric,
    reducedAdh,
    powerState
  );

  return {
    estimand: primaryEstimand, outcomeMetric: metric, design: definition.design,
    feasibility, ...displayValues(primary.interval95, feasibility.inflation_risk, extra),
    primary: { ...primary, pValue, permutationMethod: method, admissibleAssignmentsCount, admissibleAssignmentsExact, minAchievablePValue, permutationWarning },
    secondary: { ...secondary, label: 'Secondary per-protocol analysis (non-causal; adherence is not randomized)' },
    adherence,
    analyzableDays, unknownExposureDays: points.filter(p => p.exposed === null).length,
    days, missingOutcomeDays: days.filter(d => d.outcome[metric] === null || d.outcome[metric] === undefined).length,
    excludedDays: days.filter(d => d.exclusionReason !== null).length,
    statement,
    limitations: [
      'Caffeine sleep outcome belongs to the night following the exposure day.',
      'ITT includes observed outcomes with unknown exposure; unknown exposure does not count toward the analyzable-day verdict gate.',
      'Adherence/contamination describe known, nonexcluded exposure days; unknown is not zero.',
      'Experimental complier estimation is opt-in and excluded from default analysis and verdicts.',
      'Inflation risk and estimate reliability are based on planned power at minimum meaningful effect from empirical lookup.',
      'Moving-block intervals assume short-range stationarity and are approximate with few nights.',
      'Alternating and fixed alternating-block designs are descriptive only.',
    ],
  };
}
