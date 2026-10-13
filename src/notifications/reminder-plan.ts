import type { HomeState } from '../experiment/home-state';

/**
 * Marker written into the notification payload so the app can recognise the reminder it
 * scheduled and nothing else. Requests in the OS queue without this marker are left alone.
 */
export const DAILY_REMINDER_DATA_KEY = 'aevum-daily-checkin';

/** Local wall-clock time of the daily check-in reminder. */
export const DEFAULT_REMINDER_TIME = '08:00';

export interface ReminderPlan {
  hour: number;
  minute: number;
  title: string;
  body: string;
}

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

export interface ReminderStateInput {
  state: HomeState;
  /** First exposure day; used only to date the "not started yet" message. */
  startDate?: string | null;
  /** Stored preference as 'HH:mm'. An unusable value falls back to the default time. */
  reminderTime?: string | null;
}

/**
 * The reminder to schedule for a home state, or null when nothing daily is due.
 *
 * While an experiment is running the body stays day-agnostic on purpose: a single
 * repeating daily trigger is scheduled once and cannot know whether today is an
 * intervention or a control day, so stating a rule here would eventually state the
 * wrong one. Today's actual rule is only ever shown on the daily instruction screen.
 */
export function reminderForState(input: ReminderStateInput): ReminderPlan | null {
  const { state, startDate = null } = input;
  if (!needsDailyCheckIn(state)) return null;

  const time = resolveReminderTime(input.reminderTime);
  if (!time) return null;

  const title = state === 'plan_active'
    ? 'Daily instruction'
    : state === 'plan_awaiting_final'
      ? 'Final check-in'
      : 'Sleep check-in';

  const body = state === 'run_in'
    ? 'Log how long you slept to keep your run-in going.'
    : state === 'plan_scheduled'
      ? (startDate
        ? `Your experiment starts on ${startDate}. Keep logging your sleep until then.`
        : 'Your experiment has not started yet. Keep logging your sleep.')
      : state === 'plan_active'
        ? 'See the caffeine rule for today, then log your sleep.'
        : 'Your experiment is over. Log your final day to see your result.';

  return { hour: time.hour, minute: time.minute, title, body };
}

function isReminderRequest(request: ScheduledRequestLike): boolean {
  const data = request?.content?.data;
  if (!data || typeof data !== 'object') return false;
  return (data as Record<string, unknown>)[DAILY_REMINDER_DATA_KEY] === true;
}

/**
 * Identifiers of the reminders this app scheduled, so syncing can replace its own
 * reminder without disturbing any other scheduled notification.
 */
export function pickReminderIds(requests: readonly ScheduledRequestLike[]): string[] {
  return requests
    .filter((request) => typeof request?.identifier === 'string' && isReminderRequest(request))
    .map((request) => request.identifier);
}
