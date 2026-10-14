/**
 * Presentation helpers for strings that come from the domain layer.
 *
 * Nothing here adds, removes or rewrites words: these only decide the case a label
 * is rendered in, and where one sentence is broken across two lines. The copy itself
 * still lives in src/experiment (or in the screen that owns it).
 */

/**
 * Sentence case for the labels the domain stores in capitals ('GETTING STARTED').
 *
 * The brief bans all-caps eyebrow labels, so the same words are rendered in sentence
 * case. A string that already contains a lowercase letter is left untouched, so this
 * can never damage a date, an acronym or a name.
 */
export function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[a-z]/.test(trimmed)) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

export interface TodayTypeRead {
  /** Today's type, for choosing the disc's fill. Null when today is not a test day. */
  kind: 'cutoff' | 'normal' | null;
  /** The type clause of the sentence, as written: 'Today: cutoff day'. */
  clause: string;
  /** A short text label for the disc: 'Cutoff day'. */
  label: string;
  /** The rest of the sentence on its own line: 'no caffeine after 13:15'. Empty when there is none. */
  rule: string;
}

const TODAY_PREFIX = /^today:\s*/i;

/**
 * Reads today's type out of the domain's one-line instruction. The sentence is split
 * at its first comma so the type can stand as the hero line and the rule can sit under
 * it; no words are added or dropped.
 */
export function readTodayType(heading: string): TodayTypeRead {
  const [clause = '', ...rest] = heading.split(', ');
  const bare = clause.replace(TODAY_PREFIX, '');
  const kind = /cutoff day/i.test(bare) ? 'cutoff' : /normal day/i.test(bare) ? 'normal' : null;
  return {
    kind,
    clause,
    label: sentenceCase(bare),
    rule: rest.join(', '),
  };
}
