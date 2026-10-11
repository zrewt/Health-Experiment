# Caffeine Engine Simulation v3.2 Verification Report

Verification performed strictly according to specification: verification only, no changes to code, tests, or existing reports, no simulation, no tuning, no dependency changes. If something cannot be established, it is reported as **not established**.

---

## 1. Tests

### Tests in `scripts/engine-v3-2.test.ts`
All 3 tests in [scripts/engine-v3-2.test.ts](scripts/engine-v3-2.test.ts) pass.

1. **`assessFeasibility returns unknown outside table bounds and for missing inputs`**
   - **Assertions / Cases**: 38 assertions across 8 cases:
     - Case 1: In-range baseline (SD 45, rho 0.4, duration 56, adherence 1.0) -> high risk, low reliability (3 assertions)
     - Case 2: In-range baseline (SD 25, rho 0.2, duration 84, adherence 1.0) -> moderate risk, moderate reliability (3 assertions)
     - Case 3: SD 20 (<25 table lower bound) -> unknown risk, unknown reliability, null power (3 assertions)
     - Case 4: SD 90 (>75 table upper bound) -> unknown risk, unknown reliability, null power (3 assertions)
     - Case 5: duration 30 (<42 table lower bound) -> unknown risk, unknown reliability, null power (3 assertions)
     - Case 6: duration 100 (>84 table upper bound) -> unknown risk, unknown reliability, null power (3 assertions)
     - Case 7: missing autocorrelation (null) -> unknown risk, unknown reliability, null power (3 assertions)
     - Case 8: missing assumed adherence (undefined) -> unknown risk, unknown reliability, null power (3 assertions)
     - Multi-case check: loops over all 6 out-of-bounds / missing cases asserting `plannedPowerAtMinimumEffect === null`, and neither risk nor reliability is 'low' or 'moderate' (14 assertions)

2. **`exact full-string equality tests for formatResultStatement matrix`**
   - **Assertions / Cases**: 18 assertions testing the complete Cartesian product matrix:
     - 3 Verdicts (`SUPPORTED`, `NO_DETECTABLE_EFFECT`, `INCONCLUSIVE`)
     - $\times$ 3 Power States (`low`, `not-low`, `unknown`)
     - $\times$ 2 Reduced Adherence States (`false`, `true`)
     - Each of the 18 statements is checked against an exact literal expected full string using `assert.equal`.

3. **`wording rules: forbidden terms, exaggerated restriction, ruled-out clause presence`**
   - **Assertions / Cases**: 199 assertions:
     - Iterates across all 18 parameter combinations (3 verdicts $\times$ 3 power states $\times$ 2 adherence flags):
       - 8 forbidden terms checked per combination (`cause`, `caused`, `proves`, `proven`, `certain`, `certainly`, `confident`, `guarantee`) $\rightarrow 144$ regex assertions
       - 'exaggerated' rule checked per combination (asserted to match only when verdict is `SUPPORTED` and power is `low`; asserted not to match in all other 17 combinations) $\rightarrow 18$ assertions
       - 'ruled-out' clause checked per combination (asserted to match `"(effects larger than 20.0 units are ruled out)"` only for `NO_DETECTABLE_EFFECT` and `INCONCLUSIVE`; asserted not to match for `SUPPORTED`) $\rightarrow 18$ assertions
     - Null interval handling: 1 case with 2 assertions (asserts `"unestimated plausible range"` is present and `"ruled out"` is not present)

### Test Counts Per File (Before and After v3.2)

| Test File | Before v3.2 | After v3.2 | Status |
|---|:---:|:---:|:---:|
| `scripts/engine.test.ts` | 15 | 15 | Pass |
| `scripts/engine-v2.test.ts` | 8 | 8 | Pass |
| `scripts/engine-v3.test.ts` | 6 | 6 | Pass |
| `scripts/engine-v3-1.test.ts` | 4 | 4 | Pass |
| `scripts/engine-v3-2.test.ts` | 0 | 3 | Pass |
| **Total Test Count** | **33** | **36** | **All Pass** |

### Spec Coverage Checklist
- `assessFeasibility` returns unknown at SD 20: **Covered** (`scripts/engine-v3-2.test.ts:46-57`)
- `assessFeasibility` returns unknown at SD 90: **Covered** (`scripts/engine-v3-2.test.ts:59-70`)
- `assessFeasibility` returns unknown at duration 30: **Covered** (`scripts/engine-v3-2.test.ts:72-83`)
- `assessFeasibility` returns unknown at duration 100: **Covered** (`scripts/engine-v3-2.test.ts:85-96`)
- `assessFeasibility` returns unknown for missing autocorrelation: **Covered** (`scripts/engine-v3-2.test.ts:98-109`)
- `assessFeasibility` returns unknown for missing adherence: **Covered** (`scripts/engine-v3-2.test.ts:111-121`)
- Exact full-string equality for 3 verdicts $\times$ {low, not low, unknown} $\times$ {reduced adherence set, not set} (18 cases): **Covered** (`scripts/engine-v3-2.test.ts:133-255`)
- "Exaggerated" rule (present only in `SUPPORTED` + low power; never in null/inconclusive): **Covered** (`scripts/engine-v3-2.test.ts:281-285`)
- Ruled-out clause rule (present only for `NO_DETECTABLE_EFFECT` and `INCONCLUSIVE` with non-null interval; omitted when interval is null): **Covered** (`scripts/engine-v3-2.test.ts:288-298`)
- Forbidden-terms rule (`cause`, `caused`, `proves`, `proven`, `certain`, `certainly`, `confident`, `guarantee` absent across all combinations): **Covered** (`scripts/engine-v3-2.test.ts:275-278`)
- **Items NOT covered**: None.

---

## 2. Analytic Approximation

### Remaining Usages in `src/` and `scripts/`
1. **`src/engine/feasibility.ts` (lines 202–228)**:
   - *Caller*: `assessFeasibility` when `input.observedEffect !== undefined && input.observedEffect !== null`.
   - *Formula*: Analytic Gaussian power `normalCdf((effect - critical) / se)` and SE calculation based on balanced-sign AR(1) covariance.
   - *Older test requiring it*: `scripts/engine-v3.test.ts` (lines 71–91, `analytic feasibility is deterministic, monotone, translation invariant and null-safe`).
2. **`src/engine/feasibility.ts` (lines 231, 251, 270)**:
   - *Caller*: `assessFeasibility` calculation of `minimumDetectableEffect70` fallback (`critical + 0.524400512708041 * se`) when MDE is unreachable or lookup returns unknown.
   - *Older test requiring it*: `scripts/engine-v3.test.ts` (line 78, testing that `approximatePower` at analytic MDE equals 0.70).
3. **`scripts/simulate-engine-v3.ts` (line 104)**:
   - *Caller*: Legacy v3 simulation harness passing `observedEffect: target`.
   - *Older test/workflow requiring it*: v3 historical evaluation harness.

### Reachability on v3.1+ Risk, Reliability, or Planned-Power Path
- **Can anything on the v3.1+ risk, reliability, or planned-power path reach the analytic approximation?**
  **NO**.
  In `assessFeasibility`:
  - When `observedEffect` is omitted (standard v3.1+ usage):
    - If `assumedAdherence` is missing or out of $[0.9, 1.0]$, `assessFeasibility` returns immediately with `plannedPowerAtMinimumEffect = null`, `inflation_risk = 'unknown'`, `estimate_reliability = 'unknown'` (lines 230–237).
    - If baseline inputs (SD, rho, duration) are outside the lookup table bounds, `lookupFeasibility` returns `status: 'unknown'`. The `else` branch of `lookup.status === 'ok'` executes, explicitly setting `plannedPowerAtMinimumEffect = null`, `inflation_risk = 'unknown'`, and `estimate_reliability = 'unknown'` (lines 269–275).
    - Neither `inflation_risk`, `estimate_reliability`, nor `plannedPowerAtMinimumEffect` can ever be populated by the analytic Gaussian AR(1) formula on the v3.1+ path.

---

## 3. MDE Semantics

1. **Return Value for Unreachable MDE vs. "Unknown"**:
   - When parameters are **within table bounds** but 70% power is not reached for any integer effect up to 60 minutes:
     `lookupFeasibility` returns `minimumDetectableEffect70: 'not reachable within the duration'`. It does NOT return `"unknown"` or `null`.
   - In contrast, `"unknown"` (`status: 'unknown'`, `minimumDetectableEffect70: null`, `detectionProbabilityAtMinimumEffect: null`) is returned **only when parameters are outside the lookup bounds** (e.g. SD $<25$ or $>75$, duration $<42$ or $>84$, missing SD or autocorrelation).

2. **Direct vs. Assigned-Day Effect**:
   - MDE is expressed as the **assigned-day effect** (intention-to-treat / ITT effect), not the direct (per-protocol / complier) effect.

3. **Maximum Power at 60 Minutes for the 37 Unreachable Designs**:
   - **Minimum power reached**: **21.0%** (SD 75, $\rho = 0.6$, Duration 42, Adherence 0.9)
   - **Median power reached**: **53.5%**
   - **Maximum power reached**: **69.5%** (SD 60, $\rho = 0.2$, Duration 84, Adherence 0.9)

4. **Exact Plain-Language String Returned**:
   When MDE is unreachable within duration, `lookupFeasibility.statement` returns:
   `"Over <duration> days, 70% detection is not reachable within the duration for effects up to 60 minutes. Detection probability at the minimum meaningful effect (<minEff>m) is <detAtMin>%."`
   *(Example for Duration 42, SD 75, $\rho = 0.6$, Adherence 0.9, minEff 15: `"Over 42 days, 70% detection is not reachable within the duration for effects up to 60 minutes. Detection probability at the minimum meaningful effect (15m) is 4.5%."`)*

---

## 4. MDE Figures (From `reports/caffeine-simulation-v3.2.md`)

- **Share of all 120 designs with MDE $\le 30$ minutes**: **25 / 120 (20.8%)**
- **Share with MDE $\le 30$ minutes for SD 35 to 60 only (72 designs)**: **6 / 72 (8.3%)**
- **Share of all 120 designs with MDE $\le 45$ minutes**: **59 / 120 (49.2%)**

### Table by Duration and SD (From v3.2 Report)

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

---

## 5. Preservation

### SHA-256 Checksums of Reports and Artifacts

| File Path | Current SHA-256 Checksum | Recorded History Baseline | Status |
|---|---|---|:---:|
| `reports/caffeine-simulation.md` | `790281e93a9d20bfa6855107d077f391afff25de7a881154e58ac852d68dd11a` | `790281e93a9d20bfa6855107d077f391afff25de7a881154e58ac852d68dd11a` | Exact Match |
| `reports/caffeine-simulation-v2.md` | `ef9ab28a0be6d9686a13b385e6b22922f51de02a6d2838366f12f36dba5c6b87` | `ef9ab28a0be6d9686a13b385e6b22922f51de02a6d2838366f12f36dba5c6b87` | Exact Match |
| `reports/caffeine-simulation-v2-data.json` | `44bb2315c42abbb30491368191fa4dd2d65a25343fc8e9cc795af12d750d8d3e` | `44bb2315c42abbb30491368191fa4dd2d65a25343fc8e9cc795af12d750d8d3e` | Exact Match |
| `reports/caffeine-simulation-v2-lint.log` | `4a4bfde8e97b313fad8a726bcbd185be46ec784b728101c7c9e36227420e6315` | `4a4bfde8e97b313fad8a726bcbd185be46ec784b728101c7c9e36227420e6315` | Exact Match |
| `reports/caffeine-simulation-v2-run.log` | `1984e16919a06f72b15d0df6229525c9af09fa329c0b80f8a31dd222102de14d` | `1984e16919a06f72b15d0df6229525c9af09fa329c0b80f8a31dd222102de14d` | Exact Match |
| `reports/caffeine-simulation-v2-tuning.json` | `71b7772e9678d0e468c58127be7f3039eded6bcac60d14486ab45893dd12c857` | `71b7772e9678d0e468c58127be7f3039eded6bcac60d14486ab45893dd12c857` | Exact Match |
| `reports/caffeine-simulation-v2-tuning-progress.json` | `abc09a35820e85e205ba4821fb49f399db8785439f7aa1576977785a9cc282b6` | `abc09a35820e85e205ba4821fb49f399db8785439f7aa1576977785a9cc282b6` | Exact Match |
| `reports/caffeine-simulation-v3.md` | `c736891913b3e1c9b27c5525475c65beb7ead7ed13f67c8d581f971610dbac0f` | Recorded baseline: not recorded | Not established |
| `reports/caffeine-simulation-v3-heldout.json` | `14fef8daed3b0fb9593933c8e425f5aaee8c42c766615c7fc4c4bfbbc1f3c226` | Recorded baseline: not recorded | Not established |
| `reports/caffeine-simulation-v3-history.json` | `f36d6435fb8ee2fbdc79e7a899cec8d4cb89b8280f98aa274e00431d9fa92167` | Recorded baseline: not recorded | Not established |
| `reports/caffeine-simulation-v3-protocol.md` | `6e88a729963ead24ece982bf59670e0aa9978e7f06ac896fec4b0dc146557be9` | Recorded baseline: not recorded | Not established |
| `reports/caffeine-simulation-v3-run.log` | `7f5b7411187c708e481b927b789ab30528a25d9bd70bb0b31da3dbaefbf0de11` | Recorded baseline: not recorded | Not established |
| `reports/caffeine-simulation-v3-selection.json` | `05f2608bf74fd39c3431e2a63c38fe6bff82d81aa8d71260c9040cdcf2aff815` | Recorded baseline: not recorded | Not established |
| `reports/caffeine-simulation-v3-tuning.json` | `e8c0bf37eafda2679d35af335aad8fd83c8f732c64b4da825984f4cc7d442a66` | Recorded baseline: not recorded | Not established |
| `reports/caffeine-simulation-v3.1.md` | `7f27f124c8df48f9c068fc548feb5bc8b5a3635d89d99305d265efc438574539` | Recorded baseline: not recorded | Not established |
| `reports/caffeine-simulation-v3.1-addendum.md` | `4b31f0072f3778babea3d3970278f36d0a9427dd330a4c699a8738ddb314fd9c` | Recorded baseline: not recorded | Not established |
| `reports/caffeine-simulation-v3.1-heldout.json` | `d21790830aa2791761d8e3385b24fd99f52eda7964f4f342a08795dcc07b811d` | Recorded baseline: not recorded | Not established |
| `reports/caffeine-simulation-v3.1-protocol.md` | `cdad48a997fadd75f86eb6a20a943a53c499bb628d13b8444d13b78c25e10dd5` | Recorded baseline: not recorded | Not established |
| `reports/caffeine-simulation-v3.1-tuning.json` | `f32cb88e09d59e75e3e2bf3e7f87ce6420525c9c8dd9a024a534c80f838be743` | Recorded baseline: not recorded | Not established |

**Files without a recorded baseline**:
`reports/caffeine-simulation-v3-history.json` only recorded baseline SHA-256 hashes for v1 and v2 files (`caffeine-simulation.md`, `caffeine-simulation-v2*`). No history manifest was created that recorded SHA-256 baselines for v3, v3.1, or v3.1-addendum files. Because `git log` shows only a single initial commit (`3633575 Initial commit`) with no pre-v3.1 commit tagged or recorded, comparison of v3, v3.1, and v3.1-addendum hashes against an earlier recorded baseline is **not established**.

---

## 6. Commands Run & Output

### 1. `CI=1 npm run lint`
- **Exit Code**: `0`
- **Output**:
  ```
  > aevum@1.0.0 lint
  > expo lint

  env: load .env.local
  env: export EXPO_PUBLIC_APP_ENV EXPO_PUBLIC_SUPABASE_ANON_KEY EXPO_PUBLIC_SUPABASE_URL
  ```

### 2. `npm run typecheck`
- **Exit Code**: `0`
- **Output**:
  ```
  > aevum@1.0.0 typecheck
  > tsc --noEmit
  ```

### 3. `./node_modules/.bin/tsc --noEmit -p tsconfig.engine.json`
- **Exit Code**: `0`
- **Output**: *(empty stdout, clean exit)*

### 4. Full test command (`npx --no-install tsx --test scripts/engine.test.ts scripts/engine-v2.test.ts scripts/engine-v3.test.ts scripts/engine-v3-1.test.ts scripts/engine-v3-2.test.ts`)
- **Exit Code**: `0`
- **Output**:
  ```
  ✔ randomized blocks preserve equal blocks/days and optimal weekend balance across lengths, starts, stratifications and seeds (1157.4246ms)
  ✔ DP count equals independently brute-forced admissible assignments, with stratification on and off (832.1202ms)
  ✔ exact two-sided test counts complement, warns, and refuses alpha below achievable resolution (23.1235ms)
  ✔ eligibility thresholds, sample SD, missing outcomes, unknown exposure, and contradictions (2.8506ms)
  ✔ 85%/15% gates include boundary overrides; unknown exposure reduces analyzable days but preserves ITT outcomes (15.9711ms)
  ✔ joint whole-block IV ratio recovers known exposure effect and refuses weak instruments at <0.5 (32.5951ms)
  ✔ outcome metric and exposure rule are pluggable without caffeine/sleep assumptions (8.1044ms)
  ✔ size flag remains true when other gates fail and intervals exclude zero below meaningful threshold (11.0416ms)
  ✔ feasibility lookup interpolates correctly and returns unknown outside bounds (7.5448ms)
  ✔ planned-power inflation risk and reliability bands derived from lookup (92.1408ms)
  ✔ display values include ruled_out and planned power metrics (69.1155ms)
  ✔ plain-language statements follow exact wording rules (21.4651ms)
  ✔ assessFeasibility returns unknown outside table bounds and for missing inputs (70.9377ms)
  ✔ exact full-string equality tests for formatResultStatement matrix (0.8957ms)
  ✔ wording rules: forbidden terms, exaggerated restriction, ruled-out clause presence (2.4175ms)
  ✔ predeclared selection obeys exact block thresholds, null FPR ceilings, and ties (2.4606ms)
  ✔ 28 days and every <100 block allocation design are too short, independent of policies (233.0766ms)
  ✔ policies A/B/C keep evidence/day/estimate gates but differ only in compliance gates (19.4634ms)
  ✔ analytic feasibility is deterministic, monotone, translation invariant and null-safe (14.6671ms)
  ✔ every effect display has null-preserving interval/conservative estimate and baseline-based inflation risk (19.5494ms)
  ✔ experimental complier has explicit opt-in contract and never influences default verdict (14.2801ms)
  ✔ seeded randomized schedules are deterministic, balanced and capped across 100 seeds (356.2459ms)
  ✔ alternating and block designs respect patterns and deterministic phases (3.2201ms)
  ✔ invalid dates, lengths, seeds and caps are rejected (1.2782ms)
  ✔ adherence handles exact noon, no caffeine, missing times, contamination and contradictions (2.2089ms)
  ✔ exclusions preserve all reasons, null flags, and input immutability (1.4328ms)
  ✔ missing records stay null, zero is observed, duplicates and assignment mismatch rejected (24.6614ms)
  ✔ known beneficial/no-effect datasets yield exact estimates and verdicts, deterministically (59.3452ms)
  ✔ insufficient, unknown and low-adherence data are inconclusive (27.5683ms)
  ✔ interval ambiguity, configurable thresholds and secondary labels (20.243ms)
  ✔ alternating and fixed block designs return inconclusive with "design does not support inference" (44.6634ms)
  ✔ randomized blocks: determinism, balance, weekend stratification, and admissible counting (15.711ms)
  ✔ baseline run-in eligibility: checks 50% late caffeine rule, unknown handling, mean and SD (1.7826ms)
  ✔ adherence gates: 85% intervention adherence and 15% contamination max (6.6824ms)
  ✔ compliance-adjusted estimate (CACE/IV) and weak instrument refusal (23.0563ms)
  ✔ size_uncertain flag is true when lower bound of 95% CI is below minMeaningfulEffect (12.8711ms)
  ℹ tests 36
  ℹ suites 0
  ℹ pass 36
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 2848.8559
  ```

---

## 7. Report Sections Confirmation

The report `reports/caffeine-simulation-v3.2.md` contains both requested sections.

### Section 1: "Known limitations at freeze"
- **Quoted Heading**: `## Known Limitations at Freeze`
- **Items**:
  1. `1. **MDE Output Unvalidated**: The minimum detectable effect at 70% power (minimumDetectableEffect70) is generated by finding the first effect reaching 70% power in the interpolated table, but has never been checked against independent simulations.`
  2. `2. **Off-Grid Duration and Adherence Interpolation Unvalidated**: Validation was conducted on off-grid SD (40, 52, 68) and rho (0.3, 0.5). Durations (42, 56, 70, 84) and adherences (1.0, 0.9) tested in held-out validation were strictly on-grid.`
  3. `3. **Estimated vs. True Run-In Parameters**: The lookup assumes true population noise SD and lag-1 autocorrelation rho. In live use, these parameters are estimated from a short (e.g. 7-day) run-in with substantial estimation variance.`
  4. `4. **Monte Carlo Cell Noise vs. Interpolation Error**: With 200 runs per cell, the Monte Carlo 95% margin of error is approximately ±6.9pp near 50% power. This limits the ability to resolve fine interpolation errors below that margin.`
  5. `5. **Unreachable High-Power Band (>60%) at 15 Minutes**: On the entire grid, planned power at 15m never exceeds 49.0%. The >60% planned power band is unpopulated.`
  6. `6. **Winner's Curse Conditioning Residual**: While the planned-power warning correctly classifies trials in underpowered protocols as low reliability, point estimates passing the verdict remain inflated by 1.72× on average in those protocols.`

### Section 2: "Launch gates"
- **Quoted Heading**: `## Launch Gates (Pre-Launch Protocol Requirements)`
- **Items**: 5 pre-launch protocol requirements (New Seed Domain, Adequate Sample Size $\ge 1,000$, Off-Grid Duration & Adherence, Direct MDE Simulation within $[67\%, 73\%]$, Run-In Estimation Sensitivity).

---

## 8. Summary of Not Established Items

Verification report generated at `reports/caffeine-simulation-v3.2-verification.md`. Historical byte-for-byte SHA-256 match is verified for all v1 and v2 files against [reports/caffeine-simulation-v3-history.json](reports/caffeine-simulation-v3-history.json). However, because no prior history manifest recorded SHA-256 baselines for v3, v3.1, or v3.1-addendum artifacts, and the Git repository consists only of a single initial commit with no pre-v3.1 checkpoint commit, comparison of those files against an earlier recorded baseline is **not established**.
