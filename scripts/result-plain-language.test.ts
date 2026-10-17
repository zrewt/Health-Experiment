import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPlainResult,
  describeStoredEstimate,
  formatSleepMinutes,
  roundSleepMinutes,
} from '../src/experiment/result-plain-language';
import { VERDICT_HEADINGS } from '../src/experiment/verdict-headings';
import type { ResultViewModel } from '../src/experiment/types';

const BANNED = [
  'caused',
  'causes',
  'helped',
  'improved',
  'improves',
  'proves',
  'proof',
  'significant',
  'confidence',
  'interval',
  'p-value',
  'bootstrap',
  'permutation',
  'adherence',
  'effect size',
  'units',
];

function result(overrides: Partial<ResultViewModel> = {}): ResultViewModel {
  return {
    verdictLabel: 'SUPPORTED',
    statement: 'Sleep was longer on cutoff days (43.2 units).',
    reasons: ['reason'],
    conservativeEstimate: 10,
    interval: [10, 40],
    ruledOut: 0,
    daysAnalyzed: { intervention: 19, control: 19 },
    daysExcluded: 1,
    missingOutcomeDays: 2,
    unknownExposureDays: 1,
    adherence: {
      estimand: 'x',
      counts: { ADHERENT: 30, NON_ADHERENT: 6, CONTAMINATED: 2, CONTROL_CLEAN: 16, UNKNOWN: 4 },
      total: 42,
      known: 38,
      overallAdherence: 0.7,
      knownFraction: 0.9,
      interventionAdherence: 0.71,
      controlContamination: 0.1,
    },
    reducedAdherence: false,
    plannedPowerRecomputed: null,
    plannedPowerSnapshot: 0.6,
    ...overrides,
  };
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function assertCleanParagraph(paragraph: string) {
  const lower = paragraph.toLowerCase();
  for (const banned of BANNED) {
    assert.ok(!lower.includes(banned), `banned word "${banned}" in: ${paragraph}`);
  }
  assert.ok(!/\d\.\d/.test(paragraph), `decimal in: ${paragraph}`);
  assert.ok(!/\bunits\b/i.test(paragraph), `units in: ${paragraph}`);
}

function input(overrides: Partial<ResultViewModel> = {}, extra: Record<string, unknown> = {}) {
  return {
    result: result(overrides),
    heading: VERDICT_HEADINGS[overrides.verdictLabel ?? 'SUPPORTED'],
    plannedDays: 42,
    daysLogged: 38,
    ...extra,
  };
}

for (const verdictLabel of ['SUPPORTED', 'NO_DETECTABLE_EFFECT', 'INCONCLUSIVE'] as const) {
  test(`${verdictLabel}: fixed heading, 50-90 words, no banned word or decimal`, () => {
    const plain = buildPlainResult(input({ verdictLabel }));
    assert.equal(plain.headline, VERDICT_HEADINGS[verdictLabel]);
    assert.equal(plain.noAnswer, false);
    assert.ok(words(plain.paragraph) >= 50, `${words(plain.paragraph)} words: ${plain.paragraph}`);
    assert.ok(words(plain.paragraph) <= 90, `${words(plain.paragraph)} words: ${plain.paragraph}`);
    assertCleanParagraph(plain.paragraph);
    assertCleanParagraph(plain.certainty);
    assertCleanParagraph(plain.nextStep);
    assert.match(plain.paragraph, /Over 42 days you logged sleep on 38 and followed the plan on 30/);
  });
}

test('a missing interval falls back to the cautious figure, never a single best estimate', () => {
  const plain = buildPlainResult(input({ interval: null, conservativeEstimate: 25 }));
  assert.match(plain.paragraph, /at least 25 minutes longer/);
  assertCleanParagraph(plain.paragraph);
});

test('the exaggeration note never leaves a point figure on its own', () => {
  const plain = buildPlainResult(
    input({ statement: 'The estimate is probably exaggerated.', interval: null, conservativeEstimate: 25 }),
  );
  assert.match(plain.paragraph, /at least 25 minutes/);
  assert.ok(!plain.paragraph.includes('The cautious estimate was 25'));
});

test('null estimate and null interval still give a readable answer', () => {
  const plain = buildPlainResult(input({ interval: null, conservativeEstimate: null }));
  assert.equal(plain.noAnswer, false);
  assertCleanParagraph(plain.paragraph);
  assert.ok(words(plain.paragraph) >= 50);
});

test('negative direction reads shorter, and never longer', () => {
  const plain = buildPlainResult(
    input({ verdictLabel: 'NO_DETECTABLE_EFFECT', interval: [-40, -10], conservativeEstimate: 0 }),
  );
  assert.match(plain.paragraph, /shorter/);
  assert.ok(!plain.paragraph.includes('minutes longer'));
  assertCleanParagraph(plain.paragraph);
});

test('positive direction reads longer, and never shorter', () => {
  const plain = buildPlainResult(input({ verdictLabel: 'SUPPORTED', interval: [10, 40] }));
  assert.match(plain.paragraph, /longer/);
  assert.ok(!plain.paragraph.includes('minutes shorter'));
});

test('zero and tiny sizes say about the same', () => {
  for (const interval of [[0, 0], [0, 3], [-2, 2]] as [number, number][]) {
    const plain = buildPlainResult(
      input({ verdictLabel: 'SUPPORTED', interval, conservativeEstimate: 0 }),
    );
    assert.match(plain.paragraph, /about the same/);
    assert.ok(!plain.paragraph.includes('1 minute longer'));
    assertCleanParagraph(plain.paragraph);
  }
});

test('ends early and too few days say there is no answer, and why', () => {
  const ended = buildPlainResult({
    ...input({}, { result: null }),
    result: null,
    endedEarly: true,
    daysElapsed: 10,
    daysLogged: 9,
  });
  assert.equal(ended.headline, 'Test ended early');
  assert.equal(ended.noAnswer, true);
  assert.match(ended.paragraph, /ended this test after 10 of 42 days/);
  assert.match(ended.paragraph, /no answer to show/);
  assertCleanParagraph(ended.paragraph);

  const sparse = buildPlainResult(input({ daysAnalyzed: { intervention: 5, control: 4 } }));
  assert.equal(sparse.noAnswer, true);
  assert.match(sparse.paragraph, /too few days to compare fairly/);
  assertCleanParagraph(sparse.paragraph);

  const shortPlan = buildPlainResult(input({}, { plannedDays: 28 }));
  assert.equal(shortPlan.noAnswer, true);
  assert.match(shortPlan.paragraph, /too few days to compare fairly/);
});

test('everyday units: minute rounding and hours', () => {
  assert.equal(roundSleepMinutes(59), 60);
  assert.equal(roundSleepMinutes(7), 7);
  assert.equal(formatSleepMinutes(59), '1 hour');
  assert.equal(formatSleepMinutes(60), '1 hour');
  assert.equal(formatSleepMinutes(75), '1 hour 15 minutes');
  assert.equal(formatSleepMinutes(125), '2 hours 5 minutes');
  assert.equal(formatSleepMinutes(5), '5 minutes');
  assert.equal(formatSleepMinutes(-45), '45 minutes');
});

test('stored readings for Details and the comparison card use everyday units', () => {
  assert.equal(describeStoredEstimate({ interval: [10, 40], conservativeEstimate: 10 }), '10 to 40 minutes longer a night on cutoff days');
  assert.equal(describeStoredEstimate({ interval: [70, 130], conservativeEstimate: 70 }), '1 hour 10 minutes to 2 hours 10 minutes longer a night on cutoff days');
  assert.equal(describeStoredEstimate({ interval: [0, 0], conservativeEstimate: 0 }), 'about the same on cutoff days and normal days');
  assert.equal(describeStoredEstimate({ interval: null, conservativeEstimate: 75 }), 'at least 1 hour 15 minutes more a night on cutoff days');
  assert.equal(describeStoredEstimate({ interval: null, conservativeEstimate: null }), 'no clear number from this log');
});

test('certainty and next step never repeat the paragraph word for word', () => {
  for (const verdictLabel of ['SUPPORTED', 'NO_DETECTABLE_EFFECT', 'INCONCLUSIVE'] as const) {
    const plain = buildPlainResult(input({ verdictLabel }));
    assert.notEqual(plain.certainty, plain.paragraph);
    assert.ok(!plain.paragraph.includes(plain.certainty));
    assert.ok(!plain.paragraph.includes(plain.nextStep));
  }
});
