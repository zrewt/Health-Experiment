import * as realEngine from '../engine';
import * as config from './config';
import { engineCaffeineTime, engineCaffeineServings } from './caffeine-time';
import type {
  AdapterErrorCode, BaselineSummary, Condition, DailyEntry, DayRecord,
  EngineFacade, ExperimentPlan, FeasibilityLookup, FeasibilityScreenState, FeasibilityTier,
  FeasibilityViewModel, MdeDirectMinutes, ProgressSummary, ResultViewModel,
} from './types';

export class ExperimentAdapterError extends Error {
  constructor(readonly code: AdapterErrorCode, message: string) {
    super(message);
    this.name = 'ExperimentAdapterError';
  }
}

function snapshot<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => snapshot(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)])) as T;
  }
  return value;
}

export function toEngineRecord(
  entry: DailyEntry, assignedCondition: Condition, engine: EngineFacade = realEngine,
): DayRecord {
  engine.parseDate(entry.date);
  const sleepMinutes = entry.sleepMinutes ?? null;
  if (sleepMinutes !== null && (!Number.isFinite(sleepMinutes) || sleepMinutes < 0)) {
    throw new ExperimentAdapterError('INVALID_ENTRY', 'Sleep minutes must be nonnegative, finite, or null.');
  }
  // Read-side policy: a malformed stored time is unknown for the engine, never padded
  // and never treated as 'none' (explicit zero servings). Single-digit hours are rejected.
  const lastCaffeineTime = engineCaffeineTime(entry.lastCaffeineTime ?? null);
  const servings = engineCaffeineServings(entry.lastCaffeineTime ?? null);

  return {
    date: entry.date,
    assignedCondition,
    exposure: {
      lastCaffeineTime,
      servings,
    },
    covariates: { alcohol: null, illness: null, travel: null, lateWorkout: null },
    outcome: { sleepMinutes, hrvMs: null },
    exclusionReason: null,
  };
}

/**
 * The run-in baseline: eligibility, valid nights and the outcome SD the feasibility verdict
 * reads. Feed it the run-in window (entriesForRunIn), never a whole account history, or days
 * from an earlier test leak into the baseline.
 */
export function computeBaseline(
  entries: readonly DailyEntry[], engine: EngineFacade = realEngine,
): BaselineSummary {
  const records = entries.map(entry => toEngineRecord(entry, 'control', engine));
  const result = engine.checkCaffeineEligibility(records, {
    minRunInDays: config.runInMinValidDays, cutoffTime: config.conditionRule.cutoffTime,
  });
  const validDays = records.filter(record => record.outcome.sleepMinutes !== null).length;
  const reasons = [...result.reasons];
  if (validDays < config.runInMinValidDays) reasons.push(`need ${config.runInMinValidDays - validDays} more valid days`);
  return {
    validDays, targetDays: config.runInMinValidDays,
    sd: result.baselineOutcomeSd,
    eligible: result.eligible && validDays >= config.runInMinValidDays,
    reasons, engineReasons: [...result.reasons],
    lateCaffeineDays: result.lateCaffeineDaysCount,
    knownExposureDays: result.knownExposureDaysCount,
    unknownExposureDays: result.unknownExposureDaysCount,
  };
}

function tierFor(mde: MdeDirectMinutes): FeasibilityTier {
  if (mde === null) return 'cannot_assess';
  if (mde === 'larger_than_60' || mde > config.longShotMaxMinutes) return 'not_informative';
  return mde <= config.informativeMaxMinutes ? 'informative' : 'long_shot';
}

export function assessFeasibility(
  baseline: BaselineSummary, lookup: FeasibilityLookup = realEngine.lookupFeasibility,
): FeasibilityViewModel {
  const conservative = baseline.sd !== null && baseline.sd < config.sdLowerBound;
  const result: FeasibilityViewModel = {
    tier: 'cannot_assess', options: [], defaultDuration: null,
    canStart: false, requiresAcknowledgement: false,
    conservative, numberQualifier: conservative ? 'at least' : 'unqualified',
    sdUsed: null, reasons: [...baseline.reasons],
    mdeLabel: config.mdeLabel, adherenceAssumptionText: config.adherenceAssumptionText,
    autocorrelationAssumptionText: config.autocorrelationAssumptionText,
    conservativeAssumptionText: conservative ? config.conservativeAssumptionText : null,
    inputs: {
      baseline: snapshot(baseline), assumedAdherence: config.assumedAdherence,
      assumedContamination: config.assumedContamination,
      minimumMeaningfulEffectMinutes: config.minimumMeaningfulEffectMinutes,
      durations: [...config.durations], autocorrelations: [...config.autocorrelationGrid],
    },
  };
  if (baseline.sd === null || !baseline.eligible) return result;
  if (!Number.isFinite(baseline.sd) || baseline.sd < 0) {
    throw new ExperimentAdapterError('INVALID_FEASIBILITY', 'Baseline SD must be nonnegative, finite, or null.');
  }
  if (baseline.sd > config.sdUpperBound) {
    result.tier = 'not_informative';
    return result;
  }
  const sdUsed = conservative ? config.sdLowerBound : baseline.sd;
  result.sdUsed = sdUsed;
  result.options = config.durations.map(duration => {
    const rhoLookups = config.autocorrelationGrid.map(rho => {
      const input = {
        sd: sdUsed, lag1Autocorrelation: rho, duration,
        adherence: config.assumedAdherence,
        minMeaningfulEffect: config.minimumMeaningfulEffectMinutes,
      };
      return { input, output: snapshot(lookup({ ...input })) };
    });
    const powers = rhoLookups.map(row => row.output.detectionProbabilityAtMinimumEffect);
    const minPlannedPowerAcrossRho = powers.some(power => power === null)
      ? null : Math.min(...powers.map(power => power as number));
    const unassessable = rhoLookups.some(row => row.output.status === 'unknown' ||
      row.output.minimumDetectableEffect70 === null || row.output.detectionProbabilityAtMinimumEffect === null);
    const scenario = unassessable ? null : rhoLookups.reduce((selected, candidate) => {
      const rank = (mde: typeof selected.output.minimumDetectableEffect70) =>
        mde === 'not reachable within the duration' ? Infinity : mde as number;
      const a = rank(selected.output.minimumDetectableEffect70);
      const b = rank(candidate.output.minimumDetectableEffect70);
      if (b > a) return candidate;
      if (b < a) return selected;
      const selectedPower = selected.output.detectionProbabilityAtMinimumEffect!;
      const candidatePower = candidate.output.detectionProbabilityAtMinimumEffect!;
      if (candidatePower < selectedPower) return candidate;
      if (candidatePower > selectedPower) return selected;
      return candidate.input.lag1Autocorrelation! > selected.input.lag1Autocorrelation! ? candidate : selected;
    });
    const engineMde = scenario?.output.minimumDetectableEffect70 ?? null;
    const mdeDirectMinutes: MdeDirectMinutes = engineMde === 'not reachable within the duration'
      ? 'larger_than_60' : engineMde;
    return {
      duration,
      plannedPowerAtMinimumEffect: scenario?.output.detectionProbabilityAtMinimumEffect ?? null,
      mdeDirectMinutes,
      mdeAssignedDayEquivalent: typeof mdeDirectMinutes === 'number'
        ? mdeDirectMinutes * (config.assumedAdherence - config.assumedContamination) : null,
      scenarioRho: scenario?.input.lag1Autocorrelation ?? null,
      minPlannedPowerAcrossRho,
      statement: scenario?.output.statement ?? null,
      conservative, numberQualifier: result.numberQualifier,
      mdeLabel: config.mdeLabel, adherenceAssumptionText: config.adherenceAssumptionText,
      rhoLookups,
    };
  });
  const longest = result.options.find(option => option.duration === config.tierDuration)!;
  result.tier = tierFor(longest.mdeDirectMinutes);
  result.canStart = result.tier === 'informative' || result.tier === 'long_shot';
  result.requiresAcknowledgement = result.tier === 'long_shot';
  if (result.canStart) {
    const qualifying = result.options.filter(option => typeof option.mdeDirectMinutes === 'number' &&
      option.mdeDirectMinutes <= config.informativeMaxMinutes);
    result.defaultDuration = qualifying.length ? Math.min(...qualifying.map(option => option.duration)) : config.tierDuration;
  }
  return result;
}

export function startExperiment(
  baseline: BaselineSummary, feasibility: FeasibilityViewModel, chosenDuration: number,
  startDate: string, acknowledged: boolean, seed: number,
  engine: EngineFacade = realEngine,
  cutoffTime = config.conditionRule.cutoffTime,
): ExperimentPlan {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new ExperimentAdapterError('INVALID_SEED', 'An explicit uint32 seed is required.');
  }
  if (!feasibility.canStart || !['informative', 'long_shot'].includes(feasibility.tier)) {
    throw new ExperimentAdapterError('CANNOT_START', 'This feasibility tier cannot start an experiment.');
  }
  if ((feasibility.requiresAcknowledgement || feasibility.tier === 'long_shot') && acknowledged !== true) {
    throw new ExperimentAdapterError('ACKNOWLEDGEMENT_REQUIRED', 'A long-shot experiment requires acknowledgement.');
  }
  if (!config.durations.some(duration => duration === chosenDuration)) {
    throw new ExperimentAdapterError('INVALID_DURATION', 'Duration must be one of the configured durations.');
  }
  const selected = feasibility.options.find(option => option.duration === chosenDuration);
  const original = feasibility.inputs.baseline;
  const baselineMatches = baseline.sd === original.sd && baseline.eligible === original.eligible &&
    baseline.validDays === original.validDays && baseline.targetDays === original.targetDays &&
    baseline.reasons.length === original.reasons.length &&
    baseline.reasons.every((reason, index) => reason === original.reasons[index]);
  if (!baseline.eligible || baseline.sd === null || feasibility.sdUsed === null || !selected ||
      !baselineMatches || selected.plannedPowerAtMinimumEffect === null || selected.mdeDirectMinutes === null ||
      selected.scenarioRho === null) {
    throw new ExperimentAdapterError('INVALID_FEASIBILITY', 'A current, assessable baseline and duration option are required.');
  }
  const definition = {
    name: config.experimentName, startDate, lengthDays: chosenDuration,
    design: { ...config.experimentDesign }, seed, outcomeMetric: config.outcomeMetric,
    conditionRule: { ...config.conditionRule, cutoffTime },
  };
  const schedule = engine.generateSchedule(startDate, chosenDuration, definition.design, seed);
  const analysisSeed = ((seed * 1664525 + 1013904223) >>> 0);
  return {
    seed, analysisSeed, schedule: snapshot(schedule), chosenDuration, startDate,
    assumedAdherence: feasibility.inputs.assumedAdherence,
    assumedContamination: feasibility.inputs.assumedContamination,
    baselineStats: {
      sd: feasibility.sdUsed, assumedAutocorrelation: selected.scenarioRho,
      validDays: baseline.validDays,
    },
    definition, feasibilitySnapshot: snapshot(feasibility),
  };
}

function scheduledRecords(
  plan: ExperimentPlan, entries: readonly DailyEntry[], engine: EngineFacade,
): DayRecord[] {
  const byDate = new Map(plan.schedule.map(day => [day.date, day.condition]));
  const seen = new Set<string>();
  return entries.map(entry => {
    const condition = byDate.get(entry.date);
    if (!condition || seen.has(entry.date)) {
      throw new ExperimentAdapterError('INVALID_ENTRY', 'Duplicate or out-of-experiment entry date.');
    }
    seen.add(entry.date);
    return toEngineRecord(entry, condition, engine);
  });
}

function endDate(plan: ExperimentPlan, engine: EngineFacade): string {
  const last = plan.schedule[plan.schedule.length - 1];
  if (!last || plan.schedule.length !== plan.chosenDuration ||
      plan.definition.lengthDays !== plan.chosenDuration || plan.definition.seed !== plan.seed ||
      plan.definition.startDate !== plan.startDate ||
      plan.analysisSeed !== ((plan.seed * 1664525 + 1013904223) >>> 0)) {
    throw new ExperimentAdapterError('INVALID_PLAN', 'Plan schedule and definition must match.');
  }
  const expected = engine.generateSchedule(
    plan.startDate, plan.chosenDuration, plan.definition.design, plan.seed,
  );
  if (plan.schedule.some((day, index) => day.date !== expected[index].date ||
      day.condition !== expected[index].condition || day.blockIndex !== expected[index].blockIndex)) {
    throw new ExperimentAdapterError('INVALID_PLAN', 'Plan schedule must match the stored engine definition and seed.');
  }
  return last.date;
}

export function getFeasibilityScreenState(
  baseline: BaselineSummary,
  feasibility: FeasibilityViewModel,
  setup: { cutoffTime: string },
): FeasibilityScreenState {
  const actions: ['Keep logging for now', 'Not now'] = [
    'Keep logging for now', 'Not now',
  ];
  if (!baseline.eligible || feasibility.tier === 'cannot_assess') {
    const detailFacts = [
      `You logged caffeine after noon on ${baseline.lateCaffeineDays} of ${baseline.knownExposureDays + baseline.unknownExposureDays} days.`,
    ];
    if (baseline.unknownExposureDays > 0) {
      detailFacts.push(`${baseline.unknownExposureDays} days had no caffeine time logged, so they do not count. Log it every morning.`);
    }
    return {
      kind: !baseline.eligible ? 'ineligible' : 'cannot_assess',
      message: "We can't set up this test yet.",
      detailsHeading: 'Details', reasons: [...baseline.engineReasons],
      lateCaffeineDays: baseline.lateCaffeineDays,
      knownExposureDays: baseline.knownExposureDays,
      unknownExposureDays: baseline.unknownExposureDays,
      detailFacts, actions,
    };
  }
  if (feasibility.tier === 'not_informative') {
    const option = feasibility.options.find(item => item.duration === config.tierDuration);
    const mde = option?.mdeDirectMinutes ?? null;
    // The engine statement for this tier ships verbatim under Details; the plain
    // verdict and this one reason are what the screen leads with.
    const message = mde === 'larger_than_60' || (typeof mde === 'number' && mde > 60)
      ? 'Your nightly sleep varies too much for this test to show a real difference.'
      : typeof mde === 'number'
        ? 'Sleep changes would have to be large before this test could show them.'
        : 'We could not get reliable numbers from your sleep pattern.';
    return {
      kind: 'not_informative', message, detailsHeading: 'Details',
      reasons: [...baseline.engineReasons], duration: option?.duration ?? null,
      mde, actions,
    };
  }
  if (!feasibility.defaultDuration) {
    return {
      kind: 'cannot_assess', message: "We can't set up this test yet.",
      detailsHeading: 'Details', reasons: [...baseline.engineReasons],
      lateCaffeineDays: baseline.lateCaffeineDays,
      knownExposureDays: baseline.knownExposureDays,
      unknownExposureDays: baseline.unknownExposureDays,
      detailFacts: [], actions,
    };
  }
  return {
    kind: feasibility.tier, message: null,
    options: snapshot(feasibility.options),
    defaultDuration: feasibility.defaultDuration,
    requiresAcknowledgement: feasibility.tier === 'long_shot',
    cutoffTime: setup.cutoffTime,
    approximateLabel: 'Rough',
    simulationNote: 'These numbers come from computer simulations of your log, so they are rough — about six points either way.',
    conservativeNote: feasibility.conservative
      ? 'Your sleep is steadier than the range we tested, so read these as the low end.'
      : null,
    startInstruction: `Days come in pairs, picked at random: a cutoff day (no caffeine after ${setup.cutoffTime}) or a normal day. The app tells you which, one day at a time.`,
  };
}

export function entriesForPlan(
  plan: ExperimentPlan,
  entries: readonly DailyEntry[],
): DailyEntry[] {
  const scheduleDates = new Set(plan.schedule.map(d => d.date));
  return entries.filter(e => scheduleDates.has(e.date));
}

/**
 * The last scheduled day across every plan on the account, or null when there is none.
 *
 * Local YYYY-MM-DD dates compare in calendar order as strings, so the maximum is the end of
 * the last test the user ran. A plan with an empty schedule falls back to its start date,
 * the same way the screens derive a last exposure date.
 */
export function lastPlannedDate(plans: readonly ExperimentPlan[]): string | null {
  let last: string | null = null;
  for (const plan of plans) {
    const end = plan.schedule.length > 0 ? plan.schedule[plan.schedule.length - 1].date : plan.startDate;
    if (last === null || end > last) last = end;
  }
  return last;
}

/**
 * The entries a new cycle may use as its baseline ("getting to know your sleep").
 *
 * A day counts only if no earlier test can have shaped it: every day inside any plan's
 * window is excluded, because caffeine was cut on some of those mornings, and so is any day
 * after today. Days from a finished test never reach the baseline, the eligibility check or
 * the run-in counters. With no earlier plan every entry up to today counts, so a first cycle
 * is unchanged. Missing values stay missing; deciding what a valid day is happens in
 * validRunInDays or in the engine.
 */
export function entriesForRunIn(
  entries: readonly DailyEntry[], plans: readonly ExperimentPlan[], today: string,
): DailyEntry[] {
  const plannedDates = new Set<string>();
  for (const plan of plans) {
    for (const day of plan.schedule) plannedDates.add(day.date);
  }
  const cutoff = lastPlannedDate(plans);
  return entries.filter(entry =>
    (cutoff === null || entry.date > cutoff) &&
    !plannedDates.has(entry.date) &&
    entry.date <= today);
}

/** Nights logged inside the run-in window: the count Home, the run-in screen and the
 *  "is this test worth doing?" gate all show. */
export function validRunInDays(
  entries: readonly DailyEntry[], plans: readonly ExperimentPlan[], today: string,
): number {
  return entriesForRunIn(entries, plans, today).filter(entry => entry.sleepMinutes !== null).length;
}

export function evaluate(
  plan: ExperimentPlan, entries: readonly DailyEntry[], today: string,
  engine: EngineFacade = realEngine,
): ResultViewModel {
  if (engine.parseDate(today) < engine.parseDate(endDate(plan, engine))) {
    throw new ExperimentAdapterError('INTERIM_LOOK', 'Results are unavailable before the schedule end date.');
  }
  const records = scheduledRecords(plan, entries, engine);
  const analysis = engine.analyzeExperiment(snapshot(plan.definition), records, {
    ...config.selectedPolicyOverrides.analysis,
    seed: plan.analysisSeed,
    baseline: {
      mean: null, sd: plan.baselineStats.sd,
      lag1Autocorrelation: plan.baselineStats.assumedAutocorrelation,
    },
    assumedAdherence: plan.assumedAdherence,
  });
  const verdict = engine.getVerdict(analysis, {
    ...config.selectedPolicyOverrides.verdict,
    minMeaningfulEffect: plan.feasibilitySnapshot.inputs.minimumMeaningfulEffectMinutes,
  });
  if (verdict.statement === undefined) {
    throw new ExperimentAdapterError('MISSING_ENGINE_STATEMENT', 'The engine did not return a verdict statement.');
  }
  const selected = plan.feasibilitySnapshot.options.find(option => option.duration === plan.chosenDuration);
  return {
    verdictLabel: verdict.status, statement: verdict.statement, reasons: [...verdict.reasons],
    conservativeEstimate: verdict.conservative_estimate,
    interval: snapshot(verdict.interval95), ruledOut: verdict.ruled_out ?? null,
    daysAnalyzed: { ...analysis.analyzableDays }, daysExcluded: analysis.excludedDays,
    missingOutcomeDays: analysis.missingOutcomeDays, unknownExposureDays: analysis.unknownExposureDays,
    adherence: snapshot(analysis.adherence),
    reducedAdherence: verdict.effect_likely_understated,
    plannedPowerRecomputed: analysis.feasibility.plannedPowerAtMinimumEffect,
    plannedPowerSnapshot: selected?.plannedPowerAtMinimumEffect ?? null,
    limitations: analysis.limitations ? [...analysis.limitations] : [],
  };
}

export function progressSummary(
  plan: ExperimentPlan, entries: readonly DailyEntry[], today: string,
  engine: EngineFacade = realEngine,
): ProgressSummary {
  engine.parseDate(today);
  endDate(plan, engine);
  const records = scheduledRecords(plan, entries, engine);
  const byDate = new Map(records.map(record => [record.date, record]));
  const adherenceCounts: ProgressSummary['adherenceCounts'] = {
    ADHERENT: 0, NON_ADHERENT: 0, CONTAMINATED: 0, CONTROL_CLEAN: 0, UNKNOWN: 0,
  };
  let daysLogged = 0;
  for (const day of plan.schedule) {
    if (day.date > today) continue;
    const record = byDate.get(day.date) ?? toEngineRecord({
      date: day.date, sleepMinutes: null, lastCaffeineTime: null,
    }, day.condition, engine);
    if (record.outcome.sleepMinutes !== null || record.exposure.lastCaffeineTime !== null || record.exposure.servings === 0) daysLogged++;
    adherenceCounts[engine.adherenceStatus(record, plan.definition.conditionRule)]++;
  }
  return {
    daysLogged, daysRemaining: plan.schedule.filter(day => day.date > today).length,
    adherenceCounts,
  };
}
