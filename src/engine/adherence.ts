import type { DayRecord, ExposureRule, AdherenceStatus, AdherenceSummary, ExclusionConfig, EligibilityConfig, EligibilityResult, ConditionRuleConfig, CaffeineExposure } from './types';

export function timeMinutes(time: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Time must be local HH:mm.');
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export class CaffeineCutoffRule implements ExposureRule<CaffeineExposure> {
  readonly type = 'caffeine-cutoff';
  constructor(readonly cutoffTime: string = '12:00') {}

  adherenceStatus(day: DayRecord<CaffeineExposure>): AdherenceStatus {
    const cutoff = timeMinutes(this.cutoffTime);
    const { servings, lastCaffeineTime } = day.exposure;
    if (servings !== null && (!Number.isFinite(servings) || servings < 0)) {
      throw new Error('Servings must be nonnegative or null.');
    }
    if (servings === 0 && lastCaffeineTime !== null) {
      throw new Error('Zero servings conflicts with a last caffeine time.');
    }
    // A null last time only means no caffeine when an explicit zero servings was recorded.
    const restricted = servings === 0 ? true : lastCaffeineTime === null ? null : timeMinutes(lastCaffeineTime) <= cutoff;
    if (restricted === null) return 'UNKNOWN';
    if (day.assignedCondition === 'intervention') return restricted ? 'ADHERENT' : 'NON_ADHERENT';
    // Behavioral proxy, not evidence of intent: early/no caffeine could be normal behavior.
    return restricted ? 'CONTAMINATED' : 'CONTROL_CLEAN';
  }
}

export function resolveExposureRule(config: ConditionRuleConfig): ExposureRule<any> {
  if (typeof (config as any).adherenceStatus === 'function') {
    return config as ExposureRule<any>;
  }
  if (config.type === 'caffeine-cutoff') {
    const cutoff = (config as any).cutoffTime || '12:00';
    return new CaffeineCutoffRule(cutoff);
  }
  throw new Error(`Unknown condition rule type: ${config.type}`);
}

export function adherenceStatus(day: DayRecord<any>, ruleOrCutoff: ConditionRuleConfig | string = '12:00'): AdherenceStatus {
  if (typeof ruleOrCutoff === 'string') {
    return new CaffeineCutoffRule(ruleOrCutoff).adherenceStatus(day);
  }
  return resolveExposureRule(ruleOrCutoff).adherenceStatus(day);
}

export function scoreAdherence(days: DayRecord<any>[], ruleOrCutoff: ConditionRuleConfig | string = '12:00'): AdherenceSummary {
  const counts: Record<AdherenceStatus, number> = { ADHERENT: 0, NON_ADHERENT: 0, CONTAMINATED: 0, CONTROL_CLEAN: 0, UNKNOWN: 0 };
  for (const day of days) counts[adherenceStatus(day, ruleOrCutoff)]++;
  const known = days.length - counts.UNKNOWN;
  const interventionKnown = counts.ADHERENT + counts.NON_ADHERENT;
  const controlKnown = counts.CONTAMINATED + counts.CONTROL_CLEAN;
  // The assigned-day outcome difference shrinks roughly by intervention adherence
  // minus control contamination when exposure is the only causal mechanism.
  // Separate 85%/15% verdict gates protect that contrast; unknown is never compliant.
  return {
    estimand: 'exposure adherence on known intervention days and exposure contamination on known control days',
    counts,
    total: days.length,
    known,
    // overallAdherence is a descriptive summary over eligible known-exposure days only.
    // We never treat an unknown exposure day as compliant or non-compliant.
    overallAdherence: known ? (counts.ADHERENT + counts.CONTROL_CLEAN) / known : null,
    knownFraction: days.length ? known / days.length : null,
    interventionAdherence: interventionKnown ? counts.ADHERENT / interventionKnown : null,
    controlContamination: controlKnown ? counts.CONTAMINATED / controlKnown : null,
  };
}

export function applyExclusions(days: DayRecord<any>[], config: ExclusionConfig = { illness: true, travel: true }): DayRecord<any>[] {
  return days.map(day => {
    const reasons = new Set(day.exclusionReason ? day.exclusionReason.split('; ') : []);
    if (config.illness && day.covariates.illness === true) reasons.add('Illness');
    if (config.travel && day.covariates.travel === true) reasons.add('Travel');
    return { ...day, exclusionReason: reasons.size ? [...reasons].join('; ') : null };
  });
}

/**
 * Baseline run-in eligibility evaluation for the caffeine cutoff experiment.
 * A user is eligible only if at least a configurable share (default 50%) of run-in days
 * have last caffeine AFTER cutoff (e.g. 12:00).
 * Unknown exposure days are counted as unknown, NEVER as caffeine after noon.
 */
export function checkCaffeineEligibility(
  runInDays: DayRecord<CaffeineExposure>[],
  config: EligibilityConfig = {}
): EligibilityResult {
  const minRunInDays = config.minRunInDays ?? 7;
  const minLateShare = config.minLateCaffeineShare ?? 0.5;
  const cutoffTime = config.cutoffTime ?? '12:00';
  timeMinutes(cutoffTime);
  if (!Number.isInteger(minRunInDays) || minRunInDays < 1) throw new Error('Minimum run-in days must be positive.');
  if (!Number.isFinite(minLateShare) || minLateShare < 0 || minLateShare > 1) throw new Error('Late caffeine share must be between 0 and 1.');
  const seen = new Set<string>();

  const reasons: string[] = [];
  const n = runInDays.length;

  if (n < minRunInDays) {
    reasons.push(`Run-in period has ${n} days; at least ${minRunInDays} days are required.`);
  }

  let lateCount = 0;
  let knownCount = 0;
  let unknownCount = 0;

  const validSleepMinutes: number[] = [];

  for (const day of runInDays) {
    if (day.outcome.sleepMinutes !== null && Number.isFinite(day.outcome.sleepMinutes)) {
      validSleepMinutes.push(day.outcome.sleepMinutes);
    }

    if (seen.has(day.date)) throw new Error('Duplicate run-in date.');
    seen.add(day.date);
    const status = adherenceStatus({ ...day, assignedCondition: 'control' }, cutoffTime);
    if (status === 'UNKNOWN') unknownCount++;
    else {
      knownCount++;
      if (status === 'CONTROL_CLEAN') lateCount++;
    }
  }

  const lateShare = n > 0 ? lateCount / n : null;
  // Unknown days are never treated as late; they remain unknown.

  // Mean & SD of baseline outcome
  let baselineMean: number | null = null;
  let baselineSd: number | null = null;
  if (validSleepMinutes.length > 0) {
    const sum = validSleepMinutes.reduce((a, b) => a + b, 0);
    baselineMean = sum / validSleepMinutes.length;
    if (validSleepMinutes.length > 1) {
      const variance = validSleepMinutes.reduce((a, b) => a + (b - baselineMean!) ** 2, 0) / (validSleepMinutes.length - 1);
      baselineSd = Math.sqrt(variance);
    } // A single outcome cannot estimate an SD: keep it null, not zero.
  }

  if (n >= minRunInDays) {
    if (lateShare === null || lateShare < minLateShare) {
      reasons.push(
        `Only ${(lateShare !== null ? (lateShare * 100).toFixed(1) : 0)}% of run-in days had caffeine after ${cutoffTime} (${lateCount}/${n} days). Eligibility requires at least ${(minLateShare * 100).toFixed(0)}%.`
      );
    }
  }

  if (unknownCount) reasons.push(`${unknownCount} run-in exposure days are unknown; none count as afternoon caffeine.`);
  const eligible = n >= minRunInDays && lateShare !== null && lateShare >= minLateShare;

  if (eligible) {
    reasons.push(`Eligible: ${(lateShare * 100).toFixed(1)}% of run-in days had afternoon caffeine.`);
  }

  return {
    estimand: 'share of all run-in days with known caffeine after cutoff, and baseline mean/sample SD of observed sleep minutes',
    eligible,
    runInDaysCount: n,
    lateCaffeineDaysCount: lateCount,
    knownExposureDaysCount: knownCount,
    unknownExposureDaysCount: unknownCount,
    lateCaffeineShare: lateShare,
    baselineOutcomeMean: baselineMean,
    baselineOutcomeSd: baselineSd,
    reasons,
  };
}
