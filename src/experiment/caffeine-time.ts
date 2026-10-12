/**
 * Strict caffeine-time handling shared by every screen that reads or writes
 * a last-caffeine time.
 *
 * Policy:
 * - A time is valid only as "HH:mm" (24-hour): two-digit hour 00-23, two-digit
 *   minute 00-59, no spaces, no seconds. Single-digit hours are NOT padded.
 * - On entry, anything else is rejected; nothing is saved for that field.
 * - On read, a stored value that is neither a valid time, the literal 'none',
 *   nor blank is treated as unknown (null) for engine input and shown to the
 *   user as unreadable. Stored values are never modified, padded or guessed.
 *
 * MISSING IS NOT ZERO: blank and unreadable both become null (unknown), never 'none'.
 * This module is pure domain logic and never imports src/engine, React or the network.
 */

/** Strict 24-hour clock time: two-digit hour 00-23, two-digit minute 00-59. */
export const CAFFEINE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Stored shape: a time string, the literal 'none', or null (skipped / unknown). */
export type StoredCaffeineTime = string | 'none' | null;

/** Plain inline entry message that names the accepted format. No thresholds or claims. */
export const CAFFEINE_TIME_FORMAT_MESSAGE =
  'Enter the last caffeine time as HH:MM, 24-hour (for example 14:30).';

/** Shown when a stored value cannot be read as HH:MM, 'none' or blank. */
export const CAFFEINE_TIME_UNREADABLE_MESSAGE =
  'Saved caffeine time could not be read; re-enter it as HH:MM (for example 14:30).';

/** Short marker used in the Recent Days list. */
export const CAFFEINE_TIME_UNREADABLE_MARKER = 'time could not be read; re-enter';

/** True only for a strict "HH:mm" string. */
export function isValidCaffeineTime(value: string): boolean {
  return CAFFEINE_TIME_PATTERN.test(value);
}

export type CaffeineTimeKind = 'none' | 'unset' | 'valid' | 'unreadable';

export interface CaffeineTimeReading {
  /** 'none' = no caffeine, 'unset' = blank/skipped, 'valid' = HH:MM, 'unreadable' = malformed. */
  kind: CaffeineTimeKind;
  /** The valid time, otherwise null. */
  time: string | null;
}

/**
 * Classifies a stored value without modifying it. Blank and malformed stay
 * distinct so the UI can tell a skipped value apart from an unreadable one.
 */
export function readCaffeineTime(value: StoredCaffeineTime): CaffeineTimeReading {
  if (value === null || value === '') return { kind: 'unset', time: null };
  if (value === 'none') return { kind: 'none', time: null };
  if (isValidCaffeineTime(value)) return { kind: 'valid', time: value };
  return { kind: 'unreadable', time: null };
}

/** Engine input: only a strict HH:MM survives; 'none', blank and malformed are null. */
export function engineCaffeineTime(value: StoredCaffeineTime): string | null {
  return readCaffeineTime(value).time;
}

/** Servings: 'none' is an explicit zero; blank, malformed and a time are unknown (null). */
export function engineCaffeineServings(value: StoredCaffeineTime): number | null {
  return value === 'none' ? 0 : null;
}

/**
 * Never persist a malformed time: it becomes null (unknown), never 'none' and
 * never padded. 'none' and valid times are written through unchanged.
 */
export function sanitizeCaffeineTimeForWrite(value: StoredCaffeineTime): string | 'none' | null {
  const reading = readCaffeineTime(value);
  if (reading.kind === 'none') return 'none';
  if (reading.kind === 'valid') return reading.time;
  return null;
}
