import { DEFAULT_VERDICT } from '../engine';
import type { AnalysisConfig, CaffeineConditionRule, Design, VerdictConfig } from '../engine';
import { FEASIBILITY_TABLE_META } from '../engine/feasibility-table-data';

export const minimumMeaningfulEffectMinutes = DEFAULT_VERDICT.minMeaningfulEffect;
export const assumedAdherence = 0.9;
export const assumedContamination = 0.1;
export const durations = Object.freeze([...FEASIBILITY_TABLE_META.durations]);
export const autocorrelationGrid = Object.freeze([...FEASIBILITY_TABLE_META.rhos]);
export const runInMinValidDays = 14;
export const informativeMaxMinutes = 30;
export const longShotMaxMinutes = 45;
export const sdLowerBound = Math.min(...FEASIBILITY_TABLE_META.sds);
export const sdUpperBound = Math.max(...FEASIBILITY_TABLE_META.sds);
export const tierDuration = Math.max(...durations);

// Policy B is selected in reports/caffeine-simulation-v3-selection.json.
// Resampling overrides come from scripts/simulate-engine-v3-1-helpers.ts,
// the harness that generated the lookup table (149 draws, not v3's 299).
// Runtime seed/baseline/adherence are supplied by the stored experiment plan.
export const selectedPolicyOverrides = Object.freeze({
  analysis: Object.freeze({
    permutations: 149,
    bootstrapSamples: 149,
    bootstrapMethod: 'studentized',
    bootstrapBlockLength: 5,
  } satisfies Partial<AnalysisConfig>),
  verdict: Object.freeze({ gatePolicy: 'B' } satisfies Partial<VerdictConfig>),
});
export const experimentName = 'Caffeine cutoff';
export const outcomeMetric = 'sleepMinutes';
// This engine minimizes weekend imbalance; it does not stratify every weekday.
export const experimentDesign = Object.freeze({
  type: 'randomized-blocks', blockLength: 2, balanceWeekends: true,
} satisfies Design);
export const conditionRule = Object.freeze({
  type: 'caffeine-cutoff', cutoffTime: '12:00',
} satisfies CaffeineConditionRule);

export const mdeLabel = 'effect if you follow the rule fully';
export const adherenceAssumptionText =
  `assuming you follow the rule on about ${assumedAdherence * 10} of 10 assigned days`;
export const autocorrelationAssumptionText =
  `We did not estimate autocorrelation from your run-in; numbers use the least favourable value in the tested range (${Math.min(...autocorrelationGrid)} to ${Math.max(...autocorrelationGrid)}).`;
export const conservativeAssumptionText =
  `Run-in SD is below the tested range; lookup uses SD ${sdLowerBound}. Numbers labelled "at least" are conservative, unvalidated assumptions, not validated bounds.`;
