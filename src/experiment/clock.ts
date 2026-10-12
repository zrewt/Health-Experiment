import { addDaysToLocalDate, formatLocalDate } from './dates';

let devClockOffsetDays = 0;

/**
 * Returns today's local date as "YYYY-MM-DD".
 * In production: always returns real local calendar date.
 * In development (__DEV__ === true): can be shifted via dev clock tools.
 */
export function getToday(now: Date = new Date()): string {
  const isDev = (typeof __DEV__ !== 'undefined' ? Boolean(__DEV__) : process.env.NODE_ENV !== 'production');
  if (isDev && devClockOffsetDays !== 0) {
    const base = formatLocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
    return addDaysToLocalDate(base, devClockOffsetDays);
  }
  return formatLocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Dev-only clock manipulation helpers */
export function __setDevClockOffset(days: number): void {
  const isDev = (typeof __DEV__ !== 'undefined' ? Boolean(__DEV__) : process.env.NODE_ENV !== 'production');
  if (isDev) {
    devClockOffsetDays = days;
  }
}

export function __getDevClockOffset(): number {
  return devClockOffsetDays;
}
