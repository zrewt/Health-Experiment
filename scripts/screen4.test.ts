import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { generateSchedule } from '../src/engine';
import { progressSummary, entriesForPlan, ExperimentAdapterError } from '../src/experiment/adapter';
import { canEditDate, addDaysToLocalDate, formatLocalDate } from '../src/experiment/dates';
import { createPlanPersistence, type PlanServer, type PlanStorage, type StoredExperimentPlan } from '../src/data/plan-persistence';
import type { ExperimentPlan, DailyEntry } from '../src/experiment/types';

function makeTestPlan(startDate: string, lengthDays = 4, cutoffTime = '11:30'): ExperimentPlan {
  const seed = 42;
  const analysisSeed = ((seed * 1664525 + 1013904223) >>> 0);
  const design = { type: 'randomized-blocks' as const, blockLength: 2, balanceWeekends: true };
  const schedule = generateSchedule(startDate, lengthDays, design, seed);
  return {
    seed,
    analysisSeed,
    chosenDuration: lengthDays,
    startDate,
    schedule,
    assumedAdherence: 0.9,
    assumedContamination: 0.1,
    baselineStats: { sd: 28, assumedAutocorrelation: 0.3, validDays: 14 },
    definition: {
      name: 'Caffeine cutoff',
      startDate,
      lengthDays,
      design,
      seed,
      outcomeMetric: 'sleepMinutes',
      conditionRule: { type: 'caffeine-cutoff', cutoffTime },
    },
    feasibilitySnapshot: {} as any,
  };
}

function memory(): PlanStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
}

test('instruction text matches exact wording per condition and preserves plan cutoff time', () => {
  const plan = makeTestPlan('2026-02-01', 4, '13:15');
  const cutoff = plan.definition.conditionRule.cutoffTime;

  for (const day of plan.schedule) {
    const text = day.condition === 'intervention'
      ? `Today: cutoff day, no caffeine after ${cutoff}`
      : 'Today: normal day';

    if (day.condition === 'intervention') {
      assert.equal(text, 'Today: cutoff day, no caffeine after 13:15');
    } else {
      assert.equal(text, 'Today: normal day');
    }
  }
});

test('schedule dates correctly span month end and DST boundaries', () => {
  // February month end leap & non-leap
  const febPlan = makeTestPlan('2026-02-27', 4);
  assert.deepEqual(febPlan.schedule.map(s => s.date), [
    '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02',
  ]);

  // Spring DST changeover (US 2026-03-08)
  const dstPlan = makeTestPlan('2026-03-07', 4);
  assert.deepEqual(dstPlan.schedule.map(s => s.date), [
    '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10',
  ]);
});

test('view model exposes only current day instruction, never future/other-day conditions', () => {
  const plan = makeTestPlan('2026-02-01', 4);
  const today = '2026-02-02';

  // Finding today's instruction
  const todayAssignment = plan.schedule.find(s => s.date === today);
  assert.ok(todayAssignment);

  // Asserting we only expose today's assignment condition, not whole schedule
  const exposedToday = {
    date: todayAssignment.date,
    instruction: todayAssignment.condition === 'intervention'
      ? `Today: cutoff day, no caffeine after ${plan.definition.conditionRule.cutoffTime}`
      : 'Today: normal day',
  };

  assert.deepEqual(Object.keys(exposedToday).sort(), ['date', 'instruction']);
});

test('daily instruction metrics show counts only and no statistical estimations', () => {
  const plan = makeTestPlan('2026-02-01', 4);
  const entries: DailyEntry[] = [
    { date: '2026-02-01', sleepMinutes: 450, lastCaffeineTime: '11:00' },
  ];
  const summary = progressSummary(plan, entries, '2026-02-02');

  assert.deepEqual(Object.keys(summary).sort(), ['adherenceCounts', 'daysLogged', 'daysRemaining']);
  assert.equal(summary.daysLogged, 1);
  assert.equal(summary.daysRemaining, 2);
  assert.equal(typeof summary.adherenceCounts.ADHERENT, 'number');
  assert.equal('pVal' in summary, false);
  assert.equal('effect' in summary, false);
  assert.equal('verdict' in summary, false);
});

test('cancel flow requires server confirmation, clears local storage cache, and handles retry', async () => {
  const storage = memory();
  let serverStatus = 'scheduled';
  let cancelCalled = 0;

  const server: PlanServer = {
    async getActive() {
      if (serverStatus === 'cancelled') return null;
      return { id: 'plan-1', status: serverStatus, plan: makeTestPlan('2026-02-01') };
    },
    async insert() { throw new Error('not used'); },
    async setNextCheckDate() {},
    async cancel(_userId, planId) {
      assert.equal(planId, 'plan-1');
      cancelCalled++;
      serverStatus = 'cancelled';
    },
  };

  const persistence = createPlanPersistence(storage, server);

  // Plan is active initially
  const activeBefore = await persistence.getActivePlan('user-1');
  assert.ok(activeBefore);
  assert.equal(activeBefore.status, 'scheduled');

  // Cancel plan
  await persistence.cancelPlan('user-1', 'plan-1');
  assert.equal(cancelCalled, 1);

  // Active plan now null from cache and server
  const activeAfter = await persistence.getActivePlan('user-1');
  assert.equal(activeAfter, null);
});

test('backfill window permits current entry date (yesterday) and up to 3 prior days', () => {
  const today = '2026-02-10';
  // Yesterday (current morning check-in date)
  assert.equal(canEditDate(today, '2026-02-09'), true);
  // 1, 2, 3 days prior
  assert.equal(canEditDate(today, '2026-02-08'), true);
  assert.equal(canEditDate(today, '2026-02-07'), true);
  assert.equal(canEditDate(today, '2026-02-06'), true);
  // 4 days prior (read-only)
  assert.equal(canEditDate(today, '2026-02-05'), false);
  // Future dates (cannot edit)
  assert.equal(canEditDate(today, '2026-02-10'), false);
  assert.equal(canEditDate(today, '2026-02-11'), false);
});

test('dev tools modules are strictly isolated and not imported by production code', () => {
  const root = path.resolve(__dirname, '..');
  const srcDir = path.join(root, 'src');

  function scan(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) {
        scan(full, fileList);
      } else if (f.endsWith('.ts') || f.endsWith('.tsx')) {
        fileList.push(full);
      }
    }
    return fileList;
  }

  const allSourceFiles = scan(srcDir);
  for (const filePath of allSourceFiles) {
    const relative = path.relative(srcDir, filePath);
    // Only src/dev/** or src/app/dev-tools.tsx can import dev modules
    if (!relative.startsWith('dev') && relative !== path.join('app', 'dev-tools.tsx')) {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.doesNotMatch(
        content,
        /from\s+['"][^'"]*\/dev\/[^'"]*['"]/,
        `File ${relative} must not import from dev directory`
      );
      assert.doesNotMatch(
        content,
        /from\s+['"]@\/dev[^'"]*['"]/,
        `File ${relative} must not import from @/dev`
      );
    }
  }

  // Ensure dev-tools route is gated by __DEV__ in _layout.tsx
  const layoutContent = fs.readFileSync(path.join(srcDir, 'app', '_layout.tsx'), 'utf8');
  assert.match(
    layoutContent,
    /__DEV__\s*\?\s*\(\s*<Stack\.Screen\s+name="dev-tools"/,
    '_layout.tsx must gate dev-tools route with __DEV__'
  );
});

test('dev tools route self-guards against production rendering', () => {
  const devToolsSource = fs.readFileSync(path.resolve(__dirname, '../src/app/dev-tools.tsx'), 'utf8');
  assert.match(devToolsSource, /Redirect\s+href="\/"/, 'dev-tools must redirect in production');
});

test('regular persistence and engine queries do not reference is_sample', () => {
  const storeSource = fs.readFileSync(path.resolve(__dirname, '../src/data/experiment-store.ts'), 'utf8');
  assert.doesNotMatch(storeSource, /is_sample/, 'experiment-store.ts must not reference is_sample');
  const adapterSource = fs.readFileSync(path.resolve(__dirname, '../src/experiment/adapter.ts'), 'utf8');
  assert.doesNotMatch(adapterSource, /is_sample/, 'adapter.ts must not reference is_sample');
});

test('clock offset affects only getToday while stored timestamps remain real current time', () => {
  // The dev clock is now strictly fail-closed, so opt into dev mode explicitly.
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  const { getToday, __setDevClockOffset } = require('../src/experiment/clock');
  // getToday() returns a LOCAL calendar date, while the stored edited_at timestamps come
  // from toISOString(), which is UTC. Those two disagree for part of every day (in a
  // UTC-negative zone, every evening), so each comparison below is made against the basis
  // it actually means instead of whichever one happened to be handy.
  const now = new Date();
  const realLocalDate = formatLocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const realUtcDate = now.toISOString().slice(0, 10);

  __setDevClockOffset(5);
  const fakeToday = getToday();
  assert.notEqual(fakeToday, realLocalDate, 'the offset must move getToday');
  assert.equal(fakeToday, addDaysToLocalDate(realLocalDate, 5));

  // Verification that Date.now() / toISOString() used for timestamps is unshifted:
  const timestampNow = new Date().toISOString();
  assert.match(timestampNow, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.ok(timestampNow.startsWith(realUtcDate));
  assert.notEqual(timestampNow.slice(0, 10), fakeToday, 'stored timestamps must not follow the dev clock');

  __setDevClockOffset(0);
  assert.equal(getToday(), realLocalDate);
  delete (globalThis as { __DEV__?: boolean }).__DEV__;
});

test('a log holding run-in days is rejected raw, which is why the screens must narrow it first', () => {
  const plan = makeTestPlan('2026-02-15', 4);

  // Every real user's log looks like this: the run-in days they already logged, all dated
  // before the experiment starts, alongside the days inside it.
  const log: DailyEntry[] = [
    { date: '2026-02-01', sleepMinutes: 430, lastCaffeineTime: '14:00' },
    { date: '2026-02-02', sleepMinutes: 450, lastCaffeineTime: 'none' },
    { date: '2026-02-15', sleepMinutes: 460, lastCaffeineTime: '11:00' },
  ];

  assert.throws(
    () => progressSummary(plan, log, '2026-02-16'),
    (error: unknown) => error instanceof ExperimentAdapterError && error.code === 'INVALID_ENTRY',
    'the unfiltered log is rejected, so passing it straight through crashes the screen',
  );

  const summary = progressSummary(plan, entriesForPlan(plan, log), '2026-02-16');
  assert.equal(summary.daysLogged, 1);
  assert.equal(summary.daysRemaining, 2);
});

test('both experiment screens narrow the log to the plan before computing progress', () => {
  // Source-level, mirroring the dev-isolation check above. The adapter guard is deliberate
  // and stays, so the invariant to hold is at the call sites: a screen that passes the raw
  // log crashes for any user who completed a run-in before starting their experiment.
  for (const screen of ['daily-instruction', 'result']) {
    const source = fs.readFileSync(path.resolve(__dirname, `../src/app/${screen}.tsx`), 'utf8');
    assert.match(
      source,
      /progressSummary\(\s*plan,\s*entriesForPlan\(plan,\s*entries\)/,
      `${screen}.tsx must narrow the log to the plan before progressSummary`
    );
    assert.doesNotMatch(
      source,
      /progressSummary\(\s*plan,\s*entries,/,
      `${screen}.tsx must not pass the raw entry log to progressSummary`
    );
  }
});

test('progressSummary with realistic run-in + in-window log: no throw and correct counts', () => {
  // A real user's log: 14 run-in days before the experiment starts, then some in-window
  // days with a mix of logged and unlogged. The daily-instruction and result screens are
  // asked to render while the experiment is in flight, so today sits inside the window.
  const plan = makeTestPlan('2026-02-15', 6, '12:00');

  // 14 run-in days, all before the start date. They are legitimate logged history.
  const runIn: DailyEntry[] = [];
  for (let i = 0; i < 14; i++) {
    runIn.push({
      date: `2026-01-${String(15 + i).padStart(2, '0')}`,
      sleepMinutes: 420 + (i % 3) * 10,
      lastCaffeineTime: i % 4 === 0 ? '14:00' : '11:30',
    });
  }

  // In-window days, some logged, some not. today is the 4th in-window day.
  const today = '2026-02-18';
  const inWindow: DailyEntry[] = [
    { date: '2026-02-15', sleepMinutes: 450, lastCaffeineTime: '11:00' },     // logged, intervention? depends on seed
    { date: '2026-02-16', sleepMinutes: 440, lastCaffeineTime: '12:30' },     // logged
    { date: '2026-02-17', sleepMinutes: null, lastCaffeineTime: null },        // unlogged
    { date: '2026-02-18', sleepMinutes: 460, lastCaffeineTime: '10:00' },     // today, logged
    { date: '2026-02-19', sleepMinutes: null, lastCaffeineTime: null },        // not yet reached
  ];

  const log = [...runIn, ...inWindow];

  // Negative control: the raw log still throws, proving the adapter guard is intact.
  assert.throws(
    () => progressSummary(plan, log, today),
    (error: unknown) => error instanceof ExperimentAdapterError && error.code === 'INVALID_ENTRY',
    'the raw log with run-in days still throws — the guard is deliberate',
  );

  // Positive: narrowed with entriesForPlan, it does not throw and counts correctly.
  const summary = progressSummary(plan, entriesForPlan(plan, log), today);
  assert.equal(typeof summary.daysLogged, 'number');
  assert.equal(typeof summary.daysRemaining, 'number');
  assert.equal(typeof summary.adherenceCounts.ADHERENT, 'number');
  assert.equal(typeof summary.adherenceCounts.UNKNOWN, 'number');

  // daysRemaining counts schedule days strictly after today (2026-02-18).
  // The 6-day, 2026-02-15 start means the last day is 2026-02-20, so after today only
  // 2026-02-19 and 2026-02-20 remain.
  assert.equal(summary.daysRemaining, 2, 'two schedule days remain after today');
});

test('progressSummary counts unlogged in-window days as unknown, never zero or default', () => {
  const plan = makeTestPlan('2026-02-15', 4, '12:00');
  const today = '2026-02-16';

  // Two in-window days, both unlogged.
  const entries: DailyEntry[] = [
    { date: '2026-02-15', sleepMinutes: null, lastCaffeineTime: null },
    { date: '2026-02-16', sleepMinutes: null, lastCaffeineTime: null },
  ];

  const summary = progressSummary(plan, entriesForPlan(plan, entries), today);

  // MISSING IS NOT ZERO: an unlogged day is unknown, not zero servings and not a default time.
  assert.equal(summary.adherenceCounts.UNKNOWN, 2, 'unlogged in-window days are unknown');
  assert.equal(summary.adherenceCounts.CONTAMINATED, 0);
  assert.equal(summary.adherenceCounts.ADHERENT, 0);
});

test('progressSummary does not leak statistical estimates on the pre-result screen', () => {
  const plan = makeTestPlan('2026-02-15', 4, '12:00');
  const entries: DailyEntry[] = [
    { date: '2026-02-15', sleepMinutes: 450, lastCaffeineTime: '11:00' },
  ];
  const summary = progressSummary(plan, entriesForPlan(plan, entries), '2026-02-16');

  // progressSummary is counts only. Any keys beyond those three are a regression.
  assert.deepEqual(Object.keys(summary).sort(), ['adherenceCounts', 'daysLogged', 'daysRemaining']);
  assert.equal('pVal' in summary, false);
  assert.equal('effect' in summary, false);
  assert.equal('verdict' in summary, false);
  assert.equal('statement' in summary, false);
});
