import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseLocalDate } from '@/experiment/dates';
import type { ExposureKind } from '@/experiment/experiments';

/**
 * The time a user tapped "I'm off now" on a cutoff evening.
 *
 * It is an intention, not a log: the next morning's check-in is pre-filled with it, and the
 * user still confirms or changes it. Only one is kept (the latest evening), and it is read
 * back only for the night it was recorded for.
 */
export interface CutoffIntent {
  /** The exposure day the tap belongs to, YYYY-MM-DD (yesterday when checked in). */
  date: string;
  /** Local HH:mm. */
  time: string;
  exposure: ExposureKind;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function intentKey(userId: string): string {
  return `@experiment_cutoff_intent:${userId}`;
}

/** True only for a real calendar date and a real 24-hour time. */
export function isValidIntent(intent: CutoffIntent): boolean {
  try {
    parseLocalDate(intent.date);
  } catch {
    return false;
  }
  return TIME_PATTERN.test(intent.time)
    && (intent.exposure === 'caffeine' || intent.exposure === 'screens');
}

export async function saveCutoffIntent(userId: string, intent: CutoffIntent): Promise<boolean> {
  if (!isValidIntent(intent)) return false;
  try {
    await AsyncStorage.setItem(intentKey(userId), JSON.stringify(intent));
    return true;
  } catch {
    return false;
  }
}

/** The intent for exactly this date, or null. A stale intent is never returned. */
export async function getCutoffIntent(userId: string, date: string): Promise<CutoffIntent | null> {
  try {
    const raw = await AsyncStorage.getItem(intentKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CutoffIntent>;
    if (
      typeof parsed.date !== 'string'
      || typeof parsed.time !== 'string'
      || (parsed.exposure !== 'caffeine' && parsed.exposure !== 'screens')
      || parsed.date !== date
    ) {
      return null;
    }
    const intent: CutoffIntent = { date: parsed.date, time: parsed.time, exposure: parsed.exposure };
    return isValidIntent(intent) ? intent : null;
  } catch {
    return null;
  }
}

export async function clearCutoffIntent(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(intentKey(userId));
  } catch {
    // Nothing to clear; the intent is only a convenience.
  }
}
