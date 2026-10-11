import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { analyzeExperiment, generateSchedule, getVerdict, seededRandom } from '../src/engine';
import type { DayRecord, ExperimentDefinition } from '../src/engine';

const RUNS = 1000;
const RESAMPLES = 499;
const masterSeed = 20261008;
const rho = 0.4;
const nightlySd = 45;
const rows: string[] = [];
const warnings: string[] = [];
const start = performance.now();

function normal(random: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random()))) * Math.cos(2 * Math.PI * random());
}
function percent(n: number): string { return `${(100 * n / RUNS).toFixed(1)}%`; }

for (const trueEffect of [0, 15, 30, 45]) {
  for (const adherence of [0.6, 0.8, 1]) {
    let detected = 0, significant = 0, coverage = 0, perfectCoverage = 0, inconclusive = 0, available = 0;
    let effectSum = 0;
    const assignedEffect = trueEffect * (2 * adherence - 1);
    for (let run = 0; run < RUNS; run++) {
      const seed = (masterSeed + trueEffect * 100000 + Math.round(adherence * 100) * 1000 + run) >>> 0;
      const random = seededRandom(seed);
      const definition: ExperimentDefinition = {
        name: 'Caffeine cutoff', startDate: '2026-01-01', lengthDays: 28,
        design: { type: 'randomized', maxConsecutiveDays: 3 }, seed: (seed ^ 0xdeadbeef) >>> 0,
        outcomeMetric: 'sleepMinutes', conditionRule: { type: 'caffeine-cutoff', cutoffTime: '12:00' },
      };
      let noise = nightlySd * normal(random); // Stationary AR(1) initialization.
      const records: DayRecord[] = generateSchedule(definition.startDate, 28, definition.design, definition.seed).map(day => {
        noise = rho * noise + nightlySd * Math.sqrt(1 - rho * rho) * normal(random);
        const follows = random() < adherence;
        const cutoff = day.condition === 'intervention' ? follows : !follows;
        const noCaffeine = cutoff && random() < 0.1;
        const exposureMissing = random() < 0.05;
        const outcomeMissing = random() < 0.1;
        const illness = random() < 0.02;
        const travel = random() < 0.01;
        return {
          date: day.date, assignedCondition: day.condition,
          exposure: { lastCaffeineTime: exposureMissing || noCaffeine ? null : cutoff ? '11:30' : '15:00', servings: exposureMissing ? null : noCaffeine ? 0 : 2 },
          covariates: { alcohol: random() < 0.15, illness, travel, lateWorkout: random() < 0.1 },
          outcome: { sleepMinutes: outcomeMissing ? null : 420 + trueEffect * Number(cutoff) + noise, hrvMs: null },
          exclusionReason: null,
        };
      });
      const analysis = analyzeExperiment(definition, records, { permutations: RESAMPLES, bootstrapSamples: RESAMPLES, bootstrapBlockLength: 3, seed: (seed ^ 0xa5a5a5a5) >>> 0 });
      const verdict = getVerdict(analysis);
      if (verdict.status === 'SUPPORTED') detected++;
      if (verdict.status === 'INCONCLUSIVE') inconclusive++;
      if (analysis.primary.pValue !== null && analysis.primary.pValue <= 0.05) significant++;
      if (analysis.primary.interval95) {
        available++;
        const [low, high] = analysis.primary.interval95;
        if (low <= assignedEffect && high >= assignedEffect) coverage++;
        if (low <= trueEffect && high >= trueEffect) perfectCoverage++;
      }
      effectSum += analysis.primary.difference ?? 0;
    }
    const coveragePercent = 100 * coverage / RUNS;
    const sigPercent = 100 * significant / RUNS;
    if (trueEffect === 0 && sigPercent > 6.5) warnings.push(`Null scenario, adherence ${adherence * 100}%: randomization-test false positives ${sigPercent.toFixed(1)}%, clearly above 5%.`);
    if (coveragePercent < 92 || coveragePercent > 98) warnings.push(`Effect ${trueEffect}, adherence ${adherence * 100}%: assignment-effect interval coverage ${coveragePercent.toFixed(1)}%, far from 95%.`);
    rows.push(`| ${trueEffect} | ${(adherence * 100).toFixed(0)}% | ${assignedEffect.toFixed(1)} | ${(effectSum / RUNS).toFixed(1)} | ${percent(detected)} | ${percent(significant)} | ${percent(coverage)} | ${percent(perfectCoverage)} | ${percent(inconclusive)} | ${available}/${RUNS} |`);
    console.log(`Finished effect=${trueEffect}, adherence=${adherence}: supported=${percent(detected)}, p<=.05=${percent(significant)}, coverage=${percent(coverage)}, inconclusive=${percent(inconclusive)}`);
  }
}
const seconds = (performance.now() - start) / 1000;
const report = `# Caffeine engine simulation report

## Fixed protocol and methods

- Master seed: ${masterSeed}; ${RUNS} runs per scenario, 12 scenarios, 12,000 total runs.
- 28 days; uniformly sampled balanced randomized assignments, consecutive-day cap 3.
- Perfect-exposure effects: 0, 15, 30, 45 minutes. Both intervention adherence and control non-contamination probabilities: 60%, 80%, 100%.
- Sleep: 420-minute baseline plus exposure effect and stationary Gaussian AR(1) noise, marginal SD ${nightlySd} minutes, correlation rho=${rho}.
- Independent missing outcomes 10%; unknown exposure 5%; illness 2%; travel 1%. No treatment-linked missingness, carryover, trends, or causal covariate effects in this simulation.
- Randomization test: ${RESAMPLES} constrained draws plus-one correction, two-sided; missing/excluded outcomes stay at their calendar positions.
- Bootstrap: ${RESAMPLES} circular moving-block pairs draws, block length 3, percentile 95% interval. This assumption was fixed before simulation, not tuned afterward.
- Verdict defaults unchanged: 10 analyzable days per condition, 70% adherence, 15-minute meaningful effect, alpha .05; unknown exposure cannot count toward demonstrated compliance.
- Detection means SUPPORTED. Test rejection is separate: p <= .05 regardless of verdict gates. For effect 0, these are respectively verdict false positives and test false positives.
- Primary is intention-to-treat (assignment). With crossover in both groups, population assignment effect = perfect-exposure effect × (2 × adherence − 1). Coverage must target this attenuated effect. Perfect-exposure coverage is also shown but is NOT valid coverage for the primary estimand when adherence is imperfect.
- All coverage rates use all 1,000 runs as denominator; unavailable intervals count as noncoverage. Sampling error around a 5% rate is approximately ±1.4 percentage points (95% Monte Carlo margin); around 95% coverage the same margin applies.
- These results concern randomized design only. Alternating and alternating-block designs enumerate two starting phases, so their two-sided p-values are 1; they cannot produce SUPPORTED at alpha .05.

## Results

| Perfect-exposure effect (min) | Adherence probability | True assignment effect (min) | Mean estimated effect | Detection / SUPPORTED | Test rejection / null FPR | 95% CI coverage: assignment | CI contains perfect-exposure effect | INCONCLUSIVE | Available intervals |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}

## Calibration findings

${warnings.length ? warnings.map(w => `- **WARNING:** ${w}`).join('\n') : '- No scenario crossed the predeclared gross-miscalibration flags (null rejection >6.5%; coverage outside 92–98%). This is not a validation claim.'}

These flags are reporting heuristics, not engine thresholds, and do not replace scrutiny of the table. No model parameters or verdict thresholds were adjusted after observing the results.

## Limitations and proposed fixes (not applied)

- Bootstrap pairs intervals may under-cover with only 28 nights; bootstrap validity is not guaranteed by a calibrated randomization p-value.
- If coverage is poor, compare studentized/residual block bootstraps, design-aware interval inversion, and a predeclared block-length sensitivity grid using held-out simulation seeds. Do not choose a length solely to improve this table.
- For alternating/block experiments, redesign with genuinely randomized multiple blocks or restrict to descriptive/inconclusive reporting; do not use unrestricted permutations.
- Extend experiments or plan sample size around the meaningful effect if 28 days is insufficient. Do not lower evidence gates to increase detection.
- Stress-test stronger autocorrelation, weekday effects, trends, carryover, asymmetric nonadherence, and informative missingness before real-world use.
- Control contamination is a behavioral proxy. An early last caffeine time does not prove intentional restriction.
- This synthetic population is not evidence that caffeine improves an individual’s sleep.

Runtime: ${seconds.toFixed(1)} seconds in this environment (measured for this run; not a speedup claim).
`;
mkdirSync('reports', { recursive: true });
writeFileSync('reports/caffeine-simulation.md', report);
console.log(`Saved reports/caffeine-simulation.md in ${seconds.toFixed(1)} seconds.`);
