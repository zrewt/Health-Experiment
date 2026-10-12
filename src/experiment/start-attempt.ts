import { startExperiment } from './adapter';
import { addDaysToLocalDate } from './dates';
import { runInMinValidDays } from './config';
import type { BaselineSummary, ExperimentPlan, FeasibilityViewModel } from './types';

export interface StartAttemptInput {
  baseline: BaselineSummary;
  feasibility: FeasibilityViewModel;
  duration: number;
  today: string;
  acknowledged: boolean;
  cutoffTime: string;
}

/** The UI retains this plan before any asynchronous write and reuses it on retry. */
export function getStartAttempt(
  existing: ExperimentPlan | null, input: StartAttemptInput, random: () => number = Math.random,
): ExperimentPlan {
  if ((input.feasibility.requiresAcknowledgement || input.feasibility.tier === 'long_shot') && !input.acknowledged) {
    // Let the adapter enforce its typed acknowledgement error without drawing a seed.
    return startExperiment(input.baseline, input.feasibility, input.duration,
      addDaysToLocalDate(input.today, 1), false, 0);
  }
  if (existing) return existing;
  const seed = Math.floor(random() * 0x100000000);
  return startExperiment(input.baseline, input.feasibility, input.duration,
    addDaysToLocalDate(input.today, 1), input.acknowledged, seed, undefined, input.cutoffTime);
}

/** A saved re-check defers the initial 14-day gate until its local calendar date. */
export function isFeasibilityDue(validDays: number, nextCheckDate: string | null, today: string): boolean {
  return nextCheckDate !== null ? today >= nextCheckDate : validDays >= runInMinValidDays;
}
