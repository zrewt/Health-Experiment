/**
 * The value a user gets before their result exists.
 *
 * Three small, honest readings of their own log: the range their run-in nights cover, a
 * receipt for the night just logged, and a weekly line during the run-in. Nothing here
 * compares cutoff days with normal days, averages test-day sleep, or estimates anything.
 * The only test-day figures used anywhere are counts, the exact duration the user entered
 * for the night just logged, and the time they entered for that night.
 */

import type { DailyEntry } from './types';
import type { ExposureKind } from './experiments';
import { exposureValue } from './experiments';
import { readCaffeineTime } from './caffeine-time';
import { addDaysToLocalDate } from './dates';

/** Shown on every receipt, so the card can never be read as the result. */
export const NOT_YOUR_RESULT = 'Your own numbers, not your result.';

/** Why the test's days come in pairs, kept beside the pair counts. */
export const PAIRS_EXPLANATION = 'Days come in pairs, picked at random, so the two kinds of day stay balanced.';

/** A range needs three nights before it can say anything true. */
export const RANGE_MIN_NIGHTS = 3;

/** A weekday claim needs four nights of that weekday, before and after a result. */
export const WEEKDAY_MIN_NIGHTS = 4;

/** Rounds to the nearest five minutes, the app's everyday unit below an hour. */
export function roundToFive(minutes: number): number {
  return Math.round(minutes / 5) * 5;
}

/** Whole hours and minutes in words: "7 hours 30 minutes", "8 hours", "1 hour 5 minutes". */
export function formatHoursMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} ${rest === 1 ? 'minute' : 'minutes'}`;
  const hourText = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  if (rest === 0) return hourText;
  return `${hourText} ${rest} ${rest === 1 ? 'minute' : 'minutes'}`;
}

export interface RunInRange {
  nights: number;
  lowMinutes: number;
  highMinutes: number;
  /** One sentence: the user's own range and why one night cannot answer the question. */
  sentence: string;
}

/**
 * The user's own range, from the run-in nights only.
 *
 * The caller passes the run-in window (see entriesForRunIn), so test days can never reach
 * this card. Returns null below three nights: two nights are not a range.
 */
export function buildRunInRange(runInEntries: readonly DailyEntry[]): RunInRange | null {
  const values = runInEntries
    .filter(entry => entry.sleepMinutes !== null)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14)
    .map(entry => roundToFive(entry.sleepMinutes as number));

  if (values.length < RANGE_MIN_NIGHTS) return null;

  const lowMinutes = Math.min(...values);
  const highMinutes = Math.max(...values);
  return {
    nights: values.length,
    lowMinutes,
    highMinutes,
    sentence: `Your nights so far run from ${formatHoursMinutes(lowMinutes)} to ${formatHoursMinutes(highMinutes)}, which is why one night cannot answer the question.`,
  };
}

export interface ReceiptCounts {
  nightsLogged: number;
  nightsSoFar: number;
  /** Null during the run-in, where no rule applies. */
  cutoffDaysKept: number | null;
  cutoffDaysSoFar: number | null;
}

export interface CheckInReceipt {
  date: string;
  /** The duration exactly as stored, never rounded away from what the user entered. */
  sleepMinutes: number;
  sleepText: string;
  /** The time the user entered for that night, in their test's own wording. */
  timingText: string;
  counts: ReceiptCounts;
  countsText: string;
  footer: string;
}

function timingTextFor(entry: DailyEntry, exposure: ExposureKind): string {
  const read = readCaffeineTime(exposureValue(entry, exposure));
  const screens = exposure === 'screens';
  if (read.kind === 'none') return screens ? 'No screens that evening.' : 'No caffeine that day.';
  if (read.kind === 'valid' && read.time) {
    return screens ? `Last screen ${read.time}.` : `Last caffeine ${read.time}.`;
  }
  return screens ? 'Screen time not logged.' : 'Caffeine time not logged.';
}

function keptCutoffDay(entry: DailyEntry | undefined, exposure: ExposureKind, cutoffTime: string): boolean {
  if (!entry) return false;
  const read = readCaffeineTime(exposureValue(entry, exposure));
  if (read.kind === 'none') return true;
  if (read.kind !== 'valid' || !read.time) return false;
  const [hour, minute] = cutoffTime.split(':').map(Number);
  const [lastHour, lastMinute] = read.time.split(':').map(Number);
  return lastHour * 60 + lastMinute <= hour * 60 + minute;
}

export interface CheckInReceiptInput {
  /** The night just logged. */
  entry: DailyEntry;
  /** The whole log, used only to count nights inside the window. */
  entries: readonly DailyEntry[];
  /** Dates that count as "nights so far": run-in dates, or test dates up to today. */
  windowDates: readonly string[];
  /** Cutoff dates among those dates; omit or pass null during the run-in. */
  cutoffDates?: readonly string[] | null;
  exposure: ExposureKind;
  cutoffTime: string | null;
}

/**
 * The receipt Home shows after a check-in. It repeats only what the user entered for that
 * night and two plain counts, so it is safe while a test is running.
 */
export function buildCheckInReceipt(input: CheckInReceiptInput): CheckInReceipt {
  const { entry, entries, windowDates, cutoffDates, exposure, cutoffTime } = input;
  const byDate = new Map(entries.map(item => [item.date, item]));
  const nightsLogged = windowDates.filter(date => (byDate.get(date)?.sleepMinutes ?? null) !== null).length;

  let cutoffDaysKept: number | null = null;
  let cutoffDaysSoFar: number | null = null;
  if (cutoffDates && cutoffDates.length > 0 && cutoffTime) {
    cutoffDaysSoFar = cutoffDates.length;
    cutoffDaysKept = cutoffDates.filter(date => keptCutoffDay(byDate.get(date), exposure, cutoffTime)).length;
  }

  const countsText =
    cutoffDaysKept !== null && cutoffDaysSoFar !== null
      ? `You logged ${nightsLogged} of ${windowDates.length} nights so far. You kept the rule on ${cutoffDaysKept} of ${cutoffDaysSoFar} cutoff days.`
      : `You logged ${nightsLogged} of ${windowDates.length} nights so far.`;

  return {
    date: entry.date,
    sleepMinutes: entry.sleepMinutes as number,
    sleepText: formatHoursMinutes(entry.sleepMinutes as number),
    timingText: timingTextFor(entry, exposure),
    counts: { nightsLogged, nightsSoFar: windowDates.length, cutoffDaysKept, cutoffDaysSoFar },
    countsText,
    footer: NOT_YOUR_RESULT,
  };
}

export interface RunInRecap {
  nights: number;
  usualMinutes: number;
  sentence: string;
}

/**
 * The weekly recap, run-in only: how many nights were logged and what "usual" is for the
 * user. Test days are never passed here, so this cannot become an interim average.
 */
export function buildRunInRecap(runInEntries: readonly DailyEntry[], today: string): RunInRecap | null {
  const first = addDaysToLocalDate(today, -7);
  const last = addDaysToLocalDate(today, -1);
  const values = runInEntries
    .filter(entry => entry.date >= first && entry.date <= last && entry.sleepMinutes !== null)
    .map(entry => entry.sleepMinutes as number);

  if (values.length === 0) return null;

  const usualMinutes = roundToFive(values.reduce((sum, value) => sum + value, 0) / values.length);
  const nights = values.length;
  return {
    nights,
    usualMinutes,
    sentence: `You logged ${nights} ${nights === 1 ? 'night' : 'nights'} this week and your usual is about ${formatHoursMinutes(usualMinutes)}.`,
  };
}
