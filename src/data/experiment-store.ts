import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import type { DailyEntry } from '@/experiment/types';

export const HEALTH_DATA_POLICY_VERSION = '2026-10-health-draft-v1';
export const DEFAULT_EXPERIMENT_ID = 'caffeine-cutoff';

export type ScreeningAnswer = 'usually' | 'sometimes' | 'rarely_or_never';

export interface ExperimentSetupRecord {
  experimentId: string;
  cutoffTime: string;
  screeningAnswer: ScreeningAnswer;
  runInStartDate: string;
}

export interface ConsentRecord {
  userId: string;
  consentType: 'health-data';
  policyVersion: string;
  granted: boolean;
  createdAt: string;
}

export interface StoredDailyEntry extends DailyEntry {
  editedAt: string;
  synced?: boolean;
}

// Local storage key prefixes for offline resilience / fallback when Supabase is not reachable
function setupKey(userId: string): string {
  return `@experiment_setup:${userId}`;
}

function entriesKey(userId: string): string {
  return `@experiment_entries:${userId}`;
}

function consentKey(userId: string): string {
  return `@experiment_consent:${userId}`;
}

/**
 * Saves or updates setup configuration for the user.
 */
export async function saveSetup(userId: string, setup: ExperimentSetupRecord): Promise<void> {
  const localVal = JSON.stringify(setup);
  await AsyncStorage.setItem(setupKey(userId), localVal);

  if (supabase) {
    const { error } = await supabase.from('experiment_setup').upsert({
      user_id: userId,
      experiment_id: setup.experimentId,
      cutoff_time: setup.cutoffTime,
      screening_answer: setup.screeningAnswer,
      run_in_start_date: setup.runInStartDate,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) {
      // Keep local record intact but throw so caller can notify if needed
      console.warn('Supabase saveSetup warning:', error.message);
    }
  }
}

/**
 * Retrieves setup configuration for the user, returning null if not found.
 */
export async function getSetup(userId: string): Promise<ExperimentSetupRecord | null> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('experiment_setup')
        .select('experiment_id, cutoff_time, screening_answer, run_in_start_date')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data) {
        const record: ExperimentSetupRecord = {
          experimentId: data.experiment_id,
          cutoffTime: data.cutoff_time,
          screeningAnswer: data.screening_answer,
          runInStartDate: data.run_in_start_date,
        };
        await AsyncStorage.setItem(setupKey(userId), JSON.stringify(record));
        return record;
      }
    } catch {
      // Fallback to local storage
    }
  }

  const raw = await AsyncStorage.getItem(setupKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ExperimentSetupRecord;
  } catch {
    return null;
  }
}

/**
 * Saves a daily entry (upsert by user_id and date).
 * MISSING IS NOT ZERO: undefined or null sleepMinutes stays null.
 * If cloud save fails or offline, the entry is preserved locally with synced: false.
 */
export async function saveEntry(userId: string, entry: DailyEntry): Promise<StoredDailyEntry> {
  const sleepMinutes = entry.sleepMinutes ?? null;
  const lastCaffeineTime = entry.lastCaffeineTime ?? null;
  const editedAt = new Date().toISOString();

  const record: StoredDailyEntry = {
    date: entry.date,
    sleepMinutes,
    lastCaffeineTime,
    editedAt,
    synced: false,
  };

  // 1. Update local AsyncStorage cache
  const rawEntries = await AsyncStorage.getItem(entriesKey(userId));
  const entriesMap: Record<string, StoredDailyEntry> = rawEntries ? JSON.parse(rawEntries) : {};
  entriesMap[entry.date] = record;
  await AsyncStorage.setItem(entriesKey(userId), JSON.stringify(entriesMap));

  // 2. Persist to Supabase if available
  if (supabase) {
    try {
      const { error } = await supabase.from('experiment_entries').upsert({
        user_id: userId,
        date: entry.date,
        sleep_minutes: sleepMinutes,
        last_caffeine_time: lastCaffeineTime,
        edited_at: editedAt,
      }, { onConflict: 'user_id,date' });

      if (error) {
        console.warn('Supabase saveEntry error:', error.message);
        // Stays synced: false, local cache preserved
      } else {
        record.synced = true;
        entriesMap[entry.date] = record;
        await AsyncStorage.setItem(entriesKey(userId), JSON.stringify(entriesMap));
      }
    } catch (e) {
      console.warn('Supabase saveEntry network/exception:', e);
      // Stays synced: false
    }
  }

  return record;
}

/**
 * Retries syncing all unsynced local entries to Supabase.
 */
export async function syncUnsyncedEntries(userId: string): Promise<{ syncedCount: number; failedCount: number }> {
  const rawEntries = await AsyncStorage.getItem(entriesKey(userId));
  if (!rawEntries) return { syncedCount: 0, failedCount: 0 };
  const entriesMap: Record<string, StoredDailyEntry> = JSON.parse(rawEntries);
  const unsynced = Object.values(entriesMap).filter(e => e.synced === false);

  if (!supabase || unsynced.length === 0) {
    return { syncedCount: 0, failedCount: unsynced.length };
  }

  let syncedCount = 0;
  let failedCount = 0;

  for (const entry of unsynced) {
    try {
      const { error } = await supabase.from('experiment_entries').upsert({
        user_id: userId,
        date: entry.date,
        sleep_minutes: entry.sleepMinutes,
        last_caffeine_time: entry.lastCaffeineTime,
        edited_at: entry.editedAt,
      }, { onConflict: 'user_id,date' });

      if (!error) {
        entry.synced = true;
        entriesMap[entry.date] = entry;
        syncedCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  await AsyncStorage.setItem(entriesKey(userId), JSON.stringify(entriesMap));
  return { syncedCount, failedCount };
}

/**
 * Lists all daily entries for a user, sorted ascending by date.
 */
export async function listEntries(userId: string): Promise<StoredDailyEntry[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('experiment_entries')
        .select('date, sleep_minutes, last_caffeine_time, edited_at')
        .eq('user_id', userId)
        .order('date', { ascending: true });

      if (!error && data) {
        const list: StoredDailyEntry[] = data.map((d: any) => ({
          date: d.date,
          sleepMinutes: d.sleep_minutes !== null ? Number(d.sleep_minutes) : null,
          lastCaffeineTime: d.last_caffeine_time ?? null,
          editedAt: d.edited_at,
          synced: true,
        }));
        // Update local cache
        const map: Record<string, StoredDailyEntry> = {};
        for (const item of list) map[item.date] = item;
        await AsyncStorage.setItem(entriesKey(userId), JSON.stringify(map));
        return list;
      }
    } catch {
      // Fall through to local cache
    }
  }

  const rawEntries = await AsyncStorage.getItem(entriesKey(userId));
  if (!rawEntries) return [];
  try {
    const map: Record<string, StoredDailyEntry> = JSON.parse(rawEntries);
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

/**
 * Records a consent decision.
 * APPEND-ONLY: Never updates or deletes rows.
 */
export async function saveConsent(
  userId: string,
  granted: boolean,
  consentType: 'health-data' = 'health-data',
  policyVersion: string = HEALTH_DATA_POLICY_VERSION,
): Promise<ConsentRecord> {
  const record: ConsentRecord = {
    userId,
    consentType,
    policyVersion,
    granted,
    createdAt: new Date().toISOString(),
  };

  // 1. Append locally
  const rawList = await AsyncStorage.getItem(consentKey(userId));
  const list: ConsentRecord[] = rawList ? JSON.parse(rawList) : [];
  list.push(record);
  await AsyncStorage.setItem(consentKey(userId), JSON.stringify(list));

  // 2. Append to Supabase
  if (supabase) {
    const { error } = await supabase.from('experiment_consent').insert({
      user_id: userId,
      consent_type: consentType,
      policy_version: policyVersion,
      granted,
      created_at: record.createdAt,
    });
    if (error) {
      console.warn('Supabase saveConsent error:', error.message);
      throw new Error(`Failed to save consent record: ${error.message}`);
    }
  }

  return record;
}

/**
 * Retrieves the latest consent record for a user.
 */
export async function getConsent(userId: string): Promise<ConsentRecord | null> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('experiment_consent')
        .select('user_id, consent_type, policy_version, granted, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        return {
          userId: data.user_id,
          consentType: data.consent_type,
          policyVersion: data.policy_version,
          granted: Boolean(data.granted),
          createdAt: data.created_at,
        };
      }
    } catch {
      // Fall through to local cache
    }
  }

  const rawList = await AsyncStorage.getItem(consentKey(userId));
  if (!rawList) return null;
  try {
    const list: ConsentRecord[] = JSON.parse(rawList);
    if (!list.length) return null;
    return list[list.length - 1];
  } catch {
    return null;
  }
}
