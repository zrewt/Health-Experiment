/**
 * Pure dev fixtures: the rows the dev tools write, built without a server, React or a clock.
 *
 * Kept separate from the loader so the fixtures can be tested directly. Both tests get
 * their own exposure column; writing caffeine times for a screens plan would leave every
 * day UNKNOWN to the engine and make the fixture prove nothing.
 */

import { addDaysToLocalDate } from '../experiment/dates';
import type { ExposureKind } from '../experiment/experiments';

/** One fixture row, shaped exactly like the `experiment_entries` columns it upserts. */
export interface SampleEntryRow {
  user_id: string;
  date: string;
  sleep_minutes: number;
  /** Only the test being prepared gets its exposure column; the other is left untouched. */
  last_caffeine_time?: string;
  last_screen_time?: string;
  edited_at: string;
  is_sample: boolean;
}

/** Sleep minutes for the run-in fixture: mean ~443, SD ~31m. */
export const RUN_IN_SLEEP = [
  430, 475, 410, 485, 440, 400, 470,
  425, 460, 415, 490, 435, 405, 465,
];

/** Eight of fourteen are after the 12:00 default caffeine cutoff. */
export const RUN_IN_CAFFEINE = [
  '14:30', '15:00', '11:00', '16:00', 'none', '14:00', '15:30',
  'none', '13:30', '11:30', '16:30', 'none', '14:00', '15:00',
];

/** Nine of fourteen are after the 21:30 default screens cutoff; the rest are earlier or 'none'. */
export const RUN_IN_SCREENS = [
  '22:15', '23:00', '21:00', '22:40', 'none', '22:10', '23:15',
  'none', '22:30', '21:20', '23:05', 'none', '22:00', '22:50',
];

/**
 * The 14 run-in nights ending yesterday, as rows ready to upsert. Dated from `today` so a
 * fixture never claims a night that has not happened yet.
 */
export function buildSampleRunInRows(
  userId: string,
  today: string,
  exposure: ExposureKind = 'caffeine',
  editedAt: string = new Date().toISOString(),
): SampleEntryRow[] {
  return RUN_IN_SLEEP.map((sleep, index) => ({
    user_id: userId,
    date: addDaysToLocalDate(today, index - 14),
    sleep_minutes: sleep,
    ...(exposure === 'screens'
      ? { last_screen_time: RUN_IN_SCREENS[index] }
      : { last_caffeine_time: RUN_IN_CAFFEINE[index] }),
    edited_at: editedAt,
    is_sample: true,
  }));
}

/** The shape of a stored plan the fixtures need; keeps this module free of store imports. */
export interface SamplePlanShape {
  schedule: { date: string; condition: string }[];
  definition?: { conditionRule?: { type?: string } };
}

/** True when the plan under test is the screens-off one. */
export function isScreenPlan(plan: SamplePlanShape): boolean {
  return plan.definition?.conditionRule?.type === 'screen-cutoff';
}

/**
 * Deterministic sample entries for a whole plan, one per scheduled day: a 25-minute sleep
 * gain on kept cutoff days, plus a fixed repeating wobble, and one missed cutoff every
 * seventh day so adherence counts show both answers.
 */
export function buildSamplePlanRows(
  userId: string,
  plan: SamplePlanShape,
  editedAt: string = new Date().toISOString(),
): SampleEntryRow[] {
  const offsetPattern = [-15, 0, 10, -5, 20, 5, -10];
  const screens = isScreenPlan(plan);
  return plan.schedule.map((day, idx) => {
    const isIntervention = day.condition === 'intervention';
    const offset = offsetPattern[idx % offsetPattern.length];
    const sleep = 420 + (isIntervention ? 25 : 0) + offset;
    return {
      user_id: userId,
      date: day.date,
      sleep_minutes: sleep,
      ...(screens
        ? { last_screen_time: isIntervention ? (idx % 7 === 6 ? '22:30' : '21:00') : '22:15' }
        : { last_caffeine_time: isIntervention ? (idx % 7 === 6 ? '15:00' : '11:30') : '15:30' }),
      edited_at: editedAt,
      is_sample: true,
    };
  });
}
