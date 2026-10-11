# Caffeine Engine Simulation v3.1: Analysis-Only Addendum

This document is an analysis-only addendum to [caffeine-simulation-v3.1.md](reports/caffeine-simulation-v3.1.md). It re-evaluates the checkpointed simulation datasets ([tuning grid](reports/caffeine-simulation-v3.1-tuning.json), [held-out validation](reports/caffeine-simulation-v3.1-heldout.json), and [precomputed lookup table](src/engine/feasibility-table-data.ts)) under strict, unconditioned criteria.

**Hard Rule Compliance**:
- **No new simulations** were run. All calculations use saved tuning checkpoint seeds (`50,000,000+`) and held-out validation seeds (`60,000,000+`).
- **No tuning or code changes** were applied to the engine, lookup table, interpolation code, or test suites.
- Historical reports and artifacts ([v1](reports/caffeine-simulation.md), [v2](reports/caffeine-simulation-v2.md), [v3](reports/caffeine-simulation-v3.md), and [v3.1](reports/caffeine-simulation-v3.1.md)) remain byte-for-byte unchanged.
- Quantities not computable from saved data are explicitly reported as "not computable from saved data".

---

## 1. Band Map: Planned Power Distribution at 15-Minute Minimum Meaningful Effect

Across the precomputed feasibility lookup grid, a "design" is defined by four protocol dimensions: Nightly Noise SD, Lag-1 Autocorrelation $\rho$, Duration, and Adherence/Contamination pair.
- SD grid: $\{25, 35, 45, 60, 75\}$ (5 values)
- $\rho$ grid: $\{0.2, 0.4, 0.6\}$ (3 values)
- Duration grid: $\{42, 56, 70, 84\}$ (4 values)
- Adherence grid: $\{1.0/0.0, 0.9/0.1\}$ (2 pairs)
- Total parameter combinations (designs): $5 \times 3 \times 4 \times 2 = 120$ designs.

Each design's planned power is evaluated via `lookupDetection(sd, rho, duration, adherence, 15)`:
- **High Risk (<30% power)**: **109 designs (90.8%)**
- **Moderate Risk (30%–60% power)**: **11 designs (9.2%)**
- **Low Risk (>60% power)**: **0 designs (0.0%)**

### Distribution of Designs by Duration and SD
The table below aggregates across all 6 combinations of $\rho \in \{0.2, 0.4, 0.6\}$ and adherence $\in \{1.0, 0.9\}$ per cell:

| Duration (days) | SD (min) | Designs Evaluated | Mean Planned Power | <30% Band (High Risk) | 30%–60% Band (Moderate Risk) | >60% Band (Low Risk) | Power Min – Max |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 42 | 25 | 6 | 23.0% | 6 | 0 | 0 | 16.0% – 28.0% |
| 42 | 35 | 6 | 9.9% | 6 | 0 | 0 | 7.5% – 13.5% |
| 42 | 45 | 6 | 8.2% | 6 | 0 | 0 | 5.5% – 12.0% |
| 42 | 60 | 6 | 6.3% | 6 | 0 | 0 | 4.5% – 10.0% |
| 42 | 75 | 6 | 6.0% | 6 | 0 | 0 | 4.5% – 8.0% |
| 56 | 25 | 6 | 26.2% | 4 | 2 | 0 | 17.0% – 35.0% |
| 56 | 35 | 6 | 17.4% | 6 | 0 | 0 | 13.5% – 22.0% |
| 56 | 45 | 6 | 11.9% | 6 | 0 | 0 | 9.5% – 20.0% |
| 56 | 60 | 6 | 8.4% | 6 | 0 | 0 | 4.5% – 12.5% |
| 56 | 75 | 6 | 6.8% | 6 | 0 | 0 | 4.5% – 10.0% |
| 70 | 25 | 6 | 32.4% | 2 | 4 | 0 | 21.0% – 41.0% |
| 70 | 35 | 6 | 20.0% | 6 | 0 | 0 | 11.5% – 28.0% |
| 70 | 45 | 6 | 11.8% | 6 | 0 | 0 | 6.5% – 18.5% |
| 70 | 60 | 6 | 8.7% | 6 | 0 | 0 | 4.5% – 11.0% |
| 70 | 75 | 6 | 5.5% | 6 | 0 | 0 | 3.5% – 9.0% |
| 84 | 25 | 6 | 37.6% | 2 | 4 | 0 | 27.0% – 49.0% |
| 84 | 35 | 6 | 25.1% | 5 | 1 | 0 | 15.5% – 33.5% |
| 84 | 45 | 6 | 16.1% | 6 | 0 | 0 | 12.0% – 20.5% |
| 84 | 60 | 6 | 10.4% | 6 | 0 | 0 | 6.0% – 14.0% |
| 84 | 75 | 6 | 7.8% | 6 | 0 | 0 | 5.0% – 9.5% |

### Designs Reaching >60% Planned Power
**Zero designs (0 out of 120)** reach $>60\%$ planned power at the 15-minute minimum meaningful effect. The highest planned power on the entire grid is **49.0%** (at SD 25 min, duration 84 days, $\rho = 0.2$, full adherence 1.0).

The 11 designs reaching the 30%–60% (Moderate Risk) band are:
1. SD 25, 56d, $\rho = 0.2$, adherence 1.0 $\rightarrow$ 34.5%
2. SD 25, 56d, $\rho = 0.4$, adherence 1.0 $\rightarrow$ 35.0%
3. SD 25, 70d, $\rho = 0.2$, adherence 1.0 $\rightarrow$ 37.5%
4. SD 25, 70d, $\rho = 0.4$, adherence 1.0 $\rightarrow$ 41.0%
5. SD 25, 70d, $\rho = 0.4$, adherence 0.9 $\rightarrow$ 33.5%
6. SD 25, 70d, $\rho = 0.6$, adherence 1.0 $\rightarrow$ 37.5%
7. SD 25, 84d, $\rho = 0.2$, adherence 1.0 $\rightarrow$ 49.0%
8. SD 25, 84d, $\rho = 0.2$, adherence 0.9 $\rightarrow$ 32.0%
9. SD 25, 84d, $\rho = 0.4$, adherence 1.0 $\rightarrow$ 48.5%
10. SD 25, 84d, $\rho = 0.6$, adherence 1.0 $\rightarrow$ 40.0%
11. SD 35, 84d, $\rho = 0.2$, adherence 1.0 $\rightarrow$ 33.5%

### Explicit SD Range and Behavior Below 25 Minutes
- The table's valid SD range is strictly $[25, 75]$ minutes.
- `lookupFeasibility` explicitly returns `status: 'unknown'` and `detectionProbabilityAtMinimumEffect: null` for any SD $< 25$ minutes.
- In `assessFeasibility`, an out-of-bounds input falls back to the analytic Gaussian AR(1) formula. However, because $ critical = \max(15, 1.96 \cdot se) = 15$ when SE is small, at 15m minimum effect $(minimum - critical) / se = 0$, yielding $\Phi(0) = 0.50$ (50.0% power).
- Consequently, an SD $< 25$ minutes in `assessFeasibility` receives a `'moderate'` rating (power 50.0%), and **never receives a 'low' rating**. A user with run-in SD below 25 minutes cannot achieve a "low risk" rating under either implementation.

---

## 2. Inflation Re-Analysis

**Definitions**:
- A run is **SUPPORTED** if it meets the verdict criteria under Policy B (label-only).
- An **inflated run** is a SUPPORTED run whose reported point estimate exceeds $1.5\times$ the true assigned-day effect ($\text{true assigned} = \text{effect} \times (\text{adherence} - \text{contamination})$).
- The **denominator** for the inflated share is the total number of SUPPORTED runs in that stratum.
- The **flag rate** is the share of all SUPPORTED runs that are flagged high or moderate risk.
- The **false-alarm rate** is the share of non-inflated SUPPORTED runs that are flagged high or moderate risk.

### a. Held-Out Points (12 Test Points, 200 runs each, 2,400 total runs)
All 12 held-out points have planned power at the 15-minute effect of $<30\%$ (ranging from 5.0% to 18.0%). Thus, **all 12 points sit entirely in the `<30%` (High Risk) band**.

| Point Index | Parameters (SD, $\rho$, Dur, Adh, Eff) | True Assigned | Planned Power Band | Supported Runs | Inflated Runs | Inflated Share (%) | Mean Reported (min) | Ratio of Means | Mean of Ratios |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 0 | 40 SD, 0.3 $\rho$, 42d, 1.0/0.0, 25m | 25m | <30% | 53 | 27 | 50.9% | 38.29 | 1.532 | 1.532 |
| 1 | 40 SD, 0.3 $\rho$, 56d, 0.9/0.1, 15m | 12m | <30% | 23 | 23 | 100.0% | 33.00 | 2.750 | 2.750 |
| 2 | 40 SD, 0.5 $\rho$, 70d, 1.0/0.0, 12m | 12m | <30% | 28 | 28 | 100.0% | 31.21 | 2.601 | 2.601 |
| 3 | 40 SD, 0.5 $\rho$, 84d, 0.9/0.1, 40m | 32m | <30% | 133 | 13 | 9.8% | 36.48 | 1.140 | 1.140 |
| 4 | 52 SD, 0.3 $\rho$, 42d, 0.9/0.1, 40m | 32m | <30% | 54 | 33 | 61.1% | 52.35 | 1.636 | 1.636 |
| 5 | 52 SD, 0.3 $\rho$, 56d, 1.0/0.0, 25m | 25m | <30% | 42 | 31 | 73.8% | 42.59 | 1.704 | 1.704 |
| 6 | 52 SD, 0.5 $\rho$, 70d, 0.9/0.1, 15m | 12m | <30% | 22 | 22 | 100.0% | 38.73 | 3.228 | 3.228 |
| 7 | 52 SD, 0.5 $\rho$, 84d, 1.0/0.0, 12m | 12m | <30% | 17 | 17 | 100.0% | 35.50 | 2.958 | 2.958 |
| 8 | 68 SD, 0.3 $\rho$, 42d, 1.0/0.0, 12m | 12m | <30% | 10 | 10 | 100.0% | 55.85 | 4.654 | 4.654 |
| 9 | 68 SD, 0.3 $\rho$, 56d, 0.9/0.1, 40m | 32m | <30% | 50 | 41 | 82.0% | 61.15 | 1.911 | 1.911 |
| 10 | 68 SD, 0.5 $\rho$, 70d, 1.0/0.0, 25m | 25m | <30% | 36 | 36 | 100.0% | 55.69 | 2.228 | 2.228 |
| 11 | 68 SD, 0.5 $\rho$, 84d, 0.9/0.1, 15m | 12m | <30% | 20 | 20 | 100.0% | 48.50 | 4.042 | 4.042 |

**Overall Held-Out Summary**:
- Total SUPPORTED runs across 12 points: **488**
- Total Inflated runs ($>1.5\times$ true assigned): **301** (61.7% of supported runs)
- Total Flagged runs: **488** (100.0% of supported runs)
- **Flag rate**: **488 / 488 = 100.0%**
- **False-alarm rate**: Among the 187 non-inflated SUPPORTED runs, all 187 were flagged high risk: **187 / 187 = 100.0%**.
- **Overall Ratio of Means**: $(\sum \hat{\beta}) / (\sum \beta^*) = 21,179.96 / 12,298.00 =$ **1.722**
- **Overall Mean of Ratios**: $\frac{1}{488}\sum (\hat{\beta} / \beta^*) =$ **1.953**

**Critical Interpretation of the "301 / 301 (100%)" Result**:
Because the planned-power warning is derived entirely from baseline/design parameters (SD, $\rho$, duration, adherence) and evaluated at the fixed 15m effect, the flag is a **design-level constant** for any given trial protocol. It does **not** inspect the observed point estimate or test statistic of individual runs. 

Because every one of the 12 held-out points had planned power $<30\%$, **every single run in all 12 points was flagged high risk by construction**. Consequently, the fact that 301 of 301 inflated runs were flagged is an arithmetic artifact of a 100% flag rate ($488/488$). The detector has a 100% sensitivity only because it simultaneously has a **100% false-alarm rate** on non-inflated runs in these designs. It is a design-level warning, not a run-level detector.

### b. Tuning Grid (720 Cells, 144,000 Runs, In-Sample Descriptive Re-Analysis)
To observe behavior across multiple planned-power bands, we evaluate existing checkpointed data across all 720 cells of the tuning grid.
- **`<30%` Band**: 654 cells (109 designs $\times$ 6 effect levels), 47,795 SUPPORTED runs.
- **`30%–60%` Band**: 66 cells (11 designs $\times$ 6 effect levels), 9,020 SUPPORTED runs.
- **`>60%` Band**: 0 cells (0 designs $\times$ 6 effect levels), 0 SUPPORTED runs.

#### Cross-Tabulation of Planned Power Band by True Effect Level

| Planned Power Band | True Effect (min) | Cells | Supported Runs | Inflated Runs | Inflated Share (%) | Ratio of Means | Mean of Ratios | Interpretation Status |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---|
| **<30%** | 10 | 109 | 1,550 | 1,550 | 100.0% | 3.731 | 3.756 | Populated |
| **<30%** | 15 | 109 | 2,749 | 2,430 | 88.4% | 2.504 | 2.517 | Populated |
| **<30%** | 20 | 109 | 4,514 | 2,992 | 66.3% | 1.912 | 1.922 | Populated |
| **<30%** | 30 | 109 | 8,476 | 3,004 | 35.4% | 1.425 | 1.431 | Populated |
| **<30%** | 45 | 109 | 13,558 | 2,083 | 15.4% | 1.180 | 1.184 | Populated |
| **<30%** | 60 | 109 | 16,948 | 1,264 | 7.5% | 1.090 | 1.093 | Populated |
| **30%–60%** | 10 | 11 | 348 | 348 | 100.0% | 2.076 | 2.085 | Populated |
| **30%–60%** | 15 | 11 | 844 | 352 | 41.7% | 1.476 | 1.484 | Populated |
| **30%–60%** | 20 | 11 | 1,412 | 234 | 16.6% | 1.222 | 1.226 | Populated |
| **30%–60%** | 30 | 11 | 2,025 | 60 | 3.0% | 1.046 | 1.047 | Populated |
| **30%–60%** | 45 | 11 | 2,192 | 10 | 0.5% | 1.003 | 1.003 | Populated |
| **30%–60%** | 60 | 11 | 2,199 | 2 | 0.1% | 1.001 | 1.001 | Populated |
| **>60%** | 10 | 0 | 0 | 0 | not computable | not computable | not computable | Too few runs (<30) |
| **>60%** | 15 | 0 | 0 | 0 | not computable | not computable | not computable | Too few runs (<30) |
| **>60%** | 20 | 0 | 0 | 0 | not computable | not computable | not computable | Too few runs (<30) |
| **>60%** | 30 | 0 | 0 | 0 | not computable | not computable | not computable | Too few runs (<30) |
| **>60%** | 45 | 0 | 0 | 0 | not computable | not computable | not computable | Too few runs (<30) |
| **>60%** | 60 | 0 | 0 | 0 | not computable | not computable | not computable | Too few runs (<30) |

*(Note: Per-run individual trial records were not saved; summaries above are computed from cell-level totals across the 200 runs per cell. Individual run-level ratios within cells are not computable from saved data, but cell-level sums are exact.)*

### c. Does the Data Support an Inflation Gradient Across Bands?
1. **`<30%` vs. `30%–60%`**: The data demonstrate a clear, meaningful difference between `<30%` and `30%–60%`.
   - At the target 15-minute effect: in the `<30%` band, 88.4% of supported runs are inflated with a ratio of means of 2.504. In the `30%–60%` band, 41.7% are inflated with a ratio of means of 1.476.
   - Across all effects: inflated share drops from 27.9% in `<30%` to 11.2% in `30%–60%`.
2. **`>60%` (Low Risk)**: The claim of a three-tier gradient extending to "low risk" is **entirely unsupported by data**. Because 0 designs reach $>60\%$ power at 15m, the `>60%` band is completely unpopulated in both tuning and held-out datasets. We have zero empirical runs validating behavior in a ">60% planned power" design.

---

## 3. Lookup Validation Re-Analysis (Held-Out Off-Grid Points)

### a. Point-by-Point Evaluation Against 95% Wilson Confidence Intervals
- Sample size per point: $n = 200$ runs.
- Wilson 95% interval formula: $[p + z^2/(2n) \pm z\sqrt{p(1-p)/n + z^2/(4n^2)}] / [1 + z^2/n]$ where $z = 1.95996$.

| Point Index | Parameters (SD, $\rho$, Dur, Adh, Eff) | Simulated Detection ($k/n$) | 95% Wilson Interval | Lookup Prediction | Signed Error (pp) | Inside 95% CI? |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|
| 0 | 40 SD, 0.3 $\rho$, 42d, 1.0/0.0, 25m | 26.5% (53/200) | [20.9%, 33.0%] | 32.2% | +5.75 | YES |
| 1 | 40 SD, 0.3 $\rho$, 56d, 0.9/0.1, 15m | 11.5% (23/200) | [7.8%, 16.7%] | 12.6% | +1.12 | YES |
| 2 | 40 SD, 0.5 $\rho$, 70d, 1.0/0.0, 12m | 14.0% (28/200) | [9.9%, 19.5%] | 14.0% | -0.05 | YES |
| 3 | 40 SD, 0.5 $\rho$, 84d, 0.9/0.1, 40m | 66.5% (133/200) | [59.7%, 72.7%] | 68.6% | +2.12 | YES |
| 4 | 52 SD, 0.3 $\rho$, 42d, 0.9/0.1, 40m | 27.0% (54/200) | [21.3%, 33.5%] | 28.9% | +1.91 | YES |
| 5 | 52 SD, 0.3 $\rho$, 56d, 1.0/0.0, 25m | 21.0% (42/200) | [15.9%, 27.2%] | 26.0% | +4.99 | YES |
| 6 | 52 SD, 0.5 $\rho$, 70d, 0.9/0.1, 15m | 11.0% (22/200) | [7.4%, 16.1%] | 8.0% | -2.95 | YES |
| 7 | 52 SD, 0.5 $\rho$, 84d, 1.0/0.0, 12m | 8.5% (17/200) | [5.4%, 13.2%] | 10.3% | +1.78 | YES |
| 8 | 68 SD, 0.3 $\rho$, 42d, 1.0/0.0, 12m | 5.0% (10/200) | [2.7%, 9.0%] | 5.2% | +0.17 | YES |
| 9 | 68 SD, 0.3 $\rho$, 56d, 0.9/0.1, 40m | 25.0% (50/200) | [19.5%, 31.4%] | 25.8% | +0.84 | YES |
| 10 | 68 SD, 0.5 $\rho$, 70d, 1.0/0.0, 25m | 18.0% (36/200) | [13.3%, 23.9%] | 20.3% | +2.28 | YES |
| 11 | 68 SD, 0.5 $\rho$, 84d, 0.9/0.1, 15m | 10.0% (20/200) | [6.6%, 14.9%] | 8.1% | -1.90 | YES |

- **Lookup inside 95% interval**: **12 / 12 (100.0%)**.
- **Share of points with positive signed error (overestimate)**: **9 / 12 (75.0%)**.

### b. Monte Carlo Margin Restatement
The v3.1 report stated: *"Total cells: 720 cells, 200 runs/cell. Monte Carlo margin $\le \pm 3.5\text{pp}$ at 50% detection."*
- This statement was mathematically incorrect: $\sqrt{0.5 \times 0.5 / 200} = \sqrt{0.00125} \approx 0.03535$ (3.54 percentage points).
- **$3.54\text{pp}$ is ONE standard error ($1\sigma$)**, representing only a 68% confidence interval.
- The **true 95% Monte Carlo margin of error (half-width)** at $n = 200$ and $p = 0.50$ is:
  $$1.96 \times \sqrt{\frac{0.50 \times 0.50}{200}} = 1.96 \times 3.535\text{pp} = \mathbf{\pm 6.93\text{ percentage points}}.$$
  At $n = 250$ runs (as originally planned in the protocol), the 95% half-width would have been $\pm 6.20\text{pp}$.

### c. Tabulation of Signed Error by True Effect Level

| True Effect | Grid Status | Points Count | Mean Signed Error (pp) | Individual Errors (pp) |
|:---:|:---:|:---:|:---:|:---|
| 12 min | off-grid | 3 | +0.63 pp | -0.05, +1.78, +0.17 |
| 15 min | on-grid | 3 | -1.24 pp | +1.12, -2.95, -1.90 |
| 25 min | off-grid | 3 | **+4.34 pp** | +5.75, +4.99, +2.28 |
| 40 min | off-grid | 3 | +1.63 pp | +2.12, +1.91, +0.84 |

Notice that for 25m effect points, all three errors are substantial overestimates (+5.75pp, +4.99pp, +2.28pp), giving a mean signed error of +4.34pp.

### d. Off-Grid vs. On-Grid Axes Across the 12 Validation Points
Across the 12 held-out points:
- **Nightly Noise SD**: Tested at $\{40, 52, 68\}$ $\rightarrow$ **off-grid** (grid is $\{25, 35, 45, 60, 75\}$).
- **Lag-1 Autocorrelation $\rho$**: Tested at $\{0.3, 0.5\}$ $\rightarrow$ **off-grid** (grid is $\{0.2, 0.4, 0.6\}$).
- **Duration**: Tested at $\{42, 56, 70, 84\}$ $\rightarrow$ **strictly on-grid** (every duration tested was an exact grid node).
- **Adherence**: Tested at $\{1.0/0.0, 0.9/0.1\}$ $\rightarrow$ **strictly on-grid** (both values tested were exact grid nodes).
- **True Direct Effect**: Tested at $\{12, 15, 25, 40\}$ $\rightarrow$ **mixed** (15 is on-grid; 12, 25, 40 are off-grid).

**Axes NOT validated off-grid**:
- **Duration**: Not a single off-grid duration (e.g. 49, 63, 77 days) was tested.
- **Adherence / Contamination**: Not a single off-grid adherence level (e.g. 0.95/0.05, 0.85/0.15) was tested.

### e. Range of Simulated Detection Across the 12 Points
- Range: **5.0% to 66.5%**
- Points with simulated detection in `<30%`: **11 points (91.7%)**
- Points with simulated detection in `30%–60%`: **0 points (0.0%)**
- Points with simulated detection in `>60%`: **1 point (8.3%)** (Point 3: 40 SD, 0.5 $\rho$, 84d, 0.9/0.1, 40m effect $\rightarrow$ 66.5%)

### f. Worst-Case Error Attribution
- **Worst error point**: **Point 0** (SD 40, $\rho = 0.3$, duration 42, adherence 1.0, **effect 25 minutes**).
  - Simulated detection: 26.5%
  - Lookup prediction: 32.2%
  - Signed error: **+5.75 percentage points**.
- **Mechanistic Critique**: The v3.1 report claimed this error was caused by multilinear interpolation smoothing across the 15-minute estimate gate. **This claim is unsupported by saved data.** Point 0 has a true assigned effect of **25 minutes**, which is well above the 15-minute gate. 
- *Hypothesis (speculation only)*: The multilinear interpolation over-predicts detection across the mid-range effect span (20m to 30m) because the underlying power curve is sigmoidal (convex at lower values, concave at higher values); linear chords between grid points lie above convex sections.

### g. MDE Output Validation Status
Output (b) of the feasibility lookup (`minimumDetectableEffect70` — the minimum detectable effect at 70% power) was **never validated against simulation**. It remains unvalidated.

---

## 4. Process Verification

1. **Integrity of Historical Reports and Artifacts**:
   - `reports/caffeine-simulation-v3-history.json` verifies SHA-256 hashes of all v1 and v2 artifacts. Every hash matches the historical record.
   - All v3 files (`caffeine-simulation-v3.md`, `caffeine-simulation-v3-protocol.md`, `caffeine-simulation-v3-tuning.json`, `caffeine-simulation-v3-heldout.json`, `caffeine-simulation-v3-selection.json`, `caffeine-simulation-v3-run.log`) remain present, untruncated, and unchanged.
2. **Protocol Predeclaration Timestamp**:
   - File modification times (mtimes) on disk:
     - `reports/caffeine-simulation-v3.1-protocol.md`: `2026-10-09T20:23:12.973Z`
     - `reports/caffeine-simulation-v3.1-tuning.json`: `2026-10-09T20:56:59.951Z`
     - `reports/caffeine-simulation-v3.1-heldout.json`: `2026-10-09T21:16:15.342Z`
   - The protocol document was written and saved **33 minutes before the tuning grid finished** and **53 minutes before the held-out validation was executed**.
3. **Simulation Wall-Clock Time vs. 20-Minute Budget**:
   - Checkpointed per-cell execution times:
     - Tuning grid sum of cell execution seconds: 1,034.4 s (**17.24 minutes**)
     - Held-out validation sum of cell execution seconds: 19.9 s (**0.33 minutes**)
     - Total recorded simulation CPU/cell execution time: **1,054.3 s (17.57 minutes)**, comfortably inside the 20-minute budget.
4. **Test Suite Invariants**:
   - Test files and counts:
     - `scripts/engine.test.ts`: 15 tests
     - `scripts/engine-v2.test.ts`: 8 tests
     - `scripts/engine-v3.test.ts`: 6 tests
     - `scripts/engine-v3-1.test.ts`: 4 tests
     - Total: **33 tests** (all pass).
   - Diff confirms no tests from v1, v2, or v3 were deleted, commented out, or weakened.
5. **Dependency Invariants**:
   - `package.json` and `package-lock.json` diff confirms zero new packages were added for v3.1.

---

## 5. Open Wording Questions and Analysis

### Current Semantics of `ruled_out`
- In `src/engine/verdict.ts`:
  ```ts
  const ruledOut = result.primary.interval95 === null ? null : result.primary.interval95[1];
  ```
  `ruled_out` is assigned the numeric upper bound of the 95% confidence interval ($U$).

### Current Statement Templates in `src/engine/verdict.ts`
The function `formatResultStatement` generates the following strings:
- **`SUPPORTED`**:
  `"The trial observed an assigned-day difference of ${diffStr} in mean ${metric} favoring intervention, with a ${rangeStr}."`
- **`NO_DETECTABLE_EFFECT`**:
  `"The trial observed no detectable effect; the assigned-day difference of ${diffStr} in mean ${metric} lies within the configured equivalence margin, with a ${rangeStr}."`
- **`INCONCLUSIVE`**:
  `"The trial results are inconclusive; the assigned-day difference of ${diffStr} in mean ${metric} leaves whether there is a meaningful benefit uncertain, with a ${rangeStr}."`
- **Reduced Adherence Suffix**:
  `" Reduced adherence was observed during the study, so actual treatment effects under full compliance may differ."`
- **Planned Power Low Suffix**:
  `" Note: Planned design power for this protocol was low, increasing the risk of an unreliable or exaggerated estimate."`

### One-Sentence Definition vs. Generated Wording
- **Accurate Statistical Definition**: *`ruled_out` is the upper bound of effects that the 95% interval excludes in the beneficial direction (i.e., effect sizes larger than $U$ minutes are ruled out as unlikely to be consistent with the data).*
- **Current Generated Statement Assessment**: The current generated wording **does not say that effects larger than $U$ are ruled out**. It merely refers to a `"plausible range of L to U units"`, without explicitly explaining the directional "ruled out" interpretation of the upper bound.

### Proposed Wording Changes for User Decision (No Code Changed)
1. **Option 1 (Explicit Ruled-Out Clause)**:
   Append an explicit clause when the interval is available:
   - For `NO_DETECTABLE_EFFECT`: `"...with a plausible range of L to U units (effects larger than U units are ruled out)."`
   - For `INCONCLUSIVE`: `"...with a plausible range of L to U units (effects larger than U units are ruled out)."`
2. **Option 2 (Standalone Ruled-Out Metric in Verdict Display)**:
   Keep the summary statement concise and render a distinct label in the UI:
   `"Upper bound excluded: Effects greater than U min ruled out (95% CI)."`

---

## 6. Superseded Statements

The following statements in [caffeine-simulation-v3.1.md](reports/caffeine-simulation-v3.1.md) are not supported by the data and are superseded by this addendum:

1. **Monte Carlo Margin of Error**:
   - *Superseded Statement (v3.1 §Protocol)*: "Monte Carlo margin $\le \pm 3.5\text{pp}$ at 50% detection."
   - *Replacement*: $3.54\text{pp}$ is one standard error. The true **95% Monte Carlo margin of error is $\pm 6.93\text{pp}$** at $n = 200$ and $p = 0.50$.
2. **Worst Lookup Error Attribution**:
   - *Superseded Statement (v3.1 §3.2)*: Attributed the 5.75pp error to multilinear interpolation smoothing across the 15-minute gate threshold.
   - *Replacement*: The worst error occurred at Point 0, which has an assigned effect of **25 minutes** (well above the 15m threshold). The gate mechanism is not the cause. The error is consistent with linear interpolation overestimating a sigmoidal power curve between grid chords.
3. **Monotone-Spline Rationale**:
   - *Superseded Statement (v3.1 §4)*: Proposed shape-preserving monotone Hermite splines on the assumption that multilinear interpolation violates monotonicity.
   - *Replacement*: Multilinear interpolation of coordinate-wise monotone grid data mathematically preserves monotonicity. Splines would not fix non-monotonicity; rather, interpolation on the **probit (Gaussian quantile) scale** or using **effect-over-SD ($d = \Delta / \sigma$) scaling** would better capture the curvature of the power function. (Proposed only, not applied).
4. **SD Below 25 Minutes Yielding "Low Risk"**:
   - *Superseded Statement (v3.1 §3.1)*: Suggested users could achieve "low risk" by choosing an SD $<25$ minutes.
   - *Replacement*: The lookup table has an explicit lower bound of 25 minutes. Any SD below 25m returns `status: 'unknown'`. In `assessFeasibility`, the analytic fallback caps power at 50% for 15m effects, returning `'moderate'` risk. **An SD below 25 minutes can never receive a 'low' rating.**
5. **Planned Power Distribution Across Bands**:
   - *Superseded Statement (v3.1 §3.1)*: Claimed real-world configurations fall into the $<30\%$ or $30\%–60\%$ bands, with low-risk attainable at higher effects.
   - *Replacement*: Across the entire 120-design grid at 15m effect, **109 designs (90.8%) are High Risk (<30%)**, **11 designs (9.2%) are Moderate Risk (30%–60%)**, and **0 designs (0.0%) are Low Risk (>60%)**.
6. **"Catches 100% of Inflated Trials" Claim**:
   - *Superseded Statement (v3.1 §2)*: "The planned-power rule catches 100% of inflated trials when the protocol is underpowered (301/301)."
   - *Replacement*: In the 12 held-out points, all 12 points have planned power $<30\%$. Therefore, **100% of all trials (488/488) were flagged by construction**. The flag has an **overall flag rate of 100%** and a **false-alarm rate of 100%** on non-inflated trials in these protocols. It is a design-level label, not a run-level detector.

---

## 7. Where This Still Looks Inadequate

1. **Unvalidated Bands**:
   The $>60\%$ planned-power band contains **zero designs** at 15m effect in both the tuning and held-out validation sets. Its inflation characteristics are completely unvalidated.
2. **Axes Not Validated Off-Grid**:
   Neither Duration (tested only at 42, 56, 70, 84 days) nor Adherence (tested only at 1.0 and 0.9) was validated off-grid.
3. **MDE Output Unvalidated**:
   The `minimumDetectableEffect70` output from `lookupFeasibility` was never validated against empirical simulations.
4. **Estimated vs. True Run-In Parameters**:
   The lookup assumes true population noise SD and lag-1 autocorrelation $\rho$. In practice, these are estimated from a short (e.g. 7-day) run-in period with high estimation error. The impact of noisy run-in estimates on lookup accuracy and risk classification has not been assessed.
5. **Winner's Curse Residual**:
   The planned-power flag provides a static warning, but does nothing to adjust or shrink the inflated point estimate itself. In underpowered trials, reported estimates passing the verdict remain inflated by an average of 1.72× (ratio of means) to 1.95× (mean of ratios).
