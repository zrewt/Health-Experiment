import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAUSATION_CAVEAT, buildResultSummary, type ResultSummaryInputs } from '../src/experiment/result-summary';
import type { ResultViewModel } from '../src/experiment/types';
import { VERDICT_HEADINGS } from '../src/experiment/verdict-headings';

/** Only the fields the summary reads are set; the rest of a stored result is not needed. */
function result(overrides: Partial<ResultViewModel>): ResultViewModel {
  return {
    verdictLabel: 'SUPPORTED',
    statement: 'engine statement',
    reasons: [],
    conservativeEstimate: 43,
    interval: [30, 60],
    ruledOut: null,
    daysAnalyzed: { intervention: 19, control: 17 },
    daysExcluded: 0,
    missingOutcomeDays: 0,
    unknownExposureDays: 0,
    adherence: { counts: { ADHERENT: 20, NON_ADHERENT: 0, CONTAMINATED: 0, CONTROL_CLEAN: 0, UNKNOWN: 0 } } as never,
    reducedAdherence: false,
    plannedPowerRecomputed: null,
    plannedPowerSnapshot: null,
    ...overrides,
  } as ResultViewModel;
}

function inputs(overrides: Partial<ResultViewModel>, extra: Partial<ResultSummaryInputs> = {}): ResultSummaryInputs {
  const verdictLabel = (overrides.verdictLabel ?? 'SUPPORTED') as keyof typeof VERDICT_HEADINGS;
  return {
    result: result(overrides),
    verdictHeading: VERDICT_HEADINGS[verdictLabel],
    cutoffTime: '13:15',
    plannedDays: 42,
    cutoffDaysPlanned: 21,
    ...extra,
  };
}

/** Words the summary must never show: the statistics stay under "Scientific details". */
const JARGON = /cautious|interval|estimate|statistic|coefficient|standard deviation|lag|autocorrelation/i;

test('a supported result leads with a rounded headline and a plain takeaway', () => {
  const summary = buildResultSummary(inputs({ conservativeEstimate: 43.2 }));
  assert.equal(summary.headline, 'You slept about 43 minutes longer on cutoff days');
  assert.equal(summary.takeaways[0], 'You kept the 13:15 cutoff on 20 of 21 cutoff days.');
  assert.equal(summary.takeaways[1], 'We could use 36 of your 42 days.');
  assert.equal(
    summary.takeaways[2],
    'Even the smallest difference your log supports is about 43 minutes more sleep a night on cutoff days.',
  );
});

test('a supported result without a number shows no digits in its headline or finding', () => {
  const summary = buildResultSummary(inputs({ conservativeEstimate: null }));
  assert.equal(summary.headline, 'Sleep was longer on cutoff days');
  assert.doesNotMatch(summary.headline + summary.takeaways[2], /\d/);
});

test('no difference and too-close-to-call are plain and never a claim of no effect', () => {
  const none = buildResultSummary(inputs({ verdictLabel: 'NO_DETECTABLE_EFFECT', conservativeEstimate: null }));
  assert.equal(none.headline, 'No clear difference in sleep');
  assert.equal(none.takeaways[2], 'Your sleep looked about the same on cutoff days and normal days.');

  const close = buildResultSummary(inputs({ verdictLabel: 'INCONCLUSIVE', conservativeEstimate: null }));
  assert.equal(close.headline, 'Too close to call');
  assert.doesNotMatch(close.takeaways[2], /no effect/i);
});

test('every result keeps the causation caveat visible, and no sentence claims caffeine caused a change', () => {
  for (const verdictLabel of ['SUPPORTED', 'NO_DETECTABLE_EFFECT', 'INCONCLUSIVE'] as const) {
    const summary = buildResultSummary(inputs({ verdictLabel }));
    assert.equal(summary.caveat, CAUSATION_CAVEAT);
    const body = [summary.headline, ...summary.takeaways, summary.certainty].join(' ');
    assert.doesNotMatch(body, /caffeine (caused|causes|reduced|increased)/i);
  }
  assert.match(CAUSATION_CAVEAT, /does not prove that caffeine caused it/);
});

test('the summary uses no statistical jargon', () => {
  for (const verdictLabel of ['SUPPORTED', 'NO_DETECTABLE_EFFECT', 'INCONCLUSIVE'] as const) {
    const summary = buildResultSummary(inputs({ verdictLabel }));
    const plain = [summary.headline, ...summary.takeaways].join(' ');
    assert.doesNotMatch(plain, JARGON);
  }
});

test('the certainty line gives the likely range, and names the reasons to be careful', () => {
  const clean = buildResultSummary(inputs({}));
  assert.equal(clean.certainty, 'The likely range is 30 to 60 minutes a night.');

  const gappy = buildResultSummary(inputs({ missingOutcomeDays: 2, reducedAdherence: true }));
  assert.match(gappy.certainty, /did not always keep the rule/);
  assert.match(gappy.certainty, /not fully logged/);

  const noRange = buildResultSummary(inputs({ interval: null }));
  assert.equal(noRange.certainty, 'Your log was not enough to give a likely range.');
});
