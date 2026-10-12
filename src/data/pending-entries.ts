import type { StoredDailyEntry } from './experiment-store';

export interface PendingSyncResult {
  entries: StoredDailyEntry[];
  syncedCount: number;
  failedCount: number;
}

/** Preserve pending local writes even when the server successfully returns an older snapshot. */
export function mergePendingEntries(
  serverEntries: readonly StoredDailyEntry[],
  localEntries: readonly StoredDailyEntry[],
): StoredDailyEntry[] {
  const entries = new Map(serverEntries.map(entry => [entry.date, entry]));
  for (const localEntry of localEntries) {
    if (localEntry.synced === false) entries.set(localEntry.date, localEntry);
  }
  return [...entries.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Retry all locally pending writes without dropping null fields or failed entries. */
export async function retryPendingEntries(
  entries: readonly StoredDailyEntry[],
  save: (entry: StoredDailyEntry) => Promise<boolean>,
): Promise<PendingSyncResult> {
  const nextEntries = entries.map(entry => ({ ...entry }));
  let syncedCount = 0;
  let failedCount = 0;
  for (let index = 0; index < nextEntries.length; index++) {
    const entry = nextEntries[index];
    if (entry.synced !== false) continue;
    try {
      if (await save(entry)) {
        entry.synced = true;
        syncedCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }
  return { entries: nextEntries, syncedCount, failedCount };
}
