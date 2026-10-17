import type { ConsentRecord } from '../data/experiment-store';

/**
 * The consent text this build requires before it will log data.
 *
 * Bump this whenever the text changes. Consent rows are append-only, so a bump makes the
 * app ask every existing user once more instead of silently relying on an older wording.
 * v2 names screen use, which the log now stores alongside sleep and caffeine.
 */
export const CURRENT_CONSENT_VERSION = '2026-10-screens-draft-v2';

/**
 * True only when the user has agreed to the wording this build requires.
 *
 * Kept pure and separate from the store on purpose: the home state is computed in the
 * domain layer and in tests, where importing the storage module would pull in AsyncStorage
 * and Supabase.
 */
export function consentCoversCurrentVersion(consent: ConsentRecord | null): boolean {
  return consent !== null && consent.granted && consent.policyVersion === CURRENT_CONSENT_VERSION;
}
