import type { DailyEntry } from './types';
import type { StoredExperimentPlan } from '../data/plan-persistence';
import type { ConsentRecord, ExperimentSetupRecord } from '../data/experiment-store';
import { isFeasibilityDue } from './start-attempt';

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
 * - plan_result_ready: plan status is 'completed' (a stored result snapshot exists)
 * - plan_scheduled: active plan exists, but today < plan.startDate
 * - plan_active: active plan exists, startDate <= today <= lastExposureDate
 * - plan_awaiting_final: today >= lastExposureDate + 1 day and plan not completed/cancelled
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

    if (plan.status === 'completed') {
      return 'plan_result_ready';
    }

    const { startDate, schedule } = plan.plan;
    const lastExposureDate = schedule.length > 0 ? schedule[schedule.length - 1].date : startDate;

    if (today < startDate) {
      return 'plan_scheduled';
    }

    if (today <= lastExposureDate) {
      return 'plan_active';
    }

    // today >= lastExposureDate + 1 and status is not completed/cancelled
    return 'plan_awaiting_final';
  }

  // No active/running plan
  const validDaysCount = entries.filter(e => e.sleepMinutes !== null).length;
  if (isFeasibilityDue(validDaysCount, setup.nextCheckDate ?? null, today)) {
    return 'feasibility_ready';
  }

  return 'run_in';
}
