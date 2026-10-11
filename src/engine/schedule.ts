import type { Condition, Design, ScheduledDay } from './types';

export function seededRandom(seed: number): () => number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be a uint32.');
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function parseDate(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must be YYYY-MM-DD.');
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('Invalid calendar date.');
  return value;
}
export function dateAt(startDate: string, offset: number): string {
  return new Date(parseDate(startDate) + offset * 86400000).toISOString().slice(0, 10);
}
export function isWeekend(date: string): boolean {
  const day = new Date(parseDate(date)).getUTCDay();
  return day === 0 || day === 6;
}
export function validateSchedule(length: number, design: Design): void {
  if (!Number.isInteger(length) || length < 2 || length > 366) throw new Error('Length must be 2 to 366 days.');
  if (design.type === 'randomized' && (!Number.isInteger(design.maxConsecutiveDays) || design.maxConsecutiveDays < 1)) {
    throw new Error('Consecutive-day cap must be a positive integer.');
  }
  if (design.type === 'blocks' && (!Number.isInteger(design.blockLength) || design.blockLength < 1 || design.blockLength >= length)) {
    throw new Error('Block length must be positive and shorter than the experiment.');
  }
  if (design.type === 'randomized-blocks') {
    if (![2, 3].includes(design.blockLength ?? 3)) throw new Error('Randomized block length must be 2 or 3.');
    if (length % 2) throw new Error('Randomized blocks require an even duration for equal condition counts.');
  }
}

export interface BlockInfo {
  index: number;
  startIndex: number;
  endIndex: number;
  length: number;
  weekendDays: number;
}
/** Full pairs of nominal blocks, followed by a shorter equal-length pair if needed.
 * This gives exactly equal numbers of blocks AND days per condition for 28/42/56
 * without dropping nights or assigning a single unbalanced remainder block.
 */
export function partitionBlocks(startDate: string, length: number, blockLength = 3): BlockInfo[] {
  validateSchedule(length, { type: 'randomized-blocks', blockLength });
  parseDate(startDate);
  const full = Math.floor(length / (2 * blockLength)) * 2;
  const remainder = length - full * blockLength;
  const lengths = Array<number>(full).fill(blockLength);
  if (remainder) lengths.push(remainder / 2, remainder / 2);
  let startIndex = 0;
  return lengths.map((size, index) => {
    const endIndex = startIndex + size;
    let weekendDays = 0;
    for (let d = startIndex; d < endIndex; d++) weekendDays += Number(isWeekend(dateAt(startDate, d)));
    const block = { index, startIndex, endIndex, length: size, weekendDays };
    startIndex = endIndex;
    return block;
  });
}

export interface BlockAssignmentSpace {
  blocks: BlockInfo[];
  count: bigint;
  minWeekendDiff: number;
  sampleBlocks(random: () => number): Condition[];
  enumerate(limit?: number): Condition[][];
}
const spaces = new Map<string, BlockAssignmentSpace>();

/** Uniform design-based sampling. DP counts admissible suffixes exactly (BigInt),
 * subject to equal block counts, equal day counts, and minimum weekend imbalance.
 * The same space is used for scheduling and inference; no unconstrained shuffle.
 */
export function randomizedBlockSpace(startDate: string, length: number, blockLength = 3, balanceWeekends = true): BlockAssignmentSpace {
  const key = `${startDate}/${length}/${blockLength}/${balanceWeekends}`;
  const cached = spaces.get(key);
  if (cached) return cached;
  const blocks = partitionBlocks(startDate, length, blockLength);
  const m = blocks.length;
  const weekends = blocks.reduce((sum, b) => sum + b.weekendDays, 0);
  const suffixDays = Array<number>(m + 1).fill(0);
  const suffixWeekends = Array<number>(m + 1).fill(0);
  for (let j = m - 1; j >= 0; j--) {
    suffixDays[j] = suffixDays[j + 1] + blocks[j].length;
    suffixWeekends[j] = suffixWeekends[j + 1] + blocks[j].weekendDays;
  }
  const memo = new Map<string, bigint>();
  const ways = (j: number, k: number, days: number, w: number): bigint => {
    if (k < 0 || k > m - j || days < 0 || days > suffixDays[j] || w < 0 || w > suffixWeekends[j]) return 0n;
    if (j === m) return k === 0 && days === 0 && w === 0 ? 1n : 0n;
    const id = `${j},${k},${days},${w}`;
    const previous = memo.get(id);
    if (previous !== undefined) return previous;
    const b = blocks[j];
    const n = ways(j + 1, k, days, w) + ways(j + 1, k - 1, days - b.length, w - b.weekendDays);
    memo.set(id, n);
    return n;
  };
  const targets: { w: number; count: bigint }[] = [];
  let minWeekendDiff = Infinity;
  for (let w = 0; w <= weekends; w++) {
    const count = ways(0, m / 2, length / 2, w);
    if (!count) continue;
    minWeekendDiff = Math.min(minWeekendDiff, Math.abs(2 * w - weekends));
    targets.push({ w, count });
  }
  const accepted = targets.filter(t => !balanceWeekends || Math.abs(2 * t.w - weekends) === minWeekendDiff);
  const count = accepted.reduce((sum, t) => sum + t.count, 0n);
  if (!count) throw new Error('No admissible randomized-block allocations.');
  const space: BlockAssignmentSpace = {
    blocks, count, minWeekendDiff,
    sampleBlocks(random) {
      let draw = random() * Number(count);
      let target = accepted[accepted.length - 1];
      for (const t of accepted) {
        draw -= Number(t.count);
        if (draw < 0) { target = t; break; }
      }
      let k = m / 2, days = length / 2, w = target.w;
      return blocks.map((b, j) => {
        const c = ways(j + 1, k, days, w);
        const i = ways(j + 1, k - 1, days - b.length, w - b.weekendDays);
        if (random() * Number(c + i) < Number(i)) {
          k--; days -= b.length; w -= b.weekendDays;
          return 'intervention';
        }
        return 'control';
      });
    },
    enumerate(limit = 100000) {
      if (count > BigInt(limit)) throw new Error('Assignment space too large to enumerate; use exact count and uniform sampling.');
      const result: Condition[][] = [];
      const assignment: Condition[] = [];
      const visit = (j: number, k: number, days: number, w: number) => {
        if (!ways(j, k, days, w)) return;
        if (j === m) { result.push([...assignment]); return; }
        assignment[j] = 'control';
        visit(j + 1, k, days, w);
        assignment[j] = 'intervention';
        visit(j + 1, k - 1, days - blocks[j].length, w - blocks[j].weekendDays);
      };
      for (const t of accepted) visit(0, m / 2, length / 2, t.w);
      return result;
    },
  };
  if (spaces.size >= 32) spaces.delete(spaces.keys().next().value!);
  spaces.set(key, space);
  return space;
}

export function admissibleRandomizedBlockAssignments(startDate: string, length: number, blockLength = 3, balanceWeekends = true): { blockAssignments: Condition[][]; minWeekendDiff: number } {
  const space = randomizedBlockSpace(startDate, length, blockLength, balanceWeekends);
  return { blockAssignments: space.enumerate(), minWeekendDiff: space.minWeekendDiff };
}
export function expandBlockSchedule(blocks: BlockInfo[], conditions: Condition[]): Condition[] {
  return blocks.flatMap((b, j) => Array<Condition>(b.length).fill(conditions[j]));
}

export function assignmentSampler(length: number, design: Design, startDate = '2026-01-01'): (random: () => number) => Condition[] {
  validateSchedule(length, design);
  if (design.type === 'randomized-blocks') {
    const space = randomizedBlockSpace(startDate, length, design.blockLength ?? 3, design.balanceWeekends ?? true);
    return random => expandBlockSchedule(space.blocks, space.sampleBlocks(random));
  }
  if (design.type !== 'randomized') {
    const block = design.type === 'blocks' ? design.blockLength : 1;
    return random => {
      const phase = random() < 0.5 ? 0 : 1;
      return Array.from({ length }, (_, n) => (Math.floor(n / block) + phase) % 2 ? 'intervention' : 'control');
    };
  }
  const cap = design.maxConsecutiveDays;
  const memo = new Map<string, number>();
  const count = (c: number, i: number, last: number, run: number): number => {
    if (!c && !i) return 1;
    const key = `${c},${i},${last},${run}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let ways = 0;
    if (c && (last !== 0 || run < cap)) ways += count(c - 1, i, 0, last === 0 ? run + 1 : 1);
    if (i && (last !== 1 || run < cap)) ways += count(c, i - 1, 1, last === 1 ? run + 1 : 1);
    memo.set(key, ways);
    return ways;
  };
  return random => {
    let c = Math.floor(length / 2), i = c;
    if (length % 2) { if (random() < 0.5) c++; else i++; }
    let last = -1, run = 0;
    const result: Condition[] = [];
    while (c + i) {
      const cw = c && (last !== 0 || run < cap) ? count(c - 1, i, 0, last === 0 ? run + 1 : 1) : 0;
      const iw = i && (last !== 1 || run < cap) ? count(c, i - 1, 1, last === 1 ? run + 1 : 1) : 0;
      if (!(cw + iw)) throw new Error('No balanced schedule satisfies the cap.');
      const next = random() * (cw + iw) < cw ? 0 : 1;
      result.push(next ? 'intervention' : 'control');
      if (next) i--; else c--;
      run = next === last ? run + 1 : 1;
      last = next;
    }
    return result;
  };
}
export function generateSchedule(startDate: string, length: number, design: Design, seed: number): ScheduledDay[] {
  parseDate(startDate);
  const conditions = assignmentSampler(length, design, startDate)(seededRandom(seed));
  const blocks = design.type === 'randomized-blocks' ? partitionBlocks(startDate, length, design.blockLength ?? 3) : null;
  return conditions.map((condition, n) => ({
    date: dateAt(startDate, n), condition,
    blockIndex: blocks ? blocks.findIndex(b => n >= b.startIndex && n < b.endIndex) : Math.floor(n / (design.type === 'blocks' ? design.blockLength : 1)),
  }));
}
