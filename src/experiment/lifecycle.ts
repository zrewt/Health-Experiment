import type { StoredExperimentPlan } from '../data/plan-persistence';
import type { ConsentRecord, ExperimentSetupRecord } from '../data/experiment-store';
import type { DailyEntry, ExperimentPlan, ResultViewModel } from './types';
import { getHomeState, type HomeState } from './home-state';
import { validRunInDays } from './adapter';
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
    title: '1. Getting to know your sleep',
    description:
      'Log each morning how long you slept and when you last had caffeine. Keep your usual habits. After 14 nights we check whether a test can show a real difference.',
  },
  {
    stepNumber: 2,
    title: '2. The test itself',
    description:
      'Days come in pairs, picked at random: a cutoff day (no caffeine after your cutoff time) or a normal day. The app shows you one day at a time.',
  },
  {
    stepNumber: 3,
    title: '3. What we found',
    description:
      'On the morning after your last day, log your night and lock the test to see what we found.',
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
  // Every plan on the account, so the run-in count starts fresh in a new cycle.
  const allPlans = [activePlan, ...historyPlans]
    .filter((item): item is StoredExperimentPlan => item !== null)
    .map(item => item.plan);
  const state = getHomeState({
    consent,
    setup,
    entries,
    plan: activePlan,
    plans: allPlans,
    today,
  });

  const cutoffTime = activePlan
    ? extractCutoffTime(activePlan.plan)
    : setup?.cutoffTime ?? '12:00';

  const validDays = validRunInDays(entries, allPlans, today);

  let durationText = 'Chosen when you start (42, 56, 70 or 84 days)';
  if (activePlan) {
    const lastDate =
      activePlan.plan.schedule[activePlan.plan.schedule.length - 1]?.date ??
      activePlan.plan.startDate;
    durationText = `${activePlan.plan.chosenDuration} days (${activePlan.plan.startDate} to ${lastDate})`;
  }

  let stageLabel = 'Not started';
  let stageDescription = 'Set up, then start logging.';
  let nextStepLabel = 'Set up';
  let nextStepRoute: string | null = '/setup-consent';
  let canStartNewCycle = false;

  switch (state) {
    case 'needs_consent':
      stageLabel = 'Not set up';
      stageDescription = 'Read how your log is used, then agree.';
      nextStepLabel = 'Set up';
      nextStepRoute = '/setup-consent';
      break;
    case 'needs_setup':
      stageLabel = 'Not set up';
      stageDescription = 'Pick your daily caffeine cutoff time.';
      nextStepLabel = 'Set up';
      nextStepRoute = '/setup-consent';
      break;
    case 'run_in':
      stageLabel = `Getting to know your sleep (${validDays} of ${runInMinValidDays} nights)`;
      stageDescription =
        'Keep your usual habits and log each morning. 14 nights unlocks the check.';
      nextStepLabel = 'Log my sleep';
      nextStepRoute = '/run-in';
      break;
    case 'feasibility_ready':
      stageLabel = 'Ready to check';
      stageDescription =
        'Your log has enough nights to see whether a test can show a real difference.';
      nextStepLabel = 'Is this test worth doing?';
      nextStepRoute = '/feasibility';
      break;
    case 'plan_scheduled':
      stageLabel = `Starts ${activePlan?.plan.startDate ?? ''}`;
      stageDescription =
        'Your days are set. Keep logging your usual habits until then.';
      nextStepLabel = 'Today’s note';
      nextStepRoute = '/daily-instruction';
      break;
    case 'plan_active':
      stageLabel = 'Test in progress';
      stageDescription =
        'Follow today’s note and log your night each morning.';
      nextStepLabel = 'Today’s note';
      nextStepRoute = '/daily-instruction';
      break;
    case 'plan_awaiting_final':
      stageLabel = 'Last night to log';
      stageDescription =
        'The days are done. Log your last night, then lock it to see what we found.';
      nextStepLabel = 'Finish & see what we found';
      nextStepRoute = '/result';
      break;
    case 'plan_result_ready':
      stageLabel = 'Finished';
      stageDescription =
        'Your test is done and saved. Read what we found, or start again.';
      nextStepLabel = 'Read what we found';
      nextStepRoute = '/result';
      canStartNewCycle = true;
      break;
    case 'plan_ended_early':
      stageLabel = 'Stopped early';
      stageDescription =
        'You stopped early, so nothing was worked out. Your entries are still in your journal.';
      nextStepLabel = validDays >= runInMinValidDays ? 'Is this test worth doing?' : 'Log my sleep';
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
        ? 'Finished'
        : item.status === 'cancelled'
        ? 'Stopped early'
        : 'Running';

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
        'See whether your sleep is different on cutoff days.',
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
      ? `Cautious estimate: about ${result.conservativeEstimate} minutes a night more sleep on cutoff days. This is the low end of the range we could work out.`
      : 'No single number is shown here: the difference could not be told apart from night-to-night changes in your sleep.';

  const intervalText =
    result.interval !== null
      ? `The range we could work out runs from ${Math.round(result.interval[0])} to ${Math.round(result.interval[1])} minutes a night.`
      : 'A range could not be worked out from this log.';

  const uncertaintyNote =
    result.reducedAdherence
      ? 'The rule was followed less often than planned, which can make the difference look smaller or less certain.'
      : 'This range comes from night-to-night changes in your own sleep.';

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
          ? `Cutoff day (${cutoffTime})`
          : 'Normal day',
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
        'Whether your sleep was longer or shorter on cutoff days than on normal days.',
        `How many days went into it (${analyzedTotal} of ${plan.chosenDuration}) and how often the rule was followed.`,
      ],
      doesNotTell: [
        'It cannot tell you why your sleep differed. Caffeine is not separated from everything else in your day.',
        'It is a summary of your own log, not a diagnosis or treatment advice.',
      ],
    },
    underlyingDays,
  };
}
