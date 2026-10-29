import { boundingBox } from "./geo";
import type { LatLng } from "./types";

export interface SearchWindow {
  center: LatLng;
  halfLat: number;
  halfLng: number;
}

export interface Scored {
  point: LatLng;
  score: number;
}

export interface GridOptions {
  /** Points per side of the coarse grid. Odd keeps the bbox center on the grid. */
  coarseN: number;
  /** Points per side of each refinement grid. */
  refineN: number;
  rounds: number;
  /** Each round's window is this fraction of the previous one. */
  shrink: number;
  /** How many of the best distinct points to return for verification. */
  finalists: number;
}

export const DEFAULT_GRID: GridOptions = { coarseN: 9, refineN: 7, rounds: 7, shrink: 0.35, finalists: 5 };

const MIN_HALF_DEG = 0.002;

/** The participants' bounding box, padded slightly so edge optima are reachable. */
export function searchWindow(points: LatLng[]): SearchWindow {
  const b = boundingBox(points);
  const halfLat = Math.max(((b.north - b.south) / 2) * 1.1, MIN_HALF_DEG);
  const halfLng = Math.max(((b.east - b.west) / 2) * 1.1, MIN_HALF_DEG);
  return { center: { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 }, halfLat, halfLng };
}

export function gridPoints(w: SearchWindow, n: number): LatLng[] {
  const pts: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    const fy = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    for (let j = 0; j < n; j++) {
      const fx = n === 1 ? 0 : (j / (n - 1)) * 2 - 1;
      pts.push({
        lat: Math.max(-85, Math.min(85, w.center.lat + fy * w.halfLat)),
        lng: w.center.lng + fx * w.halfLng,
      });
    }
  }
  return pts;
}

export function bestOf(points: LatLng[], scores: number[]): Scored {
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] < scores[best]) best = i;
  return { point: points[best], score: scores[best] };
}

function keyOf(p: LatLng) {
  return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

/**
 * Starting from `start` inside window `w`, repeatedly shrink the window around
 * the best point and re-grid. Returns the best point and the top distinct
 * points seen during the last rounds.
 */
export function refine(
  start: Scored,
  w: SearchWindow,
  evaluate: (pts: LatLng[]) => number[],
  opts: Pick<GridOptions, "refineN" | "rounds" | "shrink" | "finalists">,
): { best: Scored; finalists: Scored[]; evaluations: number } {
  let best = start;
  let win = w;
  let evaluations = 0;
  const seen = new Map<string, Scored>([[keyOf(start.point), start]]);
  for (let r = 0; r < opts.rounds; r++) {
    win = { center: best.point, halfLat: win.halfLat * opts.shrink, halfLng: win.halfLng * opts.shrink };
    const pts = gridPoints(win, opts.refineN);
    const scores = evaluate(pts);
    evaluations += pts.length;
    pts.forEach((p, i) => seen.set(keyOf(p), { point: p, score: scores[i] }));
    const roundBest = bestOf(pts, scores);
    if (roundBest.score < best.score) best = roundBest;
  }
  const finalists = [...seen.values()]
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => a.score - b.score)
    .slice(0, opts.finalists);
  return { best, finalists, evaluations };
}

/** Coarse grid over the participants' bbox, then refinement rounds. */
export function gridSearch(
  participants: LatLng[],
  evaluate: (pts: LatLng[]) => number[],
  opts: GridOptions = DEFAULT_GRID,
) {
  const w = searchWindow(participants);
  const coarse = gridPoints(w, opts.coarseN);
  const coarseBest = bestOf(coarse, evaluate(coarse));
  // The first refinement window should span about one coarse cell either side.
  const cell = { ...w, halfLat: (w.halfLat * 2) / (opts.coarseN - 1) / opts.shrink, halfLng: (w.halfLng * 2) / (opts.coarseN - 1) / opts.shrink };
  const out = refine(coarseBest, cell, evaluate, opts);
  return { ...out, evaluations: out.evaluations + coarse.length, window: w };
}
