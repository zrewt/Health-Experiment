# Caffeine engine simulation report

## Fixed protocol and methods

- Master seed: 20261008; 1000 runs per scenario, 12 scenarios, 12,000 total runs.
- 28 days; uniformly sampled balanced randomized assignments, consecutive-day cap 3.
- Perfect-exposure effects: 0, 15, 30, 45 minutes. Both intervention adherence and control non-contamination probabilities: 60%, 80%, 100%.
- Sleep: 420-minute baseline plus exposure effect and stationary Gaussian AR(1) noise, marginal SD 45 minutes, correlation rho=0.4.
- Independent missing outcomes 10%; unknown exposure 5%; illness 2%; travel 1%. No treatment-linked missingness, carryover, trends, or causal covariate effects in this simulation.
- Randomization test: 499 constrained draws plus-one correction, two-sided; missing/excluded outcomes stay at their calendar positions.
- Bootstrap: 499 circular moving-block pairs draws, block length 3, percentile 95% interval. This assumption was fixed before simulation, not tuned afterward.
- Verdict defaults unchanged: 10 analyzable days per condition, 70% adherence, 15-minute meaningful effect, alpha .05; unknown exposure cannot count toward demonstrated compliance.
- Detection means SUPPORTED. Test rejection is separate: p <= .05 regardless of verdict gates. For effect 0, these are respectively verdict false positives and test false positives.
- Primary is intention-to-treat (assignment). With crossover in both groups, population assignment effect = perfect-exposure effect × (2 × adherence − 1). Coverage must target this attenuated effect. Perfect-exposure coverage is also shown but is NOT valid coverage for the primary estimand when adherence is imperfect.
- All coverage rates use all 1,000 runs as denominator; unavailable intervals count as noncoverage. Sampling error around a 5% rate is approximately ±1.4 percentage points (95% Monte Carlo margin); around 95% coverage the same margin applies.
- These results concern randomized design only. Alternating and alternating-block designs enumerate two starting phases, so their two-sided p-values are 1; they cannot produce SUPPORTED at alpha .05.

## Results

| Perfect-exposure effect (min) | Adherence probability | True assignment effect (min) | Mean estimated effect | Detection / SUPPORTED | Test rejection / null FPR | 95% CI coverage: assignment | CI contains perfect-exposure effect | INCONCLUSIVE | Available intervals |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 60% | 0.0 | -0.1 | 0.4% | 4.9% | 92.0% | 92.0% | 99.6% | 1000/1000 |
| 0 | 80% | 0.0 | 0.0 | 1.6% | 4.2% | 93.2% | 93.2% | 98.4% | 1000/1000 |
| 0 | 100% | 0.0 | 0.4 | 2.9% | 5.1% | 92.3% | 92.3% | 97.0% | 1000/1000 |
| 15 | 60% | 3.0 | 2.5 | 0.5% | 5.8% | 91.2% | 83.6% | 99.5% | 1000/1000 |
| 15 | 80% | 9.0 | 9.2 | 4.7% | 6.8% | 92.9% | 90.6% | 95.3% | 1000/1000 |
| 15 | 100% | 15.0 | 14.3 | 11.7% | 14.7% | 90.2% | 90.2% | 88.3% | 1000/1000 |
| 30 | 60% | 6.0 | 6.2 | 1.0% | 6.1% | 93.2% | 68.8% | 99.0% | 1000/1000 |
| 30 | 80% | 18.0 | 18.1 | 13.6% | 17.0% | 92.6% | 85.3% | 86.4% | 1000/1000 |
| 30 | 100% | 30.0 | 29.7 | 36.9% | 39.7% | 92.5% | 92.5% | 63.1% | 1000/1000 |
| 45 | 60% | 9.0 | 8.8 | 1.5% | 7.4% | 91.4% | 46.5% | 98.5% | 1000/1000 |
| 45 | 80% | 27.0 | 26.5 | 24.3% | 29.0% | 93.4% | 78.0% | 75.7% | 1000/1000 |
| 45 | 100% | 45.0 | 45.4 | 70.7% | 75.0% | 93.5% | 93.5% | 29.3% | 1000/1000 |

## Calibration findings

- **WARNING:** Effect 15, adherence 60%: assignment-effect interval coverage 91.2%, far from 95%.
- **WARNING:** Effect 15, adherence 100%: assignment-effect interval coverage 90.2%, far from 95%.
- **WARNING:** Effect 45, adherence 60%: assignment-effect interval coverage 91.4%, far from 95%.

These flags are reporting heuristics, not engine thresholds, and do not replace scrutiny of the table. No model parameters or verdict thresholds were adjusted after observing the results.

## Limitations and proposed fixes (not applied)

- Bootstrap pairs intervals may under-cover with only 28 nights; bootstrap validity is not guaranteed by a calibrated randomization p-value.
- If coverage is poor, compare studentized/residual block bootstraps, design-aware interval inversion, and a predeclared block-length sensitivity grid using held-out simulation seeds. Do not choose a length solely to improve this table.
- For alternating/block experiments, redesign with genuinely randomized multiple blocks or restrict to descriptive/inconclusive reporting; do not use unrestricted permutations.
- Extend experiments or plan sample size around the meaningful effect if 28 days is insufficient. Do not lower evidence gates to increase detection.
- Stress-test stronger autocorrelation, weekday effects, trends, carryover, asymmetric nonadherence, and informative missingness before real-world use.
- Control contamination is a behavioral proxy. An early last caffeine time does not prove intentional restriction.
- This synthetic population is not evidence that caffeine improves an individual’s sleep.

Runtime: 139.6 seconds in this environment (measured for this run; not a speedup claim).
