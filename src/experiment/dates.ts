/**
 * Pure local calendar date utilities.
 *
 * Rules:
 * - Dates are local calendar dates formatted as "YYYY-MM-DD".
 * - NEVER derive a date with toISOString() or UTC conversion.
 * - Month ends, leap years, and DST changeovers are preserved by noon-anchored local time math.
 */

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(dateStr: string): LocalDateParts {
  const match = DATE_REGEX.exec(dateStr);
  if (!match) {
    throw new Error(`Invalid local date format: expected YYYY-MM-DD, got "${dateStr}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Date out of calendar bounds: "${dateStr}"`);
  }
  return { year, month, day };
}

export function formatLocalDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Adds (or subtracts) a number of calendar days to a "YYYY-MM-DD" local date string.
 * Anchors the local Date at 12:00:00 (noon) so that 23-hour or 25-hour DST transitions
 * never cause date slippage.
 */
export function addDaysToLocalDate(dateStr: string, days: number): string {
  const { year, month, day } = parseLocalDate(dateStr);
  const date = new Date(year, month - 1, day + days, 12, 0, 0, 0);
  return formatLocalDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * Returns today's local date as "YYYY-MM-DD" using local clock components (no UTC).
 */
export function getLocalTodayDate(now: Date = new Date()): string {
  return formatLocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * ALIGNMENT CONVENTION (Engine contract):
 * In the engine, `DayRecord.date` is the exposure day, which pairs with the
 * following night's sleep outcome (see `src/engine/types.ts` line 31 and
 * `src/engine/analysis.ts` line 251: "Caffeine sleep outcome belongs to the night
 * following the exposure day").
 *
 * When a user completes their morning check-in on calendar date `today`, they are
 * reporting the sleep they just woke up from (the night of `today - 1` to `today`)
 * and yesterday's caffeine intake (exposure day `today - 1`).
 *
 * Therefore, the morning check-in writes to entry date `today - 1 day`.
 */
export function getMorningEntryDate(today: string): string {
  return addDaysToLocalDate(today, -1);
}

/**
 * Returns the signed difference in calendar days between two "YYYY-MM-DD" strings:
 * (laterDate - earlierDate).
 */
export function daysBetween(earlierDateStr: string, laterDateStr: string): number {
  const d1 = parseLocalDate(earlierDateStr);
  const d2 = parseLocalDate(laterDateStr);
  const dt1 = new Date(d1.year, d1.month - 1, d1.day, 12, 0, 0, 0);
  const dt2 = new Date(d2.year, d2.month - 1, d2.day, 12, 0, 0, 0);
  return Math.round((dt2.getTime() - dt1.getTime()) / (24 * 60 * 60 * 1000));
}

export type LockablePlan = {
  status: string;
  plan: { schedule: readonly { date: string }[] };
};

/**
 * Pure domain function determining whether an entry date can still be edited.
 *
 * Rule:
 * True ONLY for the current entry date (the date of the morning check-in on `today`)
 * and the previous 3 days. Older days are read-only. Future days cannot be edited.
 *
 * If any provided plan (single plan or history list) has status === 'completed', all
 * dates in that plan's schedule are locked and read-only (returns false), matching the
 * server-side `check_entry_edit_lock()` trigger across archived cycles.
 */
export function canEditDate(
  today: string,
  date: string,
  planOrPlans?: LockablePlan | readonly LockablePlan[] | null,
): boolean {
  if (planOrPlans) {
    const list: readonly LockablePlan[] = Array.isArray(planOrPlans)
      ? planOrPlans
      : [planOrPlans as LockablePlan];
    for (const item of list) {
      if (item && item.status === 'completed') {
        const inSchedule = item.plan.schedule.some(s => s.date === date);
        if (inSchedule) {
          return false;
        }
      }
    }
  }

  const currentEntryDate = getMorningEntryDate(today);
  const diff = daysBetween(date, currentEntryDate);
  // diff === 0: current entry date (yesterday)
  // diff === 1: 1 day prior
  // diff === 2: 2 days prior
  // diff === 3: 3 days prior
  return diff >= 0 && diff <= 3;
}
