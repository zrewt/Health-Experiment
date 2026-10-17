import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as engine from '../src/engine';
import {
  assertCutoffTime,
  assessFeasibility,
  computeBaseline,
  computeExperimentBaseline,
  computeScreenBaseline,
  getFeasibilityScreenState,
  startExperiment,
} from '../src/experiment/adapter';
import { getRunInDescriptiveStats } from '../src/experiment/view-model';
import { addDaysToLocalDate } from '../src/experiment/dates';
import { runInMinValidDays } from '../src/experiment/config';
import type { BaselineSummary, DailyEntry, FeasibilityLookup } from '../src/experiment/types';

/**
 * The two experiments must read the time the user actually chose, through the rule of the
 * test they are running. These tests pin the shared baseline entry point, the screens rule
 * injection and the plain copy that names the cutoff.
 */

const FIRST = '2026-02-01';

function nights(count = runInMinValidDays): DailyEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    date: addDaysToLocalDate(FIRST, index),
    sleepMinutes: 440 + (index % 4) * 10,
    lastCaffeineTime: index % 2 === 0 ? '13:00' : '15:00',
  }));
}

function isAdapterError(code: string) {
  return (error: unknown) =>
    error instanceof Error && (error as { code?: string }).code === code;
}

const baseline: BaselineSummary = {
  validDays: 14, targetDays: 14, sd: 25, eligible: true,
  reasons: [], engineReasons: [], lateCaffeineDays: 9, knownExposureDays: 12, unknownExposureDays: 2,
};

function lookup(mde: number | 'not reachable within the duration' | null): FeasibilityLookup {
  return () => ({
    status: mde === null ? 'unknown' : 'ok',
    minimumDetectableEffect70: mde,
    detectionProbabilityAtMinimumEffect: mde === null ? null : 0.3,
    statement: 'Engine sentence.',
  });
}

const setup = { cutoffTime: '12:00' };

test('the caffeine baseline reads the chosen cutoff, not the noon default', () => {
  const entries = nights();
  const atNoon = computeBaseline(entries, engine, '12:00');
  const atTwo = computeBaseline(entries, engine, '14:00');

  // 13:00 coffees are late against 12:00 and on time against 14:00.
  assert.equal(atNoon.lateCaffeineDays, 14);
  assert.equal(atTwo.lateCaffeineDays, 7);
  assert.equal(atNoon.knownExposureDays, 14);
  assert.equal(atTwo.knownExposureDays, 14);
  // The sleep baseline is unaffected by where the cutoff sits.
  assert.equal(atNoon.sd, atTwo.sd);
  assert.equal(atNoon.validDays, 14);
});

test('the screens baseline reads screen times only and honours its own cutoff', () => {
  const entries: DailyEntry[] = nights().map(entry => ({
    ...entry,
    // Caffeine is present every day, but the screens test must never read it.
    lastCaffeineTime: '15:00',
    lastScreenTime: '22:15',
  }));

  const at2130 = computeExperimentBaseline('screens', entries, { cutoffTime: '21:30' });
  const at2230 = computeExperimentBaseline('screens', entries, { cutoffTime: '22:30' });
  assert.equal(at2130.lateCaffeineDays, 14);
  assert.equal(at2230.lateCaffeineDays, 0);
  assert.equal(at2130.unknownExposureDays, 0);

  // A missing screen time stays unknown even when caffeine was logged.
  const missing = entries.map(entry => ({ ...entry, lastScreenTime: null }));
  const screens = computeExperimentBaseline('screens', missing, { cutoffTime: '21:30' });
  assert.equal(screens.unknownExposureDays, 14);
  assert.equal(screens.lateCaffeineDays, 0);
});

test('the screens baseline goes through the injected engine, not the real one', () => {
  let seenCutoff: string | null = null;
  const facade = {
    ...engine,
    checkScreenEligibility: (_records: unknown, config: { cutoffTime?: string } = {}) => {
      seenCutoff = config.cutoffTime ?? null;
      return {
        estimand: 'stub', eligible: true, runInDaysCount: 14, lateCaffeineDaysCount: 4,
        knownExposureDaysCount: 14, unknownExposureDaysCount: 0, lateCaffeineShare: 4 / 14,
        baselineOutcomeMean: 450, baselineOutcomeSd: 30, reasons: [],
      };
    },
  };

  const summary = computeScreenBaseline(nights(), facade, '22:30');
  assert.equal(seenCutoff, '22:30');
  assert.equal(summary.lateCaffeineDays, 4);
  assert.equal(summary.eligible, true);
});

test('one baseline entry point picks the rule that belongs to the test', () => {
  const screens = nights().map(entry => ({ ...entry, lastScreenTime: 'none' as const }));
  assert.equal(computeExperimentBaseline('caffeine', screens, { cutoffTime: '12:00' }).lateCaffeineDays, 14);
  assert.equal(computeExperimentBaseline('screens', screens, { cutoffTime: '21:30' }).lateCaffeineDays, 0);

  const caffeineOnly = computeExperimentBaseline('caffeine', nights());
  // The default is the caffeine test's own default, so callers may omit the cutoff.
  assert.equal(caffeineOnly.lateCaffeineDays, 14);
  assert.equal(caffeineOnly.engineReasons.length > 0, true);
});

test('a cutoff must be a real clock time before a plan can be built', () => {
  assert.doesNotThrow(() => assertCutoffTime('00:00'));
  assert.doesNotThrow(() => assertCutoffTime('23:59'));
  assert.throws(() => assertCutoffTime('9:30'), isAdapterError('INVALID_CUTOFF'));
  assert.throws(() => assertCutoffTime('24:00'), isAdapterError('INVALID_CUTOFF'));
  assert.throws(() => assertCutoffTime('noon'), isAdapterError('INVALID_CUTOFF'));

  const feasibility = assessFeasibility(baseline, lookup(30));
  const duration = feasibility.defaultDuration;
  assert.ok(duration);
  assert.throws(
    () => startExperiment(baseline, feasibility, duration, '2026-03-01', true, 42, engine, '9:30'),
    isAdapterError('INVALID_CUTOFF'),
  );
});

test('the check screen names the cutoff the user picked, for both tests', () => {
  const symptom: BaselineSummary = { ...baseline, eligible: false };

  const caffeine = getFeasibilityScreenState(symptom, assessFeasibility(symptom), { cutoffTime: '14:00' }, 'caffeine');
  assert.equal(caffeine.kind, 'ineligible');
  if (caffeine.kind !== 'ineligible') assert.fail();
  assert.deepEqual(caffeine.detailFacts, [
    'You logged caffeine after 14:00 on 9 of 14 days.',
    '2 days had no caffeine time logged, so they do not count. Log it every morning.',
  ]);

  const screens = getFeasibilityScreenState(symptom, assessFeasibility(symptom), { cutoffTime: '22:30' }, 'screens');
  assert.equal(screens.kind, 'ineligible');
  if (screens.kind !== 'ineligible') assert.fail();
  assert.deepEqual(screens.detailFacts, [
    'You used screens after 22:30 on 9 of 14 nights.',
    '2 nights had no screen time logged, so they do not count. Log it every morning.',
  ]);
});

test('run-in read-backs use the active rule and the active cutoff', () => {
  const entries: DailyEntry[] = nights().map(entry => ({ ...entry, lastScreenTime: 'none' as const }));

  const caffeine = getRunInDescriptiveStats(entries, '14:00', 'caffeine');
  assert.equal(caffeine.afterCutoffDays, 7);
  assert.equal(caffeine.unknownExposureDays, 0);
  assert.equal(caffeine.validDays, 14);
  // The deprecated caffeine-only names still mirror the new fields.
  assert.equal(caffeine.afternoonCaffeineDays, caffeine.afterCutoffDays);

  const screens = getRunInDescriptiveStats(entries, '21:30', 'screens');
  assert.equal(screens.afterCutoffDays, 0);
  assert.equal(screens.unknownExposureDays, 0);
  assert.equal(screens.daysLogged, 14);
});
