import type {
  ConsentRecord,
  ExperimentSetupRecord,
  StoredDailyEntry,
} from './experiment-store';
import type { StoredExperimentPlan } from './plan-persistence';

export interface UserDataExportPayload {
  schemaVersion: 1;
  exportedAt: string;
  accountEmail: string | null;
  setup: ExperimentSetupRecord | null;
  consent: ConsentRecord | null;
  entries: readonly StoredDailyEntry[];
  plans: readonly {
    id: string;
    status: string;
    startDate: string;
    endDate: string;
    chosenDuration: number;
    cutoffTime: string;
    completedAt: string | null;
    verdictLabel: string | null;
    statement: string | null;
    conservativeEstimate: number | null;
  }[];
}

function extractCutoffTime(plan: StoredExperimentPlan): string {
  const rule = plan.plan.definition.conditionRule;
  if (
    rule &&
    'cutoffTime' in rule &&
    typeof (rule as { cutoffTime?: unknown }).cutoffTime === 'string'
  ) {
    return (rule as { cutoffTime: string }).cutoffTime;
  }
  return '12:00';
}

/**
 * Builds a clean, portable JSON representation of the user's sleep & caffeine log
 * and saved tests. Missing values remain explicit `null` (never coerced to zero).
 */
export function buildUserDataJson(input: {
  exportedAt: string;
  accountEmail: string | null;
  setup: ExperimentSetupRecord | null;
  consent: ConsentRecord | null;
  entries: readonly StoredDailyEntry[];
  plans: readonly StoredExperimentPlan[];
}): string {
  const sortedEntries = [...input.entries].sort((a, b) => a.date.localeCompare(b.date));
  const payload: UserDataExportPayload = {
    schemaVersion: 1,
    exportedAt: input.exportedAt,
    accountEmail: input.accountEmail,
    setup: input.setup,
    consent: input.consent,
    entries: sortedEntries,
    plans: input.plans.map((p) => {
      const endDate =
        p.plan.schedule[p.plan.schedule.length - 1]?.date ?? p.plan.startDate;
      return {
        id: p.id,
        status: p.status,
        startDate: p.plan.startDate,
        endDate,
        chosenDuration: p.plan.chosenDuration,
        cutoffTime: extractCutoffTime(p),
        completedAt: p.completed_at ?? null,
        verdictLabel: p.result?.verdictLabel ?? null,
        statement: p.result?.statement ?? null,
        conservativeEstimate: p.result?.conservativeEstimate ?? null,
      };
    }),
  };
  return JSON.stringify(payload, null, 2);
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds a spreadsheet-friendly CSV of every logged day.
 * Missing values are emitted as empty cells (never 0).
 */
export function buildEntriesCsv(entries: readonly StoredDailyEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const header = ['date', 'sleep_minutes', 'last_caffeine_time', 'synced', 'edited_at'].join(',');
  const rows = sorted.map((entry) => {
    const cells = [
      entry.date,
      entry.sleepMinutes !== null ? String(entry.sleepMinutes) : '',
      entry.lastCaffeineTime !== null ? String(entry.lastCaffeineTime) : '',
      entry.synced === false ? 'false' : 'true',
      entry.editedAt ?? '',
    ];
    return cells.map(escapeCsvCell).join(',');
  });
  return [header, ...rows].join('\n');
}
