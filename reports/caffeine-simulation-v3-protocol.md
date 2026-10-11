# V3 frozen protocol (written before tuning or held-out evaluation)

## Scope and historical preservation
Pure TypeScript engine only; no app, auth, UI, dependency, or network changes. Preserve every pre-existing file in reports/ byte-for-byte, including v1/v2 Markdown, JSON and logs. Their SHA256 inventory is caffeine-simulation-v3-history.json. No v1/v2 simulations will be rerun or overwritten.

## Seeds and cells
500 runs/cell; 299 constrained permutation draws and 299 bootstrap draws; fixed studentized moving-block interval length 5 (chosen in v2, not reselected here). Noise SD45, stationary AR(1) rho .4. Direct effects in SD units: 0, .25, .5, .75, 1, 1.5 (0,11.25,22.5,33.75,45,67.5 outcome units). Adherence/contamination .9/.1 and 1/0, varied separately from exposure effect. Missing outcomes 10%, unknown exposure 5%, illness 2%, travel 1%, independently of treatment/outcome. Main durations 42,56,70,84; 28-day descriptive checks are unit tests, not a power target.

- TUNING cell j (0..47): data/schedule/bootstrap seeds 30,000,000+1000j+r / 31,000,000+1000j+r / 32,000,000+1000j+r for run r=0..499. Cell order duration, SD effect, adherence pair. Assignment lengths 2 and 3 use paired streams. Exact occupied maxima: 30,047,499 / 31,047,499 / 32,047,499.
- HELD-OUT cell j (0..47): data/schedule/bootstrap seeds 40,000,000+1000j+r / 41,000,000+1000j+r / 42,000,000+1000j+r. Assignment lengths 2 and 3 both evaluated for generalizability, with all three gate policies on each same experiment. Exact occupied maxima: 40,047,499 / 41,047,499 / 42,047,499.
- All explicit seeds >=30,000,000. No XOR derivation into old seed ranges. Internal engine resampling streams derive deterministically from the analysis seed; data, schedule and analysis domains are disjoint. The v2 explicit data ranges and their derived engine streams must be checked for collisions before running.
- 48 cells x 2 assignment designs x 500 runs x 2 partitions =96,000 engine analyses. Gate policies reuse each analysis; they do not rerun resampling. Resumable per-cell checkpoints; measured total simulation budget ~20 minutes.

## Fixed sequential selection rules
1. Compare 2-day against 3-day assignments using policy A on TUNING only. Pool detection over non-null effects, equal weight per duration/effect/adherence cell. Pool coverage over all cells. Choose 2 days iff detection increases by >=3 percentage points AND coverage decreases by <=1 point; otherwise choose 3. Report both designs' detection, coverage, switches, exact allocations.
2. On the selected design's TUNING results, compare A (hard .85/.15), B (label-only, no adherence/contamination gate), C (hard .75/.25). Every policy retains known-exposure/observed-outcome day minimum10 per condition, estimate minimum15, positive lower CI and p<=.05. Choose highest pooled non-null detection among policies with pooled null SUPPORTED FPR<=5% AND worst single null cell<=7%. Deterministic tie order A,B,C (retains existing policy on ties). If none qualify, select none and report failure, rather than invent a safe policy.
3. Write frozen selection and source hashes before HELD-OUT runs. Never change policies, blocks, interval methods, feasibility formulas or thresholds using held-out results. Always report A/B/C and both assignment designs on HELD-OUT regardless of selection.

## Feasibility and display validation
Analytic Gaussian approximation using marginal run-in outcome SD and lag1 AR(1), actual block partition, expected balanced block-sign covariance (1 within a block, approximately -1/(numberBlocks-1) across blocks), missing-outcome retention when supplied, two-sided alpha .05, positive benefit, minimum estimate15. No random sampling at function-call time. Ignore compliance gates in analytic power and label this explicitly; compare prediction primarily to policy B and report A/C mismatches too. Eligibility constraints (28 days or <100 assignments) yield not-inferential, not a fake numerical MDE. MDE70 = max(15, z.975 * SE) + z.70 * SE. Validate predicted power vs measured policy-B detection per cell. Fixed gross-inaccuracy flag absolute difference>10 percentage points. This reporting flag is not an engine gate.

Return unknown risk if baseline SD/rho is missing, rather than estimating a known baseline from treatment outcomes. Inflation risk high iff approximate power for the observed positive effect<50%; low otherwise, unknown when infeasible/unknown. Per-protocol displays remain non-causal, using assignment-design power only as a heuristic.

Inflation tables use empirical policy-B design power bands <20%,20–49%,50–69%,>=70%; report pooled (SUPPORTED-only estimate / true assigned effect) and conservative lower-bound / true assigned effect. Exclude null effects from ratios, retain separate null FPRs. Also report all-experiment ratios as bias diagnostics so selection inflation cannot be hidden. Experimental complier estimates are opt-in and not part of the v3 main analysis/verdict.

## Reporting
Full tables, raw counts, interval availability, feasibility prediction/error/MDE, switches, allocations, policy selection outcomes, 70% crossing only where measured, Monte Carlo uncertainty, bad calibration, runtime, and proposed fixes not applied. Preserve v1/v2 artifacts regardless of results. No post-held-out repair of statistical methods.
