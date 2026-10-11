# Caffeine engine simulation report v2

## Status and frozen protocol

**Complete:** 121/121 held-out cells. Previous report preserved at [caffeine-simulation.md](caffeine-simulation.md).

- Pure TypeScript engine; no React, network, Supabase, AI, or added dependencies. Seeded randomness only.
- **TUNING data seeds:** 10,000,000–10,000,499 (28d), 10,001,000–10,001,499 (42d), 10,002,000–10,002,499 (56d). Six candidate methods/lengths use the same paired datasets: 9,000 analyses, 1,500 unique datasets.
- **HELD-OUT core seeds:** cell j (0–107) uses 20,000,000 + 1,000j through +499. 108 cells = durations 28/42/56 × effects 0/15/30/45 × adherence 80/90/100% × independently varied contamination 0/10/20%. 54,000 analyses.
- **HELD-OUT sensitivity seeds:** 21,000,000–21,000,499, paired across ten one-factor-at-a-time cases (5,000 analyses). **HELD-OUT interval-length seeds:** 22,000,000–22,000,499, paired across lengths 2/3/5 (1,500 analyses). Total full protocol: 69,500 analyses including tuning, 56,500 unique datasets.
- Data seed s derives schedule seed (s XOR 0xcafe1234) and resampling seed (s XOR 0x09b43e12), each uint32. Tuning and held-out data seed streams are disjoint.
- **Selection rule fixed before held-out:** Minimize absolute pooled tuning coverage minus 95%; tie: length 3, then 2, then 5, then studentized. All candidates use the same paired tuning datasets; no held-out data enters selection.
- **Frozen selection for the simulation:** studentized moving-block bootstrap, length **5** nights, passed explicitly as analysis overrides. The engine's pre-existing default interval length remains 3; use `{ bootstrapMethod: 'studentized', bootstrapBlockLength: 5 }` to reproduce the selected interval. Held-out length sensitivity below is not a reason to change defaults after reporting. All verdict gates remain 10 observed-outcome/known-exposure days per condition, intervention adherence ≥85%, control contamination ≤15%, estimate ≥15 minutes, positive CI lower bound, p≤.05. No held-out tuning.
- 500 runs/cell; 299 bootstrap draws and up to 299 constrained permutation draws per analysis. Small spaces enumerate exactly. Bootstrap-t uses Bartlett HAC SEs for original and replicate differences. Finite resampling precision is a limitation.
- Assignment uses nominal 3-day randomized blocks, equal counts of blocks AND days, and minimum achievable weekend imbalance. Remainder nights form a shorter equal-length block pair: 28d = 8×3 + 2×2; 42d = 14×3; 56d = 18×3 + 2×1. The 2-day option is tested separately. Odd durations are rejected rather than quietly unbalanced.
- Admissible allocations / smallest TWO-sided p: 28d 42 / 0.04762; 42d 840 / 0.00238; 56d 21420 / 0.00009. Complement allocations explain the 2/M floor. The 28-day design warns (<100 allocations).
- Base DGP: sleep 420 + actual-exposure effect + stationary Gaussian AR(1), rho .4, marginal SD 45. Independent unknown exposure 5%, missing outcome 10%, illness 2%, travel 1%. No clipping/zero imputation. Unknown exposure preserves ITT outcomes but cannot satisfy analyzable-day gates. Adherence rates use known, nonexcluded exposures.
- Primary target = true exposure effect × (intervention adherence − control contamination). Carryover target adds the expected previous-exposure contrast conditional on the randomized schedule; weekend and trend are nuisance signals. Complier target is the direct exposure effect; carryover violates its no-interference assumption.
- CACE is secondary: ITT / adherence difference, refused below .5. Outcome and exposure resample jointly in whole assignment blocks, stratified by assigned condition. No near-zero/negative first-stage tail trimming; unstable draws withhold the interval. Per-protocol remains secondary/non-causal.
- All coverage percentages use ALL runs (unavailable intervals count as noncoverage). Availability and weak/unstable rates are retained in JSON, not hidden by conditioning. Mean estimates use non-null estimates only. Detection means SUPPORTED; at effect 0 it is verdict FPR. Test rejection at effect 0 is two-sided test FPR.
- Monte Carlo 95% margin ≈±1.9 percentage points at a 5%/95% rate and ±4.4 at 50% for a 500-run cell. Pooled percentages share scenario differences; sensitivity comparisons are paired.
- Engine SHA256: `d238707d2b447209bef9cb4d9d0e60e68fa178e9b671d5959dd475bdb013c176`. Raw counts, options, exact seeds, times: [data JSON](caffeine-simulation-v2-data.json). Frozen tuning artifact: [tuning JSON](caffeine-simulation-v2-tuning.json).

## 1. Tuning-only comparison

| Method | Moving length | Duration | Assigned-effect coverage | SUPPORTED | CI available |
|---|---:|---:|---:|---:|---:|
| percentile | 2 | 28 | 88.0% | 6.8% | 500/500 |
| percentile | 2 | 42 | 88.8% | 12.6% | 500/500 |
| percentile | 2 | 56 | 85.2% | 20.4% | 500/500 |
| percentile | 3 | 28 | 88.4% | 7.0% | 500/500 |
| percentile | 3 | 42 | 90.2% | 12.4% | 500/500 |
| percentile | 3 | 56 | 85.8% | 20.2% | 500/500 |
| percentile | 5 | 28 | 87.0% | 7.2% | 500/500 |
| percentile | 5 | 42 | 88.4% | 12.2% | 500/500 |
| percentile | 5 | 56 | 86.2% | 20.0% | 500/500 |
| studentized | 2 | 28 | 92.6% | 6.0% | 500/500 |
| studentized | 2 | 42 | 91.6% | 11.6% | 500/500 |
| studentized | 2 | 56 | 88.4% | 19.8% | 500/500 |
| studentized | 3 | 28 | 93.6% | 6.0% | 500/500 |
| studentized | 3 | 42 | 93.2% | 10.6% | 500/500 |
| studentized | 3 | 56 | 90.2% | 19.6% | 500/500 |
| studentized | 5 | 28 | 92.8% | 6.0% | 500/500 |
| studentized | 5 | 42 | 93.4% | 10.2% | 500/500 |
| studentized | 5 | 56 | 91.0% | 17.6% | 500/500 |

## 2. Held-out summary and calibration findings

- Pooled null **test FPR: 4.9%**; cell range 3.4–7.4%. Pooled null **verdict FPR: 0.9%**; cell range 0.2–2.4%.
- **Primary interval undercoverage:** pooled assigned-effect coverage **92.5%** versus nominal 95%, range 89.6–95.6%. 35/108 core cells outside the descriptive 92–98% gross-calibration band. This is NOT a validity claim or an engine threshold.
- **Secondary interval poorly calibrated:** pooled complier coverage **84.1%** (all-run denominator), and **89.6% conditional on an available interval** (diagnostic only, not a replacement denominator). 2180 weak-instrument refusals and 1140 unstable/unavailable complier intervals among 54000 core runs. Choosing the primary interval method does NOT calibrate the secondary ratio interval.
- The requested 85%/15% gates can make SUPPORTED uncommon even for large effects: realized adherence/contamination fluctuate around their population rates. Longer duration cannot overcome a systematically failed gate. See gate-failure rates below.
- SUPPORTED-only mean estimates show selection inflation; compare these with the assigned-effect target, not the larger perfect-exposure effect.
- No numerical findings in this report are hand-entered forecasts. All table values and summary ranges come from persisted run counts. Undercoverage and low detection remain reported, not repaired using held-out data.

### Representative 90% adherence / 10% contamination

| Days | Direct effect | SUPPORTED | INCONCLUSIVE | ITT coverage | CACE coverage | Mean when SUPPORTED | Data/adherence gate failed |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 28 | 0 | 1.0% | 99.0% | 91.4% | 82.2% | 50.0 | 59.0% |
| 28 | 15 | 1.8% | 98.2% | 92.6% | 81.8% | 46.9 | 56.4% |
| 28 | 30 | 6.2% | 93.8% | 91.2% | 79.8% | 53.6 | 55.4% |
| 28 | 45 | 9.4% | 90.6% | 92.4% | 82.4% | 56.5 | 54.8% |
| 42 | 0 | 0.8% | 99.2% | 92.4% | 88.0% | 35.5 | 36.4% |
| 42 | 15 | 4.8% | 95.2% | 92.0% | 86.8% | 43.1 | 32.6% |
| 42 | 30 | 10.2% | 89.8% | 91.8% | 90.4% | 49.3 | 41.0% |
| 42 | 45 | 23.8% | 76.2% | 94.0% | 90.8% | 52.3 | 37.4% |
| 56 | 0 | 0.8% | 99.2% | 91.6% | 89.8% | 40.8 | 33.4% |
| 56 | 15 | 4.6% | 95.4% | 92.6% | 91.4% | 41.2 | 38.0% |
| 56 | 30 | 17.0% | 83.0% | 92.6% | 92.8% | 42.8 | 41.2% |
| 56 | 45 | 31.8% | 68.2% | 89.6% | 87.2% | 48.7 | 35.2% |

## 3. Full held-out core grid

ITT/CACE availability column gives counts out of 500 for each interval. Coverage below uses all 500.

| Days | Direct effect | Int adh | Ctrl contam | Assigned target | Mean estimate | SUPPORTED / null verdict FPR | p≤.05 / null test FPR | INCONCLUSIVE | ITT coverage | CACE coverage | Mean when SUPPORTED | ITT/CACE available |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 28 | 0 | 80% | 0% | 0.0 | 0.2 | 0.6% | 5.2% | 99.4% | 93.4% | 85.8% | 39.6 | 500/478 |
| 28 | 0 | 80% | 10% | 0.0 | 0.2 | 0.6% | 3.4% | 99.2% | 92.8% | 71.6% | 39.7 | 500/409 |
| 28 | 0 | 80% | 20% | 0.0 | -0.9 | 0.2% | 4.4% | 99.8% | 91.8% | 49.6% | 30.8 | 500/287 |
| 28 | 0 | 90% | 0% | 0.0 | 1.8 | 0.6% | 4.6% | 99.4% | 91.0% | 83.0% | 38.0 | 500/490 |
| 28 | 0 | 90% | 10% | 0.0 | 0.3 | 1.0% | 6.8% | 99.0% | 91.4% | 82.2% | 50.0 | 500/468 |
| 28 | 0 | 90% | 20% | 0.0 | -1.3 | 0.2% | 4.0% | 99.8% | 93.4% | 71.6% | 33.4 | 500/407 |
| 28 | 0 | 100% | 0% | 0.0 | 0.8 | 1.8% | 5.4% | 98.2% | 92.0% | 84.8% | 45.3 | 500/495 |
| 28 | 0 | 100% | 10% | 0.0 | 1.5 | 2.0% | 5.4% | 98.0% | 93.0% | 86.2% | 48.7 | 500/496 |
| 28 | 0 | 100% | 20% | 0.0 | 0.2 | 0.4% | 6.4% | 99.6% | 91.0% | 83.6% | 29.8 | 500/481 |
| 28 | 15 | 80% | 0% | 12.0 | 10.3 | 1.2% | 8.2% | 98.8% | 92.2% | 79.8% | 45.7 | 500/466 |
| 28 | 15 | 80% | 10% | 10.5 | 9.1 | 0.8% | 4.2% | 99.2% | 93.8% | 71.6% | 42.5 | 500/404 |
| 28 | 15 | 80% | 20% | 9.0 | 8.8 | 0.2% | 6.0% | 99.8% | 91.4% | 55.8% | 54.9 | 500/327 |
| 28 | 15 | 90% | 0% | 13.5 | 12.1 | 2.8% | 5.4% | 97.2% | 93.2% | 85.2% | 42.4 | 500/488 |
| 28 | 15 | 90% | 10% | 12.0 | 12.2 | 1.8% | 7.0% | 98.2% | 92.6% | 81.8% | 46.9 | 500/464 |
| 28 | 15 | 90% | 20% | 10.5 | 9.6 | 0.2% | 5.6% | 99.8% | 93.4% | 72.4% | 49.9 | 500/405 |
| 28 | 15 | 100% | 0% | 15.0 | 12.4 | 4.4% | 7.8% | 95.6% | 91.2% | 86.8% | 54.4 | 500/496 |
| 28 | 15 | 100% | 10% | 13.5 | 13.5 | 3.4% | 7.8% | 96.6% | 91.6% | 84.4% | 48.4 | 500/486 |
| 28 | 15 | 100% | 20% | 12.0 | 10.6 | 1.2% | 5.6% | 98.8% | 89.6% | 82.8% | 58.6 | 500/482 |
| 28 | 30 | 80% | 0% | 24.0 | 24.7 | 3.6% | 14.6% | 96.4% | 91.4% | 83.4% | 57.9 | 500/470 |
| 28 | 30 | 80% | 10% | 21.0 | 19.4 | 2.0% | 10.2% | 98.0% | 90.6% | 67.8% | 57.5 | 500/390 |
| 28 | 30 | 80% | 20% | 18.0 | 18.7 | 0.8% | 10.2% | 99.2% | 91.6% | 58.6% | 54.3 | 500/332 |
| 28 | 30 | 90% | 0% | 27.0 | 27.5 | 9.0% | 20.0% | 91.0% | 92.8% | 82.6% | 53.1 | 500/485 |
| 28 | 30 | 90% | 10% | 24.0 | 24.0 | 6.2% | 14.4% | 93.8% | 91.2% | 79.8% | 53.6 | 500/460 |
| 28 | 30 | 90% | 20% | 21.0 | 20.1 | 1.6% | 10.0% | 98.4% | 91.6% | 70.6% | 61.0 | 500/410 |
| 28 | 30 | 100% | 0% | 30.0 | 29.7 | 12.2% | 20.0% | 87.8% | 92.4% | 87.6% | 55.3 | 500/493 |
| 28 | 30 | 100% | 10% | 27.0 | 27.0 | 6.4% | 15.2% | 93.6% | 94.2% | 86.8% | 52.5 | 500/492 |
| 28 | 30 | 100% | 20% | 24.0 | 25.2 | 3.6% | 14.6% | 96.4% | 89.8% | 81.2% | 63.7 | 500/472 |
| 28 | 45 | 80% | 0% | 36.0 | 36.8 | 8.0% | 23.2% | 92.0% | 92.4% | 82.2% | 66.5 | 500/477 |
| 28 | 45 | 80% | 10% | 31.5 | 30.8 | 4.0% | 19.2% | 96.0% | 90.6% | 71.0% | 65.7 | 500/408 |
| 28 | 45 | 80% | 20% | 27.0 | 26.9 | 1.4% | 12.8% | 98.6% | 93.6% | 57.8% | 62.9 | 500/319 |
| 28 | 45 | 90% | 0% | 40.5 | 40.3 | 16.0% | 31.0% | 84.0% | 91.8% | 85.6% | 59.5 | 500/488 |
| 28 | 45 | 90% | 10% | 36.0 | 35.2 | 9.4% | 23.4% | 90.6% | 92.4% | 82.4% | 56.5 | 500/464 |
| 28 | 45 | 90% | 20% | 31.5 | 33.0 | 6.2% | 20.0% | 93.8% | 92.8% | 74.6% | 59.7 | 500/418 |
| 28 | 45 | 100% | 0% | 45.0 | 44.9 | 26.0% | 39.8% | 74.0% | 90.4% | 86.8% | 65.0 | 500/498 |
| 28 | 45 | 100% | 10% | 40.5 | 42.0 | 16.6% | 29.6% | 83.4% | 92.6% | 85.8% | 61.8 | 500/485 |
| 28 | 45 | 100% | 20% | 36.0 | 36.2 | 6.8% | 20.6% | 93.2% | 91.2% | 83.0% | 62.6 | 500/480 |
| 42 | 0 | 80% | 0% | 0.0 | -0.6 | 0.8% | 5.0% | 99.2% | 93.8% | 89.0% | 43.5 | 500/495 |
| 42 | 0 | 80% | 10% | 0.0 | -0.1 | 0.6% | 4.2% | 99.4% | 94.0% | 84.8% | 37.9 | 500/462 |
| 42 | 0 | 80% | 20% | 0.0 | 1.8 | 0.4% | 5.2% | 99.6% | 93.0% | 66.4% | 26.7 | 500/371 |
| 42 | 0 | 90% | 0% | 0.0 | 1.3 | 1.4% | 4.8% | 98.6% | 90.6% | 89.2% | 40.3 | 500/500 |
| 42 | 0 | 90% | 10% | 0.0 | -1.9 | 0.8% | 4.4% | 99.2% | 92.4% | 88.0% | 35.5 | 500/491 |
| 42 | 0 | 90% | 20% | 0.0 | -0.4 | 0.2% | 3.8% | 99.8% | 91.8% | 83.6% | 39.5 | 500/464 |
| 42 | 0 | 100% | 0% | 0.0 | 0.2 | 2.4% | 4.4% | 97.4% | 91.6% | 89.6% | 45.5 | 500/500 |
| 42 | 0 | 100% | 10% | 0.0 | 0.8 | 1.2% | 4.0% | 98.8% | 93.0% | 90.0% | 42.8 | 500/500 |
| 42 | 0 | 100% | 20% | 0.0 | 0.4 | 1.2% | 5.8% | 98.8% | 92.0% | 88.6% | 37.7 | 500/500 |
| 42 | 15 | 80% | 0% | 12.0 | 12.4 | 3.2% | 10.4% | 96.8% | 92.0% | 88.4% | 44.4 | 500/493 |
| 42 | 15 | 80% | 10% | 10.5 | 11.6 | 2.6% | 9.4% | 97.4% | 93.8% | 82.0% | 45.3 | 500/465 |
| 42 | 15 | 80% | 20% | 9.0 | 9.1 | 0.2% | 8.6% | 99.8% | 92.2% | 68.0% | 52.8 | 500/379 |
| 42 | 15 | 90% | 0% | 13.5 | 12.8 | 5.8% | 10.0% | 94.2% | 93.6% | 90.2% | 43.2 | 500/500 |
| 42 | 15 | 90% | 10% | 12.0 | 12.8 | 4.8% | 10.2% | 95.2% | 92.0% | 86.8% | 43.1 | 500/490 |
| 42 | 15 | 90% | 20% | 10.5 | 10.6 | 1.6% | 6.0% | 98.4% | 92.0% | 84.8% | 44.0 | 500/473 |
| 42 | 15 | 100% | 0% | 15.0 | 16.0 | 8.8% | 11.4% | 91.0% | 94.0% | 91.6% | 43.1 | 500/500 |
| 42 | 15 | 100% | 10% | 13.5 | 12.9 | 5.0% | 9.8% | 94.8% | 93.6% | 89.6% | 41.5 | 500/500 |
| 42 | 15 | 100% | 20% | 12.0 | 12.3 | 2.8% | 7.6% | 97.2% | 92.2% | 90.4% | 45.3 | 500/497 |
| 42 | 30 | 80% | 0% | 24.0 | 25.0 | 8.2% | 22.6% | 91.8% | 90.2% | 86.4% | 52.9 | 500/497 |
| 42 | 30 | 80% | 10% | 21.0 | 20.6 | 3.4% | 14.0% | 96.6% | 93.8% | 82.4% | 49.2 | 500/458 |
| 42 | 30 | 80% | 20% | 18.0 | 18.6 | 2.0% | 14.6% | 98.0% | 92.6% | 67.2% | 44.6 | 500/380 |
| 42 | 30 | 90% | 0% | 27.0 | 29.0 | 16.4% | 24.6% | 83.6% | 94.4% | 93.0% | 48.9 | 500/500 |
| 42 | 30 | 90% | 10% | 24.0 | 24.3 | 10.2% | 20.2% | 89.8% | 91.8% | 90.4% | 49.3 | 500/495 |
| 42 | 30 | 90% | 20% | 21.0 | 19.3 | 4.4% | 14.4% | 95.6% | 93.8% | 82.0% | 44.8 | 500/451 |
| 42 | 30 | 100% | 0% | 30.0 | 30.1 | 24.6% | 29.8% | 75.4% | 92.8% | 91.6% | 48.2 | 500/500 |
| 42 | 30 | 100% | 10% | 27.0 | 25.4 | 17.0% | 22.6% | 83.0% | 93.6% | 91.4% | 47.7 | 500/500 |
| 42 | 30 | 100% | 20% | 24.0 | 25.1 | 8.4% | 22.6% | 91.6% | 93.4% | 89.8% | 48.6 | 500/498 |
| 42 | 45 | 80% | 0% | 36.0 | 36.4 | 12.8% | 38.8% | 87.2% | 91.8% | 89.4% | 56.4 | 500/499 |
| 42 | 45 | 80% | 10% | 31.5 | 31.2 | 10.4% | 31.6% | 89.6% | 91.6% | 78.2% | 52.8 | 500/459 |
| 42 | 45 | 80% | 20% | 27.0 | 28.5 | 3.2% | 26.6% | 96.8% | 91.6% | 69.6% | 54.0 | 500/389 |
| 42 | 45 | 90% | 0% | 40.5 | 40.7 | 38.4% | 50.6% | 61.6% | 91.8% | 89.8% | 54.5 | 500/500 |
| 42 | 45 | 90% | 10% | 36.0 | 36.9 | 23.8% | 41.2% | 76.2% | 94.0% | 90.8% | 52.3 | 500/496 |
| 42 | 45 | 90% | 20% | 31.5 | 30.1 | 8.6% | 29.2% | 91.4% | 95.0% | 83.4% | 51.6 | 500/465 |
| 42 | 45 | 100% | 0% | 45.0 | 45.4 | 54.2% | 63.4% | 45.8% | 92.4% | 88.8% | 56.9 | 500/500 |
| 42 | 45 | 100% | 10% | 40.5 | 40.8 | 34.4% | 48.8% | 65.6% | 91.8% | 88.2% | 56.5 | 500/500 |
| 42 | 45 | 100% | 20% | 36.0 | 35.4 | 13.6% | 39.0% | 86.4% | 93.0% | 90.4% | 57.4 | 500/500 |
| 56 | 0 | 80% | 0% | 0.0 | 0.8 | 0.2% | 5.6% | 99.8% | 91.8% | 90.8% | 30.7 | 500/500 |
| 56 | 0 | 80% | 10% | 0.0 | -0.1 | 0.2% | 4.0% | 99.8% | 92.4% | 90.2% | 40.2 | 500/483 |
| 56 | 0 | 80% | 20% | 0.0 | 0.2 | 0.4% | 7.4% | 99.6% | 89.6% | 71.2% | 28.2 | 500/403 |
| 56 | 0 | 90% | 0% | 0.0 | 0.6 | 1.0% | 4.2% | 99.0% | 93.4% | 92.2% | 37.2 | 500/500 |
| 56 | 0 | 90% | 10% | 0.0 | 1.1 | 0.8% | 5.0% | 99.2% | 91.6% | 89.8% | 40.8 | 500/498 |
| 56 | 0 | 90% | 20% | 0.0 | -0.2 | 0.6% | 3.8% | 99.4% | 92.0% | 87.2% | 40.3 | 500/486 |
| 56 | 0 | 100% | 0% | 0.0 | -0.8 | 1.4% | 5.0% | 98.6% | 92.2% | 91.4% | 36.5 | 500/500 |
| 56 | 0 | 100% | 10% | 0.0 | -0.2 | 2.2% | 6.6% | 97.8% | 92.4% | 90.6% | 32.5 | 500/500 |
| 56 | 0 | 100% | 20% | 0.0 | -0.9 | 0.8% | 4.6% | 99.2% | 93.8% | 92.0% | 37.6 | 500/498 |
| 56 | 15 | 80% | 0% | 12.0 | 11.6 | 2.0% | 9.8% | 98.0% | 93.0% | 90.8% | 38.7 | 500/500 |
| 56 | 15 | 80% | 10% | 10.5 | 9.2 | 1.4% | 6.8% | 98.6% | 92.6% | 86.6% | 37.5 | 500/480 |
| 56 | 15 | 80% | 20% | 9.0 | 9.8 | 0.0% | 8.0% | 100.0% | 93.8% | 72.4% | — | 500/391 |
| 56 | 15 | 90% | 0% | 13.5 | 13.5 | 6.0% | 11.2% | 94.0% | 95.0% | 92.6% | 38.5 | 500/500 |
| 56 | 15 | 90% | 10% | 12.0 | 12.0 | 4.6% | 9.4% | 95.4% | 92.6% | 91.4% | 41.2 | 500/499 |
| 56 | 15 | 90% | 20% | 10.5 | 10.6 | 1.4% | 8.4% | 98.6% | 93.4% | 88.4% | 30.1 | 500/479 |
| 56 | 15 | 100% | 0% | 15.0 | 14.8 | 10.8% | 13.2% | 89.2% | 94.6% | 93.2% | 38.3 | 500/500 |
| 56 | 15 | 100% | 10% | 13.5 | 13.7 | 10.4% | 15.6% | 89.6% | 92.0% | 89.0% | 39.0 | 500/500 |
| 56 | 15 | 100% | 20% | 12.0 | 12.3 | 1.4% | 8.6% | 98.6% | 93.6% | 91.6% | 37.4 | 500/500 |
| 56 | 30 | 80% | 0% | 24.0 | 23.5 | 8.8% | 29.2% | 91.2% | 90.8% | 90.4% | 42.7 | 500/500 |
| 56 | 30 | 80% | 10% | 21.0 | 20.4 | 5.4% | 22.6% | 94.6% | 89.8% | 85.6% | 41.1 | 500/480 |
| 56 | 30 | 80% | 20% | 18.0 | 19.1 | 2.0% | 21.4% | 98.0% | 92.2% | 72.0% | 41.8 | 500/392 |
| 56 | 30 | 90% | 0% | 27.0 | 27.2 | 23.2% | 32.4% | 76.8% | 94.0% | 93.0% | 44.7 | 500/500 |
| 56 | 30 | 90% | 10% | 24.0 | 23.9 | 17.0% | 28.4% | 83.0% | 92.6% | 92.8% | 42.8 | 500/500 |
| 56 | 30 | 90% | 20% | 21.0 | 21.5 | 6.4% | 22.4% | 93.6% | 94.4% | 90.2% | 40.1 | 500/486 |
| 56 | 30 | 100% | 0% | 30.0 | 30.2 | 40.6% | 44.4% | 59.4% | 93.4% | 92.2% | 44.1 | 500/500 |
| 56 | 30 | 100% | 10% | 27.0 | 27.4 | 26.0% | 37.8% | 74.0% | 92.2% | 90.6% | 43.4 | 500/500 |
| 56 | 30 | 100% | 20% | 24.0 | 25.3 | 8.0% | 30.4% | 92.0% | 93.6% | 92.4% | 43.1 | 500/500 |
| 56 | 45 | 80% | 0% | 36.0 | 34.5 | 11.4% | 51.4% | 88.6% | 93.4% | 93.2% | 49.0 | 500/500 |
| 56 | 45 | 80% | 10% | 31.5 | 31.6 | 11.0% | 44.2% | 89.0% | 91.4% | 85.6% | 48.4 | 500/485 |
| 56 | 45 | 80% | 20% | 27.0 | 26.0 | 3.4% | 28.8% | 96.6% | 92.6% | 73.8% | 44.8 | 500/402 |
| 56 | 45 | 90% | 0% | 40.5 | 41.0 | 53.4% | 69.8% | 46.6% | 92.6% | 92.2% | 49.9 | 500/500 |
| 56 | 45 | 90% | 10% | 36.0 | 35.5 | 31.8% | 53.2% | 68.2% | 89.6% | 87.2% | 48.7 | 500/499 |
| 56 | 45 | 90% | 20% | 31.5 | 32.3 | 13.6% | 41.8% | 86.4% | 95.0% | 89.0% | 46.0 | 500/482 |
| 56 | 45 | 100% | 0% | 45.0 | 44.7 | 70.4% | 77.4% | 29.6% | 95.6% | 93.8% | 50.9 | 500/500 |
| 56 | 45 | 100% | 10% | 40.5 | 40.1 | 46.2% | 62.6% | 53.8% | 93.0% | 91.0% | 50.4 | 500/500 |
| 56 | 45 | 100% | 20% | 36.0 | 35.9 | 16.0% | 56.0% | 84.0% | 92.6% | 91.2% | 49.0 | 500/500 |

## 4. Held-out one-factor-at-a-time sensitivity

Base: 28 days, effect 30, adherence .9, contamination .1. Only the named factor changes, using paired data seeds. Rho .4 and SD45 are represented by the base case. Assignment length sensitivity is distinct from interval block length.

| Case | Assigned target | Mean estimate | SUPPORTED | p≤.05 | INCONCLUSIVE | ITT coverage | CACE coverage | CACE available |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Base: rho .4, SD 45 | 24.0 | 23.7 | 5.6% | 12.0% | 94.4% | 91.6% | 81.2% | 466/500 |
| Weekend +30 minutes | 24.0 | 23.7 | 5.6% | 11.2% | 94.4% | 90.8% | 82.2% | 466/500 |
| Trend +10 minutes | 24.0 | 23.8 | 5.4% | 11.4% | 94.6% | 91.6% | 81.0% | 466/500 |
| Trend -10 minutes | 24.0 | 23.5 | 5.8% | 12.2% | 94.2% | 92.2% | 82.2% | 466/500 |
| Carryover 25% | 27.6 | 27.3 | 6.0% | 14.0% | 93.8% | 91.6% | 79.8% | 466/500 |
| AR(1) rho .2 | 24.0 | 23.6 | 5.6% | 13.0% | 94.4% | 92.6% | 81.6% | 466/500 |
| AR(1) rho .6 | 24.0 | 23.8 | 4.2% | 10.6% | 95.8% | 92.4% | 82.0% | 466/500 |
| Noise SD 35 | 24.0 | 23.7 | 7.0% | 17.0% | 92.8% | 92.4% | 81.2% | 466/500 |
| Noise SD 60 | 24.0 | 23.6 | 3.6% | 8.2% | 96.4% | 91.8% | 81.0% | 466/500 |
| Assignment blocks 2 days | 24.0 | 24.7 | 6.6% | 16.6% | 93.4% | 94.0% | 85.2% | 471/500 |

Carryover CACE coverage is deliberately reported against the direct effect despite invalid IV assumptions; it is a stress test, not valid causal coverage. Consecutive same-condition blocks can make carryover increase rather than attenuate assignment contrast.

## 5. Held-out interval block-length sensitivity (not used to reselect)

| Moving length | Assigned target | Mean estimate | SUPPORTED | p≤.05 | INCONCLUSIVE | ITT coverage | CACE coverage | CACE available |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2 nights | 24.0 | 24.5 | 5.8% | 13.4% | 94.2% | 93.2% | 81.0% | 466/500 |
| 3 nights | 24.0 | 24.5 | 6.0% | 13.4% | 94.0% | 93.2% | 81.0% | 466/500 |
| 5 nights | 24.0 | 24.5 | 5.8% | 13.4% | 94.2% | 92.8% | 81.0% | 466/500 |

CACE uses assignment blocks, so its interval is independent of the primary moving-block length.

## 6. Approximate duration for 70% verdict detection

Only interpolate where the measured 28/42/56-day grid actually brackets 70%. Otherwise report a bound, not an invented extrapolation; no additional experiment or threshold tuning is applied. Probabilities include the adherence and data gates, not just p-value power. Effect 0 should never target 70% detection.

| Direct effect | Adherence / contamination | Detection at 28 / 42 / 56 days | Approximate days for 70% |
|---:|---|---|---|
| 15 | 90% / 0% | 2.8% / 5.8% / 6.0% | >56; not established beyond tested durations |
| 30 | 90% / 0% | 9.0% / 16.4% / 23.2% | >56; not established beyond tested durations |
| 45 | 90% / 0% | 16.0% / 38.4% / 53.4% | >56; not established beyond tested durations |
| 15 | 90% / 10% | 1.8% / 4.8% / 4.6% | >56; not established beyond tested durations |
| 30 | 90% / 10% | 6.2% / 10.2% / 17.0% | >56; not established beyond tested durations |
| 45 | 90% / 10% | 9.4% / 23.8% / 31.8% | >56; not established beyond tested durations |
| 15 | 100% / 0% | 4.4% / 8.8% / 10.8% | >56; not established beyond tested durations |
| 30 | 100% / 0% | 12.2% / 24.6% / 40.6% | >56; not established beyond tested durations |
| 45 | 100% / 0% | 26.0% / 54.2% / 70.4% | ~56 (linear interpolation) |
| 15 | 100% / 10% | 3.4% / 5.0% / 10.4% | >56; not established beyond tested durations |
| 30 | 100% / 10% | 6.4% / 17.0% / 26.0% | >56; not established beyond tested durations |
| 45 | 100% / 10% | 16.6% / 34.4% / 46.2% | >56; not established beyond tested durations |

For 80% adherence or 20% contamination the population behavior fails a configured gate; no monotone route to 70% verdict detection should be assumed. A 15-minute direct effect with imperfect compliance also has assigned target <15, so even infinite precision would not meet the effect-size gate.

## 7. Open questions and proposed fixes — NOT applied

- If coverage is below nominal: compare predeclared residual-block or design-aware randomization-inverted intervals using NEW tuning/held-out seeds; do not silently inflate intervals based on this held-out table. Small-sample HAC/studentization is not guaranteed to solve undercoverage.
- Whole-block percentile CACE intervals can under-cover or be withheld near weak instruments. Consider joint studentization or weak-IV-robust confidence sets on a new protocol, with separate calibration of the secondary estimand.
- At 28d, exact weekend balance leaves only 42 allocations and a p-value floor .0476. Should the next protocol prefer 2-day assignment blocks or longer duration? Do not weaken stratification after viewing these results.
- The stricter adherence gates create a substantial ceiling on detection. Should the product distinguish design feasibility from evidence of benefit? Keep thresholds unchanged until a separately justified protocol exists.
- A direct 15-minute exposure effect is NOT a 15-minute assignment effect with contamination. Which estimand should define meaningful benefit? The primary and complier numbers must not be interchanged.
- Trend, weekend shifts and carryover challenge stationarity/exclusion assumptions. Consider explicit carryover-aware models or washout designs only as a future experiment-engine revision, validated on new seeds.
- Eligibility requires ≥50% late caffeine over ALL run-in days, unknowns counted separately. Is seven days adequate to measure a stable baseline? Missingness here is independent; informative missingness remains untested.
- Baseline caffeine eligibility is unit-tested, not simulated as an enrollment-selection mechanism. These synthetic runs do not establish real-world efficacy or personalized calibration.

## Reproduce and checkpoints

`npx --no-install tsx --test scripts/engine.test.ts scripts/engine-v2.test.ts`

`npx --no-install tsc --noEmit -p tsconfig.engine.json`

`npx --no-install tsx scripts/simulate-engine-v2.ts --phase full`

A fresh full run selects using tuning then runs held-out. If frozen artifacts already exist, it resumes only missing held-out cells and rebuilds the report; it does not retune. `--phase heldout` requires matching frozen tuning, and `--phase report` regenerates Markdown from checkpoints. For an independent repeat, copy the unchanged engine/script to a clean directory without v2 generated artifacts. Never delete held-out artifacts to retune the same seeds.

Measured tuning time: **74.3s**. Measured held-out cell time: **385.4s**. Total measured simulation time: **459.7s** (7.66 min); includes complete engine analysis, excludes tooling startup/report I/O. Within the requested ~15-minute simulation budget.
