import { supabase } from '@/lib/supabase';
import { getToday } from '@/experiment/clock';
import type { ExposureKind } from '@/experiment/experiments';
import {
  buildSamplePlanRows,
  buildSampleRunInRows,
  type SampleEntryRow,
  type SamplePlanShape,
} from './fixtures';

export { buildSamplePlanRows, buildSampleRunInRows, isScreenPlan } from './fixtures';
export type { SampleEntryRow, SamplePlanShape } from './fixtures';

async function upsertRows(rows: SampleEntryRow[]): Promise<number> {
  if (!supabase) return 0;
  const { error, data } = await supabase
    .from('experiment_entries')
    .upsert(rows, { onConflict: 'user_id,date' })
    .select('date');
  if (error) throw new Error(`Failed to insert sample entries: ${error.message}`);
  return data?.length ?? rows.length;
}

/**
 * Dev-only tool to load 14 valid run-in entries into the current user's log.
 * Entries end yesterday relative to the current clock (getToday()) and carry the exposure
 * column of the test being prepared.
 */
export async function loadSampleRunIn(
  userId: string,
  exposure: ExposureKind = 'caffeine',
): Promise<number> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    throw new Error('Dev tools cannot run in production.');
  }
  return upsertRows(buildSampleRunInRows(userId, getToday(), exposure));
}

/**
 * Dev-only tool to load deterministic sample entries across the whole active plan,
 * using the exposure the plan's own rule reads.
 */
export async function loadSampleExperimentEntries(
  userId: string,
  plan: SamplePlanShape,
): Promise<number> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    throw new Error('Dev tools cannot run in production.');
  }
  return upsertRows(buildSamplePlanRows(userId, plan));
}

/**
 * Dev-only tool to delete sample entries.
 * Deletes rows where is_sample = true.
 * Surfaces "deleted 0 rows" as an error if nothing was deleted.
 */
export async function deleteSampleEntries(userId: string): Promise<number> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    throw new Error('Dev tools cannot run in production.');
  }

  let deleted = 0;
  if (supabase) {
    const { error, data } = await supabase
      .from('experiment_entries')
      .delete()
      .eq('user_id', userId)
      .eq('is_sample', true)
      .select('date');

    if (error) {
      throw new Error(`Failed to delete sample entries: ${error.message}`);
    }

    deleted = data?.length ?? 0;
    if (deleted === 0) {
      throw new Error('deleted 0 rows: no sample entries were deleted');
    }
  }

  return deleted;
}
