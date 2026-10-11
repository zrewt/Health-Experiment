import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { analyzeExperiment, assessFeasibility, generateSchedule, getVerdict, randomizedBlockSpace, seededRandom } from '../src/engine';
import type { DayRecord, ExperimentDefinition, GatePolicy } from '../src/engine';
import { selectBlockLength, selectGatePolicy } from './simulation-v3-selection';

const RUNS = 500, DRAWS = 299;
const ROOT = 'reports/caffeine-simulation-v3';
const POLICIES: GatePolicy[] = ['A', 'B', 'C'];
const DURATIONS = [42, 56, 70, 84], EFFECTS = [0, .25, .5, .75, 1, 1.5];
const PROTOCOL = 'v3-500x299-standardized-analytic-AR-balanced-sign-v1';
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const enginePaths = readdirSync('src/engine').filter(p => p.endsWith('.ts')).sort().map(p => `src/engine/${p}`);
const engineHash = hash(enginePaths.map(p => readFileSync(p, 'utf8')).join('\n'));
const protocolHash = hash(readFileSync(`${ROOT}-protocol.md`));
const sourceHash = hash(readFileSync('scripts/simulate-engine-v3.ts', 'utf8') + readFileSync('scripts/simulation-v3-selection.ts', 'utf8'));
const baseline = { mean: 420, sd: 45, lag1Autocorrelation: .4 };
const retention = .9 * .98 * .99;
interface Cell { index: number; duration: number; effectSd: number; adherence: number; contamination: number; blockLength: 2 | 3 }
interface PolicySummary {
  supported: number; inconclusive: number; noEffect: number;
  estimateSumSupported: number; conservativeSumSupported: number; highRiskSupported: number;
  understated: number; understatedUnknown: number;
}
interface Summary {
  runs: number; seconds: number; dataSeedBase: number; scheduleSeedBase: number; analysisSeedBase: number;
  target: number; estimateSum: number; estimateCount: number; covered: number; available: number;
  conservativeSum: number; switches: number; allocations: string;
  feasibilityPower: number; mde70: number; se: number;
  policies: Record<GatePolicy, PolicySummary>;
}
interface Result { cell: Cell; summary: Summary }
interface Checkpoint { protocol: string; engineHash: string; protocolHash: string; sourceHash: string; selectionHash?: string; results: Result[] }
interface Selection {
  protocol: string; engineHash: string; protocolHash: string; sourceHash: string;
  blockLength: 2 | 3; gatePolicy: GatePolicy | null;
  designScores: { blockLength: number; detection: number; coverage: number }[];
  policyScores: { policy: GatePolicy; detection: number; pooledNullFpr: number; worstNullFpr: number }[];
  rules: string;
}
function save(path: string, data: unknown): void { writeFileSync(path, JSON.stringify(data, null, 2) + '\n'); }
function checkHistory(): void {
  const history = JSON.parse(readFileSync(`${ROOT}-history.json`, 'utf8')) as { path: string; sha256: string }[];
  for (const file of history) if (hash(readFileSync(file.path)) !== file.sha256) throw new Error(`Historical artifact changed: ${file.path}`);
}
function plannedCells(): Cell[] {
  const cells: Cell[] = [];
  let index = 0;
  for (const duration of DURATIONS) for (const effectSd of EFFECTS) for (const pair of [{ adherence: .9, contamination: .1 }, { adherence: 1, contamination: 0 }]) {
    for (const blockLength of [2, 3] as const) cells.push({ index, duration, effectSd, ...pair, blockLength });
    index++;
  }
  return cells;
}
function validateSeedDomains(): void {
  // Check all earlier explicitly specified engine streams (including v1/v2 XOR
  // derivatives), not just the advertised data ranges. Repeated seeds within
  // paired v3 comparisons are intentional; tuning vs held-out never overlaps.
  const old = new Set<number>();
  const addOld = (data: number, schedule: number, analysis: number) => {
    for (const s of [data, schedule, analysis, (analysis ^ 0x9e3779b9) >>> 0, (analysis ^ 0x85ebca6b) >>> 0, (analysis ^ 0x3c6ef35f) >>> 0]) old.add(s);
  };
  for (const effect of [0, 15, 30, 45]) for (const adherence of [.6, .8, 1]) for (let r = 0; r < 1000; r++) {
    const s = 20261008 + effect * 100000 + Math.round(adherence * 100) * 1000 + r;
    addOld(s, (s ^ 0xdeadbeef) >>> 0, (s ^ 0xa5a5a5a5) >>> 0);
  }
  const tuning = JSON.parse(readFileSync('reports/caffeine-simulation-v2-tuning.json', 'utf8'));
  const heldout = JSON.parse(readFileSync('reports/caffeine-simulation-v2-data.json', 'utf8'));
  for (const row of [...tuning.rows, ...heldout.results]) for (let r = 0; r < row.summary.runs; r++) {
    const s = row.summary.seedBase + r;
    addOld(s, (s ^ 0xcafe1234) >>> 0, (s ^ 0x09b43e12) >>> 0);
  }
  // V2 benchmark used additional tuning seeds, not reported final cells.
  for (let r = 0; r < 50; r++) {
    const s = 10010000 + r;
    addOld(s, (s ^ 0xcafe1234) >>> 0, (s ^ 0x09b43e12) >>> 0);
  }
  const used = new Set<number>();
  for (const partition of ['tuning', 'heldout']) for (let j = 0; j < 48; j++) for (let r = 0; r < RUNS; r++) {
    const base = partition === 'tuning' ? 30000000 : 40000000;
    const a = base + 2000000 + 1000 * j + r;
    for (const s of [base + 1000 * j + r, base + 1000000 + 1000 * j + r, a, (a ^ 0x9e3779b9) >>> 0, (a ^ 0x85ebca6b) >>> 0]) {
      if (old.has(s) || used.has(s)) throw new Error(`Seed collision with earlier stream or v3 partition: ${s}`);
      used.add(s);
    }
  }
}
function normal(random: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random()))) * Math.cos(2 * Math.PI * random());
}
function runCell(cell: Cell, partition: 'tuning' | 'heldout', runs = RUNS): Summary {
  const start = performance.now();
  const base = partition === 'tuning' ? 30000000 : 40000000;
  const dataSeedBase = base + cell.index * 1000, scheduleSeedBase = dataSeedBase + 1000000, analysisSeedBase = dataSeedBase + 2000000;
  const effect = cell.effectSd * baseline.sd;
  const target = effect * (cell.adherence - cell.contamination);
  const design = { type: 'randomized-blocks', blockLength: cell.blockLength, balanceWeekends: true } as const;
  const planning = assessFeasibility({ ...baseline, duration: cell.duration, design, startDate: '2026-01-01', observedEffect: target, outcomeRetention: retention });
  const summary: Summary = {
    runs, seconds: 0, dataSeedBase, scheduleSeedBase, analysisSeedBase, target,
    estimateSum: 0, estimateCount: 0, covered: 0, available: 0, conservativeSum: 0, switches: 0,
    allocations: randomizedBlockSpace('2026-01-01', cell.duration, cell.blockLength, true).count.toString(),
    feasibilityPower: planning.approximatePower!, mde70: planning.minimumDetectableEffect70 as number, se: planning.standardError!,
    policies: Object.fromEntries(POLICIES.map(policy => [policy, { supported: 0, inconclusive: 0, noEffect: 0, estimateSumSupported: 0,
      conservativeSumSupported: 0, highRiskSupported: 0, understated: 0, understatedUnknown: 0 }])) as Record<GatePolicy, PolicySummary>,
  };
  for (let r = 0; r < runs; r++) {
    const random = seededRandom(dataSeedBase + r);
    const definition: ExperimentDefinition = { name: 'Caffeine cutoff v3', startDate: '2026-01-01', lengthDays: cell.duration,
      design, seed: scheduleSeedBase + r, outcomeMetric: 'sleepMinutes', conditionRule: { type: 'caffeine-cutoff', cutoffTime: '12:00' } };
    const schedule = generateSchedule(definition.startDate, cell.duration, design, definition.seed);
    summary.switches += schedule.slice(1).filter((d, j) => d.condition !== schedule[j].condition).length;
    let noise = baseline.sd * normal(random);
    const records: DayRecord[] = schedule.map(day => {
      noise = .4 * noise + baseline.sd * Math.sqrt(1 - .4 ** 2) * normal(random);
      const exposed = random() < (day.condition === 'intervention' ? cell.adherence : cell.contamination);
      const noCaffeine = exposed && random() < .1;
      const unknown = random() < .05, missing = random() < .1, illness = random() < .02, travel = random() < .01;
      return {
        date: day.date, assignedCondition: day.condition,
        exposure: { lastCaffeineTime: unknown || noCaffeine ? null : exposed ? '11:30' : '15:30', servings: unknown ? null : noCaffeine ? 0 : 2 },
        covariates: { alcohol: random() < .15, illness, travel, lateWorkout: random() < .1 },
        outcome: { sleepMinutes: missing ? null : 420 + effect * Number(exposed) + noise, hrvMs: null }, exclusionReason: null,
      };
    });
    const analysis = analyzeExperiment(definition, records, {
      permutations: DRAWS, bootstrapSamples: DRAWS, bootstrapMethod: 'studentized', bootstrapBlockLength: 5,
      seed: analysisSeedBase + r, baseline,
    });
    if ('complier' in analysis) throw new Error('Default result unexpectedly includes experimental complier.');
    if (analysis.primary.difference !== null) { summary.estimateSum += analysis.primary.difference; summary.estimateCount++; }
    if (analysis.primary.interval95) {
      summary.available++;
      if (analysis.primary.interval95[0] <= target && analysis.primary.interval95[1] >= target) summary.covered++;
      summary.conservativeSum += analysis.primary.conservative_estimate!;
    }
    for (const gatePolicy of POLICIES) {
      const verdict = getVerdict(analysis, { gatePolicy });
      const p = summary.policies[gatePolicy];
      if (verdict.effect_likely_understated === true) p.understated++;
      if (verdict.effect_likely_understated === null) p.understatedUnknown++;
      if (verdict.status === 'SUPPORTED') {
        p.supported++; p.estimateSumSupported += analysis.primary.difference!;
        p.conservativeSumSupported += verdict.conservative_estimate!;
        if (verdict.inflation_risk === 'high') p.highRiskSupported++;
      } else if (verdict.status === 'INCONCLUSIVE') p.inconclusive++;
      else p.noEffect++;
    }
  }
  summary.seconds = (performance.now() - start) / 1000;
  return summary;
}
function matching(data: { protocol: string; engineHash: string; protocolHash: string; sourceHash: string }): boolean {
  return data.protocol === PROTOCOL && data.engineHash === engineHash && data.protocolHash === protocolHash && data.sourceHash === sourceHash;
}
function loadCheckpoint(partition: 'tuning' | 'heldout', selection?: Selection): Checkpoint {
  const path = `${ROOT}-${partition}.json`;
  const data: Checkpoint = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { protocol: PROTOCOL, engineHash, protocolHash, sourceHash, results: [], ...(selection ? { selectionHash: hash(JSON.stringify(selection)) } : {}) };
  if (!matching(data) || (selection && data.selectionHash !== hash(JSON.stringify(selection)))) throw new Error('Checkpoint/source mismatch: preserve results and start a NEW protocol with new seeds, not a held-out retune.');
  return data;
}
function pool(rows: Result[], policy: GatePolicy) {
  const runs = rows.reduce((s, r) => s + r.summary.runs, 0);
  return { runs, detection: rows.reduce((s, r) => s + r.summary.policies[policy].supported, 0) / runs,
    coverage: rows.reduce((s, r) => s + r.summary.covered, 0) / runs };
}
function freezeSelection(tuning: Checkpoint): Selection {
  if (tuning.results.length !== plannedCells().length) throw new Error('Tuning incomplete.');
  const designScores = [2, 3].map(blockLength => ({ blockLength,
    detection: pool(tuning.results.filter(r => r.cell.blockLength === blockLength && r.cell.effectSd > 0), 'A').detection,
    coverage: pool(tuning.results.filter(r => r.cell.blockLength === blockLength), 'A').coverage }));
  const blockLength = selectBlockLength(designScores[0], designScores[1]);
  const selected = tuning.results.filter(r => r.cell.blockLength === blockLength);
  const nulls = selected.filter(r => r.cell.effectSd === 0);
  const policyScores = POLICIES.map(policy => ({ policy,
    detection: pool(selected.filter(r => r.cell.effectSd > 0), policy).detection,
    pooledNullFpr: pool(nulls, policy).detection,
    worstNullFpr: Math.max(...nulls.map(r => r.summary.policies[policy].supported / r.summary.runs)) }));
  const selection: Selection = { protocol: PROTOCOL, engineHash, protocolHash, sourceHash, blockLength,
    gatePolicy: selectGatePolicy(policyScores), designScores, policyScores,
    rules: '2-day iff A non-null detection gain >=.03 and all-cell coverage loss <=.01; otherwise3. Then highest non-null policy detection subject to pooled null FPR<=.05 and worst null cell<=.07; ties A,B,C; none eligible=>null.' };
  save(`${ROOT}-selection.json`, selection);
  return selection;
}
function loadSelection(): Selection {
  const selection = JSON.parse(readFileSync(`${ROOT}-selection.json`, 'utf8')) as Selection;
  if (!matching(selection)) throw new Error('Frozen selection/source mismatch; do not reuse held-out seeds for a revised engine.');
  return selection;
}
function runPartition(partition: 'tuning' | 'heldout', selection?: Selection): Checkpoint {
  const checkpoint = loadCheckpoint(partition, selection);
  const planned = plannedCells();
  for (const cell of planned) {
    if (checkpoint.results.some(r => r.cell.index === cell.index && r.cell.blockLength === cell.blockLength)) continue;
    const summary = runCell(cell, partition);
    checkpoint.results.push({ cell, summary });
    save(`${ROOT}-${partition}.json`, checkpoint);
    if (selection) writeReport(loadCheckpoint('tuning'), checkpoint, selection);
    console.log(`${partition.toUpperCase()} ${checkpoint.results.length}/${planned.length}: ${cell.duration}d ${cell.effectSd}SD ${cell.adherence}/${cell.contamination} blocks=${cell.blockLength} B detection=${percent(summary.policies.B.supported / RUNS)} coverage=${percent(summary.covered / RUNS)} (${summary.seconds.toFixed(1)}s)`);
  }
  return checkpoint;
}
const percent = (rate: number) => `${(100 * rate).toFixed(1)}%`;
const number = (value: number | null) => value === null || !Number.isFinite(value) ? '—' : value.toFixed(2);
function writeReport(tuning: Checkpoint, heldout: Checkpoint, selection: Selection): void {
  const all = heldout.results, chosen = all.filter(r => r.cell.blockLength === selection.blockLength);
  const sections: string[] = [];
  const summarize = (rows: Result[], policy: GatePolicy) => {
    const nulls = rows.filter(r => r.cell.effectSd === 0), positive = rows.filter(r => r.cell.effectSd > 0);
    return `| ${policy} | ${percent(pool(positive, policy).detection)} | ${percent(pool(nulls, policy).detection)} | ${percent(Math.max(...nulls.map(r => r.summary.policies[policy].supported / r.summary.runs)))} |`;
  };
  sections.push(`# Caffeine engine simulation report v3\n\n${all.length === 96 ? '**COMPLETE**' : '**PARTIAL CHECKPOINT, NOT FINAL**'}: ${all.length}/96 held-out cells. Preserved [v1](caffeine-simulation.md), [v2](caffeine-simulation-v2.md), and ALL seven historical artifacts byte-for-byte (SHA256 inventory). No app/auth/UI/dependency changes.\n
## Frozen protocol and reproducibility

- [Predeclared protocol](caffeine-simulation-v3-protocol.md), [tuning raw counts](caffeine-simulation-v3-tuning.json), [frozen selection](caffeine-simulation-v3-selection.json), [held-out raw counts](caffeine-simulation-v3-heldout.json).
- TUNING: cell j=0..47, run r=0..499 uses data 30,000,000+1000j+r, schedule31,000,000+1000j+r, analysis32,000,000+1000j+r. Exact occupied ranges per domain extend through 30,047,499 / 31,047,499 / 32,047,499 (gaps500–999 per cell).
- HELD-OUT: corresponding data40,000,000+1000j+r, schedule41,000,000+1000j+r, analysis42,000,000+1000j+r; maxima40,047,499 / 41,047,499 / 42,047,499. Explicit domains and engine-derived stream starts were collision-checked against v1/v2, including v2 benchmark seeds. Designs2/3 share paired explicit streams intentionally; partitions are disjoint.
- Durations42,56,70,84 × effects0,.25,.5,.75,1,1.5SD × adherence/contamination.9/.1 and1/0 × assignment blocks2/3. 500 runs/cell, 48,000 tuning +48,000 held-out analyses; A/B/C verdicts reuse each analysis. Resumable per-cell checkpoints.
- SD45 and AR(1).4, stationary Gaussian noise; direct effects0,11.25,22.5,33.75,45,67.5 minutes. True assigned effect=direct effect×(adherence−contamination). These standardized numbers do not eliminate outcome-specific assumptions: minimum meaningful estimate remains15 units as requested.
- Independent missing outcomes10%, unknown exposure5%, illness2%, travel1%; missing/excluded nights retain calendar positions. Unknown exposure does not contribute to the minimum10 analyzable days/condition. It still contributes observed outcomes to ITT.
- Assignment: equal days AND blocks, minimum weekend/weekday imbalance; shorter residual block pair if necessary. Two-sided constrained plus-one test299 draws (exact enumeration for small spaces). Fixed studentized moving-block interval length5,299 draws, unchanged statistical method from v2. Interval coverage remains approximate.
-28 days is too short for inference regardless of design; fewer than100 admissible block assignments also returns INCONCLUSIVE with that exact reason. No inference-floor override added.
- Selection fixed before held-out: ${selection.rules}
- Frozen assignment selection: **${selection.blockLength}-day blocks**; frozen policy: **${selection.gatePolicy ?? 'NONE QUALIFIED'}**. Both designs and all policies still reported. Library defaults remain3-day scheduling and policyA; selected configuration is explicit, not silently applied after held-out.
- Baseline inputs here are known oracle SD/rho, not noisy seven-day estimates. Feasibility uses an analytic balanced-sign AR(1) Gaussian approximation, no simulation at call time. Its MDE70 includes the15-unit estimate rule but not compliance gates or randomization discreteness. Predicted power includes expected outcome retention .9×.98×.99; display risk uses baseline/planned complete observations and the observed estimate. These are labeled approximations, not guaranteed design power.
- Effect display has estimand, interval95, conservative_estimate=max(0,CI lower bound), inflation_risk=high iff approximate power for observed effect<50%; missing baseline=>unknown. Conservative is a display label, NOT a guaranteed conservative bound when intervals under-cover. Per-protocol remains secondary/non-causal. Complier estimation is now experimental opt-in and absent from default result/verdict.
- Engine SHA256: \`${engineHash}\`; harness SHA256: \`${sourceHash}\`; protocol SHA256: \`${protocolHash}\`.
- All coverage rates use ALL500 runs; unavailable intervals count as noncoverage. Monte Carlo margin about±1.9pp at5%/95% and±4.4pp at50% per cell. Paired design/policy comparisons are not independent.
`);
  sections.push(`## 1. Tuning-only selections\n\n| Assignment days | Pooled A detection, non-null | Pooled coverage, all effects |\n|---:|---:|---:|\n${selection.designScores.map(s => `| ${s.blockLength} | ${percent(s.detection)} | ${percent(s.coverage)} |`).join('\n')}\n\n| Policy | Pooled detection, non-null | Pooled null verdict FPR | Worst null cell FPR |\n|---|---:|---:|---:|\n${selection.policyScores.map(s => `| ${s.policy} | ${percent(s.detection)} | ${percent(s.pooledNullFpr)} | ${percent(s.worstNullFpr)} |`).join('\n')}\n\nA: hard85%/15%; B: label-only (no adherence/contamination gate, never an exposure-effect claim); C: hard75%/25%. All retain sample-size, estimate>=15, positive interval lower bound and p<=.05.\n`);
  const tuningDesign = DURATIONS.flatMap(duration => [2, 3].map(blockLength => {
    const rows = tuning.results.filter(r => r.cell.duration === duration && r.cell.blockLength === blockLength);
    const positive = rows.filter(r => r.cell.effectSd > 0), runs = rows.reduce((s, r) => s + r.summary.runs, 0);
    return `| ${duration} | ${blockLength} | ${percent(pool(positive, 'A').detection)} | ${percent(pool(positive, 'B').detection)} | ${percent(pool(rows, 'A').coverage)} | ${(rows.reduce((s, r) => s + r.summary.switches, 0) / runs).toFixed(1)} | ${rows[0].summary.allocations} |`;
  }));
  sections.push(`### Tuning design power, coverage, switches and exact allocations\n\n| Days | Assignment length | A detection | B detection | Coverage | Mean condition switches | Admissible allocations |\n|---:|---:|---:|---:|---:|---:|---:|\n${tuningDesign.join('\n')}\n`);
  sections.push(`## 2. Held-out comparison (not used to reselect)\n\nSelected ${selection.blockLength}-day design:\n\n| Policy | Pooled non-null detection | Pooled null verdict FPR | Worst null cell FPR |\n|---|---:|---:|---:|\n${POLICIES.map(p => summarize(chosen, p)).join('\n')}\n`);
  for (const blockLength of [2, 3]) {
    const rows = all.filter(r => r.cell.blockLength === blockLength);
    const covered = rows.reduce((s, r) => s + r.summary.covered, 0), runs = rows.reduce((s, r) => s + r.summary.runs, 0);
    const range = rows.map(r => r.summary.covered / r.summary.runs);
    sections.push(`- ${blockLength}-day assignment: pooled95%-interval coverage **${percent(covered / runs)}**, cell range${percent(Math.min(...range))}–${percent(Math.max(...range))}; ${rows.reduce((s, r) => s + r.summary.available, 0)}/${runs} available. Coverage below95% is undercalibration, not repaired using these held-out seeds.`);
  }
  const rows = all.flatMap(({ cell: c, summary: s }) => POLICIES.map(policy => {
    const p = s.policies[policy];
    return `| ${c.blockLength} | ${c.duration} | ${c.effectSd} | ${c.adherence}/${c.contamination} | ${policy} | ${number(s.target)} | ${percent(p.supported / s.runs)} | ${percent(p.inconclusive / s.runs)} | ${percent(s.covered / s.runs)} | ${number(p.supported ? p.estimateSumSupported / p.supported : null)} | ${number(p.supported ? p.conservativeSumSupported / p.supported : null)} | ${p.highRiskSupported}/${p.supported} |`;
  }));
  sections.push(`## 3. Full held-out standardized-effect grid\n\nNull SUPPORTED is verdict FPR. Mean/reported estimates and conservative displays below condition on SUPPORTED; see unconditional ratios in section5. Selected design/policy do not alter the other rows.\n\n| Assignment length | Days | True effect /SD | Adh/contam | Policy | Assigned target | SUPPORTED | INCONCLUSIVE | CI coverage | Mean estimate when SUPPORTED | Mean conservative when SUPPORTED | High inflation flag / SUPPORTED |\n|---:|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n`);
  const errors = all.map(r => ({ ...r, error: r.summary.feasibilityPower - r.summary.policies.B.supported / r.summary.runs }));
  const maxError = Math.max(...errors.map(r => Math.abs(r.error)));
  const mae = errors.reduce((s, r) => s + Math.abs(r.error), 0) / errors.length;
  const flagged = errors.filter(r => Math.abs(r.error) > .1);
  sections.push(`## 4. Feasibility validation — approximation, not a calibrated promise\n\nAgainst policyB (which matches omission of adherence gates), mean absolute power error **${percent(mae)}**, maximum **${percent(maxError)}**; **${flagged.length}/${errors.length} cells** exceed the predeclared10pp gross-inaccuracy threshold. Oracle baseline SD/rho means real seven-day run-in predictions can be less reliable. No formula was refit. A/C add gates absent from the approximation and must not be presented as predicted verdict power.\n\n| Assignment length | Days | Effect /SD | Adh/contam | Approximate MDE70 | Analytic power | Observed B detection | Prediction minus observed, pp | Observed A | Observed C |\n|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|\n${errors.map(({ cell: c, summary: s, error }) => `| ${c.blockLength} | ${c.duration} | ${c.effectSd} | ${c.adherence}/${c.contamination} | ${number(s.mde70)} | ${percent(s.feasibilityPower)} | ${percent(s.policies.B.supported / s.runs)} | ${(100 * error).toFixed(1)}${Math.abs(error) > .1 ? ' **WRONG >10pp**' : ''} | ${percent(s.policies.A.supported / s.runs)} | ${percent(s.policies.C.supported / s.runs)} |`).join('\n')}\n`);
  const bands = [{ name: '<20%', lo: 0, hi: .2 }, { name: '20–49%', lo: .2, hi: .5 }, { name: '50–69%', lo: .5, hi: .7 }, { name: '>=70%', lo: .7, hi: 1.01 }];
  const inflationRows: string[] = [];
  for (const blockLength of [2, 3]) for (const band of bands) for (const policy of POLICIES) {
    const bandRows = all.filter(r => r.cell.blockLength === blockLength && r.summary.target > 0 && r.summary.policies.B.supported / r.summary.runs >= band.lo && r.summary.policies.B.supported / r.summary.runs < band.hi);
    const sum = (fn: (r: Result) => number) => bandRows.reduce((s, r) => s + fn(r), 0);
    const supportedDenom = sum(r => r.summary.target * r.summary.policies[policy].supported);
    const allDenom = sum(r => r.summary.target * r.summary.estimateCount);
    const availableDenom = sum(r => r.summary.target * r.summary.available);
    inflationRows.push(`| ${blockLength} | ${band.name} | ${policy} | ${bandRows.length} | ${sum(r => r.summary.policies[policy].supported)} | ${number(supportedDenom ? sum(r => r.summary.policies[policy].estimateSumSupported) / supportedDenom : null)} | ${number(supportedDenom ? sum(r => r.summary.policies[policy].conservativeSumSupported) / supportedDenom : null)} | ${number(allDenom ? sum(r => r.summary.estimateSum) / allDenom : null)} | ${number(availableDenom ? sum(r => r.summary.conservativeSum) / availableDenom : null)} |`);
  }
  sections.push(`## 5. Reported-effect inflation by empirical design-power band\n\nBands use each cell's measured policyB positive detection, not noisy observed-effect feasibility flags. Null cells excluded (ratio undefined). Pooled ratio = sum of estimate / sum of matching true assigned effect over corresponding experiments; target-weighted, not an unweighted average of cell ratios. Reported means condition on SUPPORTED, whereas all-experiment means diagnose unconditional bias. Conservative lower-bound ratios are not guaranteed to be below1.\n\n| Assignment length | B power band | Policy | Non-null cells | SUPPORTED runs | Reported point / true assigned | Reported conservative / true assigned | All point / true assigned | All available conservative / true assigned |\n|---:|---|---|---:|---:|---:|---:|---:|---:|\n${inflationRows.join('\n')}\n\n**Important display limitation:** selecting on a large observed estimate can itself make its plug-in power exceed50% and suppress the high-risk flag, even in a genuinely underpowered design. This observed-effect flag is the requested heuristic, not a validated correction for selection inflation. The simulation retains high-risk counts among SUPPORTED and plainly reports this failure mode.\n`);
  const powerRows: string[] = [];
  for (const effectSd of EFFECTS.filter(e => e > 0)) for (const adherence of [.9, 1]) for (const policy of POLICIES) {
    const sequence = chosen.filter(r => r.cell.effectSd === effectSd && r.cell.adherence === adherence).sort((a, b) => a.cell.duration - b.cell.duration);
    const crossing = sequence.findIndex(r => r.summary.policies[policy].supported / r.summary.runs >= .7);
    let needed = '>84; not established in tested grid';
    if (crossing === 0) needed = '≤42 (first tested duration)';
    else if (crossing > 0) {
      const low = sequence[crossing - 1], high = sequence[crossing];
      const lowP = low.summary.policies[policy].supported / RUNS, highP = high.summary.policies[policy].supported / RUNS;
      needed = `~${Math.round(low.cell.duration + (.7 - lowP) / (highP - lowP) * (high.cell.duration - low.cell.duration))}; measured bracket ${low.cell.duration}–${high.cell.duration}`;
    }
    powerRows.push(`| ${effectSd} | ${adherence}/${adherence === .9 ? .1 : 0} | ${policy} | ${sequence.map(r => percent(r.summary.policies[policy].supported / r.summary.runs)).join(' / ')} | ${needed} |`);
  }
  sections.push(`## 6. Where70% detection is actually reached\n\nSelected ${selection.blockLength}-day assignment. No extrapolated day counts; interpolate only a measured crossing.70% at a500-run cell has roughly±4pp sampling error. Effects below15 assigned units can fail the minimum-estimate gate even with long follow-up.\n\n| True effect /SD | Adh/contam | Policy | Detection42 /56 /70 /84 days | Days for70% |\n|---:|---|---|---|---|\n${powerRows.join('\n')}\n`);
  const tuningSec = tuning.results.reduce((s, r) => s + r.summary.seconds, 0), heldoutSec = all.reduce((s, r) => s + r.summary.seconds, 0);
  sections.push(`## 7. Open questions and proposed fixes — NOT applied\n
- Primary intervals still need a separate calibration protocol if coverage misses95%; compare residual/bootstrap or design-aware inverted confidence sets using NEW seed domains. A calibrated verdict FPR does not validate interval coverage.
- Feasibility error above10pp is explicitly flagged. The balanced-sign approximation ignores weekend-constrained assignment covariances, effect-dependent exposure variance, bootstrap/randomization finite samples and adherence gates. Consider exact analytic design covariance and separate planned-vs-observed power definitions, validated on new seeds; do not adjust this formula to this held-out table.
- The observed-effect inflation flag can miss winner's-curse risk: a selected large estimate appears high-power by construction. Should risk instead use a pre-experiment target effect and planned design power? Do not silently replace the requested heuristic now.
- Label-only policyB describes assignment, not exposure efficacy. Its effect_likely_understated flag assumes noncompliance attenuates benefit; it is not a causal correction. Realized known-exposure adherence/contamination accompany every verdict, unknown stays null.
- Outcome standardization does not remove the15-unit meaningful-effect rule or missingness assumptions; other metrics need their own meaningful-effect units before use.
-84 days may still be inadequate for smaller effects, especially under hard gates. Report bounds rather than pretending70% was reached.28-day descriptive outputs must never be marketed as supported inference.
- Run-in SD/rho uncertainty and informative missingness remain untested. The baseline mean has no variance role for a mean difference; seven run-in days cannot establish a reliable population autocorrelation.
- Experimental complier tests remain, but the estimator is deliberately absent from this revision's default inference and simulation outcome. Its poor v2 coverage remains preserved, not erased.

## Run and verification

\`npx --no-install tsx --test scripts/engine.test.ts scripts/engine-v2.test.ts scripts/engine-v3.test.ts\`\n
\`npx --no-install tsc --noEmit -p tsconfig.engine.json\`\n
\`npm run typecheck && npm run lint\`\n
\`npx --no-install tsx scripts/simulate-engine-v3.ts --phase full\`\n
Matching artifacts resume missing cells only; no held-out retuning. \`--phase report\` reconstructs the report. Historical v2 harness now explicitly imports the opt-in estimator for source compatibility; its generated files are unchanged, and its hash guard rejects recomputation with the revised engine. For a reproducible fresh v3 repeat use unchanged sources in a clean directory with protocol/history and v1/v2 artifacts but no generated v3 tuning/selection/held-out files. Future statistical revisions require new seeds and a new protocol.

Measured tuning${tuningSec.toFixed(1)}s + held-out${heldoutSec.toFixed(1)}s = **${(tuningSec + heldoutSec).toFixed(1)}s (${((tuningSec + heldoutSec) / 60).toFixed(2)}min)**, measured cell-analysis runtime (startup/report I/O excluded). ${tuningSec + heldoutSec <= 1200 ? 'Within the requested ~20-minute budget.' : '**EXCEEDS requested ~20-minute budget; not hidden.**'}
`);
  writeFileSync(`${ROOT}.md`, sections.join('\n\n') + '\n');
}
mkdirSync('reports', { recursive: true });
checkHistory();
validateSeedDomains();
const phaseIndex = process.argv.indexOf('--phase');
const phase = phaseIndex < 0 ? 'full' : process.argv[phaseIndex + 1];
if (phase === 'benchmark') {
  const summary = runCell({ index: 0, duration: 84, effectSd: .75, adherence: .9, contamination: .1, blockLength: 2 }, 'tuning', 20);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Rough max-duration projection: ${(summary.seconds / 20 * 96000 / 60).toFixed(1)}min.`);
} else if (phase === 'report') writeReport(loadCheckpoint('tuning'), loadCheckpoint('heldout', loadSelection()), loadSelection());
else if (phase === 'tuning') {
  if (existsSync(`${ROOT}-heldout.json`) || existsSync(`${ROOT}-selection.json`)) throw new Error('Selection already frozen: do not retune on these seeds.');
  const selection = freezeSelection(runPartition('tuning'));
  console.log('FROZEN', JSON.stringify(selection));
} else if (phase === 'heldout') {
  const selection = loadSelection();
  runPartition('heldout', selection);
} else if (phase === 'full') {
  const selection = existsSync(`${ROOT}-selection.json`) ? loadSelection() : freezeSelection(runPartition('tuning'));
  console.log(`FROZEN: blocks${selection.blockLength}, policy${selection.gatePolicy}; beginning held-out with no re-selection.`);
  const heldout = runPartition('heldout', selection);
  writeReport(loadCheckpoint('tuning'), heldout, selection);
  checkHistory();
  console.log(`Complete: ${ROOT}.md; 96/96 cells, history preserved.`);
} else throw new Error('Use --phase full, tuning, heldout, report or benchmark.');
