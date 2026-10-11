import type { DailyEntry } from './types';
import { toEngineRecord } from './adapter';
import { runInMinValidDays, conditionRule } from './config';
import { checkCaffeineEligibility } from '../engine';

export interface RunInDescriptiveStats {
  daysLogged: number;
  averageSleepMinutes: number | null;
  afternoonCaffeineDays: number;
  unknownCaffeineDays: number;
  validDays: number;
}

/**
 * Pure helper for Screen 2's descriptive panel.
 * Uses ONLY the frozen engine's checkCaffeineEligibility computation.
 * Performs NO new statistical estimations or threshold checks.
 */
export function getRunInDescriptiveStats(entries: readonly DailyEntry[]): RunInDescriptiveStats {
  const records = entries.map(e => toEngineRecord(e, 'control'));
  const engineResult = checkCaffeineEligibility(records, {
    minRunInDays: runInMinValidDays,
    cutoffTime: conditionRule.cutoffTime,
  });

  const validDays = records.filter(r => r.outcome.sleepMinutes !== null).length;
  const daysLogged = entries.length;

  return {
    daysLogged,
    averageSleepMinutes: engineResult.baselineOutcomeMean,
    afternoonCaffeineDays: engineResult.lateCaffeineDaysCount,
    unknownCaffeineDays: engineResult.unknownExposureDaysCount,
    validDays,
  };
}
