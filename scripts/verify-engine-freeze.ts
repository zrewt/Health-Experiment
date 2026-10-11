import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface ManifestEntry { path: string; sha256: string }
export interface FreezeMismatch { path: string; expected: string; actual: string }

export function verifyEngineFreeze(root: string): { checked: number; mismatches: FreezeMismatch[] } {
  const manifest: { reports: ManifestEntry[]; engine: ManifestEntry[] } = JSON.parse(
    readFileSync(resolve(root, 'reports/caffeine-simulation-v3.2-manifest.json'), 'utf8'),
  );
  const entries = [...manifest.reports, ...manifest.engine].filter(entry => entry.path.startsWith('src/engine/'));
  if (!entries.length) throw new Error('Manifest contains no engine files.');
  const mismatches: FreezeMismatch[] = [];
  for (const entry of entries) {
    if (entry.path.split('/').includes('..') || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Invalid engine manifest entry: ${entry.path}`);
    }
    let actual: string;
    try {
      actual = createHash('sha256').update(readFileSync(resolve(root, entry.path))).digest('hex');
    } catch (error) {
      actual = `READ ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (actual !== entry.sha256) mismatches.push({ path: entry.path, expected: entry.sha256, actual });
  }
  return { checked: entries.length, mismatches };
}

if (require.main === module) {
  const result = verifyEngineFreeze(resolve(__dirname, '..'));
  if (result.mismatches.length) {
    console.table(result.mismatches);
    process.exitCode = 1;
  } else {
    console.log(`Engine freeze verified: ${result.checked} files match SHA-256 manifest; 0 mismatches.`);
  }
}
