/**
 * Milestones: one true sentence about the user's own sleep or effort, unlocked by the
 * amount of log behind it. These are what make a long test feel alive before the result.
 *
 * Every claim needs a minimum amount of data, every claim is descriptive, and none of them
 * compares sleep on cutoff days with sleep on normal days. A milestone is never a result.
 */

import type { DailyEntry } from './types';
import type { ScheduledDay } from '../engine';
import type { ExposureKind } from './experiments';
import { formatSleepFriendly } from './plain-language';
import { addDaysToLocalDate, parseLocalDate } from './dates';
import { getProgressFigures } from './progress-figures';

export type MilestoneId =
  | 'range'
  | 'weekday'
  | 'best-run'
  | 'fortnight'
  | 'buffer'
  | 'consistency';

export interface Milestone {
  id: MilestoneId;
  title: string;
  body: string;
}

export interface MilestoneInput {
  entries: readonly DailyEntry[];
  today: string;
  exposure: ExposureKind;
  cutoffTime: string;
  schedule?: readonly ScheduledDay[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MIN_RANGE_NIGHTS = 3;
const MIN_WEEKDAY_NIGHTS = 6;
const MIN_WEEKDAY_DIFFERENCE = 20;

function weekdayOf(date: string): number {
  const { year, month, day } = parseLocalDate(date);
  return new Date(year, month - 1, day, 12, 0, 0, 0).getDay();
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanByWeekday(entries: readonly DailyEntry[]): Map<number, number[]> {
  const byWeekday = new Map<number, number[]>();
  for (const entry of entries) {
    if (entry.sleepMinutes === null) continue;
    const key = weekdayOf(entry.date);
    byWeekday.set(key, [...(byWeekday.get(key) ?? []), entry.sleepMinutes]);
  }
  return byWeekday;
}

/**
 * The weekday with the longest average, when it is at least 20 minutes longer than another
 * weekday that also has at least two logged nights. Needs six nights in total, so a single
 * unusual Saturday can never become a claim.
 */
function weekdayMilestone(entries: readonly DailyEntry[]): Milestone | null {
  if (entries.length < MIN_WEEKDAY_NIGHTS) return null;
  const byWeekday = meanByWeekday(entries);
  const eligible = [...byWeekday.entries()]
    .filter(([, nights]) => nights.length >= 2)
    .map(([weekday, nights]) => ({ weekday, average: average(nights) }));
  if (eligible.length < 2) return null;

  const longest = eligible.reduce((best, item) => (item.average > best.average ? item : best));
  const shortest = eligible.reduce((best, item) => (item.average < best.average ? item : best));
  const difference = Math.round(longest.average - shortest.average);
  if (difference < MIN_WEEKDAY_DIFFERENCE) return null;

  return {
    id: 'weekday',
    title: `${DAY_NAMES[longest.weekday]}s run about ${difference} min longer.`,
    body: 'That is a pattern in your own log. It is not a result.',
  };
}

/**
 * All unlocked milestones, oldest threshold first. Screens show the last one (the newest)
 * so a single card is enough; the result screen can list them.
 */
export function getMilestones(input: MilestoneInput): Milestone[] {
  const { entries, today, exposure, cutoffTime, schedule } = input;
  const logged = entries
    .filter(entry => entry.sleepMinutes !== null && entry.date <= today)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  // During a test, only its own days can support a claim: a previous test changed the
  // cutoff on half its days, so mixing those nights in would describe a different habit.
  // Without a schedule, the most recent three weeks are the honest window.
  const scheduleDates = new Set((schedule ?? []).map(day => day.date));
  const relevant = scheduleDates.size > 0
    ? logged.filter(entry => scheduleDates.has(entry.date))
    : logged.slice(-21);

  const milestones: Milestone[] = [];

  if (relevant.length >= MIN_RANGE_NIGHTS) {
    const recent = relevant.slice(-14);
    const values = recent.map(entry => entry.sleepMinutes as number);
    milestones.push({
      id: 'range',
      title: `Your nights run from ${formatSleepFriendly(Math.min(...values))} to ${formatSleepFriendly(Math.max(...values))}.`,
      body: 'That spread is why one night cannot answer the question.',
    });
  }

  const weekday = weekdayMilestone(relevant);
  if (weekday) milestones.push(weekday);

  const scheduleDays = schedule ?? [];
  const figures = scheduleDays.length > 0
    ? getProgressFigures(scheduleDays, entries, cutoffTime, exposure, today)
    : null;

  if (figures && figures.bestRun >= 2) {
    milestones.push({
      id: 'best-run',
      title: `Your best run: ${figures.bestRun} cutoff days kept.`,
      body: 'That is the longest run in this test so far.',
    });
  }

  if (relevant.length >= 14) {
    const windowStart = addDaysToLocalDate(today, -13);
    const recent = relevant.filter(entry => entry.date >= windowStart && entry.date <= today).length;
    milestones.push({
      id: 'fortnight',
      title: `${relevant.length} nights logged.`,
      body: `${recent} of the last 14 nights are in your log.`,
    });
  }

  if (figures && figures.bufferAverageMinutes !== null && figures.cutoffDaysKept >= 3) {
    milestones.push({
      id: 'buffer',
      title: `You stop ${figures.bufferAverageMinutes} min before the cutoff.`,
      body:
        figures.bufferTrendMinutes !== null && figures.bufferTrendMinutes >= 5
          ? `That is ${figures.bufferTrendMinutes} min earlier than the weeks before.`
          : 'That is the average on the cutoff days you kept.',
    });
  }

  if (relevant.length >= 21) {
    milestones.push({
      id: 'consistency',
      title: `${relevant.length} nights of your own sleep, all in one place.`,
      body: 'Keep logging to fill in the rest of the test.',
    });
  }

  return milestones;
}

/** The most recently unlocked milestone, or null before the first one. */
export function getLatestMilestone(input: MilestoneInput): Milestone | null {
  const all = getMilestones(input);
  return all.length > 0 ? all[all.length - 1] : null;
}

/**
 * The trailer shown in the second half of a test: what the report will contain, with no
 * numbers and no hint of the answer. Null before the midpoint and after the last day.
 */
export function getReportTrailer(dayNumber: number, totalDays: number): { title: string; body: string } | null {
  if (totalDays <= 0 || dayNumber <= 0 || dayNumber > totalDays) return null;
  const midpoint = Math.ceil(totalDays / 2);
  const nearEnd = totalDays - dayNumber <= 3;
  if (dayNumber < midpoint && !nearEnd) return null;
  return {
    title: 'What your report will show',
    body: 'Your sleep on cutoff days and normal days, how sure we can be, and what it cannot tell you.',
  };
}
