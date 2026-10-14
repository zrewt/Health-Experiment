import type { StoredExperimentPlan } from '../data/plan-persistence';
import type { ConsentRecord, ExperimentSetupRecord } from '../data/experiment-store';
import type { DailyEntry, ExperimentPlan, ResultViewModel } from './types';
import { getHomeState, type HomeState } from './home-state';
import { VERDICT_HEADINGS } from './verdict-headings';
import { formatSleepDuration } from './journal';
import {
  CAFFEINE_TIME_UNREADABLE_MARKER,
  readCaffeineTime,
} from './caffeine-time';
import { runInMinValidDays } from './config';

export interface GuideStep {
  stepNumber: 1 | 2 | 3;
  title: string;
  description: string;
}

export interface SavedExperimentSummary {
  id: string;
  startDate: string;
  endDate: string;
  chosenDuration: number;
  cutoffTime: string;
  status: 'scheduled' | 'completed' | 'cancelled' | string;
  statusLabel: string;
  verdictHeading: string | null;
  statement: string | null;
  conservativeEstimate: number | null;
  daysAnalyzed: number | null;
  evaluatedAt: string | null;
}

export interface ExperimentLifecycleModel {
  today: string;
  state: HomeState;
  medicalNotice: 'This app is not medical advice.';
  guideSteps: readonly [GuideStep, GuideStep, GuideStep];
  detail: {
    name: string;
    purpose: string;
    cutoffTime: string;
    durationText: string;
    stageLabel: string;
    stageDescription: string;
    nextStepLabel: string;
    nextStepRoute: string | null;
    canStartNewCycle: boolean;
  };
  savedExperiments: SavedExperimentSummary[];
}

export interface UnderlyingResultDay {
  date: string;
  assignedCondition: 'intervention' | 'control';
  assignedLabel: string;
  sleepText: string;
  caffeineText: string;
  contributedToAnalysis: boolean;
}

export interface ResultExplanationModel {
  medicalNotice: 'This app is not medical advice.';
  verdictHeading: string;
  statement: string;
  reasons: string[];
  estimateExplanation: {
    conservativeEstimateText: string;
    intervalText: string;
    uncertaintyNote: string;
  };
  contributingDays: {
    totalScheduled: number;
    analyzedTotal: number;
    analyzedIntervention: number;
    analyzedControl: number;
    assignedIntervention: number;
    assignedControl: number;
    missingSleepDays: number;
    unknownCaffeineDays: number;
    excludedDays: number;
    adherentDays: number;
    contaminatedDays: number;
  };
  whatItTellsYou: {
    doesTell: string[];
    doesNotTell: string[];
  };
  underlyingDays: UnderlyingResultDay[];
}

function extractCutoffTime(plan: ExperimentPlan): string {
  const rule = plan.definition.conditionRule;
  if (rule && 'cutoffTime' in rule && typeof (rule as { cutoffTime?: unknown }).cutoffTime === 'string') {
    return (rule as { cutoffTime: string }).cutoffTime;
  }
  return '12:00';
}

export const EXPERIMENT_GUIDE_STEPS: readonly [GuideStep, GuideStep, GuideStep] = [
  {
    stepNumber: 1,
    title: '1. Baseline Run-in (14 valid days)',
    description:
      'Log last night’s sleep and yesterday’s last caffeine time each morning while keeping your usual routine. Once 14 valid sleep days are recorded, the app checks whether an experiment is feasible.',
  },
  {
    stepNumber: 2,
    title: '2. Randomized 2-Day Blocks',
    description:
      'Choose an experiment length (42 to 84 days). Days are assigned in 2-day blocks to either your caffeine cutoff time or your usual routine. Only today’s instruction is shown during the day.',
  },
  {
    stepNumber: 3,
    title: '3. Locked Final Result',
    description:
      'On the morning after your last experiment day, log your final night and lock the experiment window to view your verdict, uncertainty range, and adherence counts.',
  },
];

export function getExperimentLifecycleModel(inputs: {
  consent: ConsentRecord | null;
  setup: ExperimentSetupRecord | null;
  entries: readonly DailyEntry[];
  activePlan: StoredExperimentPlan | null;
  historyPlans: readonly StoredExperimentPlan[];
  today: string;
}): ExperimentLifecycleModel {
  const { consent, setup, entries, activePlan, historyPlans, today } = inputs;
  const state = getHomeState({
    consent,
    setup,
    entries,
    plan: activePlan,
    today,
  });

  const cutoffTime = activePlan
    ? extractCutoffTime(activePlan.plan)
    : setup?.cutoffTime ?? '12:00';

  const validDays = entries.filter(e => e.sleepMinutes !== null).length;

  let durationText = 'Chosen at feasibility check (42, 56, 70, or 84 days)';
  if (activePlan) {
    const lastDate =
      activePlan.plan.schedule[activePlan.plan.schedule.length - 1]?.date ??
      activePlan.plan.startDate;
    durationText = `${activePlan.plan.chosenDuration} days (${activePlan.plan.startDate} to ${lastDate})`;
  }

  let stageLabel = 'Not started';
  let stageDescription = 'Complete consent and choose a caffeine cutoff time to begin.';
  let nextStepLabel = 'Setup & Consent';
  let nextStepRoute: string | null = '/setup-consent';
  let canStartNewCycle = false;

  switch (state) {
    case 'needs_consent':
      stageLabel = 'Consent needed';
      stageDescription = 'Review how your log is used and grant consent before starting.';
      nextStepLabel = 'Setup & Consent';
      nextStepRoute = '/setup-consent';
      break;
    case 'needs_setup':
      stageLabel = 'Setup needed';
      stageDescription = 'Choose your daily caffeine cutoff time to begin the 14-day baseline run-in.';
      nextStepLabel = 'Setup & Consent';
      nextStepRoute = '/setup-consent';
      break;
    case 'run_in':
      stageLabel = `Baseline run-in (${validDays} of ${runInMinValidDays} valid days)`;
      stageDescription =
        'Keep your usual routine and log sleep and caffeine each morning until 14 valid sleep days are recorded.';
      nextStepLabel = 'Open Run-in Check-in';
      nextStepRoute = '/run-in';
      break;
    case 'feasibility_ready':
      stageLabel = 'Feasibility ready';
      stageDescription =
        'Your baseline log has enough valid days to evaluate whether an experiment can detect a meaningful sleep difference.';
      nextStepLabel = 'Check Feasibility';
      nextStepRoute = '/feasibility';
      break;
    case 'plan_scheduled':
      stageLabel = `Scheduled (starts ${activePlan?.plan.startDate ?? ''})`;
      stageDescription =
        'Your experiment schedule is locked in. Keep logging your usual routine until the start date.';
      nextStepLabel = 'Daily Instruction';
      nextStepRoute = '/daily-instruction';
      break;
    case 'plan_active':
      stageLabel = 'Experiment in progress';
      stageDescription =
        'Follow today’s assigned instruction and log last night’s sleep and yesterday’s caffeine each morning.';
      nextStepLabel = 'Daily Instruction';
      nextStepRoute = '/daily-instruction';
      break;
    case 'plan_awaiting_final':
      stageLabel = 'Awaiting final check-in';
      stageDescription =
        'Your scheduled experiment days have finished. Log your final night and compute your locked result.';
      nextStepLabel = 'Final Check-in';
      nextStepRoute = '/result';
      break;
    case 'plan_result_ready':
      stageLabel = 'Completed (result saved)';
      stageDescription =
        'Your experiment is complete and its result snapshot is saved. You can review the full result or start a new experiment cycle.';
      nextStepLabel = 'See Result';
      nextStepRoute = '/result';
      canStartNewCycle = true;
      break;
    case 'plan_ended_early':
      stageLabel = 'Ended early';
      stageDescription =
        'Your experiment was ended early without a result. Your logged entries remain in your journal, and you can start a new cycle via baseline/feasibility.';
      nextStepLabel = validDays >= runInMinValidDays ? 'Check Feasibility' : 'Continue Baseline Run-in';
      nextStepRoute = validDays >= runInMinValidDays ? '/feasibility' : '/run-in';
      canStartNewCycle = true;
      break;
  }

  // Merge activePlan and historyPlans without duplicates, newest first
  const seenIds = new Set<string>();
  const combinedPlans: StoredExperimentPlan[] = [];
  for (const item of [activePlan, ...historyPlans]) {
    if (item && !seenIds.has(item.id)) {
      seenIds.add(item.id);
      combinedPlans.push(item);
    }
  }

  const savedExperiments: SavedExperimentSummary[] = combinedPlans.map(item => {
    const endDate =
      item.plan.schedule[item.plan.schedule.length - 1]?.date ?? item.plan.startDate;
    const planCutoff = extractCutoffTime(item.plan);
    const res = item.result ?? null;
    const statusLabel =
      item.status === 'completed'
        ? 'Completed'
        : item.status === 'cancelled'
        ? 'Ended early'
        : 'In progress';

    return {
      id: item.id,
      startDate: item.plan.startDate,
      endDate,
      chosenDuration: item.plan.chosenDuration,
      cutoffTime: planCutoff,
      status: item.status,
      statusLabel,
      verdictHeading: res ? (VERDICT_HEADINGS[res.verdictLabel] ?? res.verdictLabel) : null,
      statement: res ? res.statement : null,
      conservativeEstimate: res ? res.conservativeEstimate : null,
      daysAnalyzed: res ? res.daysAnalyzed.intervention + res.daysAnalyzed.control : null,
      evaluatedAt: res?.evaluatedAt ?? item.completed_at ?? null,
    };
  });

  return {
    today,
    state,
    medicalNotice: 'This app is not medical advice.',
    guideSteps: EXPERIMENT_GUIDE_STEPS,
    detail: {
      name: 'Caffeine cutoff',
      purpose:
        'Compare your sleep duration on days assigned to a caffeine cutoff against days assigned to your usual routine.',
      cutoffTime,
      durationText,
      stageLabel,
      stageDescription,
      nextStepLabel,
      nextStepRoute,
      canStartNewCycle,
    },
    savedExperiments,
  };
}

export function getResultExplanationModel(
  plan: ExperimentPlan,
  result: ResultViewModel,
  entries: readonly DailyEntry[],
): ResultExplanationModel {
  const verdictHeading = VERDICT_HEADINGS[result.verdictLabel] ?? result.verdictLabel;
  const cutoffTime = extractCutoffTime(plan);

  const assignedIntervention = plan.schedule.filter(s => s.condition === 'intervention').length;
  const assignedControl = plan.schedule.filter(s => s.condition === 'control').length;
  const analyzedTotal = result.daysAnalyzed.intervention + result.daysAnalyzed.control;

  const conservativeEstimateText =
    result.conservativeEstimate !== null
      ? `Conservative estimate: ${result.conservativeEstimate} minutes per night (the cautious lower bound of the plausible range comparing cutoff-assigned days with usual-routine days).`
      : 'No single conservative minute estimate is highlighted because the observed difference could not be separated from day-to-day sleep variability.';

  const intervalText =
    result.interval !== null
      ? `95% plausible range: ${Math.round(result.interval[0])} to ${Math.round(result.interval[1])} minutes difference between assigned cutoff days and assigned usual-routine days.`
      : '95% plausible range: Not available for this log.';

  const uncertaintyNote =
    result.reducedAdherence
      ? 'Reduced adherence was observed during the experiment window, which can make an assigned-day comparison smaller or less certain than under full adherence.'
      : 'This range reflects night-to-night sleep variation across your logged experiment days.';

  const byDate = new Map(entries.map(e => [e.date, e]));
  const underlyingDays: UnderlyingResultDay[] = plan.schedule.map(slot => {
    const entry = byDate.get(slot.date);
    const sleepMinutes = entry?.sleepMinutes ?? null;
    const sleepText = formatSleepDuration(sleepMinutes);
    const parsedCaffeine = readCaffeineTime(entry?.lastCaffeineTime ?? null);
    let caffeineText = 'Not logged';
    if (parsedCaffeine.kind === 'none') caffeineText = 'No caffeine';
    else if (parsedCaffeine.kind === 'valid' && parsedCaffeine.time) {
      caffeineText = `Last caffeine ${parsedCaffeine.time}`;
    } else if (parsedCaffeine.kind === 'unreadable') {
      caffeineText = CAFFEINE_TIME_UNREADABLE_MARKER;
    }

    return {
      date: slot.date,
      assignedCondition: slot.condition,
      assignedLabel:
        slot.condition === 'intervention'
          ? `Cutoff (${cutoffTime})`
          : 'Usual routine',
      sleepText,
      caffeineText,
      contributedToAnalysis: sleepMinutes !== null,
    };
  });

  return {
    medicalNotice: 'This app is not medical advice.',
    verdictHeading,
    statement: result.statement,
    reasons: [...result.reasons],
    estimateExplanation: {
      conservativeEstimateText,
      intervalText,
      uncertaintyNote,
    },
    contributingDays: {
      totalScheduled: plan.chosenDuration,
      analyzedTotal,
      analyzedIntervention: result.daysAnalyzed.intervention,
      analyzedControl: result.daysAnalyzed.control,
      assignedIntervention,
      assignedControl,
      missingSleepDays: result.missingOutcomeDays,
      unknownCaffeineDays: result.unknownExposureDays,
      excludedDays: result.daysExcluded,
      adherentDays: result.adherence.counts.ADHERENT,
      contaminatedDays: result.adherence.counts.CONTAMINATED,
    },
    whatItTellsYou: {
      doesTell: [
        'Whether sleep duration differed on days assigned to your caffeine cutoff compared with days assigned to your usual routine during this experiment.',
        `How many scheduled days contributed (${analyzedTotal} of ${plan.chosenDuration}) and how closely the assigned schedule was followed.`,
      ],
      doesNotTell: [
        'It cannot prove why sleep differed or isolate caffeine from other unmeasured daily habits.',
        'It is a personal self-experiment summary, not a medical diagnosis or treatment recommendation.',
      ],
    },
    underlyingDays,
  };
}
