import type { DailyEntry, ProgressSummary } from './types';
import type { HomeState, HomeStateInputs } from './home-state';
import { getHomeState } from './home-state';
import { entriesForPlan, progressSummary } from './adapter';
import { getRunInDescriptiveStats, type RunInDescriptiveStats } from './view-model';
import { addDaysToLocalDate, canEditDate, getMorningEntryDate } from './dates';
import { runInMinValidDays } from './config';
import {
  CAFFEINE_TIME_UNREADABLE_MARKER,
  readCaffeineTime,
} from './caffeine-time';
import { VERDICT_HEADINGS } from './verdict-headings';

export interface DashboardDayItem {
  date: string;
  label: string;
  statusText: string;
  statusTone: 'logged' | 'partial' | 'missing' | 'unreadable';
  editable: boolean;
  sleepMinutes: number | null;
  lastCaffeineTime: string | 'none' | null;
  synced: boolean;
}

export interface TodayDashboardModel {
  today: string;
  state: HomeState;
  medicalNotice: 'This app is not medical advice.';
  instruction: {
    overline: string;
    heading: string;
    body: string;
    /** One short status line for the hero card, e.g. "Day 3 of 14 • Cutoff 12:00". */
    detail: string;
  };
  primaryAction: {
    label: string;
    route: string;
    /**
     * 'primary' = the one action the user still has to take on another screen.
     * 'quiet' = a step that is optional because Today already does the work
     * (the inline morning check-in), so it must not read as required.
     */
    tone: 'primary' | 'quiet';
  } | null;
  checkIn: {
    enabled: boolean;
    defaultDate: string;
    recentDays: DashboardDayItem[];
    /** Whether the morning check-in for defaultDate is already complete. */
    status: DashboardDayItem['statusTone'];
    /** One-line reading of that check-in, e.g. "7h 30m · Last caffeine 14:00". */
    summary: string;
  };
  progress:
    | {
        kind: 'run_in';
        validDays: number;
        targetDays: number;
        nextStepText: string;
        descriptiveStats: RunInDescriptiveStats | null;
      }
    | {
        kind: 'experiment';
        currentDayNum: number;
        totalDays: number;
        daysLogged: number;
        daysRemaining: number;
        adherenceCounts: ProgressSummary['adherenceCounts'];
        nextStepText: string;
      }
    | {
        kind: 'result';
        daysAnalyzed: number;
        daysExcluded: number;
        missingOutcomeDays: number;
        nextStepText: string;
      }
    | null;
  unsyncedCount: number;
}

export interface DashboardEntry extends DailyEntry {
  synced?: boolean;
}

export interface TodayDashboardInputs extends Omit<HomeStateInputs, 'entries'> {
  entries: readonly DashboardEntry[];
}

function getCutoffTime(plan: NonNullable<HomeStateInputs['plan']>['plan']): string {
  const rule = plan.definition.conditionRule;
  if (rule && 'cutoffTime' in rule && typeof (rule as { cutoffTime?: unknown }).cutoffTime === 'string') {
    return (rule as { cutoffTime: string }).cutoffTime;
  }
  return '12:00';
}

function formatSleepMinutes(sleepMinutes: number | null): string {
  if (sleepMinutes === null) return 'Sleep not logged';
  return `${Math.floor(sleepMinutes / 60)}h ${String(sleepMinutes % 60).padStart(2, '0')}m`;
}

/** One plain-language line describing a logged day, with missing values left missing. */
function summarizeDay(item: DashboardDayItem | undefined): string {
  const read = readCaffeineTime(item?.lastCaffeineTime ?? null);
  const caffeine =
    read.kind === 'none'
      ? 'No caffeine'
      : read.kind === 'valid'
      ? `Last caffeine ${read.time}`
      : read.kind === 'unreadable'
      ? 'Caffeine time unreadable'
      : 'Caffeine not logged';
  return `${formatSleepMinutes(item?.sleepMinutes ?? null)} · ${caffeine}`;
}

function buildDayStatus(entry: DashboardEntry | undefined): {
  statusText: string;
  statusTone: DashboardDayItem['statusTone'];
  synced: boolean;
} {
  if (!entry) {
    return { statusText: 'Missing', statusTone: 'missing', synced: true };
  }
  const synced = entry.synced !== false;
  const syncSuffix = synced ? '' : ' (not synced yet)';
  const caffeineRead = readCaffeineTime(entry.lastCaffeineTime);

  if (caffeineRead.kind === 'unreadable') {
    const base = entry.sleepMinutes !== null ? 'Partly logged' : 'Missing';
    return {
      statusText: `${base}${syncSuffix} — ${CAFFEINE_TIME_UNREADABLE_MARKER}`,
      statusTone: 'unreadable',
      synced,
    };
  }

  if (entry.sleepMinutes !== null && entry.lastCaffeineTime !== null) {
    return { statusText: `Logged${syncSuffix}`, statusTone: 'logged', synced };
  }

  if (entry.sleepMinutes !== null || entry.lastCaffeineTime !== null) {
    return { statusText: `Partly logged${syncSuffix}`, statusTone: 'partial', synced };
  }

  return { statusText: `Missing${syncSuffix}`, statusTone: 'missing', synced };
}

/**
 * Pure builder for the Today dashboard.
 *
 * Enforces all domain invariants:
 * - Narrowed entries via entriesForPlan before calling progressSummary
 * - Exposes only today's scheduled instruction (never future assignments)
 * - No interim statistical estimates or verdicts before completion
 * - Missing values remain null (MISSING IS NOT ZERO)
 */
export function getTodayDashboardModel(inputs: TodayDashboardInputs): TodayDashboardModel {
  const { consent, setup, entries, plan, today } = inputs;
  const state = getHomeState({ consent, setup, entries, plan, today });
  const unsyncedCount = entries.filter(e => e.synced === false).length;
  const yesterday = getMorningEntryDate(today);

  const candidateDates = [
    yesterday,
    addDaysToLocalDate(yesterday, -1),
    addDaysToLocalDate(yesterday, -2),
  ];

  const recentDays: DashboardDayItem[] = candidateDates.map(d => {
    const existing = entries.find(e => e.date === d);
    const { statusText, statusTone, synced } = buildDayStatus(existing);
    return {
      date: d,
      label: d === yesterday ? `Last night (${d})` : d,
      statusText,
      statusTone,
      editable: canEditDate(today, d, plan),
      sleepMinutes: existing?.sleepMinutes ?? null,
      lastCaffeineTime: existing?.lastCaffeineTime ?? null,
      synced,
    };
  });

  // Every state reports the same shape for the morning check-in, so the screen
  // never has to re-derive whether last night is already logged.
  const buildCheckIn = (opts: {
    enabled: boolean;
    defaultDate: string;
    recentDays: DashboardDayItem[];
  }): TodayDashboardModel['checkIn'] => {
    const item = opts.recentDays.find((d) => d.date === opts.defaultDate);
    return {
      ...opts,
      status: item?.statusTone ?? 'missing',
      summary: summarizeDay(item),
    };
  };

  if (state === 'needs_consent') {
    return {
      today,
      state,
      medicalNotice: 'This app is not medical advice.',
      instruction: {
        overline: 'GETTING STARTED',
        heading: 'Review consent & set up your experiment',
        body: 'Review how your sleep and caffeine log is used and choose your daily cutoff time to begin your 14-day baseline run-in.',
        detail: 'Takes about two minutes.',
      },
      primaryAction: {
        label: 'Setup & Consent',
        route: '/setup-consent',
        tone: 'primary',
      },
      checkIn: buildCheckIn({
        enabled: false,
        defaultDate: yesterday,
        recentDays: [],
      }),
      progress: null,
      unsyncedCount,
    };
  }

  if (state === 'needs_setup') {
    return {
      today,
      state,
      medicalNotice: 'This app is not medical advice.',
      instruction: {
        overline: 'GETTING STARTED',
        heading: 'Finish experiment setup',
        body: 'Choose your daily caffeine cutoff time to start logging your 14-day baseline run-in.',
        detail: 'One step left: your cutoff time.',
      },
      primaryAction: {
        label: 'Setup & Consent',
        route: '/setup-consent',
        tone: 'primary',
      },
      checkIn: buildCheckIn({
        enabled: false,
        defaultDate: yesterday,
        recentDays: [],
      }),
      progress: null,
      unsyncedCount,
    };
  }

  if (state === 'run_in' || state === 'feasibility_ready') {
    const validDays = entries.filter(e => e.sleepMinutes !== null).length;
    const descriptiveStats = validDays >= 3 ? getRunInDescriptiveStats(entries) : null;
    const remaining = Math.max(0, runInMinValidDays - validDays);
    const nextStepText =
      state === 'feasibility_ready'
        ? 'Next step: Review your feasibility check and choose an experiment duration.'
        : setup?.nextCheckDate
        ? `Next step: Keep logging until your next feasibility check on ${setup.nextCheckDate}.`
        : `Next step: Log ${remaining} more valid night${remaining === 1 ? '' : 's'} with sleep duration to unlock your feasibility check.`;

    return {
      today,
      state,
      medicalNotice: 'This app is not medical advice.',
      instruction:
        state === 'feasibility_ready'
          ? {
              overline: 'BASELINE COMPLETE',
              heading: 'Ready to check feasibility',
              body: 'Today: your usual routine. Your baseline log is ready to evaluate whether an experiment can detect a meaningful sleep change.',
              detail: `${validDays} valid nights logged.`,
            }
          : {
              overline: "TODAY'S ROUTINE",
              heading: 'Today: your usual routine.',
              body: 'Keep your normal sleep and caffeine habits during the baseline run-in and log each morning.',
              detail: `${validDays} of ${runInMinValidDays} valid nights logged.`,
            },
      primaryAction:
        state === 'feasibility_ready'
          ? { label: 'Check Feasibility', route: '/feasibility', tone: 'primary' }
          : { label: 'Run-in Check-in', route: '/run-in', tone: 'quiet' },
      checkIn: buildCheckIn({
        enabled: true,
        defaultDate: yesterday,
        recentDays,
      }),
      progress: {
        kind: 'run_in',
        validDays,
        targetDays: runInMinValidDays,
        nextStepText,
        descriptiveStats,
      },
      unsyncedCount,
    };
  }

  if (state === 'plan_ended_early') {
    return {
      today,
      state,
      medicalNotice: 'This app is not medical advice.',
      instruction: {
        overline: 'EXPERIMENT ENDED',
        heading: 'Experiment ended early',
        body: 'Your experiment was ended early without a result. Your logged entries have been preserved.',
        detail: 'No result was computed.',
      },
      primaryAction: null,
      checkIn: buildCheckIn({
        enabled: false,
        defaultDate: yesterday,
        recentDays,
      }),
      progress: null,
      unsyncedCount,
    };
  }

  if (state === 'plan_result_ready' && plan) {
    const res = plan.result;
    const verdictHeading = res ? (VERDICT_HEADINGS[res.verdictLabel] ?? res.verdictLabel) : 'Result ready';
    const statement = res ? res.statement : 'Your experiment result is ready to view.';
    const daysAnalyzed = res ? res.daysAnalyzed.intervention + res.daysAnalyzed.control : 0;

    return {
      today,
      state,
      medicalNotice: 'This app is not medical advice.',
      instruction: {
        overline: 'VERDICT',
        heading: verdictHeading,
        body: statement,
        detail: `${daysAnalyzed} days analyzed.`,
      },
      primaryAction: {
        label: 'See Result',
        route: '/result',
        tone: 'primary',
      },
      checkIn: buildCheckIn({
        enabled: false,
        defaultDate: yesterday,
        recentDays,
      }),
      progress: res
        ? {
            kind: 'result',
            daysAnalyzed,
            daysExcluded: res.daysExcluded,
            missingOutcomeDays: res.missingOutcomeDays,
            nextStepText: 'Your experiment log is locked. Open See Result for full adherence and day counts.',
          }
        : null,
      unsyncedCount,
    };
  }

  // Remaining states have a non-null active plan: plan_scheduled, plan_active, plan_awaiting_final
  const activePlan = plan!.plan;
  const narrowedEntries = entriesForPlan(activePlan, entries);
  const summary = progressSummary(activePlan, narrowedEntries, today);
  const lastExposureDate =
    activePlan.schedule[activePlan.schedule.length - 1]?.date ?? activePlan.startDate;
  const cutoffTime = getCutoffTime(activePlan);

  if (state === 'plan_scheduled') {
    return {
      today,
      state,
      medicalNotice: 'This app is not medical advice.',
      instruction: {
        overline: 'UPCOMING EXPERIMENT',
        heading: `Your experiment starts on ${activePlan.startDate}.`,
        body: 'Until then, keep your usual routine and keep logging each morning.',
        detail: `Starts ${activePlan.startDate} • ${activePlan.chosenDuration} days.`,
      },
      primaryAction: {
        label: 'Daily Instruction',
        route: '/daily-instruction',
        tone: 'quiet',
      },
      checkIn: buildCheckIn({
        enabled: true,
        defaultDate: yesterday,
        recentDays,
      }),
      progress: {
        kind: 'experiment',
        currentDayNum: 0,
        totalDays: activePlan.chosenDuration,
        daysLogged: summary.daysLogged,
        daysRemaining: summary.daysRemaining,
        adherenceCounts: summary.adherenceCounts,
        nextStepText: `Next step: Follow your first daily instruction on ${activePlan.startDate}.`,
      },
      unsyncedCount,
    };
  }

  if (state === 'plan_active') {
    const todayScheduled = activePlan.schedule.find(s => s.date === today);
    const dayIndex = activePlan.schedule.findIndex(s => s.date === today);
    const currentDayNum = dayIndex >= 0 ? dayIndex + 1 : 1;
    const instructionHeading =
      todayScheduled?.condition === 'intervention'
        ? `Today: no caffeine after ${cutoffTime}.`
        : 'Today: your usual routine.';

    return {
      today,
      state,
      medicalNotice: 'This app is not medical advice.',
      instruction: {
        overline: "TODAY'S INSTRUCTION",
        heading: instructionHeading,
        body: `Day ${currentDayNum} of ${activePlan.chosenDuration}. Log last night's sleep and yesterday's caffeine below.`,
        detail: `Day ${currentDayNum} of ${activePlan.chosenDuration} • Cutoff ${cutoffTime}`,
      },
      primaryAction: {
        label: 'Daily Instruction',
        route: '/daily-instruction',
        tone: 'quiet',
      },
      checkIn: buildCheckIn({
        enabled: true,
        defaultDate: yesterday,
        recentDays,
      }),
      progress: {
        kind: 'experiment',
        currentDayNum,
        totalDays: activePlan.chosenDuration,
        daysLogged: summary.daysLogged,
        daysRemaining: summary.daysRemaining,
        adherenceCounts: summary.adherenceCounts,
        nextStepText: `Next step: Complete your experiment through ${lastExposureDate}. Results unlock on ${addDaysToLocalDate(lastExposureDate, 1)}.`,
      },
      unsyncedCount,
    };
  }

  // state === 'plan_awaiting_final'
  const lastEntry = entries.find(e => e.date === lastExposureDate);
  const isFinalMissing = !lastEntry || lastEntry.sleepMinutes === null;
  const finalCheckInDate = recentDays.some(d => d.date === lastExposureDate)
    ? lastExposureDate
    : yesterday;

  return {
    today,
    state,
    medicalNotice: 'This app is not medical advice.',
    instruction: {
      overline: 'FINAL CHECK-IN',
      heading: 'Your experiment is complete.',
      body: isFinalMissing
        ? `You need to log your final day (${lastExposureDate}) before viewing your result.`
        : 'All scheduled days have been logged. Lock your experiment days when ready to compute your result.',
      detail: `${summary.daysLogged} of ${activePlan.chosenDuration} days logged.`,
    },
    primaryAction: {
      label: 'Final Check-in',
      route: '/result',
      tone: 'primary',
    },
    checkIn: buildCheckIn({
      enabled: isFinalMissing || recentDays.some(d => d.editable),
      defaultDate: finalCheckInDate,
      recentDays,
    }),
    progress: {
      kind: 'experiment',
      currentDayNum: activePlan.chosenDuration,
      totalDays: activePlan.chosenDuration,
      daysLogged: summary.daysLogged,
      daysRemaining: summary.daysRemaining,
      adherenceCounts: summary.adherenceCounts,
      nextStepText: 'Next step: Open Final Check-in to lock your entries and see your result.',
    },
    unsyncedCount,
  };
}
