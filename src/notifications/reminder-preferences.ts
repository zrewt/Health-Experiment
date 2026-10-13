import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_REMINDER_PREFERENCES,
  normalizeReminderPreferences,
  type ReminderPreferences,
} from './reminder-plan';

/**
 * Device-local for now. An account-level copy needs a server column, and a preference that
 * silently fails to save is worse than one that is honestly per-device, so this does not
 * pretend to sync.
 */
export const REMINDER_PREFERENCES_KEY = 'aevum-reminder-preferences-v1';

/** Unreadable or corrupt storage falls back to the defaults rather than disabling reminders. */
export async function loadReminderPreferences(): Promise<ReminderPreferences> {
  try {
    const raw = await AsyncStorage.getItem(REMINDER_PREFERENCES_KEY);
    return normalizeReminderPreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_REMINDER_PREFERENCES;
  }
}

export async function saveReminderPreferences(preferences: ReminderPreferences): Promise<ReminderPreferences> {
  const normalized = normalizeReminderPreferences(preferences);
  await AsyncStorage.setItem(REMINDER_PREFERENCES_KEY, JSON.stringify(normalized));
  return normalized;
}
