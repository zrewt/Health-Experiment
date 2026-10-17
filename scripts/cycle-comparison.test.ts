import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StoredExperimentPlan } from '../src/data/plan-persistence';
import { buildCycleComparison } from '../src/experiment/cycle-comparison';

/** Only the fields the comparison reads are filled; the rest of a plan is not needed here. */
function finishedPlan(
  id: string,
  startDate: string,
  cutoffTime: string,
  adherent: number,
  estimate: number | null,
  status = 'completed',
  ruleType: 'caffeine-cutoff' | 'screen-cutoff' = 'caffeine-cutoff',
): StoredExperimentPlan {
  return {
    id,
    status,
    plan: {
      startDate,
      chosenDuration: 42,
      schedule: [{ date: startDate, condition: 'control', blockIndex: 0 }],
      definition: { conditionRule: { type: ruleType, cutoffTime } },
    },
    result:
      status === 'completed'
        ? {
            verdictLabel: 'inconclusive',
            statement: 'x',
            conservativeEstimate: estimate,
            adherence: { counts: { ADHERENT: adherent, NON_ADHERENT: 0, CONTAMINATED: 0, CONTROL_CLEAN: 0, UNKNOWN: 0 } },
            evaluatedAt: '2026-10-01T00:00:00.000Z',
          }
        : null,
  } as unknown as StoredExperimentPlan;
}

test('no comparison until the account has two finished tests', () => {
  assert.equal(buildCycleComparison([]), null);
  assert.equal(buildCycleComparison([finishedPlan('a', '2026-08-01', '12:00', 30, 10)]), null);
});

test('running and stopped tests are never compared', () => {
  const plans = [
    finishedPlan('a', '2026-08-01', '12:00', 30, 10),
    finishedPlan('b', '2026-09-01', '13:00', 0, null, 'scheduled'),
    finishedPlan('c', '2026-09-15', '13:00', 0, null, 'cancelled'),
  ];
  assert.equal(buildCycleComparison(plans), null);
});

test('rows run oldest first, and the sentences compare the two latest finished tests', () => {
  const comparison = buildCycleComparison([
    finishedPlan('later', '2026-10-01', '13:00', 35, 25),
    finishedPlan('first', '2026-08-01', '12:00', 30, 10),
    finishedPlan('middle', '2026-09-01', '12:00', 20, 15),
  ]);
  assert.ok(comparison);
  assert.deepEqual(comparison.rows.map(row => row.id), ['first', 'middle', 'later']);
  assert.equal(comparison.rows[2].ruleFollowedDays, 35);
  assert.equal(comparison.rows[2].plannedDays, 42);
  assert.equal(comparison.sentences[0], 'Your cutoff moved from 12:00 to 13:00.');
  assert.equal(
    comparison.sentences[1],
    'The rule was followed on 20 of 42 days, then on 35 of 42 days.',
  );
  assert.equal(
    comparison.sentences[2],
    'The cautious estimate of extra sleep on cutoff days went from 15 to 25 minutes a night.',
  );
});

test('an unchanged cutoff is said plainly, and a missing estimate is never shown as zero', () => {
  const comparison = buildCycleComparison([
    finishedPlan('a', '2026-08-01', '12:00', 30, 10),
    finishedPlan('b', '2026-09-01', '12:00', 28, null),
  ]);
  assert.ok(comparison);
  assert.equal(comparison.sentences[0], 'Your cutoff stayed at 12:00.');
  assert.equal(
    comparison.sentences[2],
    'A single sleep estimate could not be worked out for one of these tests, so they cannot be compared on sleep.',
  );
  assert.equal(comparison.rows[1].sleepEstimateMinutes, null);
});

test('a caffeine test and a screens test are never read as one trend', () => {
  const comparison = buildCycleComparison([
    finishedPlan('caffeine', '2026-08-01', '12:00', 30, 10),
    finishedPlan('screens', '2026-09-15', '21:30', 25, 14, 'completed', 'screen-cutoff'),
  ]);
  assert.ok(comparison);
  assert.deepEqual(comparison.rows.map(row => row.testName), ['Caffeine cutoff', 'Screens-off cutoff']);
  assert.equal(
    comparison.sentences[0],
    'Your latest finished test is the screens-off cutoff. The one before it was the caffeine cutoff, and the two are not compared because they asked different things.',
  );
  assert.ok(!comparison.sentences.some(sentence => sentence.includes('12:00')));
});

test('the newest test is compared with the newest finished test of the same kind', () => {
  const comparison = buildCycleComparison([
    finishedPlan('caffeine-1', '2026-07-01', '12:00', 20, 8),
    finishedPlan('screens', '2026-08-01', '21:30', 25, 14, 'completed', 'screen-cutoff'),
    finishedPlan('caffeine-2', '2026-09-01', '13:00', 30, 12),
  ]);
  assert.ok(comparison);
  assert.equal(comparison.sentences[0], 'Your cutoff moved from 12:00 to 13:00.');
  assert.equal(
    comparison.sentences[1],
    'The rule was followed on 20 of 42 days, then on 30 of 42 days.',
  );
});
