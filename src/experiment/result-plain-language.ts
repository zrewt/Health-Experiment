/**
 * Plain-language reading of a stored result.
 *
 * It uses only fields the result snapshot already stores. Nothing is recomputed, no new
 * statistic is introduced, and nothing is written back. The text is deliberately narrower
 * than the engine's own sentence: the sentence and every exact figure stay under Details,
 * word for word.
 *
 * Sleep is measured in minutes per night. Every number here is rounded and given that unit.
 */

import type { ResultViewModel } from './types';

export interface PlainResultInputs {
  /** The stored result, or null for a test that ended before a result existed. */
  result: ResultViewModel | null;
  /** The fixed heading for the verdict (VERDICT_HEADINGS), or the ended-early heading. */
  heading: string;
  /** Days in the plan. */
  plannedDays: number;
  /** Nights with sleep logged inside the plan window. */
  daysLogged: number;
  /** Days that had happened when the test ended early; defaults to the plan length. */
  daysElapsed?: number;
  /** True when the user stopped the test before the end. */
  endedEarly?: boolean;
}

export interface PlainResult {
  headline: string;
  /** What this means: 50-90 words for a finished test with enough days. */
  paragraph: string;
  /** One line for "How sure we are"; never repeats the paragraph. */
  certainty: string;
  /** One line for "What to do next". */
  nextStep: string;
  /** True when the paragraph says there is no answer to show. */
  noAnswer: boolean;
}

/** Nearest 5 minutes, or nearest minute below 10, as the product rule asks. */
export function roundSleepMinutes(value: number): number {
  const abs = Math.abs(value);
  if (abs < 10) return Math.round(value);
  return Math.round(value / 5) * 5;
}

/** Absolute minutes in everyday words: 45 minutes, 1 hour, 1 hour 15 minutes. */
export function formatSleepMinutes(value: number): string {
  const total = Math.abs(roundSleepMinutes(value));
  if (total < 60) return `${total} minute${total === 1 ? '' : 's'}`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const hourText = `${hours} hour${hours === 1 ? '' : 's'}`;
  return minutes === 0 ? hourText : `${hourText} ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** True when the rounded range contains no difference at all. */
function isAboutTheSame(low: number, high: number): boolean {
  return roundSleepMinutes(low) === 0 && roundSleepMinutes(high) === 0;
}

/** Two bounds sharing one unit: "10 to 40 minutes"; hours carry their own unit. */
function boundPair(low: number, high: number): string {
  const lo = Math.abs(roundSleepMinutes(low));
  const hi = Math.abs(roundSleepMinutes(high));
  if (lo < 60 && hi < 60) return `${lo} to ${hi} minutes`;
  return `${formatSleepMinutes(lo)} to ${formatSleepMinutes(hi)}`;
}

/** "10 to 40 minutes longer", "up to 10 minutes shorter", "about the same". */
export function describeRange(low: number, high: number): string {
  const lo = roundSleepMinutes(low);
  const hi = roundSleepMinutes(high);
  // Under five minutes either way is not a size a reader can act on.
  if (Math.abs(lo) < 5 && Math.abs(hi) < 5) return 'about the same';
  if (lo >= 0 && hi > 0) {
    if (lo === 0) return `up to ${formatSleepMinutes(hi)} longer`;
    if (lo === hi) return `${formatSleepMinutes(hi)} longer`;
    return `${boundPair(lo, hi)} longer`;
  }
  if (hi <= 0 && lo < 0) {
    if (hi === 0) return `up to ${formatSleepMinutes(-lo)} shorter`;
    if (lo === hi) return `${formatSleepMinutes(-lo)} shorter`;
    return `${boundPair(-hi, -lo)} shorter`;
  }
  return `between ${formatSleepMinutes(-lo)} shorter and ${formatSleepMinutes(hi)} longer`;
}

/**
 * The stored sleep reading in everyday words, for Details and the comparison card.
 * Prefers the range the engine stored; falls back to its cautious low end, never a
 * single best estimate.
 */
export function describeStoredEstimate(reading: {
  interval: [number, number] | null;
  conservativeEstimate: number | null;
}): string {
  if (reading.interval) {
    const text = describeRange(reading.interval[0], reading.interval[1]);
    return text === 'about the same'
      ? 'about the same on cutoff days and normal days'
      : `${text} a night on cutoff days`;
  }
  if (reading.conservativeEstimate !== null && roundSleepMinutes(reading.conservativeEstimate) > 0) {
    return `at least ${formatSleepMinutes(reading.conservativeEstimate)} more a night on cutoff days`;
  }
  return 'no clear number from this log';
}

type Direction = 'longer' | 'shorter' | 'same';

function directionFromInterval(low: number | null, high: number | null): Direction {
  if (low === null || high === null) return 'same';
  if (isAboutTheSame(low, high)) return 'same';
  const midpoint = (low + high) / 2;
  if (Math.abs(midpoint) < 2.5) return 'same';
  return midpoint > 0 ? 'longer' : 'shorter';
}

function isLowPower(result: ResultViewModel): boolean {
  const power = result.plannedPowerRecomputed ?? result.plannedPowerSnapshot;
  if (typeof power === 'number' && Number.isFinite(power) && power < 0.3) return true;
  // The engine's own note is the stored signal when the power field is absent.
  return /exaggerated/i.test(result.statement);
}

function analyzedDays(result: ResultViewModel): number {
  return (result.daysAnalyzed?.intervention ?? 0) + (result.daysAnalyzed?.control ?? 0);
}

/** The opening every paragraph shares: days in the test, nights logged, plan followed. */
function opening(plannedDays: number, daysLogged: number, keptCutoffDays: number): string {
  const logged = Math.max(0, Math.min(daysLogged, plannedDays));
  const kept = Math.max(0, keptCutoffDays);
  return `Over ${plannedDays} days you logged sleep on ${logged} and followed the plan on ${kept} cutoff ${kept === 1 ? 'day' : 'days'}.`;
}

type NoAnswerKind = 'ended' | 'short' | 'sparse' | 'empty';

function noAnswerText(input: PlainResultInputs, kind: NoAnswerKind, analyzed = 0): PlainResult {
  const { heading, plannedDays, daysLogged, daysElapsed } = input;
  const logged = Math.max(0, Math.min(daysLogged, plannedDays));
  let paragraph: string;
  if (kind === 'ended') {
    const elapsed = Math.max(1, Math.min(daysElapsed ?? plannedDays, plannedDays));
    paragraph = `You ended this test after ${elapsed} of ${plannedDays} days, with sleep logged on ${logged}. That is too few days to compare fairly, so there is no answer to show. You can start again any time.`;
  } else if (kind === 'empty') {
    paragraph = `You did not log any nights in this test, so there is no answer to show. Logging sleep and your cutoff time each morning is what makes a test possible. You can start again any time.`;
  } else if (kind === 'sparse') {
    paragraph = `Over ${plannedDays} days you logged sleep on ${logged} nights, but only ${analyzed} had everything this test needs. That is too few days to compare fairly, so there is no answer to show. A longer test, with most nights fully logged, would give a clearer answer.`;
  } else {
    paragraph = `This test ran for ${plannedDays} days and you logged sleep on ${logged} of them. That is too few days to compare fairly, so there is no answer to show. Short tests cannot tell a real difference from the normal ups and downs of sleep. A test of six weeks or more, with most nights logged, would give a clearer answer.`;
  }
  return {
    headline: kind === 'ended' ? 'Test ended early' : heading,
    paragraph,
    certainty: 'No answer can be read from this log.',
    nextStep: 'Start a new sleep test when you are ready.',
    noAnswer: true,
  };
}

/**
 * Builds the headline, paragraph, certainty line and next step from the stored result.
 *
 * A finished test with too few days says so plainly. Otherwise the paragraph follows the
 * fixed order: what was compared, what was seen, how sure, what it cannot show, next step.
 */
export function buildPlainResult(input: PlainResultInputs): PlainResult {
  const { result, heading, plannedDays, daysLogged, endedEarly } = input;

  if (endedEarly || result === null) {
    return endedEarly
      ? noAnswerText(input, 'ended')
      : noAnswerText(input, 'short');
  }

  const logged = Math.max(0, Math.min(daysLogged, plannedDays));
  // A stored snapshot from an older build can be missing adherence: read it as unknown.
  const kept = result.adherence?.counts?.ADHERENT ?? 0;
  const low = result.interval ? result.interval[0] : null;
  const high = result.interval ? result.interval[1] : null;
  const analyzed = analyzedDays(result);

  if (logged === 0) return noAnswerText(input, 'empty', analyzed);
  // A short plan or too few usable days cannot support a comparison, so the screen says
  // there is no answer instead of decorating an inconclusive verdict.
  if (plannedDays <= 28) return noAnswerText(input, 'short', analyzed);
  if (analyzed < 20) return noAnswerText(input, 'sparse', analyzed);

  const status = result.verdictLabel;
  const lowPower = isLowPower(result);
  const direction = directionFromInterval(low, high);
  const start = opening(plannedDays, logged, kept);

  // The cautious figure is used only when the interval is unavailable. It is never a
  // single best estimate, and it is never shown as a point on its own.
  const cautious = result.conservativeEstimate !== null && roundSleepMinutes(result.conservativeEstimate) > 0
    ? `at least ${formatSleepMinutes(result.conservativeEstimate)} longer`
    : null;
  const rangeText = low !== null && high !== null ? describeRange(low, high) : cautious;

  if (status === 'SUPPORTED') {
    const seen = rangeText === null
      ? 'Your sleep on cutoff days was longer than on normal days, but the log did not give a range for it.'
      : rangeText === 'about the same'
        ? 'Your sleep on cutoff days was about the same as on normal days.'
        : `On cutoff days your sleep was ${rangeText} than on normal days.`;
    const confidence = rangeText === 'about the same' || direction === 'same'
      ? 'The size was small, so read this as a hint rather than a rule.'
      : lowPower
        ? 'A larger test would say more.'
        : 'The difference is bigger than your normal night-to-night changes.';
    const paragraph = [
      start,
      seen,
      'This is a cautious reading of your own log.',
      'Sleep changes from night to night, and this test cannot show why the difference happened.',
      confidence,
      'Keep the cutoff if it suits your mornings, or run a longer test for a narrower answer.',
    ].join(' ');
    return {
      headline: heading,
      paragraph,
      certainty: lowPower
        ? 'Less sure: the test was small, so a small difference could be missed.'
        : result.reducedAdherence
          ? 'Less sure: not every cutoff day was followed.'
          : 'Fairly sure: enough cutoff and normal days were logged.',
      nextStep: 'Keep the cutoff if it suits your mornings. Run a longer test if you want a narrower answer.',
      noAnswer: false,
    };
  }

  if (status === 'NO_DETECTABLE_EFFECT') {
    const same = rangeText === null || rangeText === 'about the same' || direction === 'same';
    const seen = same
      ? 'Your sleep on cutoff days and normal days was about the same.'
      : `Your sleep looked a little ${direction} on cutoff days, but the difference was small.`;
    const paragraph = [
      start,
      seen,
      'Any difference was smaller than the normal ups and downs of your own sleep, so this test cannot show whether the cutoff mattered.',
      'That does not mean it did nothing.',
      lowPower ? 'The test was small, so a small difference could be missed.' : '',
      'A longer test, or steadier weeks, would give a clearer answer.',
    ].filter(Boolean).join(' ');
    return {
      headline: heading,
      paragraph,
      certainty: 'Not sure either way from this log.',
      nextStep: 'Run a longer test, or keep logging, if you want a clearer answer.',
      noAnswer: false,
    };
  }

  // INCONCLUSIVE
  const seenDirection = direction === 'same' ? 'about the same' : `a little ${direction}`;
  const seen = rangeText === null
    ? `Your sleep looked ${seenDirection} on cutoff days, but the log did not give a range for the difference.`
    : `Your sleep looked ${seenDirection} on cutoff days, but the range is ${rangeText}.`;
  const paragraph = [
    start,
    seen,
    'The range overlaps your normal night-to-night changes, so this test cannot tell whether the cutoff made a difference.',
    'That does not mean it did nothing.',
    // One uncertainty sentence is enough; two would push the paragraph past 90 words.
    lowPower
      ? 'It was a small test.'
      : result.reducedAdherence
        ? 'Not every cutoff day was followed, so the difference may be smaller.'
        : '',
    'A longer test, or more cutoff days followed, would give a clearer answer.',
  ].filter(Boolean).join(' ');
  return {
    headline: heading,
    paragraph,
    certainty: 'Not sure either way from this log.',
    nextStep: 'Run a longer test, or follow more cutoff days, for a clearer answer.',
    noAnswer: false,
  };
}
