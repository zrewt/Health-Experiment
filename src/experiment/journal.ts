import type { StoredExperimentPlan } from '../data/plan-persistence';
import type { ExperimentSetupRecord } from '../data/experiment-store';
import type { DashboardEntry } from './today-dashboard';
import {
  addDaysToLocalDate,
  canEditDate,
  daysBetween,
  getMorningEntryDate,
} from './dates';
import {
  CAFFEINE_TIME_UNREADABLE_MARKER,
  readCaffeineTime,
} from './caffeine-time';
import {
  experimentById,
  experimentForRuleType,
  exposureForExperimentId,
  exposureValue,
  type ExposureKind,
} from './experiments';

export interface JournalDayItem {
  date: string;
  sleepMinutes: number | null;
  sleepText: string;
  /** Which exposure this test logs: the time column the day was judged on. */
  exposure: ExposureKind;
  exposureWord: string;
  /** The stored value for that exposure (caffeine time or screen time). */
  exposureValue: string | 'none' | null;
  exposureText: string;
  /** The other exposure, so both fields stay visible in the log. Null when not logged. */
  otherExposure: ExposureKind;
  otherExposureWord: string;
  otherExposureText: string | null;
  statusText: string;
  statusTone: 'logged' | 'partial' | 'missing' | 'unreadable';
  editable: boolean;
  synced: boolean;
  phaseLabel: 'Test day' | 'Getting to know you';
}

export interface JournalChartBar {
  date: string;
  shortLabel: string;
  sleepMinutes: number | null;
  heightFraction: number;
  accessibleSummary: string;
}

export interface JournalViewModel {
  today: string;
  yesterday: string;
  medicalNotice: 'This app is not medical advice.';
  summary: {
    totalTimelineDays: number;
    loggedDays: number;
    partialDays: number;
    missingDays: number;
    averageSleepMinutes: number | null;
  };
  chart: {
    bars: JournalChartBar[];
    maxScaleMinutes: number;
    accessibleOverview: string;
  };
  days: JournalDayItem[];
}

export interface JournalInputs {
  entries: readonly DashboardEntry[];
  today: string;
  setup: ExperimentSetupRecord | null;
  plan: StoredExperimentPlan | null;
  /** Optional full plan history so archived completed plans stay locked in the journal. */
  plans?: readonly StoredExperimentPlan[];
  maxTimelineDays?: number;
}

export function formatSleepDuration(sleepMinutes: number | null): string {
  if (sleepMinutes === null) return 'Not logged';
  const h = Math.floor(sleepMinutes / 60);
  const m = sleepMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function formatExposureDisplay(
  raw: string | 'none' | null,
  exposure: ExposureKind,
): { text: string; unreadable: boolean } {
  const isScreens = exposure === 'screens';
  const parsed = readCaffeineTime(raw);
  if (parsed.kind === 'none') {
    return { text: isScreens ? 'No screens' : 'No caffeine', unreadable: false };
  }
  if (parsed.kind === 'valid' && parsed.time) {
    return {
      text: isScreens ? `Last screen ${parsed.time}` : `Last caffeine ${parsed.time}`,
      unreadable: false,
    };
  }
  if (parsed.kind === 'unreadable') {
    return { text: CAFFEINE_TIME_UNREADABLE_MARKER, unreadable: true };
  }
  return { text: 'Not logged', unreadable: false };
}

/**
 * Pure builder for the Journal screen.
 *
 * Rules:
 * - Missing values remain null and are explicitly shown as Missing / Not logged (never zero).
 * - Shows a dated timeline up through yesterday (the current morning check-in date),
 *   so missing or partially logged days in the range are visible.
 * - Never exposes future experiment assignments or interim condition comparisons.
 */
export function getJournalViewModel(inputs: JournalInputs): JournalViewModel {
  const { entries, today, setup, plan, plans = [], maxTimelineDays = 60 } = inputs;
  const yesterday = getMorningEntryDate(today);
  // The journal reads the same test the rest of the app is running: the active plan owns it
  // while one exists, otherwise the setup row does.
  const experiment = plan
    ? experimentForRuleType(plan.plan.definition.conditionRule.type)
    : experimentById(setup?.experimentId);
  const exposure = exposureForExperimentId(experiment.id);
  const otherExposure: ExposureKind = exposure === 'screens' ? 'caffeine' : 'screens';

  const byDate = new Map<string, DashboardEntry>();
  for (const entry of entries) {
    if (entry.date <= yesterday) {
      byDate.set(entry.date, entry);
    }
  }

  const allPlans = [...(plan ? [plan] : []), ...plans];
  const scheduleDates = new Set<string>();
  for (const item of allPlans) {
    if (item && item.status !== 'cancelled') {
      for (const s of item.plan.schedule) {
        scheduleDates.add(s.date);
      }
    }
  }

  // Determine earliest date to include in the continuous dated list
  const candidateStarts: string[] = [];
  if (setup?.runInStartDate && setup.runInStartDate <= yesterday) {
    candidateStarts.push(setup.runInStartDate);
  }
  for (const key of byDate.keys()) {
    candidateStarts.push(key);
  }
  if (plan?.plan.startDate && plan.plan.startDate <= yesterday) {
    candidateStarts.push(plan.plan.startDate);
  }

  // Default to showing at least the last 7 days if no earlier start exists
  const defaultStart = addDaysToLocalDate(yesterday, -6);
  const earliestRaw =
    candidateStarts.length > 0
      ? candidateStarts.reduce((min, d) => (d < min ? d : min), candidateStarts[0])
      : defaultStart;

  const spanDays = Math.min(Math.max(daysBetween(earliestRaw, yesterday) + 1, 1), maxTimelineDays);
  const startDate = addDaysToLocalDate(yesterday, -(spanDays - 1));

  const daysDesc: JournalDayItem[] = [];
  let loggedDays = 0;
  let partialDays = 0;
  let missingDays = 0;
  let sleepSum = 0;
  let sleepCount = 0;

  for (let offset = 0; offset < spanDays; offset++) {
    const date = addDaysToLocalDate( yesterday, -offset );
    const entry = byDate.get(date);
    const sleepMinutes = entry?.sleepMinutes ?? null;
    const storedExposure = exposureValue(entry, exposure);
    const otherStoredExposure = exposureValue(entry, otherExposure);
    const synced = entry ? entry.synced !== false : true;
    const syncSuffix = synced ? '' : ' (not synced yet)';
    const sleepText = formatSleepDuration(sleepMinutes);
    const exposureInfo = formatExposureDisplay(storedExposure, exposure);
    const otherExposureInfo = formatExposureDisplay(otherStoredExposure, otherExposure);

    let statusText: string;
    let statusTone: JournalDayItem['statusTone'];

    if (exposureInfo.unreadable) {
      const base = sleepMinutes !== null ? 'Partly logged' : 'Missing';
      statusText = `${base}${syncSuffix} — ${CAFFEINE_TIME_UNREADABLE_MARKER}`;
      statusTone = 'unreadable';
      if (sleepMinutes !== null) partialDays++;
      else missingDays++;
    } else if (sleepMinutes !== null && storedExposure !== null) {
      statusText = `Logged${syncSuffix}`;
      statusTone = 'logged';
      loggedDays++;
    } else if (sleepMinutes !== null || storedExposure !== null) {
      statusText = `Partly logged${syncSuffix}`;
      statusTone = 'partial';
      partialDays++;
    } else {
      statusText = `Missing${syncSuffix}`;
      statusTone = 'missing';
      missingDays++;
    }

    if (sleepMinutes !== null) {
      sleepSum += sleepMinutes;
      sleepCount++;
    }

    daysDesc.push({
      date,
      sleepMinutes,
      sleepText,
      exposure,
      exposureWord: experiment.exposureWord,
      exposureValue: storedExposure,
      exposureText: exposureInfo.text,
      otherExposure,
      otherExposureWord: otherExposure === 'screens' ? 'screens' : 'caffeine',
      // Only shown when the other field holds a value: an empty one is not this test's job.
      otherExposureText:
        otherStoredExposure === null ? null : otherExposureInfo.text,
      statusText,
      statusTone,
      editable: canEditDate(today, date, allPlans),
      synced,
      phaseLabel: scheduleDates.has(date) ? 'Test day' : 'Getting to know you',
    });
  }

  // Build simple sleep-duration chart for up to 14 most recent days (chronological left-to-right)
  const chartSource = daysDesc.slice(0, Math.min(14, daysDesc.length)).reverse();
  const maxObserved = chartSource.reduce(
    (max, d) => (d.sleepMinutes !== null && d.sleepMinutes > max ? d.sleepMinutes : max),
    0
  );
  const maxScaleMinutes = Math.max(600, maxObserved);

  const bars: JournalChartBar[] = chartSource.map(d => {
    const heightFraction =
      d.sleepMinutes !== null
        ? Math.min(1, Math.max(0.08, d.sleepMinutes / maxScaleMinutes))
        : 0;
    const accessibleSummary =
      d.sleepMinutes !== null
        ? `${d.date}: ${d.sleepText} sleep, ${d.exposureText}`
        : `${d.date}: sleep not logged, ${d.exposureText}`;
    return {
      date: d.date,
      shortLabel: d.date.slice(5),
      sleepMinutes: d.sleepMinutes,
      heightFraction,
      accessibleSummary,
    };
  });

  const averageSleepMinutes = sleepCount > 0 ? Math.round(sleepSum / sleepCount) : null;
  const chartLoggedCount = bars.filter(b => b.sleepMinutes !== null).length;
  const accessibleOverview =
    chartLoggedCount > 0 && averageSleepMinutes !== null
      ? `Sleep duration over the last ${bars.length} days (${startDate <= bars[0].date ? bars[0].date : startDate} to ${yesterday}): ${chartLoggedCount} of ${bars.length} nights logged, overall average ${formatSleepDuration(averageSleepMinutes)}.`
      : `Sleep duration over the last ${bars.length} days: no sleep nights logged yet.`;

  return {
    today,
    yesterday,
    medicalNotice: 'This app is not medical advice.',
    summary: {
      totalTimelineDays: daysDesc.length,
      loggedDays,
      partialDays,
      missingDays,
      averageSleepMinutes,
    },
    chart: {
      bars,
      maxScaleMinutes,
      accessibleOverview,
    },
    days: daysDesc,
  };
}
