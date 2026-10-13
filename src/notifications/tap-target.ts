import type { HomeState } from '../experiment/home-state';

/**
 * The one place that decides which screen a home state belongs to, so the home button and
 * a tapped reminder can never disagree about where a state lives.
 *
 * Strings rather than typed routes on purpose: keeping this module free of router imports
 * keeps it importable by the tests, and the navigation site casts once.
 */
export const ROUTE_FOR_HOME_STATE: Record<HomeState, string> = {
  needs_consent: '/setup-consent',
  needs_setup: '/setup-consent',
  run_in: '/run-in',
  feasibility_ready: '/feasibility',
  plan_scheduled: '/daily-instruction',
  plan_active: '/daily-instruction',
  plan_awaiting_final: '/result',
  plan_result_ready: '/result',
  // The experiment is over and there is nothing to act on, so this is a statement, not a task.
  plan_ended_early: '/',
};

export function routeForHomeState(state: HomeState): string {
  return ROUTE_FOR_HOME_STATE[state] ?? '/';
}

/** Slots written into the notification payload when scheduling. */
export const REMINDER_SLOTS = ['morning-check-in', 'before-cutoff', 'next-day-preview'] as const;
export type ReminderSlotName = (typeof REMINDER_SLOTS)[number];

/** Read our own payload marker back out, ignoring anything unexpected. */
export function reminderSlotFrom(data: unknown): ReminderSlotName | null {
  if (!data || typeof data !== 'object') return null;
  const slot = (data as { slot?: unknown }).slot;
  return typeof slot === 'string' && (REMINDER_SLOTS as readonly string[]).includes(slot)
    ? (slot as ReminderSlotName)
    : null;
}

/**
 * Where a tapped reminder should land.
 *
 * The two experiment reminders are about one specific thing, so they always go to the
 * daily instruction screen. The morning check-in is about logging, and where logging
 * happens depends on how far along the user is, hence the state. A null state means the
 * state could not be read, in which case the caller should fall back to home rather than
 * guess at a screen.
 */
export function resolveReminderTap(slot: ReminderSlotName | null, state: HomeState | null): string | null {
  if (slot === 'before-cutoff' || slot === 'next-day-preview') return '/daily-instruction';
  if (slot === 'morning-check-in') return state ? routeForHomeState(state) : null;
  return null;
}
