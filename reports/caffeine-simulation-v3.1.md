# Caffeine engine simulation report v3.1

**COMPLETE**: Precomputed feasibility lookup table and held-out validation. Preserved [v1](caffeine-simulation.md), [v2](caffeine-simulation-v2.md), and [v3](caffeine-simulation-v3.md) byte-for-byte.

## Protocol and Reproducibility

- [Predeclared protocol](caffeine-simulation-v3.1-protocol.md), [tuning raw counts](caffeine-simulation-v3.1-tuning.json), [held-out raw counts](caffeine-simulation-v3.1-heldout.json), [data table](src/engine/feasibility-table-data.ts).
- Seed domains:
  - **Tuning Grid**: `50,000,000 + 1000 * j + r` ($j = 0 \dots 719$, $r = 0 \dots 199$).
  - **Held-Out Validation**: `60,000,000 + 1000 * k + r` ($k = 0 \dots 11$, $r = 0 \dots 199$).
  - Strictly disjoint from all v1 (`20,261,008+`), v2 (`10,000,000+`), and v3 (`30,000,000+` and `40,000,000+`) seed streams.
- Design: 2-day randomized blocks with weekend balance, Policy B (label-only), studentized circular moving-block bootstrap (length 5).
- Grid dimensions:
  - Noise SD: 25, 35, 45, 60, 75
  - Lag-1 autocorrelation $\rho$: 0.2, 0.4, 0.6
  - Durations: 42, 56, 70, 84
  - Adherence / contamination: 1.0/0.0 and 0.9/0.1
  - True direct effects: 10, 15, 20, 30, 45, 60 minutes
  - Total cells: 720 cells, 200 runs/cell (144,000 simulations). Monte Carlo margin $\le \pm 3.5\text{pp}$ at 50% detection.

---

## 1. Feasibility Lookup Validation on Held-Out Off-Grid Points

Evaluation on 12 held-out off-grid points testing unsimulated parameter combinations:

| Point (SD, $\rho$, Duration, Adh/Contam, Effect) | Simulated Detection | Lookup Detection | Error (pp) |
|---|---:|---:|---:|
| 40 SD, 0.3 $\rho$, 42d, 1.0/0.0, 25m | 26.5% | 32.2% | +5.75 |
| 40 SD, 0.3 $\rho$, 56d, 0.9/0.1, 15m | 11.5% | 12.6% | +1.12 |
| 40 SD, 0.5 $\rho$, 70d, 1.0/0.0, 12m | 14.0% | 14.0% | -0.05 |
| 40 SD, 0.5 $\rho$, 84d, 0.9/0.1, 40m | 66.5% | 68.6% | +2.12 |
| 52 SD, 0.3 $\rho$, 42d, 0.9/0.1, 40m | 27.0% | 28.9% | +1.91 |
| 52 SD, 0.3 $\rho$, 56d, 1.0/0.0, 25m | 21.0% | 26.0% | +4.99 |
| 52 SD, 0.5 $\rho$, 70d, 0.9/0.1, 15m | 11.0% | 8.0% | -2.95 |
| 52 SD, 0.5 $\rho$, 84d, 1.0/0.0, 12m | 8.5% | 10.3% | +1.78 |
| 68 SD, 0.3 $\rho$, 42d, 1.0/0.0, 12m | 5.0% | 5.2% | +0.17 |
| 68 SD, 0.3 $\rho$, 56d, 0.9/0.1, 40m | 25.0% | 25.8% | +0.84 |
| 68 SD, 0.5 $\rho$, 70d, 1.0/0.0, 25m | 18.0% | 20.3% | +2.28 |
| 68 SD, 0.5 $\rho$, 84d, 0.9/0.1, 15m | 10.0% | 8.1% | -1.90 |

### Predeclared Acceptance Criteria Results
- **Mean Absolute Error (MAE)**: **2.16 percentage points** (predeclared threshold: $\le 5.0\text{pp}$) — **PASS**
- **Worst-Case Error**: **5.75 percentage points** (predeclared threshold: $\le 10.0\text{pp}$) — **PASS**
- **Systematic Bias**: **+1.34 percentage points** (predeclared threshold: $\le 3.0\text{pp}$) — **PASS**

---

## 2. Planned-Power Inflation Risk and Reliability Validation

The heuristic plug-in observed-power flag has been replaced by **planned power at the minimum meaningful effect (15m)** derived from the lookup table:
- **High risk / Low reliability**: Planned power $<30\%$
- **Moderate risk / Moderate reliability**: Planned power $30\% \dots 60\%$
- **Low risk / High reliability**: Planned power $>60\%$
- **Unknown**: Missing baseline run-in parameters or outside table bounds.

### Performance Across Held-Out Points

| Planned Power Band | Points | Supported Runs | Mean Reported / True Assigned |
|---|---:|---:|---:|
| <30% | 12 | 488 | 1.72 |
| 30%–60% | 0 | 0 | N/A |
| >60% | 0 | 0 | N/A |

### Share of Over-Inflated Runs Flagged
Across all held-out runs where the reported estimate exceeded $1.5\times$ the true assigned-day effect:
- **Total runs with $>1.5\times$ inflation**: 301
- **Flagged high or moderate risk**: **301 / 301 (100.0%)**

Unlike v3 (where noisy large estimates suppressed the warning in underpowered designs), the planned-power rule catches 100% of inflated trials when the protocol is underpowered.

---

## 3. Plain Statement of Where Calibration or Heuristics Look Inadequate

1. **Table Sparsity in High-Power Regions at 15 Minutes**:
   - Because caffeine trials with noisy outcomes (SD $\ge 35\text{m}$) have difficulty reaching $>60\%$ power for a modest 15-minute effect within 84 days, almost all real-world configurations at 15m fall into the $<30\%$ or $30\%–60\%$ bands. While this accurately reflects that 15m is difficult to detect, users seeking a 'low risk' design must commit to either very low SD ($<25\text{m}$) or larger target effects ($>25\text{m}$).
2. **Boundary Sensitivity in Multilinear Interpolation**:
   - Multilinear interpolation between grid points can slightly smooth out nonlinear power step-functions near detection thresholds (e.g., crossing the 15-minute estimate gate), resulting in localized errors up to ~5.75pp.
3. **Winner's Curse Conditioning on SUPPORTED**:
   - In low-power regimes ($<30\%$), the mean reported effect among trials passing the verdict remains **1.72× true assigned effect**. The planned-power flag successfully warns the user (`high` risk / `low` reliability), but the point estimate itself remains conditioned on statistical significance.

---

## 4. Proposed Fixes (Not Applied)

- **Adaptive Non-Linear Spline Interpolation**: Replace 5D multilinear interpolation with shape-preserving monotone Hermite splines to better capture logistic S-curves of power functions near thresholds.
- **Empirical Shrinkage / Empirical Bayes Estimator**: Add an optional shrinkage estimator (e.g., James-Stein or empirical Bayes) to pull reported estimates toward zero or the planned prior when planned power is low.
