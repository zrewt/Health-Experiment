import type { DailyEntry, ProgressSummary } from './types';
import type { HomeState, HomeStateInputs } from './home-state';
import { getHomeState } from './home-state';
import { entriesForPlan, entriesForRunIn, validRunInDays, progressSummary } from './adapter';
import { getRunInDescriptiveStats, type RunInDescriptiveStats } from './view-model';
import { buildRunInRange, type RunInRange } from './wait-value';
import { getProgressFigures } from './progress-figures';
import { addDaysToLocalDate, canEditDate, getMorningEntryDate } from './dates';
import { runInMinValidDays } from './config';
import {
  CAFFEINE_TIME_UNREADABLE_MARKER,
  readCaffeineTime,
} from './caffeine-time';
import { VERDICT_HEADINGS } from './verdict-headings';
import {
  cutoffRuleText,
  experimentById,
  experimentForRuleType,
  exposureForExperimentId,
  exposureValue,
  type ExposureKind,
} from './experiments';

export interface DashboardDayItem {
  date: string;
  label: string;
  statusText: string;
  statusTone: 'logged' | 'partial' | 'missing' | 'unreadable';
  editable: boolean;
  sleepMinutes: number | null;
  lastCaffeineTime: string | 'none' | null;
  /** Last screen use, only ever read by the screens-off test. */
  lastScreenTime?: string | 'none' | null;
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
    /** The exposure this check-in records, so the screen never re-derives the test. */
    exposure: ExposureKind;
    /** The exposure as the user reads it, e.g. "caffeine" or "screens". */
    exposureWord: string;
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
        /** The cutoff the user chose, so read-backs name their own time. */
        cutoffTime: string;
        nextStepText: string;
        descriptiveStats: RunInDescriptiveStats | null;
        /** The user's own run-in range, or null below three logged nights. */
        range: RunInRange | null;
      }
    | {
        kind: 'experiment';
        currentDayNum: number;
        totalDays: number;
        daysLogged: number;
        daysRemaining: number;
        adherenceCounts: ProgressSummary['adherenceCounts'];
        nextStepText: string;
        /** Nights with a sleep figure, among the scheduled days that have happened. */
        nightsLogged: number;
        nightsSoFar: number;
        /** Cutoff days that have happened, and how many of them were kept. */
        cutoffDaysSoFar: number;
        cutoffDaysKept: number;
        pairsDone: number;
        pairsPlanned: number;
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
function summarizeDay(item: DashboardDayItem | undefined, exposure: ExposureKind): string {
  const read = readCaffeineTime(exposureValue(item, exposure));
  const isScreens = exposure === 'screens';
  const exposureText =
    read.kind === 'none'
      ? isScreens ? 'No screens' : 'No caffeine'
      : read.kind === 'valid'
      ? isScreens ? `Last screen ${read.time}` : `Last caffeine ${read.time}`
      : read.kind === 'unreadable'
      ? isScreens ? 'Screen time unreadable' : 'Caffeine time unreadable'
      : isScreens ? 'Screens not logged' : 'Caffeine not logged';
  return `${formatSleepMinutes(item?.sleepMinutes ?? null)} · ${exposureText}`;
}

function buildDayStatus(entry: DashboardEntry | undefined, exposure: ExposureKind): {
  statusText: string;
  statusTone: DashboardDayItem['statusTone'];
  synced: boolean;
} {
  if (!entry) {
    return { statusText: 'Missing', statusTone: 'missing', synced: true };
  }
  const synced = entry.synced !== false;
  const syncSuffix = synced ? '' : ' (not synced yet)';
  const exposureRead = readCaffeineTime(exposureValue(entry, exposure));

  if (exposureRead.kind === 'unreadable') {
    const base = entry.sleepMinutes !== null ? 'Partly logged' : 'Missing';
    return {
      statusText: `${base}${syncSuffix} — ${CAFFEINE_TIME_UNREADABLE_MARKER}`,
      statusTone: 'unreadable',
      synced,
    };
  }

  if (entry.sleepMinutes !== null && exposureRead.kind !== 'unset') {
    return { statusText: `Logged${syncSuffix}`, statusTone: 'logged', synced };
  }

  if (entry.sleepMinutes !== null || exposureRead.kind !== 'unset') {
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
  const { consent, setup, entries, plan, plans, today } = inputs;
  const state = getHomeState({ consent, setup, entries, plan, plans, today });
  const unsyncedCount = entries.filter(e => e.synced === false).length;
  const yesterday = getMorningEntryDate(today);

  // The test the user is running: the active plan owns it while one exists, otherwise the
  // setup row does. Every label below is read from that test, never assumed to be caffeine.
  const experiment = plan
    ? experimentForRuleType(plan.plan.definition.conditionRule.type)
    : experimentById(setup?.experimentId);
  const exposure = exposureForExperimentId(experiment.id);

  const candidateDates = [
    yesterday,
    addDaysToLocalDate(yesterday, -1),
    addDaysToLocalDate(yesterday, -2),
  ];

  // Lock any date belonging to a completed plan — including one just archived to start a
  // new cycle — so the client never offers an edit that the server trigger will reject.
  const lockPlans = [
    ...(plan ? [plan] : []),
    ...plans.map((p) => ({ status: 'completed', plan: p })),
  ];

  const recentDays: DashboardDayItem[] = candidateDates.map(d => {
    const existing = entries.find(e => e.date === d);
    const { statusText, statusTone, synced } = buildDayStatus(existing, exposure);
    return {
      date: d,
      label: d === yesterday ? `Last night (${d})` : d,
      statusText,
      statusTone,
      editable: canEditDate(today, d, lockPlans),
      sleepMinutes: existing?.sleepMinutes ?? null,
      lastCaffeineTime: existing?.lastCaffeineTime ?? null,
      lastScreenTime: existing?.lastScreenTime ?? null,
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
      exposure,
      exposureWord: experiment.exposureWord,
      status: item?.statusTone ?? 'missing',
      summary: summarizeDay(item, exposure),
    };
  };

  if (state === 'needs_consent') {
    return {
      today,
      state,
      medicalNotice: 'This app is not medical advice.',
      instruction: {
        overline: 'GETTING STARTED',
        heading: 'Let’s get you set up',
        body: 'Pick the sleep test you want to run, then read how your log is used.',
        detail: 'Takes about two minutes.',
      },
      primaryAction: {
        label: 'Choose a test',
        route: '/choose-test',
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
        heading: 'One step left',
        body: 'Pick the sleep test you want to run.',
        detail: 'Then you can start logging.',
      },
      primaryAction: {
        label: 'Choose a test',
        route: '/choose-test',
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
    // The counters read the run-in window only: days inside an earlier plan's schedule are
    // not "getting to know your sleep", they are days of a test that already ran.
    const runInEntries = entriesForRunIn(entries, plans, today);
    const validDays = validRunInDays(entries, plans, today, exposure);
    const cutoffTime = setup?.cutoffTime ?? experimentById(setup?.experimentId).defaultCutoff;
    const descriptiveStats = validDays >= 3
      ? getRunInDescriptiveStats(runInEntries, cutoffTime, exposure)
      : null;
    const remaining = Math.max(0, runInMinValidDays - validDays);
    const nextStepText =
      state === 'feasibility_ready'
        ? 'Next step: see if this test can show a real difference.'
        : setup?.nextCheckDate
        ? `Next step: keep logging until ${setup.nextCheckDate}.`
        : `Next step: log ${remaining} more night${remaining === 1 ? '' : 's'} to unlock the check.`;

    return {
      today,
      state,
      medicalNotice: 'This app is not medical advice.',
      instruction:
        state === 'feasibility_ready'
          ? {
              overline: 'ALL SET',
              heading: 'Your log is ready',
              body: 'Time to see if this test can show a real difference.',
              detail: `${validDays} nights logged.`,
            }
          : {
              overline: 'GETTING TO KNOW YOU',
              heading: 'Keep your usual routine',
              body: 'Keep your usual habits, and log your night each morning.',
              detail: `${validDays} of ${runInMinValidDays} nights logged.`,
            },
      primaryAction:
        state === 'feasibility_ready'
          ? { label: 'Is this test worth doing?', route: '/feasibility', tone: 'primary' }
          : { label: 'Log my sleep', route: '/run-in', tone: 'quiet' },
      checkIn: buildCheckIn({
        enabled: true,
        defaultDate: yesterday,
        recentDays,
      }),
      progress: {
        kind: 'run_in',
        validDays,
        targetDays: runInMinValidDays,
        cutoffTime,
        nextStepText,
        descriptiveStats,
        range: buildRunInRange(runInEntries),
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
        overline: 'ENDED',
        heading: 'Test stopped early',
        body: 'Your entries are safe, and nothing was worked out.',
        detail: 'You can start again any time.',
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
    const verdictHeading = res ? (VERDICT_HEADINGS[res.verdictLabel] ?? res.verdictLabel) : 'Ready to read';
    const statement = res ? res.statement : 'Your test has finished. Open it to read what we found.';
    const daysAnalyzed = res ? res.daysAnalyzed.intervention + res.daysAnalyzed.control : 0;

    return {
      today,
      state,
      medicalNotice: 'This app is not medical advice.',
      instruction: {
        overline: 'WHAT WE FOUND',
        heading: verdictHeading,
        body: statement,
        detail: `${daysAnalyzed} days looked at.`,
      },
      primaryAction: {
        label: 'Read what we found',
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
            nextStepText: 'Your log is locked. Open what we found for the day counts.',
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
  // Counts the user controls. They are read from the schedule and the log only, so no
  // test-day sleep value can reach the progress card.
  const figures = getProgressFigures(
    activePlan.schedule,
    narrowedEntries,
    cutoffTime,
    exposure,
    today,
  );

  if (state === 'plan_scheduled') {
    return {
      today,
      state,
      medicalNotice: 'This app is not medical advice.',
      instruction: {
        overline: 'STARTING SOON',
        heading: `Starts ${activePlan.startDate}`,
        body: 'Until then, keep your usual habits and keep logging.',
        detail: `${activePlan.chosenDuration} days planned.`,
      },
      primaryAction: {
        label: 'Today’s note',
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
        nextStepText: `Next step: your first note on ${activePlan.startDate}.`,
        nightsLogged: figures.nightsLogged,
        nightsSoFar: figures.daysElapsed,
        cutoffDaysSoFar: figures.cutoffDaysElapsed,
        cutoffDaysKept: figures.cutoffDaysKept,
        pairsDone: figures.pairsDone,
        pairsPlanned: figures.pairsPlanned,
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
        ? `Today: cutoff day, ${cutoffRuleText(experiment, cutoffTime)}`
        : 'Today: normal day';

    return {
      today,
      state,
      medicalNotice: 'This app is not medical advice.',
      instruction: {
        overline: 'TODAY',
        heading: instructionHeading,
        body: `Log last night’s sleep and ${experiment.exposureLogPhrase} below.`,
        detail: `Day ${currentDayNum} of ${activePlan.chosenDuration}`,
      },
      primaryAction: {
        label: 'Today’s note',
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
        nextStepText: `Next step: finish on ${lastExposureDate}. What we found opens the next day.`,
        nightsLogged: figures.nightsLogged,
        nightsSoFar: figures.daysElapsed,
        cutoffDaysSoFar: figures.cutoffDaysElapsed,
        cutoffDaysKept: figures.cutoffDaysKept,
        pairsDone: figures.pairsDone,
        pairsPlanned: figures.pairsPlanned,
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
    instruction: {        overline: 'LAST DAY',
        heading: 'Your sleep test is over',
        body: isFinalMissing
          ? 'Log your last night to see what we found.'
          : 'Everything is logged. Lock it to see what we found.',
        detail: `${summary.daysLogged} of ${activePlan.chosenDuration} days logged.`,
      },
      primaryAction: {
        label: 'Finish & see what we found',
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
      nextStepText: 'Next step: lock your log to see what we found.',
      nightsLogged: figures.nightsLogged,
      nightsSoFar: figures.daysElapsed,
      cutoffDaysSoFar: figures.cutoffDaysElapsed,
      cutoffDaysKept: figures.cutoffDaysKept,
      pairsDone: figures.pairsDone,
      pairsPlanned: figures.pairsPlanned,
    },
    unsyncedCount,
  };
}
