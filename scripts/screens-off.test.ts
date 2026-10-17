import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSchedule } from '../src/engine';
import { CURRENT_CONSENT_VERSION } from '../src/experiment/consent';
import { addDaysToLocalDate } from '../src/experiment/dates';
import { validRunInDays } from '../src/experiment/adapter';
import { getHomeState } from '../src/experiment/home-state';
import { getExperimentLifecycleModel, getResultExplanationModel } from '../src/experiment/lifecycle';
import { buildResultSummary, causationCaveat } from '../src/experiment/result-summary';
import { conditionAction } from '../src/notifications/reminder-plan';
import {
  EXPERIMENTS,
  experimentForRuleType,
  exposureValue,
  cutoffRuleText,
} from '../src/experiment/experiments';
import { VERDICT_HEADINGS } from '../src/experiment/verdict-headings';
import type { DailyEntry, ExperimentPlan, ResultViewModel } from '../src/experiment/types';
import type { ConsentRecord, ExperimentSetupRecord } from '../src/data/experiment-store';
import type { StoredExperimentPlan } from '../src/data/plan-persistence';

/**
 * The screens-off test end to end, at the domain layer.
 *
 * The caffeine test is proven elsewhere; these tests exist so a screens test can never read
 * caffeine wording, count a night it never observed, or fall back to caffeine defaults.
 */

const TODAY = '2026-03-20';
const RUN_IN_START = addDaysToLocalDate(TODAY, -13);

function screenSetup(overrides: Partial<ExperimentSetupRecord> = {}): ExperimentSetupRecord {
  return {
    experimentId: 'screens-off-cutoff',
    cutoffTime: '21:30',
    screeningAnswer: 'usually',
    runInStartDate: RUN_IN_START,
    ...overrides,
  };
}

function currentConsent(granted = true): ConsentRecord {
  return {
    userId: 'u1',
    consentType: 'health-data',
    policyVersion: CURRENT_CONSENT_VERSION,
    granted,
    createdAt: '2026-03-01T00:00:00.000Z',
  };
}

function screenshotPlan(startDate: string, lengthDays = 14, status = 'scheduled'): StoredExperimentPlan {
  const design = { type: 'randomized-blocks' as const, blockLength: 2, balanceWeekends: true };
  const schedule = generateSchedule(startDate, lengthDays, design, 100);
  const plan: ExperimentPlan = {
    seed: 100,
    analysisSeed: 12345,
    chosenDuration: lengthDays,
    startDate,
    schedule,
    assumedAdherence: 0.9,
    assumedContamination: 0.1,
    baselineStats: { sd: 26, assumedAutocorrelation: 0.2, validDays: 14 },
    definition: {
      name: EXPERIMENTS['screens-off-cutoff'].name,
      startDate,
      lengthDays,
      design,
      seed: 100,
      outcomeMetric: 'sleepMinutes',
      conditionRule: { type: 'screen-cutoff', cutoffTime: '21:30' },
    },
    feasibilitySnapshot: {} as ExperimentPlan['feasibilitySnapshot'],
  };
  return { id: 'plan-screens-1', status, plan };
}

/** Fourteen run-in nights ending yesterday, with screen use logged where asked for. */
function runInNights(opts: { withScreenTime: boolean }): DailyEntry[] {
  return Array.from({ length: 14 }, (_, index) => ({
    date: addDaysToLocalDate(RUN_IN_START, index),
    sleepMinutes: 450 + (index % 3) * 10,
    lastCaffeineTime: '15:00',
    ...(opts.withScreenTime ? { lastScreenTime: index % 2 === 0 ? '22:15' : 'none' } : {}),
  }));
}

test('the screens test is reachable from its stored rule type and cutoff wording', () => {
  const info = experimentForRuleType('screen-cutoff');
  assert.equal(info.id, 'screens-off-cutoff');
  assert.equal(info.name, 'Screens-off cutoff');
  assert.equal(cutoffRuleText(info, '21:30'), 'no screens after 21:30');
  assert.equal(exposureValue({ date: TODAY, sleepMinutes: null, lastScreenTime: '22:10' }, 'screens'), '22:10');
  assert.equal(exposureValue({ date: TODAY, sleepMinutes: null, lastCaffeineTime: '11:00' }, 'screens'), null);
});

test('a screens run-in only counts nights whose screen time was logged', () => {
  const without = runInNights({ withScreenTime: false });
  const withScreens = runInNights({ withScreenTime: true });

  assert.equal(validRunInDays(without, [], TODAY, 'screens'), 0);
  assert.equal(validRunInDays(withScreens, [], TODAY, 'screens'), 14);
  // The caffeine rule is unchanged: sleep is what it needs.
  assert.equal(validRunInDays(without, [], TODAY, 'caffeine'), 14);
});

test('home state waits for screen-logged nights before it offers the check', () => {
  const sleepOnly = runInNights({ withScreenTime: false });
  const screens = runInNights({ withScreenTime: true });

  assert.equal(
    getHomeState({
      consent: currentConsent(),
      setup: screenSetup(),
      entries: sleepOnly,
      plan: null,
      plans: [],
      today: TODAY,
    }),
    'run_in',
  );
  assert.equal(
    getHomeState({
      consent: currentConsent(),
      setup: screenSetup(),
      entries: screens,
      plan: null,
      plans: [],
      today: TODAY,
    }),
    'feasibility_ready',
  );
});

test('an older consent wording is re-asked, and declining blocks logging', () => {
  const older: ConsentRecord = { ...currentConsent(), policyVersion: '2026-10-health-draft-v1' };
  const stateFor = (consent: ConsentRecord) =>
    getHomeState({ consent, setup: screenSetup(), entries: [], plan: null, plans: [], today: TODAY });

  assert.equal(stateFor(older), 'needs_consent');
  assert.equal(stateFor(currentConsent(false)), 'needs_consent');
  assert.equal(stateFor(currentConsent()), 'run_in');
});

test('the lifecycle model reads the screens test, not caffeine', () => {
  const active = screenshotPlan(addDaysToLocalDate(TODAY, -3));
  const model = getExperimentLifecycleModel({
    consent: currentConsent(),
    setup: screenSetup(),
    entries: [],
    activePlan: { ...active, status: 'scheduled' },
    historyPlans: [],
    today: TODAY,
  });

  assert.equal(model.detail.name, 'Screens-off cutoff');
  assert.equal(model.detail.experimentId, 'screens-off-cutoff');
  assert.equal(model.detail.exposureWord, 'screens');
  assert.equal(model.detail.cutoffTime, '21:30');

  const guide = model.guideSteps.map(step => step.description).join(' ');
  assert.match(guide, /used a screen/);
  assert.match(guide, /no screens after your cutoff time/);
  assert.doesNotMatch(guide, /caffeine/i);
});

test('without a plan the setup row decides the wording', () => {
  const model = getExperimentLifecycleModel({
    consent: currentConsent(),
    setup: null,
    entries: [],
    activePlan: null,
    historyPlans: [],
    today: TODAY,
  });
  assert.equal(model.detail.experimentId, 'caffeine-cutoff');

  const screens = getExperimentLifecycleModel({
    consent: currentConsent(),
    setup: screenSetup(),
    entries: [],
    activePlan: null,
    historyPlans: [],
    today: TODAY,
  });
  assert.equal(screens.detail.name, 'Screens-off cutoff');
  assert.equal(screens.detail.cutoffTime, '21:30');
});

test('a screens result names screen times and never caffeine', () => {
  const record = screenshotPlan(addDaysToLocalDate(TODAY, -20), 4);
  const entries: DailyEntry[] = record.plan.schedule.map((day, index) => ({
    date: day.date,
    sleepMinutes: 430 + index * 10,
    lastCaffeineTime: '15:00',
    lastScreenTime: index === 1 ? null : index === 2 ? 'none' : '22:10',
  }));
  const result: ResultViewModel = {
    verdictLabel: 'NO_DETECTABLE_EFFECT',
    statement: 'Engine statement, word for word.',
    reasons: ['Engine reason'],
    conservativeEstimate: null,
    interval: [-8, 9],
    ruledOut: 12,
    daysAnalyzed: { intervention: 2, control: 2 },
    daysExcluded: 0,
    missingOutcomeDays: 0,
    unknownExposureDays: 1,
    adherence: {
      estimand: 'itt',
      counts: { ADHERENT: 2, NON_ADHERENT: 0, CONTAMINATED: 1, CONTROL_CLEAN: 1, UNKNOWN: 0 },
      total: 4,
      known: 4,
      overallAdherence: 0.67,
      knownFraction: 1,
      interventionAdherence: 0.5,
      controlContamination: 0,
    },
    reducedAdherence: false,
    plannedPowerRecomputed: 0.8,
    plannedPowerSnapshot: 0.8,
    evaluatedAt: '2026-03-16T08:00:00.000Z',
  };

  const explanation = getResultExplanationModel(record.plan, result, entries);
  assert.equal(explanation.contributingDays.exposureWord, 'screens');
  assert.equal(explanation.contributingDays.unknownExposureDays, 1);
  assert.equal(explanation.underlyingDays[2].exposureText, 'No screens');
  assert.equal(explanation.underlyingDays[3].exposureText, 'Last screen 22:10');

  const allText = [
    explanation.statement,
    ...explanation.reasons,
    ...explanation.whatItTellsYou.doesTell,
    ...explanation.whatItTellsYou.doesNotTell,
    ...explanation.underlyingDays.map(day => day.exposureText),
    explanation.estimateExplanation.conservativeEstimateText,
  ].join(' ');
  assert.doesNotMatch(allText, /caffeine/i);
  assert.match(explanation.whatItTellsYou.doesNotTell.join(' '), /Screens are not separated/);
});

test('the plain-language caveat follows the exposure and never claims causation', () => {
  assert.equal(causationCaveat('screens'), 'This is a pattern in your own log. It does not prove that screens caused it.');
  assert.match(causationCaveat('screens'), /does not prove/);

  const summary = buildResultSummary({
    result: {
      verdictLabel: 'SUPPORTED',
      statement: '',
      reasons: [],
      conservativeEstimate: 30,
      interval: [20, 40],
      ruledOut: null,
      daysAnalyzed: { intervention: 10, control: 10 },
      daysExcluded: 0,
      missingOutcomeDays: 0,
      unknownExposureDays: 0,
      adherence: { counts: { ADHERENT: 9, NON_ADHERENT: 0, CONTAMINATED: 0, CONTROL_CLEAN: 0, UNKNOWN: 0 } } as never,
      reducedAdherence: false,
      plannedPowerRecomputed: null,
      plannedPowerSnapshot: null,
    } as ResultViewModel,
    verdictHeading: VERDICT_HEADINGS.SUPPORTED,
    cutoffTime: '21:30',
    plannedDays: 42,
    cutoffDaysPlanned: 21,
    exposureWord: 'screens',
  });
  assert.match(summary.caveat, /screens/);
  assert.equal(summary.takeaways[0], 'You kept the 21:30 cutoff on 9 of 21 cutoff days.');
});

test('the cutoff reminder describes the screens rule', () => {
  const screens = conditionAction({ type: 'screen-cutoff', cutoffTime: '21:30' } as never);
  assert.ok(screens);
  assert.equal(screens.body, 'No screens after 21:30 today.');
  assert.equal(screens.previewBody, 'Tomorrow: no screens after 21:30.');

  const caffeine = conditionAction({ type: 'caffeine-cutoff', cutoffTime: '12:00' } as never);
  assert.equal(caffeine?.body, 'No caffeine after 12:00 today.');

  assert.equal(conditionAction({ type: 'cold-plunge', cutoffTime: '12:00' } as never), null);
});
