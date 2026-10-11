import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { lookupDetection } from '../src/engine';
import {
  GridCell,
  GridCellResult,
  OFF_GRID_POINTS,
  PROTOCOL_V3_1,
  ROOT_V3_1,
  simulateCell,
} from './simulate-engine-v3-1-helpers';

const HELDOUT_PATH = `${ROOT_V3_1}-heldout.json`;

export interface OffGridValidationRow {
  point: typeof OFF_GRID_POINTS[number];
  simulatedDetection: number;
  lookupDetection: number;
  error: number; // lookup - simulated
  simulatedSupportedCount: number;
  simulatedRuns: number;
  trueAssigned: number;
  sumEstimateSupported: number;
  meanSupportedEstimate: number | null;
  inflationRatio: number | null;
  inflatedCount: number;
  highOrModRiskInflatedCount: number;
}

export function runHeldoutValidation(): void {
  console.log(`Starting held-out off-grid validation (${OFF_GRID_POINTS.length} points)...`);

  let results: GridCellResult[] = [];
  if (existsSync(HELDOUT_PATH)) {
    try {
      const data = JSON.parse(readFileSync(HELDOUT_PATH, 'utf8'));
      if (data.protocol === PROTOCOL_V3_1 && Array.isArray(data.results)) {
        results = data.results;
        console.log(`Resumed held-out checkpoint: ${results.length}/${OFF_GRID_POINTS.length} complete.`);
      }
    } catch (e) {
      console.warn('Failed to parse held-out checkpoint, starting fresh.');
    }
  }

  const completedIndices = new Set(results.map(r => r.cell.index));
  const t0 = performance.now();

  for (let i = 0; i < OFF_GRID_POINTS.length; i++) {
    const p = OFF_GRID_POINTS[i];
    if (completedIndices.has(i)) continue;

    const cell: GridCell = {
      index: i,
      sd: p.sd,
      rho: p.rho,
      duration: p.duration,
      adherence: p.adherence,
      contamination: p.contamination,
      effect: p.effect,
    };

    const res = simulateCell(cell, 'heldout');
    results.push(res);
    completedIndices.add(i);

    writeFileSync(
      HELDOUT_PATH,
      JSON.stringify(
        {
          protocol: PROTOCOL_V3_1,
          updatedAt: new Date().toISOString(),
          totalPoints: OFF_GRID_POINTS.length,
          completedPoints: results.length,
          results,
        },
        null,
        2
      )
    );
    const elapsed = (performance.now() - t0) / 1000;
    console.log(
      `Held-out progress: ${results.length}/${OFF_GRID_POINTS.length} points (${elapsed.toFixed(1)}s elapsed, last: ${p.sd}sd ${p.rho}rho ${p.duration}d -> ${(res.detection * 100).toFixed(1)}%)`
    );
  }

  console.log(`Held-out validation simulation complete! Generating comparison report...`);
}

if (process.argv[1]?.includes('run-heldout-validation')) {
  runHeldoutValidation();
}
