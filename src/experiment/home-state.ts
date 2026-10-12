import type { DailyEntry } from './types';
import type { StoredExperimentPlan } from '../data/plan-persistence';
import type { ConsentRecord, ExperimentSetupRecord } from '../data/experiment-store';
import { isFeasibilityDue } from './start-attempt';
import { addDaysToLocalDate } from './dates';

export type HomeState =
  | 'needs_consent'
  | 'needs_setup'
  | 'run_in'
  | 'feasibility_ready'
  | 'plan_scheduled'
  | 'plan_active'
  | 'plan_awaiting_final'
  | 'plan_ended_early'
  | 'plan_result_ready';

export interface HomeStateInputs {
  consent: ConsentRecord | null;
  setup: ExperimentSetupRecord | null;
  entries: readonly DailyEntry[];
  plan: StoredExperimentPlan | null;
  today: string;
}

/**
 * Pure router function determining the user's home state.
 *
 * States:
 * - needs_consent: no consent or granted === false
 * - needs_setup: no setup record
 * - plan_ended_early: plan status is 'cancelled'
 * - plan_scheduled: active plan exists, but today < plan.startDate
 * - plan_active: active plan exists, startDate <= today <= lastExposureDate
 * - plan_awaiting_final: today === lastExposureDate + 1 day (final sleep outcome night to be logged)
 * - plan_result_ready: today > lastExposureDate + 1 day
 * - feasibility_ready: no active plan, run-in has >= 14 valid days OR nextCheckDate reached
 * - run_in: run-in in progress
 */
export function getHomeState(inputs: HomeStateInputs): HomeState {
  const { consent, setup, entries, plan, today } = inputs;

  if (!consent || !consent.granted) {
    return 'needs_consent';
  }

  if (!setup) {
    return 'needs_setup';
  }

  if (plan) {
    if (plan.status === 'cancelled') {
      return 'plan_ended_early';
    }

    const { startDate, schedule } = plan.plan;
    const lastExposureDate = schedule.length > 0 ? schedule[schedule.length - 1].date : startDate;

    if (today < startDate) {
      return 'plan_scheduled';
    }

    if (today <= lastExposureDate) {
      return 'plan_active';
    }

    const dayAfterLastExposure = addDaysToLocalDate(lastExposureDate, 1);
    if (today === dayAfterLastExposure) {
      const finalEntry = entries.find(e => e.date === lastExposureDate);
      const hasFinalSleep = finalEntry && finalEntry.sleepMinutes !== null;
      if (!hasFinalSleep) {
        return 'plan_awaiting_final';
      }
      return 'plan_result_ready';
    }

    if (today > dayAfterLastExposure) {
      return 'plan_result_ready';
    }
  }

  // No active/running plan
  const validDaysCount = entries.filter(e => e.sleepMinutes !== null).length;
  if (isFeasibilityDue(validDaysCount, setup.nextCheckDate ?? null, today)) {
    return 'feasibility_ready';
  }

  return 'run_in';
}
