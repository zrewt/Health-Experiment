import type { DailyEntry } from './types';
import { runInMinValidDays, conditionRule } from './config';
import { toEngineRecord, getFeasibilityScreenState, entriesForPlan } from './adapter';
import { checkCaffeineEligibility } from '../engine';

export interface RunInDescriptiveStats {
  daysLogged: number;
  averageSleepMinutes: number | null;
  afternoonCaffeineDays: number;
  unknownCaffeineDays: number;
  validDays: number;
}

/** Uses the frozen engine for descriptive-only counts; does not expose eligibility. */
export function getRunInDescriptiveStats(entries: readonly DailyEntry[]): RunInDescriptiveStats {
  const records = entries.map(entry => toEngineRecord(entry, 'control'));
  const engineResult = checkCaffeineEligibility(records, {
    minRunInDays: runInMinValidDays,
    cutoffTime: conditionRule.cutoffTime,
  });
  const validDays = records.filter(record => record.outcome.sleepMinutes !== null).length;
  return {
    daysLogged: entries.length,
    averageSleepMinutes: engineResult.baselineOutcomeMean,
    afternoonCaffeineDays: engineResult.lateCaffeineDaysCount,
    unknownCaffeineDays: engineResult.unknownExposureDaysCount,
    validDays,
  };
}

export { getFeasibilityScreenState, entriesForPlan };
