import type { DailyEntry } from './types';
import { addDaysToLocalDate } from './dates';

/**
 * Plain-language helpers for everyday screens.
 *
 * Everything here is descriptive: it counts what the user logged and reads it back
 * in ordinary words. Nothing compares conditions or hints at an interim result, so
 * these helpers are safe to show while a test is running.
 */

/** One-tap sleep amounts. Tapping one fills the hours and minutes fields. */
export const SLEEP_PRESETS: readonly { label: string; minutes: number }[] = [
  { label: '6 hours', minutes: 360 },
  { label: '7 hours', minutes: 420 },
  { label: '8 hours', minutes: 480 },
  { label: '9 hours', minutes: 540 },
];

/** One-tap caffeine times. Each fills the time picker; the user can still adjust it. */
export const CAFFEINE_PRESETS: readonly { label: string; time: string }[] = [
  { label: 'Morning', time: '09:00' },
  { label: 'Lunch', time: '12:30' },
  { label: 'Afternoon', time: '15:00' },
  { label: 'Evening', time: '19:00' },
];

/** One-tap last-screen-use times for the screens-off test. Each fills the time picker. */
export const SCREEN_PRESETS: readonly { label: string; time: string }[] = [
  { label: 'Early evening', time: '19:30' },
  { label: 'Evening', time: '21:00' },
  { label: 'Bedtime', time: '22:00' },
];

/** Total minutes from the two sleep inputs, or null when both are empty. */
export function sleepMinutesFromInputs(hours: string, minutes: string): number | null {
  if (hours.trim() === '' && minutes.trim() === '') return null;
  const h = Number(hours.trim()) || 0;
  const m = Number(minutes.trim()) || 0;
  return h * 60 + m;
}

/** Sleep in everyday words: "7 hours", "7½ hours", "7 h 20 min". */
export function formatSleepFriendly(minutes: number | null): string {
  if (minutes === null) return 'Not logged';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  if (rest === 30) return `${hours}½ hours`;
  return `${hours} h ${rest} min`;
}

export function nightsWord(count: number): string {
  return count === 1 ? 'night' : 'nights';
}

/** One dot per night in the run-in, filled for each night logged (capped at the target). */
export function progressDots(logged: number, target: number): boolean[] {
  const total = Math.max(0, Math.floor(target));
  const filled = Math.min(Math.max(0, Math.floor(logged)), total);
  return Array.from({ length: total }, (_, index) => index < filled);
}

/** The one sentence that says where the user is in the run-in. */
export function progressSentence(logged: number, target: number): string {
  const remaining = Math.max(0, target - logged);
  if (logged <= 0) return 'Log last night to start your first night.';
  if (remaining === 0) return 'Your nights are in. Nice work.';
  if (logged * 2 >= target) return `Halfway there. ${remaining} more ${nightsWord(remaining)} to go.`;
  return `Good start. ${remaining} more ${nightsWord(remaining)} to go.`;
}

export interface WeeklyRecap {
  daysLogged: number;
  averageSleepMinutes: number | null;
  sentence: string;
}

/**
 * A plain read-back of the last seven nights the user logged sleep for.
 * "Last seven" means the seven dates before today, since today's entry describes last night.
 */
export function weeklyRecap(entries: readonly DailyEntry[], today: string): WeeklyRecap {
  const first = addDaysToLocalDate(today, -7);
  const last = addDaysToLocalDate(today, -1);
  const sleepValues = entries
    .filter(e => e.date >= first && e.date <= last)
    .map(e => e.sleepMinutes)
    .filter((value): value is number => value !== null);

  const daysLogged = sleepValues.length;
  if (daysLogged === 0) {
    return { daysLogged: 0, averageSleepMinutes: null, sentence: 'No nights logged this week yet.' };
  }

  const total = sleepValues.reduce((sum, value) => sum + value, 0);
  const averageSleepMinutes = Math.round(total / daysLogged);
  return {
    daysLogged,
    averageSleepMinutes,
    sentence: `You logged ${daysLogged} ${nightsWord(daysLogged)} this week, and slept about ${formatSleepFriendly(averageSleepMinutes)} on average.`,
  };
}
