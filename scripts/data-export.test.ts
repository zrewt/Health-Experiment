import { CURRENT_CONSENT_VERSION } from '../src/experiment/consent';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEntriesCsv, buildUserDataJson } from '../src/data/data-export';
import type { StoredDailyEntry } from '../src/data/experiment-store';
import type { StoredExperimentPlan } from '../src/data/plan-persistence';

const sampleEntries: StoredDailyEntry[] = [
  {
    date: '2026-02-12',
    sleepMinutes: 450,
    lastCaffeineTime: '14:30',
    editedAt: '2026-02-13T08:00:00.000Z',
    synced: true,
  },
  {
    date: '2026-02-10',
    sleepMinutes: null,
    lastCaffeineTime: null,
    editedAt: '2026-02-11T08:00:00.000Z',
    synced: false,
  },
  {
    date: '2026-02-11',
    sleepMinutes: 420,
    lastCaffeineTime: 'none',
    editedAt: '2026-02-12T08:00:00.000Z',
    synced: true,
  },
];

const samplePlan: StoredExperimentPlan = {
  id: 'plan-1',
  status: 'completed',
  completed_at: '2026-02-15T09:00:00.000Z',
  plan: {
    seed: 100,
    analysisSeed: 200,
    chosenDuration: 14,
    startDate: '2026-02-01',
    schedule: [
      { date: '2026-02-01', condition: 'intervention', blockIndex: 0 },
      { date: '2026-02-14', condition: 'control', blockIndex: 6 },
    ],
    assumedAdherence: 0.9,
    assumedContamination: 0.1,
    baselineStats: { sd: 26, assumedAutocorrelation: 0.2, validDays: 14 },
    definition: {
      name: 'Caffeine cutoff',
      startDate: '2026-02-01',
      lengthDays: 14,
      design: { type: 'randomized-blocks', blockLength: 2, balanceWeekends: true },
      seed: 100,
      outcomeMetric: 'sleepMinutes',
      conditionRule: { type: 'caffeine-cutoff', cutoffTime: '12:00' },
    },
    feasibilitySnapshot: {} as never,
  },
  result: {
    verdictLabel: 'SUPPORTED',
    statement: 'Exact engine statement verbatim.',
    reasons: [],
    conservativeEstimate: 18,
    interval: [8, 28],
    ruledOut: null,
    daysAnalyzed: { intervention: 7, control: 7 },
    daysExcluded: 0,
    missingOutcomeDays: 0,
    unknownExposureDays: 0,
    adherence: {
      estimand: 'itt',
      counts: { ADHERENT: 7, NON_ADHERENT: 0, CONTAMINATED: 0, CONTROL_CLEAN: 7, UNKNOWN: 0 },
      total: 14,
      known: 14,
      overallAdherence: 1,
      knownFraction: 1,
      interventionAdherence: 1,
      controlContamination: 0,
    },
    reducedAdherence: false,
    plannedPowerRecomputed: 0.8,
    plannedPowerSnapshot: 0.8,
    evaluatedAt: '2026-02-15T09:00:00.000Z',
  },
};

test('buildUserDataJson sorts entries by date and preserves null missing values (never zero)', () => {
  const json = buildUserDataJson({
    exportedAt: '2026-02-16T10:00:00.000Z',
    accountEmail: 'user@example.com',
    setup: {
      experimentId: 'caffeine-cutoff',
      cutoffTime: '12:00',
      screeningAnswer: 'usually',
      runInStartDate: '2026-01-15',
    },
    consent: {
      userId: 'u1',
      consentType: 'health-data',
      policyVersion: CURRENT_CONSENT_VERSION,
      granted: true,
      createdAt: '2026-01-15T08:00:00.000Z',
    },
    entries: sampleEntries,
    plans: [samplePlan],
  });

  const parsed = JSON.parse(json);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.accountEmail, 'user@example.com');
  assert.deepEqual(
    parsed.entries.map((e: { date: string }) => e.date),
    ['2026-02-10', '2026-02-11', '2026-02-12'],
  );
  // Missing stays null, never 0
  assert.equal(parsed.entries[0].sleepMinutes, null);
  assert.equal(parsed.entries[0].lastCaffeineTime, null);
  assert.equal(parsed.entries[0].synced, false);

  assert.equal(parsed.plans.length, 1);
  assert.equal(parsed.plans[0].startDate, '2026-02-01');
  assert.equal(parsed.plans[0].endDate, '2026-02-14');
  assert.equal(parsed.plans[0].verdictLabel, 'SUPPORTED');
  assert.equal(parsed.plans[0].statement, 'Exact engine statement verbatim.');
  assert.equal(parsed.plans[0].conservativeEstimate, 18);
});

test('buildEntriesCsv emits empty cells for missing values and sorts chronologically', () => {
  const csv = buildEntriesCsv(sampleEntries);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'date,sleep_minutes,last_caffeine_time,synced,edited_at');
  assert.equal(lines[1], '2026-02-10,,,false,2026-02-11T08:00:00.000Z');
  assert.equal(lines[2], '2026-02-11,420,none,true,2026-02-12T08:00:00.000Z');
  assert.equal(lines[3], '2026-02-12,450,14:30,true,2026-02-13T08:00:00.000Z');
});
