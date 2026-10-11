# Caffeine engine simulation protocol v3.1

## Motivation and Scope

The v3 held-out evaluation demonstrated two key issues:
1. **Feasibility Approximation Errors**: The analytic normal AR(1) formula had mean absolute error of 6.3% and exceeded 10pp inaccuracy in 26/96 cells (up to 23.9% error), largely because it failed to account for weekend-constrained block assignments, empirical variance, and bootstrap noise.
2. **Winner's Curse / Heuristic Inflation Flag Flaw**: Computing `inflation_risk` from observed plug-in effect power led to systemic suppression of warnings on noisy, inflated estimates when the true design was underpowered.

Protocol v3.1 resolves these with:
1. **Precomputed Feasibility Lookup Table**: Generated via simulation across a structured grid of noise SD, lag-1 autocorrelation, duration, compliance, and true effect sizes. Multilinear interpolation yields:
   - Estimated detection probability at minimum meaningful effect (default 15 minutes).
   - Minimum detectable effect (MDE) at 70% power (or 'not reachable within the duration').
   - Plain-language feasibility statement.
   - Values outside table bounds return `'unknown'` rather than extrapolating.
2. **Planned-Power Inflation Risk & Reliability**:
   - `planned_power_at_minimum_effect` from lookup table.
   - `inflation_risk`: `'high'` (<30%), `'moderate'` (30%–60%), `'low'` (>60%), or `'unknown'`.
   - `estimate_reliability`: `'low'` (<30%), `'moderate'` (30%–60%), `'high'` (>60%), or `'unknown'`.
3. **Estimation-First Result & Ruled-Out Effect**:
   - `ruled_out`: largest effect (in minutes) that the 95% interval excludes in the beneficial direction (i.e. interval upper bound if interval is available, floored at 0, or descriptive). Specifically, if CI is $[L, U]$, effect sizes greater than $U$ are ruled out (excluded by the upper bound).
   - Plain-language result statement covering `SUPPORTED`, `NO_DETECTABLE_EFFECT`, and `INCONCLUSIVE`.
   - Strictly describes assigned-day difference without unwarranted causal leaps.
   - Refers only to 'plausible range' rather than formal probability/certainty claims.
   - Explicitly notes reduced adherence if label-only Policy B or compliance $<1.0$.
   - Includes planned power reliability warning when planned power is low.
4. **Frozen Engine Elements**:
   - 2-day weekday-balanced blocks.
   - Policy B (label-only).
   - Studentized circular moving-block bootstrap (length 5, draws 199/299).

## Seed Domains

All v3.1 seeds are strictly disjoint from v1, v2, and v3 (which started at 20,261,008, 10,000,000, 30,000,000, and 40,000,000).
- **Tuning Grid Domain**:
  - Base: `50,000,000`
  - Cell index $j = 0 \dots 719$:
    - Data seeds: `50,000,000 + 1,000 * j + r` ($r = 0 \dots 249$)
    - Schedule seeds: `51,000,000 + 1,000 * j + r`
    - Analysis seeds: `52,000,000 + 1,000 * j + r`
- **Held-Out Validation Domain**:
  - Base: `60,000,000`
  - Validation test points $k = 0 \dots 47$:
    - Data seeds: `60,000,000 + 1,000 * k + r` ($r = 0 \dots 249$)
    - Schedule seeds: `61,000,000 + 1,000 * k + r`
    - Analysis seeds: `62,000,000 + 1,000 * k + r`

## Grid Specifications

- **Nightly Noise SD**: 25, 35, 45, 60, 75 minutes (5 values)
- **Lag-1 Autocorrelation ($\rho$)**: 0.2, 0.4, 0.6 (3 values)
- **Duration**: 42, 56, 70, 84 days (4 values)
- **Adherence / Contamination**:
  - 1.0 / 0.0
  - 0.9 / 0.1 (2 pairs)
- **True Direct Effect**: 10, 15, 20, 30, 45, 60 minutes (6 values)
- **Total Cells in Grid**: $5 \times 3 \times 4 \times 2 \times 6 = 720$ cells.
- **Runs per Cell**: 250 runs (Monte Carlo margin of error $\le \pm 3.2\text{pp}$ at 50% power).
- **Design**: 2-day randomized blocks with weekend balance.

## Held-Out Validation Points & Acceptance Criteria

### Off-Grid Test Points
Off-grid evaluation on held-out seeds tests combinations not present on the grid:
- SD: 40, 52, 68
- Autocorrelation $\rho$: 0.3, 0.5
- Duration: 42, 56, 70, 84
- Adherence: 0.9/0.1 and 1.0/0.0
- Effects: 12, 25, 40

### Predeclared Acceptance Criteria
1. **Feasibility Lookup Validation**:
   - Mean absolute error (MAE) across off-grid test points: $\le 5.0$ percentage points.
   - Worst-case absolute error: $\le 10.0$ percentage points.
   - Systematic bias (mean predicted minus observed): $\le 3.0$ percentage points.
   If any criterion fails, it must be reported plainly without modifying or refitting the table post-hoc.
2. **Inflation Flag Validation**:
   - Report the ratio of mean SUPPORTED estimate to true assigned effect across planned-power bands (<30%, 30%–60%, >60%).
   - Report share of runs with $>1.5\times$ inflation flagged as high or moderate risk.
