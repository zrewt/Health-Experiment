# Personal experiment engine — v3

Pure TypeScript, deterministic seeded randomness, runtime imports local to the engine. No React, Expo, network, Supabase or AI imports. Missing outcomes/exposure remain missing, not zeros.

## API

- `generateSchedule(startDate, length, design, seed)` preserves civil dates and seeded assignments. `randomized-blocks` supports nominal lengths 2/3, equal day AND block counts, and configurable minimum weekend imbalance (`balanceWeekends`, default true). Remainders form a shorter equal-length pair; odd durations are rejected. `randomizedBlockSpace` counts exact admissible assignments with BigInt and samples under the same constraints used for inference.
- `checkCaffeineEligibility(runInDays, config)` defaults to seven days, at least 50% with caffeine after noon over ALL run-in days. Unknown exposure counts separately; sample SD is null with fewer than two outcomes.
- `analyzeExperiment(definition, records, overrides)` uses the pluggable exposure rule and named outcome metric. Primary is assigned intervention minus assigned control, NOT actual-exposure effect. Observed unknown-exposure days stay in ITT but cannot satisfy the analyzable-day gate. Per-protocol is secondary/non-causal. Default interval: studentized circular moving-block bootstrap, length3; v3 simulations explicitly retain v2 tuning length5. Default result NEVER includes complier estimates.
- `getVerdict(result, { gatePolicy })`: A (default) hard85% intervention adherence /15% contamination; B label-only, no adherence/contamination gate; C hard75%/25%. All retain at least10 known-exposure/observed-outcome days per condition, estimate>=15 outcome units, positive lower interval bound, and p<=.05 for SUPPORTED. Overrides for thresholds remain possible. B changes only compliance gates; it does not reinterpret assignment as exposure efficacy.
- 28 days or less is **too short for inference** regardless of assignment length; any randomized-block design with fewer than100 admissible allocations is also INCONCLUSIVE for that reason. Alternating/fixed blocks are descriptive only with reason `design does not support inference`. Randomization resolution is two-sided2/M (complement assignments), not1/M.
- Verdict carries `effect_likely_understated` (true if realized intervention adherence minus control contamination<1), `intervention_adherence`, `control_contamination`, policy, estimand and display fields. Unknown rates produce null, not a fabricated percentage. The understatement flag is a descriptive attenuation assumption, not a causal correction.
- `assessFeasibility({ mean, sd, lag1Autocorrelation, duration, design, startDate?, observedEffect?, outcomeRetention?, minMeaningfulEffect? })` computes an analytic Gaussian AR(1) approximation. Returns MDE at70% positive-benefit power, approximate observed-effect power, SE, inflation risk, inference feasibility and plain-language statement. No simulation/network at call time. Missing SD/rho=>null MDE/power and unknown risk. Mean is validated but does not alter translation-invariant variance. `outcomeRetention` defaults1; planning may supply expected observed-outcome retention. The function ignores compliance gates, weekday-constrained covariance details and uncertain run-in estimates. Do not label this as guaranteed verdict power.
- Every effect result (top-level analysis, primary, per-protocol, verdict, experimental estimate) includes `estimand`, `interval95`, `conservative_estimate` (`max(0, lower95)`; null if interval missing), and `inflation_risk` (`high` when approximate power for observed effect<50%, `low` otherwise, `unknown` without baseline/feasibility). Supply analysis `baseline: { mean, sd, lag1Autocorrelation }` from run-in. Never derive a fake baseline from treated outcomes. Per-protocol uses the assigned-design approximation only as a heuristic. Experimental IV risk remains unknown because that approximation does not apply to the ratio estimand.

## Experimental complier estimation

Explicit import only (not exported from the default barrel):

```ts
import { analyzeExperimentalComplier } from './experimental-complier';
```

`analyzeExperimentalComplier(definition, records, overrides, preparedAnalysis?)` performs a secondary Wald ratio with joint whole-assignment-block percentile bootstrap. Assumes exclusion restriction, no defiers, no interference/carryover and ignorable missingness. First stage<.5 returns null; nonpositive bootstrap first stages withhold the interval rather than trimming tails. No verdict consumes this module. Earlier IV tests remain, redirected to explicit opt-in calls.

## Run with existing dependencies

```bash
npx --no-install tsx --test scripts/engine.test.ts scripts/engine-v2.test.ts scripts/engine-v3.test.ts
npx --no-install tsc --noEmit -p tsconfig.engine.json
npm run typecheck
npm run lint
npx --no-install tsx scripts/simulate-engine-v3.ts --phase full
```

Simulation protocol is `reports/caffeine-simulation-v3-protocol.md`, written before tuning/held-out evaluation. V3 saves per-cell checkpoints, a frozen selection artifact and `reports/caffeine-simulation-v3.md`. All v1/v2 reports, JSON and logs remain byte-for-byte unchanged. Historical harnesses should not be rerun with revised engine semantics; the v2 source has an explicit experimental import for type compatibility and its hash guard prevents rewriting historical artifacts.

## Interpretation cautions

Positive outcome differences are configured as benefit (sleep minutes: longer sleep); meaningful-effect defaults are in OUTCOME units, even when simulation effects are standardized by SD. `size_uncertain` remains true if lower bound<meaningful effect, including when other gates fail. NO_DETECTABLE_EFFECT is an interval inside configured ±meaningful-effect bounds, not proof of zero effect.

Approximate95% intervals can under-cover. A conservative display is not a guaranteed conservative bound. Observed-effect plug-in power can miss winner's-curse risk: the very estimates selected for support look high-power afterward. Calibration, feasibility errors, design-power-band inflation and this display failure mode are reported without tuning on held-out seeds. Carryover, informative missingness and run-in estimation uncertainty require future validation on new seeds.
