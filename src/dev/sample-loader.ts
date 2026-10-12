import { supabase } from '@/lib/supabase';
import { saveEntry } from '@/data/experiment-store';
import { addDaysToLocalDate } from '@/experiment/dates';
import { getToday } from '@/experiment/clock';

export const DEV_SAMPLE_MARKER_PREFIX = 'DEV_SAMPLE_ENTRY_';

/**
 * Dev-only tool to load 14 valid run-in entries into the current user's log.
 * Entries end yesterday relative to current clock (getToday()).
 * SD is ~35 mins. Afternoon caffeine on ~8 of 14 days.
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
  for (let i = 14; i >= 1; i--) {
    const entryDate = addDaysToLocalDate(today, -i);
    const index = 14 - i;
    const entry = {
      date: entryDate,
      sleepMinutes: sleepDurations[index],
      lastCaffeineTime: caffeineTimes[index],
    };
    await saveEntry(userId, entry);
    count++;
  }

  return count;
}

/**
 * Dev-only tool to delete sample entries.
 * Identifies sample entries by querying and checking dates or removing recent run-in entries created by sample loader.
 */
export async function deleteSampleEntries(userId: string): Promise<number> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    throw new Error('Dev tools cannot run in production.');
  }

  const today = getToday();
  const datesToDelete = Array.from({ length: 14 }, (_, i) => addDaysToLocalDate(today, -(i + 1)));

  let deleted = 0;
  if (supabase) {
    const { error } = await supabase
      .from('experiment_entries')
      .delete()
      .eq('user_id', userId)
      .in('date', datesToDelete);
    if (!error) {
      deleted = datesToDelete.length;
    }
  }

  return deleted;
}
