import type { ResultViewModel } from './types';

/**
 * Plain-language summary of a finished test, built only from the stored result.
 *
 * The screen leads with this short summary so a reader can take in the answer at a glance.
 * The engine's exact wording and the statistics stay under "Scientific details" on the
 * screen; nothing here repeats them. The result stores the engine's cautious estimate (the
 * smallest difference the log supports), so the headline never uses a larger number.
 */

/**
 * Shown on every result, always visible, never hidden under Details.
 * It names the test's own exposure, so a screens result never reads as a caffeine result.
 */
export function causationCaveat(exposureWord: string = 'caffeine'): string {
  return `This is a pattern in your own log. It does not prove that ${exposureWord} caused it.`;
}

/** The caffeine caveat, kept for callers that predate the second test. */
export const CAUSATION_CAVEAT = causationCaveat('caffeine');

export interface ResultSummaryInputs {
  result: ResultViewModel;
  /** The shared heading for this verdict (VERDICT_HEADINGS), so the wording lives in one place. */
  verdictHeading: string;
  /** The cutoff time this test used, as HH:mm. */
  cutoffTime: string;
  /** Days in the test. */
  plannedDays: number;
  /** Days that were cutoff days in the test's schedule. */
  cutoffDaysPlanned: number;
  /** The exposure the test changed: 'caffeine' or 'screens'. Defaults to caffeine. */
  exposureWord?: string;
}

export interface ResultSummary {
  /** The answer in one line. */
  headline: string;
  /** Three short lines: what you did, what we could use, and what we saw. */
  takeaways: string[];
  /** How much to trust the answer, in one line. */
  certainty: string;
  /** Always shown. */
  caveat: string;
}

function minutes(value: number): string {
  return `${Math.round(value)} ${Math.round(value) === 1 ? 'minute' : 'minutes'}`;
}

export function buildResultSummary(inputs: ResultSummaryInputs): ResultSummary {
  const {
    result,
    verdictHeading,
    cutoffTime,
    plannedDays,
    cutoffDaysPlanned,
    exposureWord = 'caffeine',
  } = inputs;
  const estimate = result.conservativeEstimate;
  const usedDays = result.daysAnalyzed.intervention + result.daysAnalyzed.control;
  const keptCutoff = result.adherence.counts.ADHERENT;

  let headline = verdictHeading;
  let finding: string;
  if (result.verdictLabel === 'SUPPORTED') {
    if (estimate !== null) {
      headline = `You slept about ${minutes(estimate)} longer on cutoff days`;
      finding = `Even the smallest difference your log supports is about ${minutes(estimate)} more sleep a night on cutoff days.`;
    } else {
      finding = 'Your sleep was longer on cutoff days, but your log did not give one number for it.';
    }
  } else if (result.verdictLabel === 'NO_DETECTABLE_EFFECT') {
    finding = 'Your sleep looked about the same on cutoff days and normal days.';
  } else {
    finding = 'Your log did not clearly show a difference, and did not clearly rule one out.';
  }

  return {
    headline,
    takeaways: [
      `You kept the ${cutoffTime} cutoff on ${keptCutoff} of ${cutoffDaysPlanned} cutoff days.`,
      `We could use ${usedDays} of your ${plannedDays} days.`,
      finding,
    ],
    certainty: certaintyText(result),
    caveat: causationCaveat(exposureWord),
  };
}

function certaintyText(result: ResultViewModel): string {
  const parts: string[] = [];
  if (result.interval) {
    parts.push(
      `The likely range is ${Math.round(result.interval[0])} to ${Math.round(result.interval[1])} minutes a night.`,
    );
  } else {
    parts.push('Your log was not enough to give a likely range.');
  }
  if (result.reducedAdherence) {
    parts.push('You did not always keep the rule, so the real difference could be smaller or less certain.');
  }
  if (result.missingOutcomeDays > 0 || result.unknownExposureDays > 0) {
    parts.push('Some nights were not fully logged, so the picture is less complete.');
  }
  return parts.join(' ');
}
