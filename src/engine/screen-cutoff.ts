import type {
  AdherenceStatus, DayRecord, EligibilityConfig, EligibilityResult, ExposureRule,
} from './types';

/**
 * Screens-off cutoff: the same design as the caffeine cutoff, with last screen use as the
 * exposure. `lastScreenTime` is HH:mm, or 'none' for a screen-free evening, or null when the
 * user did not log it (unknown: never treated as screens-off or screens-on).
 *
 * Kept in its own file so the caffeine rule and its eligibility check stay exactly as frozen.
 */
export interface ScreenExposure {
  lastScreenTime: string | 'none' | null;
  [key: string]: unknown;
}

export const SCREEN_CUTOFF_RULE_TYPE = 'screen-cutoff';
export const DEFAULT_SCREEN_CUTOFF = '21:30';

function screenTimeMinutes(time: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Time must be local HH:mm.');
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export class ScreenCutoffRule implements ExposureRule<ScreenExposure> {
  readonly type = SCREEN_CUTOFF_RULE_TYPE;
  constructor(readonly cutoffTime: string = DEFAULT_SCREEN_CUTOFF) {}

  adherenceStatus(day: DayRecord<ScreenExposure>): AdherenceStatus {
    const cutoff = screenTimeMinutes(this.cutoffTime);
    const last = day.exposure.lastScreenTime ?? null;
    if (last === null) return 'UNKNOWN';
    // 'none' is an explicit screen-free evening, which always meets the cutoff.
    const screensOff = last === 'none' ? true : screenTimeMinutes(last) <= cutoff;
    if (day.assignedCondition === 'intervention') return screensOff ? 'ADHERENT' : 'NON_ADHERENT';
    // Behavioral proxy, not evidence of intent: an early screen-off evening could be normal.
    return screensOff ? 'CONTAMINATED' : 'CONTROL_CLEAN';
  }
}

/**
 * Baseline run-in eligibility for the screens-off cutoff test. Eligible only if at least a
 * configurable share (default 50%) of run-in nights had screen use after the cutoff, so the
 * test starts from a habit the user actually has. Unknown nights are counted as unknown.
 */
export function checkScreenEligibility(
  runInDays: DayRecord<ScreenExposure>[],
  config: EligibilityConfig = {},
): EligibilityResult {
  const minRunInDays = config.minRunInDays ?? 7;
  const minLateShare = config.minLateCaffeineShare ?? 0.5;
  const cutoffTime = config.cutoffTime ?? DEFAULT_SCREEN_CUTOFF;
  screenTimeMinutes(cutoffTime);
  if (!Number.isInteger(minRunInDays) || minRunInDays < 1) throw new Error('Minimum run-in days must be positive.');
  if (!Number.isFinite(minLateShare) || minLateShare < 0 || minLateShare > 1) throw new Error('Late share must be between 0 and 1.');
  const rule = new ScreenCutoffRule(cutoffTime);
  const seen = new Set<string>();

  const reasons: string[] = [];
  const n = runInDays.length;
  if (n < minRunInDays) reasons.push(`Run-in period has ${n} days; at least ${minRunInDays} days are required.`);

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
    const status = rule.adherenceStatus({ ...day, assignedCondition: 'control' });
    if (status === 'UNKNOWN') unknownCount++;
    else {
      knownCount++;
      if (status === 'CONTROL_CLEAN') lateCount++;
    }
  }

  const lateShare = n > 0 ? lateCount / n : null;

  let baselineMean: number | null = null;
  let baselineSd: number | null = null;
  if (validSleepMinutes.length > 0) {
    const sum = validSleepMinutes.reduce((a, b) => a + b, 0);
    baselineMean = sum / validSleepMinutes.length;
    if (validSleepMinutes.length > 1) {
      const variance = validSleepMinutes.reduce((a, b) => a + (b - baselineMean!) ** 2, 0) / (validSleepMinutes.length - 1);
      baselineSd = Math.sqrt(variance);
    }
  }

  if (n >= minRunInDays && (lateShare === null || lateShare < minLateShare)) {
    reasons.push(
      `Only ${(lateShare !== null ? (lateShare * 100).toFixed(1) : 0)}% of run-in nights had screens after ${cutoffTime} (${lateCount}/${n} nights). Eligibility requires at least ${(minLateShare * 100).toFixed(0)}%.`,
    );
  }
  if (unknownCount) reasons.push(`${unknownCount} run-in nights have no screen time logged; none count as screens after the cutoff.`);
  const eligible = n >= minRunInDays && lateShare !== null && lateShare >= minLateShare;
  if (eligible) reasons.push(`Eligible: ${(lateShare * 100).toFixed(1)}% of run-in nights had screens after the cutoff.`);

  return {
    estimand: 'share of all run-in nights with known screen use after cutoff, and baseline mean/sample SD of observed sleep minutes',
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
