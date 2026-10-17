import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import type { DailyEntry } from '@/experiment/types';
import { mergePendingEntries, retryPendingEntries } from './pending-entries';
import { deviceKeysForUser } from './local-wipe';
import { createPlanPersistence, type StoredExperimentPlan } from './plan-persistence';
import { parseLocalDate } from '@/experiment/dates';
import { CAFFEINE_TIME_PATTERN, sanitizeCaffeineTimeForWrite } from '@/experiment/caffeine-time';
import { CURRENT_CONSENT_VERSION } from '@/experiment/consent';

/**
 * Consent covers both exposures: the log stores sleep, caffeine and screen times, so one
 * version names all three. The version itself lives in the pure consent module; this is the
 * store's name for it.
 */
export const HEALTH_DATA_POLICY_VERSION = CURRENT_CONSENT_VERSION;
export const DEFAULT_EXPERIMENT_ID = 'caffeine-cutoff';

function plansHistoryKey(userId: string): string {
  return `@experiment_plans_history:${userId}`;
}

function archivedPlanIdsKey(userId: string): string {
  return `@experiment_archived_plan_ids:${userId}`;
}

async function readArchivedPlanIds(userId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(archivedPlanIdsKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

async function mergePlansIntoLocalHistory(userId: string, incoming: readonly StoredExperimentPlan[]): Promise<StoredExperimentPlan[]> {
  let existing: StoredExperimentPlan[] = [];
  try {
    const raw = await AsyncStorage.getItem(plansHistoryKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed as StoredExperimentPlan[];
    }
  } catch {
    existing = [];
  }
  const byId = new Map<string, StoredExperimentPlan>();
  for (const item of incoming) {
    if (item && item.id) byId.set(item.id, item);
  }
  for (const item of existing) {
    if (item && item.id && !byId.has(item.id)) byId.set(item.id, item);
  }
  const merged = Array.from(byId.values());
  await AsyncStorage.setItem(plansHistoryKey(userId), JSON.stringify(merged));
  return merged;
}

const planPersistence = createPlanPersistence(AsyncStorage, {
  async getActive(userId) {
    if (!supabase) throw new Error('Server storage is unavailable. Your experiment has not been started.');
    const { data, error } = await supabase.from('experiment_plans')
      .select('id, plan, status, result, completed_at')
      .eq('user_id', userId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Could not load experiment plan: ${error.message}`);
    const rows = Array.isArray(data)
      ? (data as StoredExperimentPlan[])
      : data
      ? [data as StoredExperimentPlan]
      : [];
    if (rows.length > 0) {
      await mergePlansIntoLocalHistory(userId, rows);
    }
    const archivedIds = await readArchivedPlanIds(userId);
    const active = rows.find(row => row.status === 'scheduled' || !archivedIds.has(row.id)) ?? null;
    return active;
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
 * Write-side policy for last screen use: HH:mm or 'none', otherwise unknown (null).
 * Same strict rule as caffeine time: a malformed value is never padded or guessed.
 */
function sanitizeScreenTimeForWrite(value: string | 'none' | null): string | 'none' | null {
  if (value === 'none') return 'none';
  if (typeof value === 'string' && CAFFEINE_TIME_PATTERN.test(value)) return value;
  return null;
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
  const lastScreenTime = sanitizeScreenTimeForWrite(entry.lastScreenTime ?? null);
  const editedAt = new Date().toISOString();

  const record: StoredDailyEntry = {
    date: entry.date,
    sleepMinutes,
    lastCaffeineTime,
    lastScreenTime,
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
        last_screen_time: lastScreenTime,
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
        last_screen_time: entry.lastScreenTime ?? null,
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
        .select('date, sleep_minutes, last_caffeine_time, last_screen_time, edited_at')
        .eq('user_id', userId)
        .order('date', { ascending: true });

      if (!error && data) {
        const list: StoredDailyEntry[] = data.map((d: any) => ({
          date: d.date,
          sleepMinutes: d.sleep_minutes !== null ? Number(d.sleep_minutes) : null,
          lastCaffeineTime: d.last_caffeine_time ?? null,
          lastScreenTime: d.last_screen_time ?? null,
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

/**
 * Lists all saved experiment plans for a user (including completed and ended-early plans),
 * ordered newest first. Preserves local history when offline.
 */
export async function listExperimentPlans(userId: string): Promise<StoredExperimentPlan[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('experiment_plans')
        .select('id, plan, status, result, completed_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        return await mergePlansIntoLocalHistory(userId, data as StoredExperimentPlan[]);
      }
    } catch {
      // Fall through to local history
    }
  }
  return await mergePlansIntoLocalHistory(userId, []);
}

/**
 * Preserves a completed experiment in saved history and marks it archived so the user
 * can start a new baseline/feasibility cycle while keeping the completed result and its
 * locked entries intact.
 */
export async function archiveCompletedPlanForRepeat(
  userId: string,
  planRecord: StoredExperimentPlan,
): Promise<void> {
  if (planRecord.status !== 'completed') {
    throw new Error('Only a completed experiment can be archived to start a new cycle.');
  }
  await mergePlansIntoLocalHistory(userId, [planRecord]);
  const archived = await readArchivedPlanIds(userId);
  archived.add(planRecord.id);
  await AsyncStorage.setItem(archivedPlanIdsKey(userId), JSON.stringify(Array.from(archived)));
  await AsyncStorage.removeItem(`@experiment_active_plan:${userId}`);
}

export interface LocalWipeReport {
  /** The keys that were actually on the device and are now gone. */
  removedKeys: string[];
}

/**
 * Removes this account's offline copy from the device.
 *
 * Everything removed here is a cache the account can rebuild, so a partial failure is
 * only ever an unfinished cleanup, never lost data. Keys are selected by shape (see
 * deviceKeysForUser) instead of by name, so a cache key added later is cleared with
 * them rather than being left behind on the phone.
 */
export async function clearLocalUserData(userId: string): Promise<LocalWipeReport> {
  const allKeys = await AsyncStorage.getAllKeys();
  const owned = deviceKeysForUser(allKeys, userId);
  if (owned.length > 0) {
    await AsyncStorage.multiRemove(owned);
  }
  return { removedKeys: owned };
}

