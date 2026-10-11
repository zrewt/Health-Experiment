import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { analyzeExperiment, generateSchedule, getVerdict, seededRandom } from '../src/engine';
import type { DayRecord, ExperimentDefinition } from '../src/engine';

export const PROTOCOL_V3_1 = 'v3.1-simulation-lookup-and-planned-power-v1';
export const ROOT_V3_1 = 'reports/caffeine-simulation-v3.1';

export const GRID_CONFIG = {
  sds: [25, 35, 45, 60, 75] as const,
  rhos: [0.2, 0.4, 0.6] as const,
  durations: [42, 56, 70, 84] as const,
  adherences: [
    { adherence: 1.0, contamination: 0.0 },
    { adherence: 0.9, contamination: 0.1 },
  ] as const,
  effects: [10, 15, 20, 30, 45, 60] as const,
  runsPerCell: 200,
  draws: 149,
  blockLength: 2 as const,
};

export const OFF_GRID_POINTS = [
  // 12 representative combinations across off-grid SD, rho, duration, adherence, effect
  { sd: 40, rho: 0.3, duration: 42, adherence: 1.0, contamination: 0.0, effect: 25 },
  { sd: 40, rho: 0.3, duration: 56, adherence: 0.9, contamination: 0.1, effect: 15 },
  { sd: 40, rho: 0.5, duration: 70, adherence: 1.0, contamination: 0.0, effect: 12 },
  { sd: 40, rho: 0.5, duration: 84, adherence: 0.9, contamination: 0.1, effect: 40 },
  { sd: 52, rho: 0.3, duration: 42, adherence: 0.9, contamination: 0.1, effect: 40 },
  { sd: 52, rho: 0.3, duration: 56, adherence: 1.0, contamination: 0.0, effect: 25 },
  { sd: 52, rho: 0.5, duration: 70, adherence: 0.9, contamination: 0.1, effect: 15 },
  { sd: 52, rho: 0.5, duration: 84, adherence: 1.0, contamination: 0.0, effect: 12 },
  { sd: 68, rho: 0.3, duration: 42, adherence: 1.0, contamination: 0.0, effect: 12 },
  { sd: 68, rho: 0.3, duration: 56, adherence: 0.9, contamination: 0.1, effect: 40 },
  { sd: 68, rho: 0.5, duration: 70, adherence: 1.0, contamination: 0.0, effect: 25 },
  { sd: 68, rho: 0.5, duration: 84, adherence: 0.9, contamination: 0.1, effect: 15 },
] as const;

export interface GridCell {
  index: number;
  sd: number;
  rho: number;
  duration: number;
  adherence: number;
  contamination: number;
  effect: number;
}

export interface GridCellResult {
  cell: GridCell;
  detection: number; // proportion SUPPORTED under policy B
  mde70?: number;
  runs: number;
  seconds: number;
  supportedCount: number;
  sumEstimateSupported: number;
  highOrModRiskInflatedCount: number;
  inflatedCount: number;
}

export function generatePlannedGridCells(): GridCell[] {
  const cells: GridCell[] = [];
  let index = 0;
  for (const sd of GRID_CONFIG.sds) {
    for (const rho of GRID_CONFIG.rhos) {
      for (const duration of GRID_CONFIG.durations) {
        for (const pair of GRID_CONFIG.adherences) {
          for (const effect of GRID_CONFIG.effects) {
            cells.push({
              index,
              sd,
              rho,
              duration,
              adherence: pair.adherence,
              contamination: pair.contamination,
              effect,
            });
            index++;
          }
        }
      }
    }
  }
  return cells;
}

function normal(random: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random()))) * Math.cos(2 * Math.PI * random());
}

export function simulateCell(cell: GridCell, partition: 'tuning' | 'heldout'): GridCellResult {
  const t0 = performance.now();
  const base = partition === 'tuning' ? 50000000 : 60000000;
  const dataSeedBase = base + cell.index * 1000;
  const scheduleSeedBase = dataSeedBase + 1000000;
  const analysisSeedBase = dataSeedBase + 2000000;

  const design = { type: 'randomized-blocks', blockLength: GRID_CONFIG.blockLength, balanceWeekends: true } as const;
  let supportedCount = 0;
  let sumEstimateSupported = 0;
  let inflatedCount = 0;
  let highOrModRiskInflatedCount = 0;

  const trueAssigned = cell.effect * (cell.adherence - cell.contamination);

  for (let r = 0; r < GRID_CONFIG.runsPerCell; r++) {
    const rng = seededRandom(dataSeedBase + r);
    const def: ExperimentDefinition = {
      name: 'Caffeine cutoff v3.1',
      startDate: '2026-01-01',
      lengthDays: cell.duration,
      design,
      seed: scheduleSeedBase + r,
      outcomeMetric: 'sleepMinutes',
      conditionRule: { type: 'caffeine-cutoff', cutoffTime: '12:00' },
    };
    const schedule = generateSchedule(def.startDate, cell.duration, design, def.seed);
    let noise = cell.sd * normal(rng);
    const records: DayRecord[] = schedule.map(day => {
      noise = cell.rho * noise + cell.sd * Math.sqrt(Math.max(0, 1 - cell.rho ** 2)) * normal(rng);
      const exposed = rng() < (day.condition === 'intervention' ? cell.adherence : cell.contamination);
      const noCaffeine = exposed && rng() < 0.1;
      const unknown = rng() < 0.05;
      const missing = rng() < 0.1;
      const illness = rng() < 0.02;
      const travel = rng() < 0.01;
      return {
        date: day.date,
        assignedCondition: day.condition,
        exposure: {
          lastCaffeineTime: unknown || noCaffeine ? null : exposed ? '11:30' : '15:30',
          servings: unknown ? null : noCaffeine ? 0 : 2,
        },
        covariates: { alcohol: rng() < 0.15, illness, travel, lateWorkout: rng() < 0.1 },
        outcome: {
          sleepMinutes: missing ? null : 420 + cell.effect * Number(exposed) + noise,
          hrvMs: null,
        },
        exclusionReason: null,
      };
    });

    const analysis = analyzeExperiment(def, records, {
      permutations: GRID_CONFIG.draws,
      bootstrapSamples: GRID_CONFIG.draws,
      bootstrapMethod: 'studentized',
      bootstrapBlockLength: 5,
      seed: analysisSeedBase + r,
      baseline: { mean: 420, sd: cell.sd, lag1Autocorrelation: cell.rho },
    });

    const verdict = getVerdict(analysis, { gatePolicy: 'B' });
    if (verdict.status === 'SUPPORTED') {
      supportedCount++;
      const est = analysis.primary.difference!;
      sumEstimateSupported += est;
      if (trueAssigned > 0 && est > 1.5 * trueAssigned) {
        inflatedCount++;
        if (verdict.inflation_risk === 'high' || verdict.inflation_risk === 'moderate') {
          highOrModRiskInflatedCount++;
        }
      }
    }
  }

  const seconds = (performance.now() - t0) / 1000;
  return {
    cell,
    detection: supportedCount / GRID_CONFIG.runsPerCell,
    runs: GRID_CONFIG.runsPerCell,
    seconds,
    supportedCount,
    sumEstimateSupported,
    inflatedCount,
    highOrModRiskInflatedCount,
  };
}
