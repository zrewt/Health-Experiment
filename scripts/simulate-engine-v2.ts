import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { analyzeExperiment, generateSchedule, getVerdict, isWeekend, randomizedBlockSpace, seededRandom } from '../src/engine';
import { analyzeExperimentalComplier } from '../src/engine/experimental-complier';
import type { DayRecord, ExperimentDefinition } from '../src/engine';

type Method = 'percentile' | 'studentized';
interface Options {
  duration: number; effect: number; adherence: number; contamination: number;
  weekend?: number; trend?: number; carryover?: number; rho?: number; sd?: number;
  method?: Method; bootstrapLength?: number; assignmentLength?: number;
}
interface Cell {
  id: string; group: 'core' | 'sensitivity' | 'block-length'; label: string;
  options: Options; seedBase: number;
}
interface Summary {
  runs: number; seedBase: number; seconds: number; target: number;
  meanEstimate: number | null; supported: number; rejected: number; inconclusive: number;
  covered: number; available: number; complierCovered: number; complierAvailable: number;
  weakInstrument: number; unstableComplier: number; supportedMean: number | null;
  meanComplier: number | null; sizeUncertain: number; gateFailures: number;
}
interface TuningRow { method: Method; length: number; duration: number; summary: Summary }
interface Selection {
  protocol: string; engineHash: string; runs: number; samples: number;
  method: Method; length: number; rows: TuningRow[]; seconds: number;
  selectionRule: string;
}
interface Checkpoint {
  protocol: string; engineHash: string; selectionHash: string;
  results: { cell: Cell; summary: Summary }[];
}
const RUNS = 500, RESAMPLES = 299;
const PROTOCOL = 'v2-balanced-residual-pairs-hac-t-joint-stratified-blocks-500x299-v1';
const selectionPath = 'reports/caffeine-simulation-v2-tuning.json';
const checkpointPath = 'reports/caffeine-simulation-v2-data.json';
const reportPath = 'reports/caffeine-simulation-v2.md';
const selectionRule = 'Minimize absolute pooled tuning coverage minus 95%; tie: length 3, then 2, then 5, then studentized. All candidates use the same paired tuning datasets; no held-out data enters selection.';
const engineFiles = ['types', 'schedule', 'adherence', 'analysis', 'verdict'].map(name => `src/engine/${name}.ts`);
const hash = (data: string) => createHash('sha256').update(data).digest('hex');
const engineHash = hash(engineFiles.map(path => readFileSync(path, 'utf8')).join('\n'));
mkdirSync('reports', { recursive: true });
function save(path: string, data: unknown): void { writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`); }
function normal(random: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random()))) * Math.cos(2 * Math.PI * random());
}

function runSimulation(options: Options, runs: number, seedBase: number): Summary {
  const start = performance.now();
  let supported = 0, rejected = 0, inconclusive = 0, covered = 0, available = 0;
  let complierCovered = 0, complierAvailable = 0, weakInstrument = 0, unstableComplier = 0;
  let estimateSum = 0, estimated = 0, supportedSum = 0, complierSum = 0, complierEstimated = 0;
  let sizeUncertain = 0, gateFailures = 0, targetSum = 0;
  const rho = options.rho ?? 0.4, sd = options.sd ?? 45;
  for (let r = 0; r < runs; r++) {
    const seed = seedBase + r, random = seededRandom(seed);
    const definition: ExperimentDefinition = {
      name: 'Caffeine cutoff v2', startDate: '2026-01-01', lengthDays: options.duration,
      design: { type: 'randomized-blocks', blockLength: options.assignmentLength ?? 3, balanceWeekends: true },
      seed: (seed ^ 0xcafe1234) >>> 0,
      outcomeMetric: 'sleepMinutes', conditionRule: { type: 'caffeine-cutoff', cutoffTime: '12:00' },
    };
    const schedule = generateSchedule(definition.startDate, definition.lengthDays, definition.design, definition.seed);
    let noise = sd * normal(random), previousExposure = random() < options.contamination;
    let expectedI = 0, expectedC = 0, ni = 0, nc = 0;
    const records: DayRecord[] = schedule.map((day, j) => {
      noise = rho * noise + sd * Math.sqrt(1 - rho * rho) * normal(random);
      const intervention = day.condition === 'intervention';
      const exposureProbability = intervention ? options.adherence : options.contamination;
      const exposed = random() < exposureProbability;
      const noCaffeine = exposed && random() < 0.1;
      const exposureMissing = random() < 0.05, outcomeMissing = random() < 0.1;
      const illness = random() < 0.02, travel = random() < 0.01;
      const carryover = options.carryover ?? 0;
      const prevProbability = j === 0 ? options.contamination : schedule[j - 1].condition === 'intervention' ? options.adherence : options.contamination;
      // Target averages out exposure/noise, conditional on this randomized schedule.
      // Weekend/trend are nuisance signals, NOT part of the causal assignment effect.
      // Carryover's assignment-mediated component is part of the assignment contrast.
      const expectedEffect = options.effect * (exposureProbability + carryover * prevProbability);
      if (intervention) { expectedI += expectedEffect; ni++; }
      else { expectedC += expectedEffect; nc++; }
      const value = 420 + options.effect * Number(exposed) + carryover * options.effect * Number(previousExposure)
        + (isWeekend(day.date) ? options.weekend ?? 0 : 0)
        + (options.trend ?? 0) * j / (options.duration - 1) + noise;
      previousExposure = exposed;
      return {
        date: day.date, assignedCondition: day.condition,
        exposure: { lastCaffeineTime: exposureMissing || noCaffeine ? null : exposed ? '11:30' : '15:30', servings: exposureMissing ? null : noCaffeine ? 0 : 2 },
        covariates: { alcohol: random() < 0.15, illness, travel, lateWorkout: random() < 0.1 },
        outcome: { sleepMinutes: outcomeMissing ? null : value, hrvMs: null }, exclusionReason: null,
      };
    });
    const target = expectedI / ni - expectedC / nc;
    targetSum += target;
    const analysis = analyzeExperiment(definition, records, {
      permutations: RESAMPLES, bootstrapSamples: RESAMPLES,
      bootstrapMethod: options.method ?? 'studentized', bootstrapBlockLength: options.bootstrapLength ?? 3,
      seed: (seed ^ 0x09b43e12) >>> 0,
    });
    const verdict = getVerdict(analysis);
    if (analysis.primary.difference !== null) { estimateSum += analysis.primary.difference; estimated++; }
    if (verdict.status === 'SUPPORTED') {
      supported++; supportedSum += analysis.primary.difference!;
      if (verdict.size_uncertain) sizeUncertain++;
    }
    if (verdict.status === 'INCONCLUSIVE') inconclusive++;
    if (analysis.primary.pValue !== null && analysis.primary.pValue <= 0.05) rejected++;
    const interval = analysis.primary.interval95;
    if (interval) { available++; if (interval[0] <= target && interval[1] >= target) covered++; }
    const complier = analyzeExperimentalComplier(definition, records, {
      permutations: RESAMPLES, bootstrapSamples: RESAMPLES,
      bootstrapBlockLength: options.bootstrapLength ?? 3,
      seed: (seed ^ 0x09b43e12) >>> 0,
    }, analysis);
    if (complier.difference !== null) { complierSum += complier.difference; complierEstimated++; }
    if (complier.weakInstrument) weakInstrument++;
    else if (!complier.interval95) unstableComplier++;
    if (complier.interval95) {
      complierAvailable++;
      if (complier.interval95[0] <= options.effect && complier.interval95[1] >= options.effect) complierCovered++;
    }
    if (analysis.analyzableDays.control < 10 || analysis.analyzableDays.intervention < 10
      || analysis.adherence.interventionAdherence === null || analysis.adherence.interventionAdherence < 0.85
      || analysis.adherence.controlContamination === null || analysis.adherence.controlContamination > 0.15) gateFailures++;
  }
  return {
    runs, seedBase, seconds: (performance.now() - start) / 1000, target: targetSum / runs,
    meanEstimate: estimated ? estimateSum / estimated : null, supported, rejected, inconclusive, covered, available,
    complierCovered, complierAvailable, weakInstrument, unstableComplier,
    supportedMean: supported ? supportedSum / supported : null,
    meanComplier: complierEstimated ? complierSum / complierEstimated : null, sizeUncertain, gateFailures,
  };
}
function tuning(): Selection {
  if (existsSync(checkpointPath)) throw new Error('Held-out results already exist: do not retune on reported data. Use a new protocol and new seed ranges for future revisions.');
  const start = performance.now(), rows: TuningRow[] = [];
  // Three tuning cells, 500 runs each; methods/lengths use paired datasets.
  for (const method of ['percentile', 'studentized'] as Method[]) for (const length of [2, 3, 5]) for (const duration of [28, 42, 56]) {
    const summary = runSimulation({ duration, effect: 30, adherence: 0.9, contamination: 0.1, method, bootstrapLength: length }, RUNS, 10000000 + [28, 42, 56].indexOf(duration) * 1000);
    rows.push({ method, length, duration, summary });
    console.log(`TUNING ${method} L=${length} ${duration}d coverage=${pct(summary.covered, summary.runs)} (${summary.seconds.toFixed(1)}s)`);
    save('reports/caffeine-simulation-v2-tuning-progress.json', { protocol: PROTOCOL, engineHash, rows });
  }
  const candidates = (['percentile', 'studentized'] as Method[]).flatMap(method => [2, 3, 5].map(length => {
    const subset = rows.filter(r => r.method === method && r.length === length);
    const coverage = subset.reduce((s, r) => s + r.summary.covered, 0) / (RUNS * subset.length);
    return { method, length, error: Math.abs(coverage - 0.95) };
  }));
  candidates.sort((a, b) => a.error - b.error || [3, 2, 5].indexOf(a.length) - [3, 2, 5].indexOf(b.length) || Number(a.method === 'percentile') - Number(b.method === 'percentile'));
  const chosen = candidates[0];
  const selection: Selection = { protocol: PROTOCOL, engineHash, runs: RUNS, samples: RESAMPLES, method: chosen.method, length: chosen.length, rows, seconds: (performance.now() - start) / 1000, selectionRule };
  save(selectionPath, selection);
  console.log(`FROZEN from tuning: ${selection.method}, length=${selection.length}; ${selection.seconds.toFixed(1)} seconds.`);
  return selection;
}
function loadSelection(): Selection {
  const selection = JSON.parse(readFileSync(selectionPath, 'utf8')) as Selection;
  if (selection.protocol !== PROTOCOL || selection.engineHash !== engineHash || selection.runs !== RUNS || selection.samples !== RESAMPLES) throw new Error('Tuning artifact does not match current protocol/engine; do not report mismatched held-out results.');
  return selection;
}
function cells(selection: Selection): Cell[] {
  const result: Cell[] = [];
  const settings = { method: selection.method, bootstrapLength: selection.length };
  for (const duration of [28, 42, 56]) for (const effect of [0, 15, 30, 45]) for (const adherence of [0.8, 0.9, 1]) for (const contamination of [0, 0.1, 0.2]) {
    result.push({ id: `core-${duration}-${effect}-${adherence}-${contamination}`, group: 'core', label: '',
      options: { duration, effect, adherence, contamination, ...settings }, seedBase: 20000000 + result.length * 1000 });
  }
  const base: Options = { duration: 28, effect: 30, adherence: 0.9, contamination: 0.1, ...settings };
  const sensitivity: { label: string; options: Partial<Options> }[] = [
    { label: 'Base: rho .4, SD 45', options: {} },
    { label: 'Weekend +30 minutes', options: { weekend: 30 } },
    { label: 'Trend +10 minutes', options: { trend: 10 } },
    { label: 'Trend -10 minutes', options: { trend: -10 } },
    { label: 'Carryover 25%', options: { carryover: 0.25 } },
    { label: 'AR(1) rho .2', options: { rho: 0.2 } },
    { label: 'AR(1) rho .6', options: { rho: 0.6 } },
    { label: 'Noise SD 35', options: { sd: 35 } },
    { label: 'Noise SD 60', options: { sd: 60 } },
    { label: 'Assignment blocks 2 days', options: { assignmentLength: 2 } },
  ];
  sensitivity.forEach((s, j) => result.push({ id: `sensitivity-${j}`, group: 'sensitivity', label: s.label, options: { ...base, ...s.options }, seedBase: 21000000 }));
  for (const length of [2, 3, 5]) result.push({ id: `length-${length}`, group: 'block-length', label: `${length} nights`, options: { ...base, bootstrapLength: length }, seedBase: 22000000 });
  return result;
}
const pct = (count: number, runs: number) => `${(100 * count / runs).toFixed(1)}%`;
const num = (value: number | null) => value === null ? '—' : value.toFixed(1);
function report(selection: Selection, checkpoint: Checkpoint): void {
  const core = checkpoint.results.filter(r => r.cell.group === 'core');
  const sensitivities = checkpoint.results.filter(r => r.cell.group === 'sensitivity');
  const lengths = checkpoint.results.filter(r => r.cell.group === 'block-length');
  const rows = core.map(({ cell: { options: o }, summary: s }) => `| ${o.duration} | ${o.effect} | ${Math.round(o.adherence * 100)}% | ${Math.round(o.contamination * 100)}% | ${num(s.target)} | ${num(s.meanEstimate)} | ${pct(s.supported, s.runs)} | ${pct(s.rejected, s.runs)} | ${pct(s.inconclusive, s.runs)} | ${pct(s.covered, s.runs)} | ${pct(s.complierCovered, s.runs)} | ${num(s.supportedMean)} | ${s.available}/${s.complierAvailable} |`);
  const tuningRows = selection.rows.map(r => `| ${r.method} | ${r.length} | ${r.duration} | ${pct(r.summary.covered, r.summary.runs)} | ${pct(r.summary.supported, r.summary.runs)} | ${r.summary.available}/${r.summary.runs} |`);
  const simpleRows = (items: typeof core) => items.map(({ cell, summary: s }) => `| ${cell.label} | ${num(s.target)} | ${num(s.meanEstimate)} | ${pct(s.supported, s.runs)} | ${pct(s.rejected, s.runs)} | ${pct(s.inconclusive, s.runs)} | ${pct(s.covered, s.runs)} | ${pct(s.complierCovered, s.runs)} | ${s.complierAvailable}/${s.runs} |`);
  const nullCells = core.filter(r => r.cell.options.effect === 0);
  const aggregate = (items: typeof core, key: 'supported' | 'rejected' | 'covered' | 'complierCovered' | 'inconclusive' | 'gateFailures') => {
    const count = items.reduce((s, r) => s + r.summary[key], 0), runs = items.reduce((s, r) => s + r.summary.runs, 0);
    return { count, runs, rate: count / runs };
  };
  const totalNullTest = aggregate(nullCells, 'rejected'), totalNullVerdict = aggregate(nullCells, 'supported');
  const pooledCoverage = aggregate(core, 'covered'), pooledCace = aggregate(core, 'complierCovered');
  const min = (items: typeof core, key: 'supported' | 'rejected' | 'covered' | 'complierCovered') => Math.min(...items.map(r => 100 * r.summary[key] / r.summary.runs));
  const max = (items: typeof core, key: 'supported' | 'rejected' | 'covered' | 'complierCovered') => Math.max(...items.map(r => 100 * r.summary[key] / r.summary.runs));
  const powerRows: string[] = [];
  for (const adherence of [0.9, 1]) for (const contamination of [0, 0.1]) for (const effect of [15, 30, 45]) {
    const points = core.filter(r => r.cell.options.adherence === adherence && r.cell.options.contamination === contamination && r.cell.options.effect === effect).sort((a, b) => a.cell.options.duration - b.cell.options.duration);
    const crossing = points.findIndex(r => r.summary.supported / r.summary.runs >= 0.7);
    let days = '>56; not established beyond tested durations';
    if (crossing === 0) days = '≤28';
    if (crossing > 0) {
      const lo = points[crossing - 1], hi = points[crossing];
      const fraction = (0.7 - lo.summary.supported / RUNS) / (hi.summary.supported / RUNS - lo.summary.supported / RUNS);
      days = `~${Math.round(lo.cell.options.duration + fraction * (hi.cell.options.duration - lo.cell.options.duration))} (linear interpolation)`;
    }
    powerRows.push(`| ${effect} | ${Math.round(adherence * 100)}% / ${Math.round(contamination * 100)}% | ${points.map(r => pct(r.summary.supported, r.summary.runs)).join(' / ')} | ${days} |`);
  }
  const flags = core.filter(r => r.summary.covered / RUNS < 0.92 || r.summary.covered / RUNS > 0.98);
  const weak = core.reduce((s, r) => s + r.summary.weakInstrument, 0), unstable = core.reduce((s, r) => s + r.summary.unstableComplier, 0);
  const availableCace = core.reduce((s, r) => s + r.summary.complierAvailable, 0);
  const frozenHeldout = core.filter(r => r.cell.options.adherence === 0.9 && r.cell.options.contamination === 0.1);
  const frozenRows = frozenHeldout.map(({ cell, summary: s }) => `| ${cell.options.duration} | ${cell.options.effect} | ${pct(s.supported, RUNS)} | ${pct(s.inconclusive, RUNS)} | ${pct(s.covered, RUNS)} | ${pct(s.complierCovered, RUNS)} | ${num(s.supportedMean)} | ${pct(s.gateFailures, RUNS)} |`);
  const completed = checkpoint.results.length, expected = cells(selection).length;
  const runtime = checkpoint.results.reduce((s, r) => s + r.summary.seconds, 0);
  writeFileSync(reportPath, `# Caffeine engine simulation report v2

## Status and frozen protocol

${completed === expected ? '**Complete:**' : '**PARTIAL CHECKPOINT (not final):**'} ${completed}/${expected} held-out cells. Previous report preserved at [caffeine-simulation.md](caffeine-simulation.md).

- Pure TypeScript engine; no React, network, Supabase, AI, or added dependencies. Seeded randomness only.
- **TUNING data seeds:** 10,000,000–10,000,499 (28d), 10,001,000–10,001,499 (42d), 10,002,000–10,002,499 (56d). Six candidate methods/lengths use the same paired datasets: 9,000 analyses, 1,500 unique datasets.
- **HELD-OUT core seeds:** cell j (0–107) uses 20,000,000 + 1,000j through +499. 108 cells = durations 28/42/56 × effects 0/15/30/45 × adherence 80/90/100% × independently varied contamination 0/10/20%. 54,000 analyses.
- **HELD-OUT sensitivity seeds:** 21,000,000–21,000,499, paired across ten one-factor-at-a-time cases (5,000 analyses). **HELD-OUT interval-length seeds:** 22,000,000–22,000,499, paired across lengths 2/3/5 (1,500 analyses). Total full protocol: 69,500 analyses including tuning, 56,500 unique datasets.
- Data seed s derives schedule seed (s XOR 0xcafe1234) and resampling seed (s XOR 0x09b43e12), each uint32. Tuning and held-out data seed streams are disjoint.
- **Selection rule fixed before held-out:** ${selection.selectionRule}
- **Frozen selection for the simulation:** ${selection.method} moving-block bootstrap, length **${selection.length}** nights, passed explicitly as analysis overrides. The engine's pre-existing default interval length remains 3; use \`{ bootstrapMethod: '${selection.method}', bootstrapBlockLength: ${selection.length} }\` to reproduce the selected interval. Held-out length sensitivity below is not a reason to change defaults after reporting. All verdict gates remain 10 observed-outcome/known-exposure days per condition, intervention adherence ≥85%, control contamination ≤15%, estimate ≥15 minutes, positive CI lower bound, p≤.05. No held-out tuning.
- ${RUNS} runs/cell; ${RESAMPLES} bootstrap draws and up to ${RESAMPLES} constrained permutation draws per analysis. Small spaces enumerate exactly. Bootstrap-t uses Bartlett HAC SEs for original and replicate differences. Finite resampling precision is a limitation.
- Assignment uses nominal 3-day randomized blocks, equal counts of blocks AND days, and minimum achievable weekend imbalance. Remainder nights form a shorter equal-length block pair: 28d = 8×3 + 2×2; 42d = 14×3; 56d = 18×3 + 2×1. The 2-day option is tested separately. Odd durations are rejected rather than quietly unbalanced.
- Admissible allocations / smallest TWO-sided p: 28d ${randomizedBlockSpace('2026-01-01', 28).count} / ${(2 / Number(randomizedBlockSpace('2026-01-01', 28).count)).toFixed(5)}; 42d ${randomizedBlockSpace('2026-01-01', 42).count} / ${(2 / Number(randomizedBlockSpace('2026-01-01', 42).count)).toFixed(5)}; 56d ${randomizedBlockSpace('2026-01-01', 56).count} / ${(2 / Number(randomizedBlockSpace('2026-01-01', 56).count)).toFixed(5)}. Complement allocations explain the 2/M floor. The 28-day design warns (<100 allocations).
- Base DGP: sleep 420 + actual-exposure effect + stationary Gaussian AR(1), rho .4, marginal SD 45. Independent unknown exposure 5%, missing outcome 10%, illness 2%, travel 1%. No clipping/zero imputation. Unknown exposure preserves ITT outcomes but cannot satisfy analyzable-day gates. Adherence rates use known, nonexcluded exposures.
- Primary target = true exposure effect × (intervention adherence − control contamination). Carryover target adds the expected previous-exposure contrast conditional on the randomized schedule; weekend and trend are nuisance signals. Complier target is the direct exposure effect; carryover violates its no-interference assumption.
- CACE is secondary: ITT / adherence difference, refused below .5. Outcome and exposure resample jointly in whole assignment blocks, stratified by assigned condition. No near-zero/negative first-stage tail trimming; unstable draws withhold the interval. Per-protocol remains secondary/non-causal.
- All coverage percentages use ALL runs (unavailable intervals count as noncoverage). Availability and weak/unstable rates are retained in JSON, not hidden by conditioning. Mean estimates use non-null estimates only. Detection means SUPPORTED; at effect 0 it is verdict FPR. Test rejection at effect 0 is two-sided test FPR.
- Monte Carlo 95% margin ≈±1.9 percentage points at a 5%/95% rate and ±4.4 at 50% for a 500-run cell. Pooled percentages share scenario differences; sensitivity comparisons are paired.
- Engine SHA256: \`${engineHash}\`. Raw counts, options, exact seeds, times: [data JSON](caffeine-simulation-v2-data.json). Frozen tuning artifact: [tuning JSON](caffeine-simulation-v2-tuning.json).

## 1. Tuning-only comparison

| Method | Moving length | Duration | Assigned-effect coverage | SUPPORTED | CI available |
|---|---:|---:|---:|---:|---:|
${tuningRows.join('\n')}

## 2. Held-out summary and calibration findings

- Pooled null **test FPR: ${pct(totalNullTest.count, totalNullTest.runs)}**; cell range ${min(nullCells, 'rejected').toFixed(1)}–${max(nullCells, 'rejected').toFixed(1)}%. Pooled null **verdict FPR: ${pct(totalNullVerdict.count, totalNullVerdict.runs)}**; cell range ${min(nullCells, 'supported').toFixed(1)}–${max(nullCells, 'supported').toFixed(1)}%.
- **Primary interval undercoverage:** pooled assigned-effect coverage **${pct(pooledCoverage.count, pooledCoverage.runs)}** versus nominal 95%, range ${min(core, 'covered').toFixed(1)}–${max(core, 'covered').toFixed(1)}%. ${flags.length}/${core.length} core cells outside the descriptive 92–98% gross-calibration band. This is NOT a validity claim or an engine threshold.
- **Secondary interval poorly calibrated:** pooled complier coverage **${pct(pooledCace.count, pooledCace.runs)}** (all-run denominator), and **${pct(pooledCace.count, availableCace)} conditional on an available interval** (diagnostic only, not a replacement denominator). ${weak} weak-instrument refusals and ${unstable} unstable/unavailable complier intervals among ${core.length * RUNS} core runs. Choosing the primary interval method does NOT calibrate the secondary ratio interval.
- The requested 85%/15% gates can make SUPPORTED uncommon even for large effects: realized adherence/contamination fluctuate around their population rates. Longer duration cannot overcome a systematically failed gate. See gate-failure rates below.
- SUPPORTED-only mean estimates show selection inflation; compare these with the assigned-effect target, not the larger perfect-exposure effect.
- No numerical findings in this report are hand-entered forecasts. All table values and summary ranges come from persisted run counts. Undercoverage and low detection remain reported, not repaired using held-out data.

### Representative 90% adherence / 10% contamination

| Days | Direct effect | SUPPORTED | INCONCLUSIVE | ITT coverage | CACE coverage | Mean when SUPPORTED | Data/adherence gate failed |
|---:|---:|---:|---:|---:|---:|---:|---:|
${frozenRows.join('\n')}

## 3. Full held-out core grid

ITT/CACE availability column gives counts out of 500 for each interval. Coverage below uses all 500.

| Days | Direct effect | Int adh | Ctrl contam | Assigned target | Mean estimate | SUPPORTED / null verdict FPR | p≤.05 / null test FPR | INCONCLUSIVE | ITT coverage | CACE coverage | Mean when SUPPORTED | ITT/CACE available |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}

## 4. Held-out one-factor-at-a-time sensitivity

Base: 28 days, effect 30, adherence .9, contamination .1. Only the named factor changes, using paired data seeds. Rho .4 and SD45 are represented by the base case. Assignment length sensitivity is distinct from interval block length.

| Case | Assigned target | Mean estimate | SUPPORTED | p≤.05 | INCONCLUSIVE | ITT coverage | CACE coverage | CACE available |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${simpleRows(sensitivities).join('\n')}

Carryover CACE coverage is deliberately reported against the direct effect despite invalid IV assumptions; it is a stress test, not valid causal coverage. Consecutive same-condition blocks can make carryover increase rather than attenuate assignment contrast.

## 5. Held-out interval block-length sensitivity (not used to reselect)

| Moving length | Assigned target | Mean estimate | SUPPORTED | p≤.05 | INCONCLUSIVE | ITT coverage | CACE coverage | CACE available |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${simpleRows(lengths).join('\n')}

CACE uses assignment blocks, so its interval is independent of the primary moving-block length.

## 6. Approximate duration for 70% verdict detection

Only interpolate where the measured 28/42/56-day grid actually brackets 70%. Otherwise report a bound, not an invented extrapolation; no additional experiment or threshold tuning is applied. Probabilities include the adherence and data gates, not just p-value power. Effect 0 should never target 70% detection.

| Direct effect | Adherence / contamination | Detection at 28 / 42 / 56 days | Approximate days for 70% |
|---:|---|---|---|
${powerRows.join('\n')}

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

\`npx --no-install tsx --test scripts/engine.test.ts scripts/engine-v2.test.ts\`

\`npx --no-install tsc --noEmit -p tsconfig.engine.json\`

\`npx --no-install tsx scripts/simulate-engine-v2.ts --phase full\`

A fresh full run selects using tuning then runs held-out. If frozen artifacts already exist, it resumes only missing held-out cells and rebuilds the report; it does not retune. \`--phase heldout\` requires matching frozen tuning, and \`--phase report\` regenerates Markdown from checkpoints. For an independent repeat, copy the unchanged engine/script to a clean directory without v2 generated artifacts. Never delete held-out artifacts to retune the same seeds.

Measured tuning time: **${selection.seconds.toFixed(1)}s**. Measured held-out cell time: **${runtime.toFixed(1)}s**. Total measured simulation time: **${(selection.seconds + runtime).toFixed(1)}s** (${((selection.seconds + runtime) / 60).toFixed(2)} min); includes complete engine analysis, excludes tooling startup/report I/O. ${selection.seconds + runtime > 900 ? '**Runtime exceeds the requested ~15-minute budget; reported honestly.**' : 'Within the requested ~15-minute simulation budget.'}
`);
}
function heldout(selection: Selection): void {
  const selectionHash = hash(JSON.stringify(selection));
  const checkpoint: Checkpoint = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, 'utf8')) : { protocol: PROTOCOL, engineHash, selectionHash, results: [] };
  if (checkpoint.protocol !== PROTOCOL || checkpoint.engineHash !== engineHash || checkpoint.selectionHash !== selectionHash) throw new Error('Held-out checkpoint does not match frozen protocol. Do not overwrite it.');
  const planned = cells(selection);
  for (const cell of planned) {
    if (checkpoint.results.some(r => r.cell.id === cell.id)) continue;
    const summary = runSimulation(cell.options, RUNS, cell.seedBase);
    checkpoint.results.push({ cell, summary });
    save(checkpointPath, checkpoint);
    report(selection, checkpoint);
    console.log(`HELD-OUT ${checkpoint.results.length}/${planned.length} ${cell.id}: supported=${pct(summary.supported, RUNS)} coverage=${pct(summary.covered, RUNS)} time=${summary.seconds.toFixed(1)}s`);
  }
  report(selection, checkpoint);
  console.log(`Saved ${reportPath}; ${checkpoint.results.length} cells verified.`);
}
const phaseIndex = process.argv.indexOf('--phase');
const phase = phaseIndex < 0 ? 'full' : process.argv[phaseIndex + 1];
if (phase === 'benchmark') {
  const summary = runSimulation({ duration: 56, effect: 30, adherence: 0.9, contamination: 0.1 }, 50, 10010000);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Projected core duration: ${(summary.seconds / 50 * 54000 / 60).toFixed(1)} minutes (rough upper-input timing only).`);
} else if (phase === 'tuning') tuning();
else if (phase === 'heldout') heldout(loadSelection());
else if (phase === 'report') report(loadSelection(), JSON.parse(readFileSync(checkpointPath, 'utf8')) as Checkpoint);
else if (phase === 'full') heldout(existsSync(selectionPath) ? loadSelection() : tuning());
else throw new Error('Use --phase full, tuning, heldout, report, or benchmark.');
