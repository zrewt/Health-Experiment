/**
 * Dev-only diagnostics: one pure snapshot of what the app would decide for the signed-in
 * account right now. The dev screen renders these rows, and tests can assert them without
 * a device, a clock or a server.
 *
 * Nothing here writes, and a broken plan is reported as a warning instead of throwing: the
 * point is to see the state that would otherwise only show up as a confusing screen.
 */

import { assessFeasibility, computeExperimentBaseline, entriesForRunIn, progressSummary, validRunInDays } from '../experiment/adapter';
import { experimentById, exposureForExperimentId } from '../experiment/experiments';
import { getHomeState, type HomeState } from '../experiment/home-state';
import { runInMinValidDays } from '../experiment/config';
import type { DailyEntry, FeasibilityTier, ProgressSummary } from '../experiment/types';
import type { ConsentRecord, ExperimentSetupRecord } from '../data/experiment-store';
import type { StoredExperimentPlan } from '../data/plan-persistence';

export interface DevDiagnosticsInput {
  consent: ConsentRecord | null;
  setup: ExperimentSetupRecord | null;
  entries: readonly DailyEntry[];
  /** Every plan on the account, newest first. */
  plans: readonly StoredExperimentPlan[];
  /** The plan the app would act on, when there is one. */
  plan: StoredExperimentPlan | null;
  today: string;
}

export interface DevDiagnosticsRow {
  label: string;
  value: string;
}

export interface DevDiagnostics {
  headline: string;
  rows: DevDiagnosticsRow[];
  warnings: string[];
}

const HOME_STATE_LABELS: Record<HomeState, string> = {
  needs_consent: 'Needs consent',
  needs_setup: 'Needs setup',
  run_in: 'Getting to know your sleep',
  feasibility_ready: 'Check is ready',
  plan_scheduled: 'Test scheduled',
  plan_active: 'Test running',
  plan_awaiting_final: 'Waiting for final night',
  plan_ended_early: 'Test ended early',
  plan_result_ready: 'Result ready',
};

function tierLabel(tier: FeasibilityTier): string {
  switch (tier) {
    case 'informative': return 'Good bet';
    case 'long_shot': return 'Worth a try';
    case 'not_informative': return 'Probably not enough to tell';
    default: return 'Cannot assess yet';
  }
}

function planPosition(plan: StoredExperimentPlan, today: string): string {
  const schedule = plan.plan.schedule;
  const passed = schedule.filter(day => day.date <= today).length;
  return `${plan.status} · day ${passed} of ${schedule.length || plan.plan.chosenDuration}`;
}

function adherenceLine(progress: ProgressSummary): string {
  const counts = progress.adherenceCounts;
  const known = progress.daysLogged;
  return `${counts.ADHERENT} kept · ${counts.NON_ADHERENT} missed · ${counts.CONTAMINATED} normal-day cutoff · ${counts.UNKNOWN} unknown (${known} logged days)`;
}

/**
 * Builds the dev snapshot. The experiment wording, cutoff and rule all come from the setup
 * row (or the active plan's rule when setup is missing), so a screens account never reads
 * caffeine numbers.
 */
export function buildDevDiagnostics(input: DevDiagnosticsInput): DevDiagnostics {
  const { consent, setup, entries, plans, plan, today } = input;
  const warnings: string[] = [];
  const rows: DevDiagnosticsRow[] = [];

  const planRuleType = plan?.plan.definition.conditionRule.type;
  const info = setup
    ? experimentById(setup.experimentId)
    : experimentById(planRuleType === 'screen-cutoff' ? 'screens-off-cutoff' : 'caffeine-cutoff');
  const exposure = setup ? exposureForExperimentId(setup.experimentId) : (planRuleType === 'screen-cutoff' ? 'screens' : 'caffeine');
  const cutoffTime = setup?.cutoffTime ?? info.defaultCutoff;

  if (setup && planRuleType && planRuleType !== info.ruleType) {
    warnings.push(`Setup says ${info.name}, but the active plan stores the ${planRuleType} rule.`);
  }

  const state = getHomeState({
    consent,
    setup,
    entries,
    plan,
    plans: plans.map(item => item.plan),
    today,
  });

  rows.push({ label: 'Test', value: `${info.name} (${info.ruleType})` });
  rows.push({ label: 'Cutoff', value: cutoffTime });
  rows.push({ label: 'Today', value: today });
  rows.push({ label: 'Home state', value: HOME_STATE_LABELS[state] });
  rows.push({ label: 'Logged days', value: String(entries.length) });

  const runInEntries = entriesForRunIn(entries, plans.map(item => item.plan), today);
  const validNights = validRunInDays(entries, plans.map(item => item.plan), today, exposure);
  const baseline = computeExperimentBaseline(exposure, runInEntries, { cutoffTime });
  rows.push({ label: 'Run-in window', value: `${runInEntries.length} logged nights` });
  rows.push({ label: 'Valid run-in nights', value: `${validNights} of ${runInMinValidDays}` });
  rows.push({ label: 'After cutoff', value: `${baseline.lateCaffeineDays} of ${baseline.knownExposureDays + baseline.unknownExposureDays}` });
  rows.push({ label: 'Exposure not logged', value: String(baseline.unknownExposureDays) });
  rows.push({ label: 'Baseline sleep SD', value: baseline.sd === null ? 'unknown' : `${baseline.sd.toFixed(1)} min` });

  const feasibility = assessFeasibility(baseline);
  rows.push({ label: 'Check verdict', value: tierLabel(feasibility.tier) });
  const longest = feasibility.options.find(option => option.duration === Math.max(...feasibility.options.map(item => item.duration)));
  rows.push({
    label: 'Smallest change it could show',
    value: longest
      ? typeof longest.mdeDirectMinutes === 'number'
        ? `${longest.mdeDirectMinutes} min`
        : longest.mdeDirectMinutes === 'larger_than_60' ? 'over 60 min' : 'unknown'
      : 'unknown',
  });

  if (plan) {
    rows.push({ label: 'Plan', value: planPosition(plan, today) });
    try {
      const progress = progressSummary(plan.plan, entries, today);
      rows.push({ label: 'Plan adherence', value: adherenceLine(progress) });
      rows.push({ label: 'Days remaining', value: String(progress.daysRemaining) });
    } catch (error) {
      warnings.push(`Plan cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    rows.push({ label: 'Plan', value: 'none' });
  }

  const unsynced = entries.filter(entry => (entry as { synced?: boolean }).synced === false).length;
  if (unsynced > 0) warnings.push(`${unsynced} logged day${unsynced === 1 ? '' : 's'} not synced yet.`);
  if (baseline.unknownExposureDays > 0) {
    warnings.push(`${baseline.unknownExposureDays} run-in night${baseline.unknownExposureDays === 1 ? '' : 's'} without ${info.exposureWord} logged.`);
  }
  if (validNights >= runInMinValidDays && !plan) {
    warnings.push('Run-in is complete: Today should offer the check.');
  }

  return {
    headline: `${info.name} · ${HOME_STATE_LABELS[state]}`,
    rows,
    warnings,
  };
}
