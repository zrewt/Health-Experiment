import type { DailyEntry } from './types';
import { runInMinValidDays, conditionRule } from './config';
import { toEngineRecord, toScreenEngineRecord, getFeasibilityScreenState, entriesForPlan } from './adapter';
import { checkCaffeineEligibility, checkScreenEligibility } from '../engine';
import type { ExposureKind } from './experiments';

export interface RunInDescriptiveStats {
  daysLogged: number;
  averageSleepMinutes: number | null;
  /** Nights with the exposure after the user's own cutoff, read by the active test's rule. */
  afterCutoffDays: number;
  /** Nights with no exposure logged; never counted as before or after the cutoff. */
  unknownExposureDays: number;
  validDays: number;
  /** @deprecated Caffeine-only names kept for existing callers; use afterCutoffDays. */
  afternoonCaffeineDays: number;
  /** @deprecated Caffeine-only names kept for existing callers; use unknownExposureDays. */
  unknownCaffeineDays: number;
}

/**
 * Uses the frozen engine for descriptive-only counts; does not expose eligibility.
 *
 * The cutoff is the user's saved one and the rule is the active test's, so a screens
 * account never reads caffeine counts and "after cutoff" means the time they picked.
 */
export function getRunInDescriptiveStats(
  entries: readonly DailyEntry[],
  cutoffTime: string = conditionRule.cutoffTime,
  exposure: ExposureKind = 'caffeine',
): RunInDescriptiveStats {
  const summarize = (
    validDays: number,
    baselineMean: number | null,
    afterCutoffDays: number,
    unknownExposureDays: number,
  ): RunInDescriptiveStats => ({
    daysLogged: entries.length,
    averageSleepMinutes: baselineMean,
    afterCutoffDays,
    unknownExposureDays,
    validDays,
    afternoonCaffeineDays: afterCutoffDays,
    unknownCaffeineDays: unknownExposureDays,
  });

  if (exposure === 'screens') {
    const records = entries.map(entry => toScreenEngineRecord(entry, 'control'));
    const result = checkScreenEligibility(records, { minRunInDays: runInMinValidDays, cutoffTime });
    const validDays = records.filter(record => record.outcome.sleepMinutes !== null).length;
    return summarize(validDays, result.baselineOutcomeMean, result.lateCaffeineDaysCount, result.unknownExposureDaysCount);
  }

  const records = entries.map(entry => toEngineRecord(entry, 'control'));
  const result = checkCaffeineEligibility(records, { minRunInDays: runInMinValidDays, cutoffTime });
  const validDays = records.filter(record => record.outcome.sleepMinutes !== null).length;
  return summarize(validDays, result.baselineOutcomeMean, result.lateCaffeineDaysCount, result.unknownExposureDaysCount);
}

export { getFeasibilityScreenState, entriesForPlan };
