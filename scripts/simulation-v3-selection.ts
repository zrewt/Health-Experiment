import type { GatePolicy } from '../src/engine';
export interface PolicyScore { policy: GatePolicy; detection: number; pooledNullFpr: number; worstNullFpr: number }
export function selectBlockLength(two: { detection: number; coverage: number }, three: { detection: number; coverage: number }): 2 | 3 {
  return two.detection - three.detection >= 0.03 - 1e-12 && two.coverage - three.coverage >= -0.01 - 1e-12 ? 2 : 3;
}
export function selectGatePolicy(scores: PolicyScore[]): GatePolicy | null {
  const candidates = scores.filter(s => s.pooledNullFpr <= 0.05 + 1e-12 && s.worstNullFpr <= 0.07 + 1e-12);
  candidates.sort((a, b) => b.detection - a.detection || ['A', 'B', 'C'].indexOf(a.policy) - ['A', 'B', 'C'].indexOf(b.policy));
  return candidates[0]?.policy ?? null;
}
