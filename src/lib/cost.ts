import type { Priority } from "./types";

/**
 * Tie-break weight. "Least total" with two equal people is flat along the
 * segment between them, and "even out" can be flat too; a tiny pull toward
 * the weighted root-mean-square makes the optimum unique (the midpoint in the
 * symmetric case) without visibly biasing the answer.
 */
const TIE_BREAK = 1e-3;

/**
 * Score one candidate. `costs[i]` is person i's cost to reach it (km or min),
 * `weights[i]` their weight. Lower is better.
 *   total: sum(w * c)
 *   even:  max(w * c)
 * Unreachable candidates (non-finite cost) score Infinity.
 */
export function weightedScore(costs: number[], weights: number[], priority: Priority): number {
  let sum = 0;
  let max = 0;
  let sq = 0;
  for (let i = 0; i < costs.length; i++) {
    const c = costs[i];
    if (!Number.isFinite(c)) return Infinity;
    const wc = weights[i] * c;
    sum += wc;
    if (wc > max) max = wc;
    sq += weights[i] * c * c;
  }
  const primary = priority === "total" ? sum : max;
  return primary + TIE_BREAK * Math.sqrt(sq);
}

export function weightedAverage(costs: number[], weights: number[]): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < costs.length; i++) {
    num += weights[i] * costs[i];
    den += weights[i];
  }
  return den === 0 ? 0 : num / den;
}
