import type { HomeState } from '../experiment/home-state';
import type { ConditionRuleConfig } from '../engine';
import { addDaysToLocalDate } from '../experiment/dates';

/**
 * Marker written into the notification payload so the app can recognise the reminders it
 * scheduled and nothing else. Requests in the OS queue without this marker are left alone.
 */
export const DAILY_REMINDER_DATA_KEY = 'aevum-daily-checkin';

/** Local wall-clock time of the daily check-in reminder. */
export const DEFAULT_REMINDER_TIME = '08:00';

/** Local wall-clock time of the evening heads-up before an assigned day. */
export const EVENING_PREVIEW_TIME = '21:00';

/** How long before the assigned moment the "last call" nudge fires. */
export const CUTOFF_LEAD_MINUTES = 15;

/**
 * How many days ahead day-specific reminders are scheduled.
 *
 * These are one-shot dated notifications rather than a repeating trigger, because what is
 * worth saying depends on whether tomorrow is an assigned or a usual-routine day. Each app
 * open rolls the window forward; the repeating reminder below covers the gaps.
 */
export const REMINDER_WINDOW_DAYS = 14;

/** Hard ceiling per calendar day, so no state can ever turn into a stream of nudges. */
export const MAX_REMINDERS_PER_DAY = 3;

/** Safety ceiling for the whole queue; well under the OS pending-notification limits. */
export const MAX_SCHEDULED_REMINDERS = 60;

/** Minimal view of a scheduled request, so the pure logic never imports native code. */
export interface ScheduledRequestLike {
  identifier: string;
  content?: { data?: unknown } | null;
}

/**
 * Strict 24-hour HH:mm: two-digit hour and minute, no seconds, no padding of single digits.
 * Deliberately separate from the caffeine-time validator, which additionally accepts the
 * literal 'none' and must stay free to diverge from a clock time.
 */
export function parseReminderTime(value: string): { hour: number; minute: number } | null {
  const match = /^([0-9]{2}):([0-9]{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Resolve a stored or default time, falling back to the default when the value is unusable. */
export function resolveReminderTime(value: string | null | undefined): { hour: number; minute: number } | null {
  return parseReminderTime(value ?? '') ?? parseReminderTime(DEFAULT_REMINDER_TIME);
}

/**
 * States in which the user is expected to log something every day.
 *
 * `feasibility_ready` is deliberately excluded: that state asks for a one-off decision
 * (choose a duration and start), not a daily habit, and nagging about it is not the job
 * of a check-in reminder.
 */
export const DAILY_CHECKIN_STATES: readonly HomeState[] = [
  'run_in',
  'plan_scheduled',
  'plan_active',
  'plan_awaiting_final',
];

export function needsDailyCheckIn(state: HomeState): boolean {
  return DAILY_CHECKIN_STATES.includes(state);
}

export type ReminderSlot = 'morning-check-in' | 'before-cutoff' | 'next-day-preview';

export type ReminderTrigger =
  /** Repeats every day at a fixed local time; survives an app that is never reopened. */
  | { kind: 'daily'; hour: number; minute: number }
  /** Fires once, on one local date. Used where the content depends on that specific day. */
  | { kind: 'date'; date: string; hour: number; minute: number };

export interface ReminderSpec {
  slot: ReminderSlot;
  trigger: ReminderTrigger;
  title: string;
  body: string;
}

/** A day of the stored schedule; structural so `ScheduledDay[]` is assignable. */
export interface ReminderScheduleDay {
  date: string;
  condition: string;
}

/** The parts of a stored plan the reminder layer needs, and nothing else. */
export interface ReminderPlanContext {
  startDate: string;
  chosenDuration: number;
  schedule: readonly ReminderScheduleDay[];
  conditionRule: ConditionRuleConfig | null | undefined;
}

export interface ReminderScheduleInput {
  state: HomeState;
  /** Local calendar date from the app clock (which dev tools can shift). */
  today: string;
  plan?: ReminderPlanContext | null;
  /** Stored preference as 'HH:mm'. An unusable value falls back to the default time. */
  reminderTime?: string | null;
  /** Minutes past local midnight; when supplied, reminders whose moment has passed are skipped. */
  nowMinutes?: number | null;
  windowDays?: number;
}

/**
 * What the assigned condition asks of the user, in the one place that maps a rule type to
 * copy. Returns null for anything unrecognised, which is the whole point: a rule this
 * build does not understand degrades to the generic reminder rather than announcing a
 * rule it cannot actually describe. A new experiment type needs one more case here.
 */
export interface ConditionAction {
  cutoff: { hour: number; minute: number };
  leadMinutes: number;
  /** Said on an assigned day, just before the moment it applies. */
  title: string;
  body: string;
  /** Said the evening before, while planning ahead is still possible. */
  previewTitle: string;
  previewBody: string;
}

export function conditionAction(rule: ConditionRuleConfig | null | undefined): ConditionAction | null {
  if (!rule || typeof rule !== 'object') return null;
  if ((rule as { type?: unknown }).type !== 'caffeine-cutoff') return null;

  const cutoffTime = (rule as { cutoffTime?: unknown }).cutoffTime;
  if (typeof cutoffTime !== 'string') return null;
  const cutoff = parseReminderTime(cutoffTime);
  if (!cutoff) return null;

  return {
    cutoff,
    leadMinutes: CUTOFF_LEAD_MINUTES,
    title: 'Last call',
    body: `No caffeine after ${cutoffTime} today.`,
    previewTitle: 'Heads up for tomorrow',
    previewBody: `Tomorrow: no caffeine after ${cutoffTime}. Plan ahead.`,
  };
}

/** Move a wall-clock time back by some minutes, or null if that would cross midnight. */
function subtractMinutes(
  time: { hour: number; minute: number },
  minutes: number,
): { hour: number; minute: number } | null {
  const total = time.hour * 60 + time.minute - minutes;
  if (total < 0) return null;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

function orderKey(spec: ReminderSpec): string {
  const time = `${String(spec.trigger.hour).padStart(2, '0')}:${String(spec.trigger.minute).padStart(2, '0')}`;
  return spec.trigger.kind === 'date' ? `${spec.trigger.date}T${time}` : `0000-00-00T${time}`;
}

/**
 * Trim the queue so no day carries more than MAX_REMINDERS_PER_DAY. The repeating
 * reminder is never counted or dropped: it is the one that keeps working when the app
 * has not been opened, so it must survive any cap.
 */
export function applyDailyCap(specs: readonly ReminderSpec[]): ReminderSpec[] {
  const perDay = new Map<string, number>();
  const kept: ReminderSpec[] = [];
  for (const spec of [...specs].sort((a, b) => orderKey(a).localeCompare(orderKey(b)))) {
    if (spec.trigger.kind === 'daily') {
      kept.push(spec);
      continue;
    }
    const count = perDay.get(spec.trigger.date) ?? 0;
    if (count >= MAX_REMINDERS_PER_DAY) continue;
    perDay.set(spec.trigger.date, count + 1);
    kept.push(spec);
  }
  return kept;
}

function morningReminder(
  state: HomeState,
  plan: ReminderPlanContext | null,
  time: { hour: number; minute: number },
): ReminderSpec {
  const title = state === 'plan_awaiting_final' ? 'Final check-in' : 'Sleep check-in';

  const body = state === 'run_in'
    ? 'Log how long you slept to keep your run-in going.'
    : state === 'plan_scheduled'
      ? (plan?.startDate
        ? `Your experiment starts on ${plan.startDate}. Keep logging your sleep until then.`
        : 'Your experiment has not started yet. Keep logging your sleep.')
      : state === 'plan_awaiting_final'
        ? 'Your experiment is over. Log your final day to see your result.'
        // Day-agnostic on purpose: this one repeats, so it cannot know which rule today has.
        : 'See the instruction for today, then log how long you slept.';

  return { slot: 'morning-check-in', trigger: { kind: 'daily', ...time }, title, body };
}

function conditionReminders(
  plan: ReminderPlanContext,
  today: string,
  action: ConditionAction,
  windowDays: number,
  nowMinutes: number | null,
): ReminderSpec[] {
  const specs: ReminderSpec[] = [];

  const lead = subtractMinutes(action.cutoff, action.leadMinutes);
  // A cutoff within the lead time of midnight leaves no usable warning moment; skip rather
  // than fire at a nonsense hour.
  if (!lead) return specs;

  const evening = resolveReminderTime(EVENING_PREVIEW_TIME);
  if (!evening) return specs;

  const windowEnd = addDaysToLocalDate(today, windowDays);
  const eveningMinutes = evening.hour * 60 + evening.minute;
  const leadMinutes = lead.hour * 60 + lead.minute;

  for (const day of plan.schedule) {
    if (day.condition !== 'intervention') continue;
    // Outside the window it is not scheduled, and once the app is reopened the window rolls.
    if (day.date < today || day.date > windowEnd) continue;

    if (day.date > today || nowMinutes === null || leadMinutes > nowMinutes) {
      specs.push({
        slot: 'before-cutoff',
        trigger: { kind: 'date', date: day.date, ...lead },
        title: action.title,
        body: action.body,
      });
    }

    // The evening before is when a user can still act on tomorrow's assignment.
    const eveningBefore = addDaysToLocalDate(day.date, -1);
    if (eveningBefore < today) continue;
    if (eveningBefore === today && nowMinutes !== null && eveningMinutes <= nowMinutes) continue;
    specs.push({
      slot: 'next-day-preview',
      trigger: { kind: 'date', date: eveningBefore, ...evening },
      title: action.previewTitle,
      body: action.previewBody,
    });
  }

  return specs;
}

/**
 * The full reminder queue for a state: exactly one repeating morning reminder whenever a
 * daily log is expected, plus dated reminders on the days a rule actually applies.
 *
 * Nothing here is caffeine-specific except `conditionAction`, and an unrecognised rule
 * simply yields no day-specific reminders.
 */
export function buildReminderSchedule(input: ReminderScheduleInput): ReminderSpec[] {
  const { state, today, plan = null } = input;
  if (!needsDailyCheckIn(state)) return [];

  const time = resolveReminderTime(input.reminderTime);
  if (!time) return [];

  const specs: ReminderSpec[] = [morningReminder(state, plan, time)];

  if (state === 'plan_active' && plan) {
    const action = conditionAction(plan.conditionRule);
    if (action) {
      specs.push(...conditionReminders(
        plan,
        today,
        action,
        input.windowDays ?? REMINDER_WINDOW_DAYS,
        input.nowMinutes ?? null,
      ));
    }
  }

  return applyDailyCap(specs).slice(0, MAX_SCHEDULED_REMINDERS);
}

function isReminderRequest(request: ScheduledRequestLike): boolean {
  const data = request?.content?.data;
  if (!data || typeof data !== 'object') return false;
  return (data as Record<string, unknown>)[DAILY_REMINDER_DATA_KEY] === true;
}

/**
 * Identifiers of the reminders this app scheduled, so syncing can replace its own
 * reminders without disturbing any other scheduled notification.
 */
export function pickReminderIds(requests: readonly ScheduledRequestLike[]): string[] {
  return requests
    .filter((request) => typeof request?.identifier === 'string' && isReminderRequest(request))
    .map((request) => request.identifier);
}
