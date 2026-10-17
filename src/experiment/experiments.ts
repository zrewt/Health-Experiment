/**
 * The sleep tests the app can run. One definition per test, so screens read the name, the
 * engine rule and the wording from here instead of hard-coding caffeine.
 *
 * Only one test runs at a time (see reports/screens-off-cutoff-plan.md). The engine rule name
 * is what the frozen engine dispatches on; the rest is copy for the screens.
 */

import type { DailyEntry } from './types';

export type ExperimentId = 'caffeine-cutoff' | 'screens-off-cutoff';

/** Which exposure a check-in records for the active test. */
export type ExposureKind = 'caffeine' | 'screens';

export interface ExperimentInfo {
  id: ExperimentId;
  /** The engine's rule type, stored inside each plan. */
  ruleType: 'caffeine-cutoff' | 'screen-cutoff';
  /** Name of the test, as shown on the choose-a-test screen. */
  name: string;
  /** One sentence on what the user does on cutoff days. */
  whatYouDo: string;
  /** Default time the rule starts on cutoff days, HH:mm. */
  defaultCutoff: string;
  /** The daily question for the exposure, as the check-in shows it. */
  exposureQuestion: string;
  /** The exposure as the user reads it, e.g. "caffeine" or "screens". */
  exposureWord: string;
  /** What the user types in the check-in, as a sentence fragment. */
  exposureLogPhrase: string;
  /** One line asking for the cutoff time on the setup screen. */
  setupPrompt: string;
  /** The cutoff rule in two or three words, before the time: "no caffeine" / "no screens". */
  cutoffRule: string;
}

export const EXPERIMENTS: Record<ExperimentId, ExperimentInfo> = {
  'caffeine-cutoff': {
    id: 'caffeine-cutoff',
    ruleType: 'caffeine-cutoff',
    name: 'Caffeine cutoff',
    whatYouDo: 'On cutoff days, have no caffeine after your cutoff time.',
    defaultCutoff: '12:00',
    exposureQuestion: 'When was your last caffeine?',
    exposureWord: 'caffeine',
    exposureLogPhrase: 'when you last had caffeine',
    setupPrompt: 'Pick your daily caffeine cutoff time.',
    cutoffRule: 'no caffeine',
  },
  'screens-off-cutoff': {
    id: 'screens-off-cutoff',
    ruleType: 'screen-cutoff',
    name: 'Screens-off cutoff',
    whatYouDo: 'On cutoff days, put screens away from your cutoff time until bed.',
    defaultCutoff: '21:30',
    exposureQuestion: 'When did you last use a screen?',
    exposureWord: 'screens',
    exposureLogPhrase: 'when you last used a screen',
    setupPrompt: 'Pick the time screens go off each evening.',
    cutoffRule: 'no screens',
  },
};

export const EXPERIMENT_IDS: readonly ExperimentId[] = ['caffeine-cutoff', 'screens-off-cutoff'];

/** The test that owns a stored rule type. Unknown types fall back to the original test. */
export function experimentForRuleType(ruleType: string | undefined | null): ExperimentInfo {
  const match = EXPERIMENT_IDS.map(id => EXPERIMENTS[id]).find(info => info.ruleType === ruleType);
  return match ?? EXPERIMENTS['caffeine-cutoff'];
}

/** The test for a stored setup id. Unknown or missing ids fall back to the caffeine test. */
export function experimentById(id: string | undefined | null): ExperimentInfo {
  return id === 'screens-off-cutoff' ? EXPERIMENTS['screens-off-cutoff'] : EXPERIMENTS['caffeine-cutoff'];
}

/** The exposure the check-in records for a test. Unknown or missing ids fall back to caffeine. */
export function exposureForExperimentId(id: string | undefined | null): ExposureKind {
  return id === 'screens-off-cutoff' ? 'screens' : 'caffeine';
}

/** The cutoff rule with its time: "no caffeine after 12:00" or "no screens after 21:30". */
export function cutoffRuleText(info: ExperimentInfo, cutoffTime: string): string {
  return `${info.cutoffRule} after ${cutoffTime}`;
}

/** The stored exposure value for the active test: caffeine time, or screen time. Missing stays null. */
export function exposureValue(entry: DailyEntry | undefined, exposure: ExposureKind): string | 'none' | null {
  if (!entry) return null;
  return exposure === 'screens' ? (entry.lastScreenTime ?? null) : (entry.lastCaffeineTime ?? null);
}
