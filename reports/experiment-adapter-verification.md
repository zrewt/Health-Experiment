# Experiment adapter fixes — verification report

## Delivered changes

- [config.ts](../src/experiment/config.ts): explicit selected Policy B overrides sourced from the lookup-table simulation harness; no default seed.
- [types.ts](../src/experiment/types.ts): scenarioRho, minPlannedPowerAcrossRho, nullable scenario statement, reducedAdherence, and INVALID_SEED.
- [adapter.ts](../src/experiment/adapter.ts): passes selected overrides to analysis/verdict; requires an explicit uint32 seed; selects a single coherent scenario per duration.
- [experiment.test.ts](../scripts/experiment.test.ts): 34 tests, including real-engine adherence fixtures and coherent-scenario regressions.

No statistical estimation was added. Scenario ranking is selection over engine outputs. No engine files, engine defaults, dependencies, or screens were changed. No commits, tags, pushes, or staging operations were performed.

## Step 0: exact policy provenance

[Selection](caffeine-simulation-v3-selection.json) chooses blockLength 2 and gatePolicy B. [Protocol](caffeine-simulation-v3-protocol.md) explicitly names B as label-only with no adherence/contamination gates. Both inspected harnesses use that clearly named policy.

[Original v3 harness](../scripts/simulate-engine-v3.ts) per-run override objects:

```ts
// AnalysisConfig
{
  permutations: 299,
  bootstrapSamples: 299,
  bootstrapMethod: 'studentized',
  bootstrapBlockLength: 5,
  seed: analysisSeedBase + r,
  baseline: { mean: 420, sd: 45, lag1Autocorrelation: 0.4 },
}
// VerdictConfig for Policy B
{ gatePolicy: 'B' }
```

[Lookup-table v3.1 harness](../scripts/simulate-engine-v3-1-helpers.ts) per-run override objects:

```ts
// AnalysisConfig
{
  permutations: 149,
  bootstrapSamples: 149,
  bootstrapMethod: 'studentized',
  bootstrapBlockLength: 5,
  seed: analysisSeedBase + r,
  baseline: { mean: 420, sd: cell.sd, lag1Autocorrelation: cell.rho },
}
// VerdictConfig
{ gatePolicy: 'B' }
```

The adapter uses the v3.1 lookup-table harness's static settings:

```ts
selectedPolicyOverrides = {
  analysis: {
    permutations: 149,
    bootstrapSamples: 149,
    bootstrapMethod: 'studentized',
    bootstrapBlockLength: 5,
  },
  verdict: { gatePolicy: 'B' },
};
```

Runtime analysis overrides additionally supply the plan seed, baseline `{ mean: null, sd: plan.baselineStats.sd, lag1Autocorrelation: plan.baselineStats.assumedAutocorrelation }`, and plan assumedAdherence. Baseline mean is unavailable and remains null; it is not invented. Verdict additionally receives the snapshotted minimumMeaningfulEffectMinutes (15).

DEFAULT_ANALYSIS differs: permutations 999, bootstrapSamples 999, bootstrapBlockLength 3, seed 12345. Its studentized method and illness/travel exclusions match the harness. DEFAULT_VERDICT differs in gatePolicy (A rather than B); its evidence/day/effect thresholds are inherited unchanged. No harness specifies a 95% label threshold.

## Authorized exception: 95% adherence

The frozen engine labels reduced adherence whenever intervention adherence minus control contamination is below 1 (within its numerical tolerance). Thus 95% adherence with zero contamination still produces the note. The user explicitly chose to preserve this engine behavior rather than suppress or paraphrase the statement.

Real-engine fixtures use 40 known intervention exposures: 38/40, 32/40, and 20/40 compliant, with two other intervention exposures remaining unknown. They produce exact 95%, 80%, and 50% adherence and zero known control contamination. All three strong assigned-day outcome fixtures return SUPPORTED under B, reducedAdherence true, and the engine statement byte-for-byte. This establishes no adherence-only blocking at 50%, not a guarantee that every 50% experiment is supported; all evidence and sample-size gates remain active.

Engine sentence preserved verbatim:

> Reduced adherence was observed during the study, so actual treatment effects under full compliance may differ.

## Public interface changes

```ts
startExperiment(
  baseline: BaselineSummary,
  feasibility: FeasibilityViewModel,
  chosenDuration: number,
  startDate: string,
  acknowledged: boolean,
  seed: number,
  engine: EngineFacade = realEngine,
): ExperimentPlan
```

Seed is mandatory at the type level and validated at runtime. Missing/noninteger/negative/above-uint32 seeds throw ExperimentAdapterError with code INVALID_SEED. No random generation or fallback seed exists.

Each DurationOption returns scenarioRho instead of the former duration-level assumedAutocorrelation. The plan retains baselineStats.assumedAutocorrelation, populated from scenarioRho. Consumers must update to the new duration-option field and explicit-seed argument.

Ranking: maximum MDE first (unreachable above numeric), then minimum power among equal MDEs, then maximum rho. Displayed power, MDE, and statement are from the same lookup result. minPlannedPowerAcrossRho is diagnostic only. If any rho has null power/MDE or unknown status, the duration's scenario fields are all null, including statement and scenarioRho. A known diagnostic minimum can remain available when only MDE is unknown; it is not a display scenario.

## Complete test-name inventory: scripts/experiment.test.ts

### Tier, configuration, and SD bounds (9)
1. `tier boundary: MDE 30 -> informative`
2. `tier boundary: MDE 31 -> long_shot`
3. `tier boundary: MDE 45 -> long_shot`
4. `tier boundary: MDE 46 -> not_informative`
5. `tier boundary: MDE not reachable within the duration -> not_informative`
6. `tier boundary: MDE null -> cannot_assess`
7. `config reuses engine bounds and defaults; assumption labels match the contract`
8. `SD 76, null SD, and an ineligible baseline skip every lookup and hide output numbers`
9. `SD 24 uses SD 25 for every lookup, flags each number at least, and preserves the engine statement`

### Coherent rho selection and duration choice (7)
10. `scenario selection keeps maximum MDE, its power and statement together when rho outputs disagree`
11. `null power or MDE at any rho nulls the entire duration scenario, including rho and statement`
12. `unreachable MDE outranks numeric MDE regardless of power; equal scenarios pick higher rho`
13. `equal MDE scenarios choose lower power before higher rho, including unreachable ties`
14. `assigned-day equivalent for MDE 30 is MDE times 0.8`
15. `assigned-day equivalent for MDE 37 is MDE times 0.8`
16. `default duration is the shortest qualifying option, otherwise 84 for startable tiers`

### Start restrictions, seed, and snapshots (4)
17. `start refuses both blocked tiers, unacknowledged long-shot, and duration 49 with typed errors`
18. `explicit seed is required; missing, noninteger, negative, and out-of-range seeds refuse`
19. `the same explicit seed reproduces the schedule and uint32 boundaries are accepted`
20. `start stores seed, engine schedule, assumptions, and deep snapshots without mutating inputs`

### Baseline, missing data, and input validation (4)
21. `missing sleep and servings stay null, explicit none alone maps to zero servings, and time exposure is known`
22. `baseline preserves engine reasons and returns no autocorrelation, power, or effect fields`
23. `fewer than 14 valid sleep days cannot assess even when the engine finds enough run-in records`
24. `invalid and duplicate entries are rejected rather than silently counted or defaulted`

### Final-only evaluation and progress (3)
25. `evaluate refuses before end without calling analysis, accepts on end, preserves statements and recomputes snapshot power`
26. `a modified schedule cannot bypass the interim-look guard`
27. `progress is counts only, uses engine adherence, ignores future logs, and counts unlogged exposure as unknown`

### Selected policy and real-engine adherence (5)
28. `selected policy overrides match the lookup harness while engine defaults remain unchanged`
29. `Policy B real fixture at 95% adherence labels reduced adherence without blocking support`
30. `Policy B real fixture at 80% adherence labels reduced adherence without blocking support`
31. `Policy B real fixture at 50% adherence labels reduced adherence without blocking support`
32. `default engine policy blocks 80 percent intervention adherence; B labels only and C uses 75 percent`

### Import guard and frozen-engine integrity (2)
33. `adapter import scan permits only local engine/module imports and no React, Supabase, network, or AI calls`
34. `freeze verifier passes real files and reports changed or missing files with nonzero CLI exit`

## Requested regression coverage confirmation

All explicitly requested guards already existed and were retained:
- No react/supabase/fetch imports or network calls: test 33.
- not_informative and cannot_assess start refusals: test 17.
- long_shot without acknowledgement refusal: test 17.
- duration 49 refusal: test 17.
- Fewer than 14 valid run-in outcomes -> cannot_assess: test 23.
- SD 24 conservative flag and SD 25 lookups: test 9.
- SD 76 -> not_informative with no display numbers: test 8.

None of these regression guards were missing. Added explicit seed, policy-provenance, 95/80/50 adherence, and MDE-tie regressions. Old mixed-rho assertions were changed because coherent scenarios are the requested behavior, not to bypass failures.

## Final checks

Every command below completed with exit code 0. No filtered pipelines were used.

```bash
CI=1 npm run lint
npm run typecheck
./node_modules/.bin/tsc --noEmit -p tsconfig.engine.json
./node_modules/.bin/tsc --ignoreConfig --noEmit --target ES2022 --module Node16 --moduleResolution Node16 --strict --esModuleInterop --skipLibCheck --types node src/experiment/config.ts src/experiment/types.ts src/experiment/adapter.ts scripts/experiment.test.ts scripts/verify-engine-freeze.ts
./node_modules/.bin/tsx --test scripts/engine.test.ts scripts/engine-v2.test.ts scripts/engine-v3.test.ts scripts/engine-v3-1.test.ts scripts/engine-v3-2.test.ts scripts/experiment.test.ts scripts/auth-sanity.ts
node scripts/env-sanity.cjs
node scripts/contrast-sanity.cjs
npm run verify:freeze
git diff --exit-code engine-v3.2-freeze -- src/engine/
```

| Test file | Passed |
|---|---:|
| [engine.test.ts](../scripts/engine.test.ts) | 15 |
| [engine-v2.test.ts](../scripts/engine-v2.test.ts) | 8 |
| [engine-v3.test.ts](../scripts/engine-v3.test.ts) | 6 |
| [engine-v3-1.test.ts](../scripts/engine-v3-1.test.ts) | 4 |
| [engine-v3-2.test.ts](../scripts/engine-v3-2.test.ts) | 4 |
| [experiment.test.ts](../scripts/experiment.test.ts) | 34 |
| [auth-sanity.ts](../scripts/auth-sanity.ts) | 6 |
| **Total runner tests** | **77** |

Environment and contrast sanity scripts also passed; they do not register individual node:test cases. Lint produced no warnings. All 10 manifest-listed engine file hashes match; engine diff against the frozen tag is empty. HEAD and the freeze tag remain 8a3ec6c96e28a435fc51b9f6f265952ffcb8cba8.

## Limitations / not established

- The requested absence of a 95% note is intentionally not implemented, with explicit user approval; the engine's verbatim behavior is preserved.
- The original v3 selection used 299 draws; the adapter uses 149 draws to match the v3.1 table harness. These are explicitly different historical analysis settings.
- Fixture tests establish adapter plumbing and deterministic engine behavior, not new statistical calibration or production validity. No simulations were rerun.
- Autocorrelation is assumed, not estimated. Below-grid conservative qualifiers remain unvalidated. Schedules balance weekend counts, not every weekday.
- The original app/package setup remains uncommitted. Clean-clone reproducibility is not established. This task installed no dependencies and did not stage unrelated setup.
- Persistence, UI, and random seed generation remain caller responsibilities and were not implemented.

## Scoped Git commands — not executed

The adapter and verifier are still untracked from the earlier task. Stage only these deliverables; unrelated app files and package changes are deliberately excluded.

```bash
git status --short
git branch --show-current
git add -- src/experiment/config.ts src/experiment/types.ts src/experiment/adapter.ts scripts/experiment.test.ts scripts/verify-engine-freeze.ts reports/experiment-adapter-verification.md
```

If including the prior verify:freeze npm-script addition, stage only that change (this patch targets the currently committed package.json, not its unrelated working-copy edits):

```bash
git apply --cached <<'PATCH'
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -17,6 +17,7 @@
     "android": "expo start --android",
     "ios": "expo start --ios",
-    "web": "expo start --web"
+    "web": "expo start --web",
+    "verify:freeze": "tsx scripts/verify-engine-freeze.ts"
   },
   "private": true
 }
PATCH

git diff --cached
git commit -m "fix(experiment): preserve selected Policy B and coherent seeded scenarios"
```

No tag command is needed. No push was authorized or performed for this task.
