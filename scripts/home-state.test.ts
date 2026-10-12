import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getHomeState, HomeStateInputs } from '../src/experiment/home-state';
import { getToday, __setDevClockOffset } from '../src/experiment/clock';
import type { StoredExperimentPlan } from '../src/data/plan-persistence';
import type { ExperimentPlan } from '../src/experiment/types';

const defaultConsent = {
  userId: 'user-1',
  consentType: 'health-data' as const,
  policyVersion: '2026-10-health-draft-v1',
  granted: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const defaultSetup = {
  experimentId: 'caffeine-cutoff',
  cutoffTime: '12:00',
  screeningAnswer: 'usually' as const,
  runInStartDate: '2026-01-01',
};

function makePlan(startDate: string, lengthDays = 4, status = 'scheduled'): StoredExperimentPlan {
  const schedule = [
    { date: '2026-01-15', condition: 'intervention' as const, blockIndex: 0 },
    { date: '2026-01-16', condition: 'intervention' as const, blockIndex: 0 },
    { date: '2026-01-17', condition: 'control' as const, blockIndex: 1 },
    { date: '2026-01-18', condition: 'control' as const, blockIndex: 1 },
  ];
  return {
    id: 'plan-1',
    status,
    plan: {
      seed: 1234,
      analysisSeed: 5678,
      startDate,
      chosenDuration: lengthDays,
      schedule,
      assumedAdherence: 0.9,
      assumedContamination: 0.1,
      baselineStats: { sd: 30, assumedAutocorrelation: 0.4, validDays: 14 },
      definition: {
        name: 'Caffeine cutoff',
        startDate,
        lengthDays,
        design: { type: 'randomized-blocks', blockLength: 2, balanceWeekends: true },
        seed: 1234,
        outcomeMetric: 'sleepMinutes',
        conditionRule: { type: 'caffeine-cutoff', cutoffTime: '12:00' },
      },
      feasibilitySnapshot: {} as any,
    },
  };
}

test('getHomeState returns needs_consent when consent is missing or ungranted', () => {
  assert.equal(getHomeState({
    consent: null,
    setup: defaultSetup,
    entries: [],
    plan: null,
    today: '2026-01-01',
  }), 'needs_consent');

  assert.equal(getHomeState({
    consent: { ...defaultConsent, granted: false },
    setup: defaultSetup,
    entries: [],
    plan: null,
    today: '2026-01-01',
  }), 'needs_consent');
});

test('getHomeState returns needs_setup when setup is missing', () => {
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: null,
    entries: [],
    plan: null,
    today: '2026-01-01',
  }), 'needs_setup');
});

test('getHomeState returns run_in during baseline logging', () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({
    date: `2026-01-0${i + 1}`,
    sleepMinutes: 420,
    lastCaffeineTime: '14:00',
  }));
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries,
    plan: null,
    today: '2026-01-06',
  }), 'run_in');
});

test('getHomeState returns feasibility_ready at 14 valid days or nextCheckDate', () => {
  const entries = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    sleepMinutes: 420,
    lastCaffeineTime: '14:00',
  }));
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries,
    plan: null,
    today: '2026-01-15',
  }), 'feasibility_ready');

  // Deferred nextCheckDate in the future
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: { ...defaultSetup, nextCheckDate: '2026-01-20' },
    entries,
    plan: null,
    today: '2026-01-15',
  }), 'run_in');

  // Deferred nextCheckDate reached
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: { ...defaultSetup, nextCheckDate: '2026-01-20' },
    entries,
    plan: null,
    today: '2026-01-20',
  }), 'feasibility_ready');
});

test('getHomeState transitions across scheduled, active, awaiting final, and result ready', () => {
  const plan = makePlan('2026-01-15'); // Last exposure date 2026-01-18

  // Before start date
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan,
    today: '2026-01-14',
  }), 'plan_scheduled');

  // Active during schedule
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan,
    today: '2026-01-15',
  }), 'plan_active');

  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan,
    today: '2026-01-18',
  }), 'plan_active');

  // Day after last exposure date, final night not yet logged
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan,
    today: '2026-01-19',
  }), 'plan_awaiting_final');

  // Day after last exposure date, not yet completed: plan_awaiting_final
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [{ date: '2026-01-18', sleepMinutes: 440, lastCaffeineTime: 'none' }],
    plan,
    today: '2026-01-19',
  }), 'plan_awaiting_final');

  // Completed status (stored snapshot exists): plan_result_ready
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [{ date: '2026-01-18', sleepMinutes: 440, lastCaffeineTime: 'none' }],
    plan: { ...plan, status: 'completed' },
    today: '2026-01-19',
  }), 'plan_result_ready');
});

test('getHomeState returns plan_ended_early when plan status is cancelled', () => {
  const cancelledPlan = makePlan('2026-01-15', 4, 'cancelled');
  assert.equal(getHomeState({
    consent: defaultConsent,
    setup: defaultSetup,
    entries: [],
    plan: cancelledPlan,
    today: '2026-01-16',
  }), 'plan_ended_early');
});

test('dev clock offset shifts getToday in dev environment', () => {
  // The dev clock is now strictly fail-closed, so opt into dev mode explicitly.
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  __setDevClockOffset(0);
  const base = getToday();
  __setDevClockOffset(3);
  assert.notEqual(getToday(), base);
  __setDevClockOffset(0);
  assert.equal(getToday(), base);
  delete (globalThis as { __DEV__?: boolean }).__DEV__;
});
