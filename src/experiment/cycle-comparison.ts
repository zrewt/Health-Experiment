import type { StoredExperimentPlan } from '../data/plan-persistence';
import { VERDICT_HEADINGS } from './verdict-headings';
import { experimentForRuleType, type ExperimentId } from './experiments';
import { formatSleepMinutes, roundSleepMinutes } from './result-plain-language';

/**
 * Side-by-side comparison of finished sleep tests.
 *
 * Only completed tests with a saved result are compared. Everything here is read back
 * from what each finished test already recorded: its cutoff time, how often the rule was
 * followed, and the engine's own sleep estimate. Nothing is recomputed, and nothing is
 * shown for a test that is still running, so no interim comparison can leak in.
 *
 * Two different tests are never compared with each other: a caffeine cutoff and a
 * screens-off cutoff ask different things at different times of day, so reading one as a
 * change to the other would be a false trend. The most recent finished test is compared
 * with the newest finished test of the same kind.
 */

export interface CycleComparisonRow {
  id: string;
  experimentId: ExperimentId;
  /** The test as the user reads it, e.g. "Caffeine cutoff". */
  testName: string;
  startDate: string;
  cutoffTime: string;
  plannedDays: number;
  /** Days where the rule was followed, or null when the test has no adherence counts. */
  ruleFollowedDays: number | null;
  /** Engine's cautious estimate in minutes a night, or null when none could be worked out. */
  sleepEstimateMinutes: number | null;
  verdictHeading: string | null;
  /**
   * False when the engine's own verdict says these nights do not support a comparison.
   * The card then says the tests are too noisy to compare instead of showing a number.
   */
  comparable: boolean;
}

export interface CycleComparison {
  /** Oldest first, so the list reads like the story of repeated tests. */
  rows: CycleComparisonRow[];
  /** Plain sentences comparing the two most recent finished tests of the same kind. */
  sentences: string[];
}

function experimentOf(item: StoredExperimentPlan) {
  const rule = item.plan.definition.conditionRule as { type?: unknown };
  return experimentForRuleType(typeof rule.type === 'string' ? rule.type : null);
}

function cutoffOf(item: StoredExperimentPlan): string {
  const rule = item.plan.definition.conditionRule as { cutoffTime?: unknown };
  if (typeof rule.cutoffTime === 'string') return rule.cutoffTime;
  return experimentOf(item).defaultCutoff;
}

/**
 * The engine's own stored verdict decides whether the nights support a comparison. An
 * inconclusive test is never dressed up as a reading, and no second judgement is made here.
 */
function isComparable(result: NonNullable<StoredExperimentPlan['result']>): boolean {
  return result.verdictLabel === 'SUPPORTED' || result.verdictLabel === 'NO_DETECTABLE_EFFECT';
}

/** "15 minutes more a night", "about the same a night"; never a raw number or a unit. */
function cautiousReading(minutes: number): string {
  if (roundSleepMinutes(minutes) === 0) return 'about the same a night';
  return `${formatSleepMinutes(minutes)} ${minutes < 0 ? 'less' : 'more'} a night`;
}

function rowFor(item: StoredExperimentPlan): CycleComparisonRow {
  const result = item.result ?? null;
  const experiment = experimentOf(item);
  return {
    id: item.id,
    experimentId: experiment.id,
    testName: experiment.name,
    startDate: item.plan.startDate,
    cutoffTime: cutoffOf(item),
    plannedDays: item.plan.chosenDuration,
    ruleFollowedDays: result ? result.adherence.counts.ADHERENT : null,
    sleepEstimateMinutes: result ? result.conservativeEstimate : null,
    verdictHeading: result ? (VERDICT_HEADINGS[result.verdictLabel] ?? result.verdictLabel) : null,
    comparable: result ? isComparable(result) : false,
  };
}

function sentencesFor(previous: CycleComparisonRow, latest: CycleComparisonRow): string[] {
  const sentences: string[] = [];

  sentences.push(
    previous.cutoffTime === latest.cutoffTime
      ? `Your cutoff stayed at ${latest.cutoffTime}.`
      : `Your cutoff moved from ${previous.cutoffTime} to ${latest.cutoffTime}.`,
  );

  if (previous.ruleFollowedDays !== null && latest.ruleFollowedDays !== null) {
    sentences.push(
      `The rule was followed on ${previous.ruleFollowedDays} of ${previous.plannedDays} days, then on ${latest.ruleFollowedDays} of ${latest.plannedDays} days.`,
    );
  }

  if (previous.sleepEstimateMinutes === null || latest.sleepEstimateMinutes === null) {
    sentences.push(
      'A single sleep estimate could not be worked out for one of these tests, so they cannot be compared on sleep.',
    );
  } else if (!previous.comparable || !latest.comparable) {
    sentences.push(
      'These tests are too noisy to compare on sleep. Their own results did not show a steady enough difference.',
    );
  } else {
    sentences.push(
      `The cautious sleep reading was ${cautiousReading(previous.sleepEstimateMinutes)} in the earlier test and ${cautiousReading(latest.sleepEstimateMinutes)} in the later one.`,
    );
  }

  return sentences;
}

/**
 * Returns the comparison when the account has two or more finished tests, or null otherwise.
 * Tests that were stopped early or are still running are left out entirely.
 */
export function buildCycleComparison(
  plans: readonly StoredExperimentPlan[],
): CycleComparison | null {
  const finished = plans
    .filter(item => item.status === 'completed' && item.result)
    .slice()
    .sort((a, b) => (a.plan.startDate < b.plan.startDate ? -1 : a.plan.startDate > b.plan.startDate ? 1 : 0));

  if (finished.length < 2) return null;

  const rows = finished.map(rowFor);
  const latest = rows[rows.length - 1];
  const previous = [...rows]
    .reverse()
    .slice(1)
    .find(row => row.experimentId === latest.experimentId);

  const previousAny = rows[rows.length - 2];
  const sentences = previous
    ? sentencesFor(previous, latest)
    : [
        `Your latest finished test is the ${latest.testName.toLowerCase()}. The one before it was the ${previousAny.testName.toLowerCase()}, and the two are not compared because they asked different things.`,
      ];

  return { rows, sentences };
}
