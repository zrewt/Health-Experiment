import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import type { HomeState } from '../experiment/home-state';
import { getHomeState } from '../experiment/home-state';
import { parseLocalDate } from '../experiment/dates';
import { getToday } from '../experiment/clock';
import { getActivePlan, getConsent, getSetup, listEntries } from '@/data/experiment-store';
import { loadReminderPreferences } from './reminder-preferences';
import { reminderSlotFrom, resolveReminderTap } from './tap-target';
import {
  DAILY_REMINDER_DATA_KEY,
  buildReminderSchedule,
  pickReminderIds,
  type ReminderPlanContext,
  type ReminderPreferences,
  type ReminderSpec,
} from './reminder-plan';

/** Android delivers through a channel; it must exist before the Android 13+ permission prompt. */
export const REMINDER_CHANNEL_ID = 'daily-checkin';

/**
 * Set once the OS prompt has actually been shown. Without it, every home-screen visit
 * while the decision is undecided would try to prompt again instead of asking once.
 */
export const REMINDER_ASKED_KEY = 'aevum-reminder-asked-v1';

export type ReminderPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export type ReminderSyncOutcome =
  | { status: 'scheduled'; count: number; dated: number }
  | { status: 'cancelled'; cancelled: number }
  | { status: 'skipped'; permission: ReminderPermission }
  | { status: 'unavailable'; platform: string }
  | { status: 'failed'; message: string };

async function hasAskedForPermission(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(REMINDER_ASKED_KEY)) === 'true';
  } catch {
    // Unreadable storage must not block the reminder; treat it as already asked so the
    // worst case is a silently missing prompt rather than a repeated one.
    return true;
  }
}

/**
 * expo-notifications has no web implementation, and scheduling throws UnavailabilityError
 * there. Every native entry point below is gated on this so web keeps working untouched.
 */
export function remindersSupported(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

// Foreground presentation. Without a handler the OS shows nothing while the app is open,
// even on the day a reminder fires while the user already has Aevum in front of them.
if (remindersSupported()) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Collapse the platform permission shapes into one verdict. iOS reports the real decision
 * in `ios.status`, while the root `granted` stays false for provisional and ephemeral
 * authorization, which do allow delivery.
 */
function toPermission(status: Notifications.NotificationPermissionsStatus): ReminderPermission {
  const ios = status.ios?.status;
  const granted =
    status.granted === true ||
    ios === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    ios === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    ios === Notifications.IosAuthorizationStatus.EPHEMERAL;
  if (granted) return 'granted';
  if (status.status === 'undetermined') return 'undetermined';
  return 'denied';
}

export async function getReminderPermission(): Promise<ReminderPermission> {
  if (!remindersSupported()) return 'unavailable';
  return toPermission(await Notifications.getPermissionsAsync());
}

export async function ensureReminderChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Daily check-in',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (!remindersSupported()) return 'unavailable';
  // Created first: on Android 13+ the system prompt does not appear without a channel.
  await ensureReminderChannel();
  const status = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return toPermission(status);
}

/** Cancel only the reminders this app owns; returns how many were removed. */
export async function cancelDailyReminder(): Promise<number> {
  if (!remindersSupported()) return 0;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const identifiers = pickReminderIds(scheduled);
  for (const identifier of identifiers) {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  }
  return identifiers.length;
}

/**
 * Best-effort cancel for terminal transitions (experiment completed or ended early).
 *
 * Never throws: the caller has already committed a real state change, so a failed
 * notification call must not be reported as a failed experiment edit. A miss is
 * self-healing, because the next home-screen visit re-syncs and clears the remainder.
 */
export async function clearDailyReminder(): Promise<number> {
  if (!remindersSupported()) return 0;
  try {
    return await cancelDailyReminder();
  } catch {
    return 0;
  }
}

function triggerFor(spec: ReminderSpec): Notifications.NotificationTriggerInput {
  const channelId = Platform.OS === 'android' ? REMINDER_CHANNEL_ID : undefined;

  if (spec.trigger.kind === 'daily') {
    return {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: spec.trigger.hour,
      minute: spec.trigger.minute,
      ...(channelId ? { channelId } : {}),
    };
  }

  // Built from local components so the reminder lands at the local wall-clock time the
  // user was promised rather than at the same instant in UTC.
  const { year, month, day } = parseLocalDate(spec.trigger.date);
  return {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: new Date(year, month - 1, day, spec.trigger.hour, spec.trigger.minute, 0, 0),
    ...(channelId ? { channelId } : {}),
  };
}

export interface ReminderSyncInput {
  state: HomeState;
  /** Local calendar date from the app clock. */
  today: string;
  plan?: ReminderPlanContext | null;
  /** Loaded from storage when omitted, so every caller honours the saved preferences. */
  preferences?: ReminderPreferences | null;
  /** Ask the OS when the decision has not been made yet. Never re-prompts when denied. */
  requestPermission?: boolean;
}

/** Open the OS settings for this app, for a user who previously declined notifications. */
export async function openNotificationSettings(): Promise<void> {
  await Linking.openSettings();
}

/**
 * Everything syncing needs, read from storage. Used by the settings screen, which has no
 * data loaded of its own; a screen that already holds these values passes them directly
 * instead of paying for the reads twice.
 */
export async function loadReminderSyncInput(userId: string): Promise<ReminderSyncInput> {
  const [consent, setup, entries, plan] = await Promise.all([
    getConsent(userId),
    getSetup(userId),
    listEntries(userId),
    getActivePlan(userId),
  ]);
  const today = getToday();

  return {
    state: getHomeState({ consent, setup, entries, plan, today }),
    today,
    plan: plan
      ? {
        startDate: plan.plan.startDate,
        chosenDuration: plan.plan.chosenDuration,
        schedule: plan.plan.schedule,
        conditionRule: plan.plan.definition.conditionRule,
      }
      : null,
  };
}

/**
 * Where a tapped reminder should land, or null when it should be ignored.
 *
 * The state is only read for the morning check-in, whose destination depends on how far
 * along the user is; the other slots go to one known screen.
 */
export async function resolveReminderRoute(data: unknown, userId: string | null): Promise<string | null> {
  const slot = reminderSlotFrom(data);
  if (!slot) return null;

  const known = resolveReminderTap(slot, null);
  if (known) return known;

  // Only the morning check-in needs the current state, and without a user there is no state.
  if (slot !== 'morning-check-in' || !userId) return null;

  try {
    const [consent, setup, entries, plan] = await Promise.all([
      getConsent(userId),
      getSetup(userId),
      listEntries(userId),
      getActivePlan(userId),
    ]);
    const today = getToday();
    return resolveReminderTap(slot, getHomeState({ consent, setup, entries, plan, today }));
  } catch {
    // Reading the state failed: give up rather than guide the user to a screen that does
    // not match where they actually are.
    return null;
  }
}

/**
 * Make the OS queue match the state: the full set of reminders for this state, and never
 * any duplicate or any notification this app did not schedule.
 *
 * Resolves to an outcome instead of throwing: a missed reminder must never break a screen.
 */
export async function syncReminders(input: ReminderSyncInput): Promise<ReminderSyncOutcome> {
  if (!remindersSupported()) {
    return { status: 'unavailable', platform: Platform.OS };
  }

  try {
    const now = new Date();
    const preferences = input.preferences ?? await loadReminderPreferences();
    const specs = buildReminderSchedule({
      state: input.state,
      today: input.today,
      plan: input.plan ?? null,
      preferences,
      nowMinutes: now.getHours() * 60 + now.getMinutes(),
    });

    if (specs.length === 0) {
      return { status: 'cancelled', cancelled: await cancelDailyReminder() };
    }

    await ensureReminderChannel();

    let permission = await getReminderPermission();
    if (permission === 'undetermined' && input.requestPermission !== false && !(await hasAskedForPermission())) {
      // Marked only after a prompt actually happened, so a thrown request can be retried.
      permission = await requestReminderPermission();
      await AsyncStorage.setItem(REMINDER_ASKED_KEY, 'true');
    }
    if (permission !== 'granted') {
      // Declined or revoked: clear anything stale so an outdated reminder cannot still fire.
      await cancelDailyReminder();
      return { status: 'skipped', permission };
    }

    // Replaced wholesale rather than added to, so repeated launches cannot stack duplicates.
    await cancelDailyReminder();
    const identifiers = await Promise.all(specs.map((spec) => Notifications.scheduleNotificationAsync({
      content: {
        title: spec.title,
        body: spec.body,
        data: { [DAILY_REMINDER_DATA_KEY]: true, slot: spec.slot },
      },
      trigger: triggerFor(spec),
    })));

    return {
      status: 'scheduled',
      count: identifiers.length,
      dated: specs.filter((spec) => spec.trigger.kind === 'date').length,
    };
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
