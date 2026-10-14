/**
 * One-to-one mapping from the engine verdict status to the heading shown on the result screen.
 *
 * The engine can return exactly three statuses: SUPPORTED, NO_DETECTABLE_EFFECT, INCONCLUSIVE
 * (src/engine/types.ts Verdict['status']). This mapping covers each of them and nothing else.
 *
 * This module is pure domain logic: it imports nothing from React, the UI, the adapter or the
 * engine. It exists so the result screen and the tests both read the same mapping, and so the
 * heading wording can be checked in one place against the word list in the tests.
 */
import type { Verdict } from '../engine/types';

export const VERDICT_HEADINGS: Record<Verdict['status'], string> = {
  SUPPORTED: 'Sleep was longer on cutoff days',
  NO_DETECTABLE_EFFECT: 'No clear difference in sleep',
  INCONCLUSIVE: 'Too close to call',
};

/** Every verdict the engine can return has a heading here. */
export function hasHeadingFor(status: string): status is Verdict['status'] {
  return (status as Verdict['status']) in VERDICT_HEADINGS;
}

