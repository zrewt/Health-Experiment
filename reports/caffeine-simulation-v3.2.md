# Caffeine Engine Simulation Report v3.2

**Narrow Revision**:
- **Part A (Conformance Fix)**:
  1. `assessFeasibility` returns `'unknown'` for planned power, inflation risk, and estimate reliability when any baseline input is missing or outside the lookup grid range, eliminating the uncalibrated analytic power fallback.
  2. `formatResultStatement` in `verdict.ts` updated with directional ruled-out wording `"(effects larger than U units are ruled out)"` for `NO_DETECTABLE_EFFECT` and `INCONCLUSIVE`, distinct low-power notes for `SUPPORTED` vs null/inconclusive, and unknown-power statements without certainty claims. `ruled_out` comment added in `verdict.ts`.
  3. New test suite `scripts/engine-v3-2.test.ts` added; all 36 tests pass across v1, v2, v3, v3.1, and v3.2.
- **Part B (Analysis-Only MDE Map)**: Comprehensive evaluation of Minimum Detectable Effect at 70% power across all 120 designs using the precomputed lookup table.
- **Byte-for-byte preservation**: [v1](reports/caffeine-simulation.md), [v2](reports/caffeine-simulation-v2.md), [v3](reports/caffeine-simulation-v3.md), [v3.1](reports/caffeine-simulation-v3.1.md), and [v3.1 Addendum](reports/caffeine-simulation-v3.1-addendum.md) remain completely unchanged. Zero new simulations run. Zero new dependencies installed.

---

## Part A: Conformance Fix

### A1. Elimination of Analytic Fallback in Feasibility Assessment
In v3.1, when baseline inputs (SD, autocorrelation, duration, adherence) fell outside the lookup table bounds $[25, 75]$ SD, $[0.2, 0.6]$ $\rho$, $[42, 84]$ days, and $[0.9, 1.0]$ adherence, `assessFeasibility` fell back to an analytic Gaussian AR(1) calculation. As proven in the v3.1 addendum, because $critical = \max(15, 1.96 \cdot se) = 15$ when SE is small, at 15m minimum effect $(minimum - critical) / se = 0$, yielding $\Phi(0) = 0.50$ (50.0% power) and returning `'moderate'` risk even for SD 10 or duration 20.

**Changes Applied**:
- In `assessFeasibility` (`src/engine/feasibility.ts`):
  - When `assumedAdherence` is undefined, null, or outside $[0.9, 1.0]$, or when `lookupFeasibility` returns `status: 'unknown'` (e.g. SD $<25$ or $>75$, duration $<42$ or $>84$, missing $\rho$ or SD):
    - `plannedPowerAtMinimumEffect = null`
    - `inflation_risk = 'unknown'`
    - `estimate_reliability = 'unknown'`
    - `statement` preserves the lookup/validation explanation.
  - The analytic Gaussian SE calculation (`critical + 0.5244 * se`) is preserved solely for `minimumDetectableEffect70` and backward compatibility with earlier tests that pass `observedEffect`.
  - When `observedEffect` is provided (backward compatibility path for v3 analytic tests), the analytic branch remains available.

**Usages of Analytic Approximation Found Across Codebase**:
1. `src/engine/feasibility.ts` (lines 200–225): Analytic standard error and Gaussian power when `observedEffect` is supplied. (Preserved for backward-compatibility with v3 tests).
2. `scripts/engine-v3.test.ts` (lines 72–90): Tests checking analytic properties (monotonicity, translation invariance, null-safety) using `observedEffect: 30` and `observedEffect: 5/100`. (Fully passing, unaffected).
3. `scripts/simulate-engine-v3.ts` (line 99): Legacy v3 simulation harness passing `observedEffect: target`. (Unaffected).

### A2. Statement Wording and Ruled-Out Semantics
- In `src/engine/verdict.ts`:
  - `ruled_out`: Preserved as the numeric upper bound $U$ of the 95% interval (`result.primary.interval95[1]`). Added code comment: `"ruled_out: upper bound U of the 95% interval; effects larger than U minutes are ruled out"`.
  - In `formatResultStatement`:
    - For `NO_DETECTABLE_EFFECT` and `INCONCLUSIVE` when the interval $[L, U]$ is non-null: appends `"(effects larger than U units are ruled out)"` inside the range sentence.
    - For `SUPPORTED`: interval statement remains `"plausible range of L to U units"` without the ruled-out clause.
    - When interval is null: statement states `"unestimated plausible range"` without the ruled-out clause.
    - **Planned Power Low** (<30% power):
      - `SUPPORTED`: `" Note: planned design power for this protocol was low, so this estimate is likely to be exaggerated."`
      - `NO_DETECTABLE_EFFECT` and `INCONCLUSIVE`: `" Note: planned design power for this protocol was low, so a real effect could have gone undetected."`
      - The term `"exaggerated"` is strictly prohibited from appearing in `NO_DETECTABLE_EFFECT` and `INCONCLUSIVE` statements.
    - **Planned Power Unknown**:
      - For all three verdicts: `" Planned design power could not be assessed for this protocol."`
    - **Planned Power Moderate or High**:
      - No power note is appended.
    - Reduced-adherence suffix and non-causal language preserved byte-for-byte.

### A3. Before and After Test Counts

| Test File | Before (v3.1 Addendum) | After (v3.2) | Status |
|---|:---:|:---:|:---:|
| `scripts/engine.test.ts` | 15 tests | 15 tests | Pass |
| `scripts/engine-v2.test.ts` | 8 tests | 8 tests | Pass |
| `scripts/engine-v3.test.ts` | 6 tests | 6 tests | Pass |
| `scripts/engine-v3-1.test.ts` | 4 tests | 4 tests | Pass |
| `scripts/engine-v3-2.test.ts` (new) | 0 tests | 3 tests | Pass |
| **Total Test Count** | **33 tests** | **36 tests** | **All Pass** |

---

## Part B: MDE Map (Analysis Only)

> **UNVALIDATED output: MDE has not been checked against simulation.**

### B1. Evaluation Across All 120 Designs
Across the 120 grid designs (5 SD $\times$ 3 $\rho$ $\times$ 4 Durations $\times$ 2 Adherences):
- **Reachable MDE ($\le 60$ minutes)**: **83 designs (69.2%)**
- **Not Reachable within Duration ($> 60$ minutes)**: **37 designs (30.8%)**
- **Designs with MDE $\le 30$ minutes**: **25 designs (20.8%)**

### B2. Distinguishing "Not Reachable" from "Beyond Table Range"
In `lookupFeasibility` (`src/engine/feasibility.ts`):
1. **Out of Range (`status: 'unknown'`)**: If any design parameter is outside table bounds (e.g., SD $<25$ or $>75$, duration $<42$ or $>84$), the lookup cannot interpolate and returns `status: 'unknown'`, `detectionProbabilityAtMinimumEffect: null`, and `minimumDetectableEffect70: null`.
2. **Not Reachable (`status: 'ok'`)**: When parameters are within the valid table grid, `lookupFeasibility` evaluates `lookupDetection(sd, rho, duration, adherence, eff)` across integer effects from $10$ to $60$ minutes. If detection probability never reaches $0.70$ (70% power) for any tested effect up to $60$ minutes, the function sets `minimumDetectableEffect70 = 'not reachable within the duration'`.

For all 37 unreachable designs, the power achieved at the maximum effect on the table (60 minutes) ranges from **46.5% to 69.5%** (never reaching the required 70% threshold).

### B3. MDE Distribution by Duration and SD
The table below aggregates across all 6 combinations of $\rho \in \{0.2, 0.4, 0.6\}$ and adherence $\in \{1.0, 0.9\}$ per cell:

| Duration (days) | SD (min) | Total Designs | Reachable | Not Reachable | Share Not Reachable | Median MDE (Reachable) | Min MDE | Max MDE | Max Power at 60m (Unreachable) |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 42 | 25 | 6 | 6 | 0 | 0.0% | 33.5m | 27.0m | 42.0m | N/A |
| 42 | 35 | 6 | 6 | 0 | 0.0% | 46.0m | 38.0m | 57.0m | N/A |
| 42 | 45 | 6 | 4 | 2 | 33.3% | 51.0m | 48.0m | 60.0m | 67.5% |
| 42 | 60 | 6 | 0 | 6 | 100.0% | N/A | N/A | N/A | 63.5% |
| 42 | 75 | 6 | 0 | 6 | 100.0% | N/A | N/A | N/A | 46.5% |
| 56 | 25 | 6 | 6 | 0 | 0.0% | 28.0m | 24.0m | 34.0m | N/A |
| 56 | 35 | 6 | 6 | 0 | 0.0% | 38.5m | 33.0m | 46.0m | N/A |
| 56 | 45 | 6 | 5 | 1 | 16.7% | 44.0m | 41.0m | 58.0m | 68.0% |
| 56 | 60 | 6 | 3 | 3 | 50.0% | 55.0m | 54.0m | 60.0m | 63.0% |
| 56 | 75 | 6 | 0 | 6 | 100.0% | N/A | N/A | N/A | 62.5% |
| 70 | 25 | 6 | 6 | 0 | 0.0% | 25.0m | 20.0m | 30.0m | N/A |
| 70 | 35 | 6 | 6 | 0 | 0.0% | 36.5m | 27.0m | 42.0m | N/A |
| 70 | 45 | 6 | 6 | 0 | 0.0% | 41.0m | 36.0m | 52.0m | N/A |
| 70 | 60 | 6 | 3 | 3 | 50.0% | 49.0m | 45.0m | 52.0m | 68.0% |
| 70 | 75 | 6 | 1 | 5 | 83.3% | 58.0m | 58.0m | 58.0m | 68.5% |
| 84 | 25 | 6 | 6 | 0 | 0.0% | 22.5m | 19.0m | 27.0m | N/A |
| 84 | 35 | 6 | 6 | 0 | 0.0% | 30.0m | 24.0m | 38.0m | N/A |
| 84 | 45 | 6 | 6 | 0 | 0.0% | 38.5m | 30.0m | 48.0m | N/A |
| 84 | 60 | 6 | 5 | 1 | 16.7% | 48.0m | 42.0m | 57.0m | 69.5% |
| 84 | 75 | 6 | 2 | 4 | 66.7% | 56.5m | 54.0m | 59.0m | 68.0% |

#### Subset: Realistic Noise Regimes (SD 35 to 60 Minutes, 72 Designs)
- **Reachable MDE**: **56 / 72 designs (77.8%)**
- **Not Reachable within Duration**: **16 / 72 designs (22.2%)**
- **MDE $\le 30$ minutes**: **6 / 72 designs (8.3%)**
  (Only reachable with SD 35 at 84 days, or SD 35 at 70 days with high adherence/low $\rho$).

---

## Known Limitations at Freeze

1. **MDE Output Unvalidated**: The minimum detectable effect at 70% power (`minimumDetectableEffect70`) is generated by finding the first effect reaching 70% power in the interpolated table, but has never been checked against independent simulations.
2. **Off-Grid Duration and Adherence Interpolation Unvalidated**: Validation was conducted on off-grid SD ($40, 52, 68$) and $\rho$ ($0.3, 0.5$). Durations ($42, 56, 70, 84$) and adherences ($1.0, 0.9$) tested in held-out validation were strictly on-grid.
3. **Estimated vs. True Run-In Parameters**: The lookup assumes true population noise SD and lag-1 autocorrelation $\rho$. In live use, these parameters are estimated from a short (e.g. 7-day) run-in with substantial estimation variance.
4. **Monte Carlo Cell Noise vs. Interpolation Error**: With 200 runs per cell, the Monte Carlo 95% margin of error is approximately $\pm 6.9\text{pp}$ near 50% power. This limits the ability to resolve fine interpolation errors below that margin.
5. **Unreachable High-Power Band (>60%) at 15 Minutes**: On the entire grid, planned power at 15m never exceeds 49.0%. The `>60%` planned power band is unpopulated.
6. **Winner's Curse Conditioning Residual**: While the planned-power warning correctly classifies trials in underpowered protocols as low reliability, point estimates passing the verdict remain inflated by 1.72× on average in those protocols.

---

## Launch Gates (Pre-Launch Protocol Requirements)

Before launching the caffeine experiment to production users, the following validation must be completed under a newly declared protocol:
1. **New Seed Domain**: Generate a fresh held-out validation stream on seeds `70,000,000+` with the protocol committed prior to running simulations.
2. **Adequate Sample Size**: Run at least **1,000 simulations per test point** to narrow the Monte Carlo margin from $\pm 6.9\text{pp}$ down to $\le \pm 3.1\text{pp}$ at 50% power.
3. **Off-Grid Duration & Adherence**: Test points with off-grid durations (e.g. 49, 63, 77 days) and off-grid adherence levels (e.g. 0.95 adherence / 0.05 contamination).
4. **Direct MDE Simulation**: Directly simulate points at the predicted MDE to verify empirical detection probability is within $[67\%, 73\%]$.
5. **Run-In Estimation Sensitivity**: Simulate a 7-day run-in phase for each virtual subject, estimate sample SD and sample autocorrelation $\hat{\rho}$, pass those noisy estimates to the lookup, and assess classification stability.

---

## v3.2 Follow-up

### 1. Complete Elimination of Analytic MDE Fallback in `assessFeasibility`
In this follow-up pass, the remaining analytic fallback calculations for `minimumDetectableEffect70` on the v3.1+ path were completely replaced:
- When lookup status is `unknown` (e.g. out-of-range SD $<25$ or $>75$, duration $<42$ or $>84$, missing SD, or missing autocorrelation/adherence), `minimumDetectableEffect70 = null`, and the statement states:
  `"Planned design power and minimum detectable effect could not be assessed for this protocol (unknown)."`
  No numeric MDE is returned or printed.
- When lookup status is `ok` but 70% power is not reached by 60 minutes, `minimumDetectableEffect70` is set to `'not reachable within the duration'`, and the statement text uses the lookup statement:
  `"Over <duration> days, 70% detection would need an effect larger than 60 minutes, the largest effect tested. Detection probability at the minimum meaningful effect (<minEff>m) is <detAtMin>%."`
- The Gaussian analytic approximation is preserved exclusively on the legacy `observedEffect` branch for older v3 tests with the code comment:
  `"// LEGACY: plug-in observed power; not for display; does not feed inflation_risk or reliability"`.

### 2. MDE Axis Semantics: Direct vs. Assigned-Day Effect
An empirical evaluation was conducted for the design $(\text{SD} = 35, \rho = 0.4, \text{Duration} = 84)$:
- At **Adherence 1.0 / Contamination 0.0**: $\text{MDE} = 27\text{ minutes}$.
- At **Adherence 0.9 / Contamination 0.1**: $\text{MDE} = 35\text{ minutes}$.
- **Ratio (0.9 / 1.0)**: $35 / 27 = 1.296 \approx 1.25 = 1 / (1.0 - 0.2) = 1 / 0.8$.
- **Semantics Established**:
  - The lookup table's `effect` grid dimension simulates the **true DIRECT effect** (biological impact under full compliance).
  - The assigned-day effect equals $\text{direct effect} \times (\text{adherence} - \text{contamination}) = \text{effect} \times 0.8$.
  - Therefore, the MDE produced by the table is on the **DIRECT effect axis**.
  - *Correction of previous verification statement*: The prior v3.2 verification report informally described MDE as the "assigned-day effect"; that was technically inaccurate. The MDE returned by `lookupFeasibility` represents the **direct treatment effect** required to achieve 70% detection power under the specified adherence and contamination levels. Documentation and statements have been updated to accurately reflect "direct effect".

### 3. Added Limitation at Freeze
7. **Adherence and Contamination Grid Coupling**: The precomputed simulation grid couples adherence and contamination strictly into two discrete pairs: $(1.0 / 0.0)$ and $(0.9 / 0.1)$. Consequently, the lookup assumes $\text{contamination} = 1 - \text{adherence}$. Arbitrary, uncoupled combinations (e.g. 0.95 adherence with 0.0 contamination) are not directly represented in the grid without interpolation assumptions.

