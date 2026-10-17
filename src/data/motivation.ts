import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The optional reason a user writes at setup ("mornings with my daughter").
 *
 * Stored on the device only: it is a personal note, not health data the test needs, and
 * keeping it local means it can never block setup or sync. The why-echo reads it back on
 * the days it can help.
 */
export const MAX_MOTIVATION_LENGTH = 140;

function motivationKey(userId: string): string {
  return `@experiment_why:${userId}`;
}

/** Trimmed, single-line text, or null when there is nothing to keep. */
export function normalizeMotivation(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/\s+/g, ' ').trim().slice(0, MAX_MOTIVATION_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

export async function saveMotivation(userId: string, text: string | null | undefined): Promise<string | null> {
  const value = normalizeMotivation(text);
  if (value === null) {
    await AsyncStorage.removeItem(motivationKey(userId));
    return null;
  }
  await AsyncStorage.setItem(motivationKey(userId), value);
  return value;
}

export async function getMotivation(userId: string): Promise<string | null> {
  try {
    return normalizeMotivation(await AsyncStorage.getItem(motivationKey(userId)));
  } catch {
    return null;
  }
}
