import type { DailyEntry, ExperimentPlan } from './types';
import type { StoredExperimentPlan } from '../data/plan-persistence';
import type { ConsentRecord, ExperimentSetupRecord } from '../data/experiment-store';
import { isFeasibilityDue } from './start-attempt';
import { validRunInDays } from './adapter';
import { exposureForExperimentId } from './experiments';
import { consentCoversCurrentVersion } from './consent';

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
  /**
   * Every plan on the account, active or finished. The run-in count excludes the days
   * inside their windows, so a new cycle starts from zero instead of inheriting the days
   * of the test before it.
   */
  plans: readonly ExperimentPlan[];
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
 * - feasibility_ready: no active plan, the run-in window has >= 14 valid days OR nextCheckDate
 *   is reached. The run-in window is the days after every earlier plan's last scheduled day
 *   (entriesForRunIn), so a finished test never counts towards the next one.
 * - run_in: run-in in progress
 */
export function getHomeState(inputs: HomeStateInputs): HomeState {
  const { consent, setup, entries, plan, plans, today } = inputs;

  // A new consent version re-asks the user: the log now stores screen times as well as
  // sleep and caffeine, so an older agreement does not cover what is collected today.
  if (!consentCoversCurrentVersion(consent)) {
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

  // No active/running plan. Only days outside every earlier plan's window count, so a
  // second cycle is judged on its own run-in rather than on the test that came before it.
  // The run-in is counted for the test the setup row names: a screens night needs its
  // screen time logged, so the two tests never inherit each other's nights.
  const exposure = exposureForExperimentId(setup.experimentId);
  const validDaysCount = validRunInDays(entries, plans, today, exposure);
  if (isFeasibilityDue(validDaysCount, setup.nextCheckDate ?? null, today)) {
    return 'feasibility_ready';
  }

  return 'run_in';
}
