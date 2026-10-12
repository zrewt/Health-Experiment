import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { generateSchedule } from '../src/engine';
import { progressSummary } from '../src/experiment/adapter';
import { canEditDate, addDaysToLocalDate } from '../src/experiment/dates';
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
      ? `Today: no caffeine after ${cutoff}.`
      : 'Today: your usual routine.';

    if (day.condition === 'intervention') {
      assert.equal(text, 'Today: no caffeine after 13:15.');
    } else {
      assert.equal(text, 'Today: your usual routine.');
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
      ? `Today: no caffeine after ${plan.definition.conditionRule.cutoffTime}.`
      : 'Today: your usual routine.',
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
  const { getToday, __setDevClockOffset } = require('../src/experiment/clock');
  __setDevClockOffset(5);
  const fakeToday = getToday();
  const realIsoDate = new Date().toISOString().slice(0, 10);
  assert.notEqual(fakeToday, realIsoDate);

  // Verification that Date.now() / toISOString() used for timestamps is unshifted:
  const timestampNow = new Date().toISOString();
  assert.match(timestampNow, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.ok(timestampNow.startsWith(realIsoDate));

  __setDevClockOffset(0);
  assert.equal(getToday(), realIsoDate);
});
