import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import type { DailyEntry } from '@/experiment/types';
import { mergePendingEntries, retryPendingEntries } from './pending-entries';
import { createPlanPersistence, type StoredExperimentPlan } from './plan-persistence';
import { parseLocalDate } from '@/experiment/dates';
import { sanitizeCaffeineTimeForWrite } from '@/experiment/caffeine-time';

export const HEALTH_DATA_POLICY_VERSION = '2026-10-health-draft-v1';
export const DEFAULT_EXPERIMENT_ID = 'caffeine-cutoff';

const planPersistence = createPlanPersistence(AsyncStorage, {
  async getActive(userId) {
    if (!supabase) throw new Error('Server storage is unavailable. Your experiment has not been started.');
    const { data, error } = await supabase.from('experiment_plans')
      .select('id, plan, status, result, completed_at').eq('user_id', userId).neq('status', 'cancelled').maybeSingle();
    if (error) throw new Error(`Could not load experiment plan: ${error.message}`);
    return data as StoredExperimentPlan | null;
  },
  async insert(userId, plan) {
    if (!supabase) throw new Error('Server storage is unavailable. Your experiment has not been started.');
    const { data, error } = await supabase.from('experiment_plans')
      .insert({ user_id: userId, plan, status: 'scheduled' }).select('id, plan, status, result, completed_at').single();
    if (error) throw new Error(`Could not save experiment plan: ${error.message}`);
    return data as StoredExperimentPlan;
  },
  async setNextCheckDate(userId, date) {
    parseLocalDate(date);
    if (!supabase) throw new Error('Server storage is unavailable. The re-check date has not been saved.');
    const { data, error } = await supabase.from('experiment_setup')
      .update({ next_check_date: date }).eq('user_id', userId).select('user_id').single();
    if (error || !data) throw new Error(`Could not save re-check date: ${error?.message ?? 'setup not found'}`);
  },
  async cancel(userId, planId) {
    if (!supabase) throw new Error('Server storage is unavailable. Plan cannot be cancelled.');
    const { data, error } = await supabase.from('experiment_plans')
      .update({ status: 'cancelled' }).eq('id', planId).eq('user_id', userId).select('id').single();
    if (error || !data) throw new Error(`Could not cancel experiment plan: ${error?.message ?? 'plan not found'}`);
  },
  async complete(userId, planId, result, completedAt) {
    if (!supabase) throw new Error('Server storage is unavailable. Plan result cannot be saved.');
    // First, try conditional update: update only if status is not already completed
    const { data, error } = await supabase.from('experiment_plans')
      .update({ status: 'completed', result, completed_at: completedAt })
      .eq('id', planId)
      .eq('user_id', userId)
      .neq('status', 'completed')
      .select('id, plan, status, result, completed_at')
      .maybeSingle();

    if (error) throw new Error(`Could not complete experiment plan: ${error.message}`);
    if (data) return data as StoredExperimentPlan;

    // If no row returned, row might already be completed (idempotent / double tap / lost response)
    const { data: existing, error: fetchErr } = await supabase.from('experiment_plans')
      .select('id, plan, status, result, completed_at')
      .eq('id', planId)
      .eq('user_id', userId)
      .single();

    if (fetchErr || !existing) throw new Error('Could not verify completed plan.');
    return existing as StoredExperimentPlan;
  },
  async resetCompleted(userId, planId) {
    if (!supabase) throw new Error('Server storage is unavailable.');
    const { data, error } = await supabase.from('experiment_plans')
      .update({ status: 'scheduled', result: null, completed_at: null })
      .eq('id', planId)
      .eq('user_id', userId)
      .select('id, plan, status, result, completed_at')
      .single();

    if (error) throw new Error(`Could not reset plan: ${error.message}`);
    return data as StoredExperimentPlan;
  },
});

export const { getActivePlan, savePlan, saveNextCheckDate, getPendingPlan, cancelPlan, completePlan, resetCompletedPlan } = planPersistence;

export type ScreeningAnswer = 'usually' | 'sometimes' | 'rarely_or_never';

export interface ExperimentSetupRecord {
  experimentId: string;
  cutoffTime: string;
  screeningAnswer: ScreeningAnswer;
  runInStartDate: string;
  nextCheckDate?: string | null;
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
      next_check_date: setup.nextCheckDate ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) {
      console.warn('Supabase saveSetup error:', error.message);
      throw new Error(`Failed to save setup: ${error.message}`);
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
        .select('experiment_id, cutoff_time, screening_answer, run_in_start_date, next_check_date')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data) {
        const record: ExperimentSetupRecord = {
          experimentId: data.experiment_id,
          cutoffTime: data.cutoff_time,
          screeningAnswer: data.screening_answer,
          runInStartDate: data.run_in_start_date,
          nextCheckDate: data.next_check_date ?? null,
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
  // Write-side policy: a malformed time is never persisted; it is stored as unknown (null),
  // never padded and never turned into 'none'.
  const lastCaffeineTime = sanitizeCaffeineTimeForWrite(entry.lastCaffeineTime ?? null);
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
  const pending = Object.values(entriesMap).filter(e => e.synced === false);

  const result = await retryPendingEntries(pending, async entry => {
    if (!supabase) return false;
    try {
      // The retry queue re-writes already-stored values verbatim on purpose: it must
      // never modify, pad or drop stored data, so it does no caffeine-time validation.
      const { error } = await supabase.from('experiment_entries').upsert({
        user_id: userId,
        date: entry.date,
        sleep_minutes: entry.sleepMinutes,
        last_caffeine_time: entry.lastCaffeineTime,
        edited_at: entry.editedAt,
      }, { onConflict: 'user_id,date' });
      return !error;
    } catch {
      return false;
    }
  });

  for (const entry of result.entries) entriesMap[entry.date] = entry;
  await AsyncStorage.setItem(entriesKey(userId), JSON.stringify(entriesMap));
  return { syncedCount: result.syncedCount, failedCount: result.failedCount };
}

/**
 * Lists all daily entries for a user, sorted ascending by date.
 */
export async function listEntries(userId: string): Promise<StoredDailyEntry[]> {
  if (supabase) {
    try {
      const rawCache = await AsyncStorage.getItem(entriesKey(userId));
      const localEntries: StoredDailyEntry[] = rawCache ? Object.values(JSON.parse(rawCache)) : [];
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
        const merged = mergePendingEntries(list, localEntries);
        const map: Record<string, StoredDailyEntry> = {};
        for (const item of merged) map[item.date] = item;
        await AsyncStorage.setItem(entriesKey(userId), JSON.stringify(map));
        return merged;
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
