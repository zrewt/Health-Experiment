/**
 * The Morning Mirror: one true, specific reading of the night the user just logged.
 *
 * It compares the night to the user's own recent nights — never to the other day type —
 * so it cannot become an interim result. The only other facts it adds are the timing of
 * that day's exposure against the user's own cutoff, and a behavior streak. No causal
 * claim, no estimate, no condition split.
 */

import type { DailyEntry } from './types';
import type { ScheduledDay } from '../engine';
import type { ExposureKind } from './experiments';
import { exposureValue } from './experiments';
import { readCaffeineTime } from './caffeine-time';
import { formatSleepFriendly } from './plain-language';
import { addDaysToLocalDate } from './dates';

export interface MorningMirror {
  /** The night being described (the entry's date, i.e. yesterday's date). */
  date: string;
  sleepMinutes: number;
  /** "7 h 12 min — 18 min above your usual." */
  headline: string;
  /** Signed minutes against the user's own average; null when there is no baseline yet. */
  deltaMinutes: number | null;
  comparison: 'above' | 'below' | 'about' | null;
  /** Two short lines: when the exposure ended, and a streak that counts behavior. */
  facts: string[];
  /** The user's own recent range, for the progress card. */
  range: { lowMinutes: number; highMinutes: number; nights: number } | null;
  /** Always false: this object is never a result, and the type says so. */
  isResult: false;
}

export interface MorningMirrorInput {
  entries: readonly DailyEntry[];
  today: string;
  exposure: ExposureKind;
  cutoffTime: string;
  /** Optional test schedule, used only to count kept cutoff days in a row. */
  schedule?: readonly ScheduledDay[];
}

const BASELINE_NIGHTS = 7;
const ABOUT_THRESHOLD_MINUTES = 5;

function minutesFromHHMM(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function streakOfLoggedNights(entries: readonly DailyEntry[], endingAt: string): number {
  const byDate = new Map(entries.filter(entry => entry.sleepMinutes !== null).map(entry => [entry.date, entry]));
  let streak = 0;
  let cursor = endingAt;
  while (byDate.has(cursor)) {
    streak++;
    cursor = addDaysToLocalDate(cursor, -1);
  }
  return streak;
}

function timingFact(entry: DailyEntry | undefined, exposure: ExposureKind, cutoffTime: string): string {
  const raw = exposureValue(entry, exposure);
  const reading = readCaffeineTime(raw);
  const screens = exposure === 'screens';
  const noun = screens ? 'screen' : 'caffeine';

  if (reading.kind === 'none') {
    return screens ? 'No screens that evening.' : 'No caffeine that day.';
  }
  if (reading.kind === 'unset') {
    return `Your last ${noun} time was not logged for that night.`;
  }
  if (reading.kind === 'unreadable' || !reading.time) {
    return `Your saved ${noun} time could not be read.`;
  }

  const cutoff = minutesFromHHMM(cutoffTime);
  const last = minutesFromHHMM(reading.time);
  const diff = cutoff - last;
  const label = screens ? 'last screen' : 'last caffeine';
  if (diff === 0) return `Your ${label} was right at the ${cutoffTime} cutoff.`;
  if (diff > 0) return `Your ${label} was at ${reading.time}, ${diff} min before the ${cutoffTime} cutoff.`;
  return `Your ${label} was at ${reading.time}, ${-diff} min after the ${cutoffTime} cutoff.`;
}

/**
 * Returns null until there is a logged night to describe. The most recent logged night is
 * used, so the card still works after a skipped day or a late check-in.
 */
export function getMorningMirror(input: MorningMirrorInput): MorningMirror | null {
  const { entries, today, exposure, cutoffTime } = input;

  const logged = entries
    .filter(entry => entry.sleepMinutes !== null && entry.date <= today)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (logged.length === 0) return null;

  const target = logged[logged.length - 1];
  const sleepMinutes = target.sleepMinutes as number;

  const baseline = logged
    .filter(entry => entry.date < target.date)
    .slice(-BASELINE_NIGHTS);
  const baselineAverage = baseline.length > 0
    ? Math.round(baseline.reduce((sum, entry) => sum + (entry.sleepMinutes as number), 0) / baseline.length)
    : null;

  const deltaMinutes = baselineAverage === null ? null : Math.round(sleepMinutes - baselineAverage);
  const comparison: MorningMirror['comparison'] =
    deltaMinutes === null ? null
      : Math.abs(deltaMinutes) <= ABOUT_THRESHOLD_MINUTES ? 'about'
      : deltaMinutes > 0 ? 'above' : 'below';

  let headline: string;
  if (deltaMinutes === null) {
    headline = `${formatSleepFriendly(sleepMinutes)} logged.`;
  } else if (comparison === 'about') {
    headline = `${formatSleepFriendly(sleepMinutes)} — about your usual.`;
  } else {
    headline = `${formatSleepFriendly(sleepMinutes)} — ${Math.abs(deltaMinutes)} min ${comparison} your usual.`;
  }

  const byDate = new Map(entries.map(entry => [entry.date, entry]));
  const facts: string[] = [timingFact(target, exposure, cutoffTime)];

  // Behavior streak: kept cutoff days first, then nights logged. Both are things the user
  // did, never how long they slept.
  const kept = input.schedule && input.schedule.length > 0
    ? keptDaysInARow(input.schedule, byDate, exposure, cutoffTime, target.date)
    : 0;
  const loggedStreak = streakOfLoggedNights(entries, target.date);

  if (kept >= 2) {
    facts.push(`That is ${kept} cutoff days kept in a row.`);
  } else if (loggedStreak >= 2) {
    facts.push(`That is ${loggedStreak} nights logged in a row.`);
  } else {
    const windowStart = addDaysToLocalDate(target.date, -6);
    const loggedInWindow = logged.filter(entry => entry.date >= windowStart && entry.date <= target.date).length;
    facts.push(`You have logged ${loggedInWindow} of the last 7 nights.`);
  }

  const recent = logged.slice(-14).map(entry => entry.sleepMinutes as number);
  const range = recent.length >= 3
    ? { lowMinutes: Math.min(...recent), highMinutes: Math.max(...recent), nights: recent.length }
    : null;

  return {
    date: target.date,
    sleepMinutes,
    headline,
    deltaMinutes,
    comparison,
    facts,
    range,
    isResult: false,
  };
}

/** Consecutive kept cutoff days ending at (or before) the target night. */
function keptDaysInARow(
  schedule: readonly ScheduledDay[],
  byDate: Map<string, DailyEntry>,
  exposure: ExposureKind,
  cutoffTime: string,
  endingAt: string,
): number {
  const cutoff = minutesFromHHMM(cutoffTime);
  const cutoffDays = schedule.filter(day => day.condition === 'intervention' && day.date <= endingAt);
  let streak = 0;
  for (let index = cutoffDays.length - 1; index >= 0; index--) {
    const entry = byDate.get(cutoffDays[index].date);
    if (!entry) break;
    const reading = readCaffeineTime(exposureValue(entry, exposure));
    const kept = reading.kind === 'none'
      || (reading.kind === 'valid' && reading.time !== null && minutesFromHHMM(reading.time) <= cutoff);
    if (!kept) break;
    streak++;
  }
  return streak;
}

