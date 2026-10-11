import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { generatePlannedGridCells, simulateCell, GridCellResult, PROTOCOL_V3_1, ROOT_V3_1 } from './simulate-engine-v3-1-helpers';

const TUNING_PATH = `${ROOT_V3_1}-tuning.json`;

export function runGridSimulation(): void {
  const cells = generatePlannedGridCells();
  console.log(`Starting feasibility grid simulation: ${cells.length} cells...`);
  
  let results: GridCellResult[] = [];
  if (existsSync(TUNING_PATH)) {
    try {
      const data = JSON.parse(readFileSync(TUNING_PATH, 'utf8'));
      if (data.protocol === PROTOCOL_V3_1 && Array.isArray(data.results)) {
        results = data.results;
        console.log(`Resumed from checkpoint: ${results.length}/${cells.length} cells complete.`);
      }
    } catch (e) {
      console.warn('Failed to parse checkpoint, starting fresh.');
    }
  }

  const completedIndices = new Set(results.map(r => r.cell.index));
  const t0 = performance.now();

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (completedIndices.has(cell.index)) continue;

    const res = simulateCell(cell, 'tuning');
    results.push(res);
    completedIndices.add(cell.index);

    if (results.length % 20 === 0 || results.length === cells.length) {
      writeFileSync(TUNING_PATH, JSON.stringify({
        protocol: PROTOCOL_V3_1,
        updatedAt: new Date().toISOString(),
        totalCells: cells.length,
        completedCells: results.length,
        results,
      }, null, 2));
      const elapsed = (performance.now() - t0) / 1000;
      console.log(`Tuning progress: ${results.length}/${cells.length} cells (${elapsed.toFixed(1)}s elapsed, last cell: ${cell.sd}sd ${cell.rho}rho ${cell.duration}d ${cell.adherence}adh ${cell.effect}eff -> ${(res.detection * 100).toFixed(1)}%)`);
    }
  }

  console.log(`Grid simulation complete! Exporting data file src/engine/feasibility-table-data.ts...`);
  exportDataFile(results);
}

export function exportDataFile(results: GridCellResult[]): void {
  // Structure: nested dictionary or array for fast interpolation
  // table[sd][rho][duration][adh][effect] = detection
  const grid: Record<string, number> = {};
  for (const r of results) {
    const key = `${r.cell.sd}_${r.cell.rho}_${r.cell.duration}_${r.cell.adherence}_${r.cell.effect}`;
    grid[key] = Math.round(r.detection * 10000) / 10000;
  }

  const content = `// Generated precomputed feasibility lookup table v3.1
// Protocol: ${PROTOCOL_V3_1}
// Generated: ${new Date().toISOString()}

export const FEASIBILITY_TABLE_META = {
  version: '3.1',
  sds: [25, 35, 45, 60, 75] as const,
  rhos: [0.2, 0.4, 0.6] as const,
  durations: [42, 56, 70, 84] as const,
  adherences: [1.0, 0.9] as const,
  effects: [10, 15, 20, 30, 45, 60] as const,
  totalCells: ${results.length},
};

export const FEASIBILITY_GRID_DATA: Record<string, number> = ${JSON.stringify(grid, null, 2)};
`;

  writeFileSync('src/engine/feasibility-table-data.ts', content, 'utf8');
  console.log('Successfully wrote src/engine/feasibility-table-data.ts');
}

if (process.argv[1]?.includes('generate-feasibility-table')) {
  runGridSimulation();
}
