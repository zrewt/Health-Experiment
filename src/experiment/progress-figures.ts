/**
 * Progress figures that count what the user controls, not the calendar.
 *
 * "Day 12 of 42" is a clock. This module turns the same schedule and log into kept
 * cutoff days, completed pairs, the longest run, and how early the user stops relative
 * to their own cutoff. Every number is descriptive and recomputed from the log; nothing
 * compares sleep on cutoff days with sleep on normal days, so nothing here can leak an
 * interim result.
 */

import type { DailyEntry } from './types';
import type { ScheduledDay } from '../engine';
import type { ExposureKind } from './experiments';
import { exposureValue } from './experiments';
import { timeMinutes } from '../engine';
import { readCaffeineTime } from './caffeine-time';

export interface ProgressFigures {
  /** Cutoff days on the whole schedule. */
  cutoffDaysPlanned: number;
  /** Cutoff days that have happened and were kept. */
  cutoffDaysKept: number;
  /** Every scheduled day that has happened. */
  daysElapsed: number;
  /** Unique day-pairs on the schedule. */
  pairsPlanned: number;
  /** Pairs whose every day is fully logged (sleep and that day's exposure). */
  pairsDone: number;
  /** Longest run of kept cutoff days, with missed or unlogged cutoff days breaking it. */
  bestRun: number;
  /** The run the user is on right now. */
  currentRun: number;
  /** Mean minutes before the cutoff on kept cutoff days with a readable time. */
  bufferAverageMinutes: number | null;
  /** Recent buffer minus the buffer before it. Positive means stopping earlier. */
  bufferTrendMinutes: number | null;
}

/** Exposure time in minutes, 'none' for an explicit none, or null when unknown. */
function exposureMinutes(entry: DailyEntry | undefined, exposure: ExposureKind): number | 'none' | null {
  if (!entry) return null;
  const reading = readCaffeineTime(exposureValue(entry, exposure));
  if (reading.kind === 'none') return 'none';
  if (reading.kind === 'valid' && reading.time) return timeMinutes(reading.time);
  return null;
}

/** A day counts as logged only when both the night and its exposure are there. */
function isFullyLogged(entry: DailyEntry | undefined, exposure: ExposureKind): boolean {
  if (!entry || entry.sleepMinutes === null) return false;
  return exposureMinutes(entry, exposure) !== null;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Builds the figures for one plan. Pass the schedule and the full log: days outside the
 * schedule are ignored by date, so run-in nights never inflate a test's kept-day count.
 */
export function getProgressFigures(
  schedule: readonly ScheduledDay[],
  entries: readonly DailyEntry[],
  cutoffTime: string,
  exposure: ExposureKind,
  today: string,
): ProgressFigures {
  const cutoff = timeMinutes(cutoffTime);
  const byDate = new Map(entries.map(entry => [entry.date, entry]));

  const cutoffDays = schedule.filter(day => day.condition === 'intervention');
  const elapsed = schedule.filter(day => day.date <= today);

  let cutoffDaysKept = 0;
  let bestRun = 0;
  let run = 0;

  const buffers: { date: string; minutes: number }[] = [];

  // Schedule order is date order, so the run reads forward in time.
  for (const day of cutoffDays) {
    if (day.date > today) break;
    const entry = byDate.get(day.date);
    const minutes = exposureMinutes(entry, exposure);
    const kept = minutes === 'none' || (typeof minutes === 'number' && minutes <= cutoff);
    if (kept) {
      cutoffDaysKept++;
      run++;
      bestRun = Math.max(bestRun, run);
      if (typeof minutes === 'number') buffers.push({ date: day.date, minutes: cutoff - minutes });
    } else {
      run = 0;
    }
  }

  const blockOf = (day: ScheduledDay, index: number): number =>
    typeof day.blockIndex === 'number' ? day.blockIndex : Math.floor(index / 2);
  const pairs = new Map<number, { dates: string[]; done: boolean }>();
  schedule.forEach((day, index) => {
    const key = blockOf(day, index);
    const pair = pairs.get(key) ?? { dates: [], done: true };
    pair.dates.push(day.date);
    if (day.date <= today && !isFullyLogged(byDate.get(day.date), exposure)) pair.done = false;
    pairs.set(key, pair);
  });

  let pairsDone = 0;
  for (const pair of pairs.values()) {
    // A pair only counts once both of its days have happened and both are logged.
    if (pair.done && pair.dates.every(date => date <= today)) pairsDone++;
  }

  const recentBuffers = buffers.slice(-7).map(item => item.minutes);
  const previousBuffers = buffers.slice(-14, -7).map(item => item.minutes);
  const recentAverage = average(recentBuffers);
  const previousAverage = average(previousBuffers);

  return {
    cutoffDaysPlanned: cutoffDays.length,
    cutoffDaysKept,
    daysElapsed: elapsed.length,
    pairsPlanned: pairs.size,
    pairsDone,
    bestRun,
    currentRun: run,
    bufferAverageMinutes: recentAverage === null ? null : Math.round(recentAverage),
    bufferTrendMinutes:
      recentAverage !== null && previousAverage !== null
        ? Math.round(recentAverage - previousAverage)
        : null,
  };
}
