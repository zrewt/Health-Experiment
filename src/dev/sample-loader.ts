import { supabase } from '@/lib/supabase';
import { addDaysToLocalDate } from '@/experiment/dates';
import { getToday } from '@/experiment/clock';

export const DEV_SAMPLE_MARKER_PREFIX = 'DEV_SAMPLE_ENTRY_';

/**
 * Dev-only tool to load 14 valid run-in entries into the current user's log.
 * Entries end yesterday relative to current clock (getToday()).
 * SD is ~35 mins. Afternoon caffeine on ~8 of 14 days.
 * Inserts with is_sample = true so they can be cleanly cleaned up.
 */
export async function loadSampleRunIn(userId: string): Promise<number> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    throw new Error('Dev tools cannot run in production.');
  }

  const today = getToday();
  const sleepDurations = [
    430, 475, 410, 485, 440, 400, 470,
    425, 460, 415, 490, 435, 405, 465,
  ]; // Mean ~443, SD ~31m

  const caffeineTimes = [
    '14:30', '15:00', '11:00', '16:00', 'none', '14:00', '15:30',
    'none', '13:30', '11:30', '16:30', 'none', '14:00', '15:00',
  ];

  let count = 0;
  if (supabase) {
    const rows = [];
    for (let i = 14; i >= 1; i--) {
      const entryDate = addDaysToLocalDate(today, -i);
      const index = 14 - i;
      rows.push({
        user_id: userId,
        date: entryDate,
        sleep_minutes: sleepDurations[index],
        last_caffeine_time: caffeineTimes[index],
        edited_at: new Date().toISOString(),
        is_sample: true,
      });
    }

    const { error, data } = await supabase
      .from('experiment_entries')
      .upsert(rows, { onConflict: 'user_id,date' })
      .select('date');

    if (error) {
      throw new Error(`Failed to insert sample entries: ${error.message}`);
    }
    count = data?.length ?? rows.length;
  }

  return count;
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
