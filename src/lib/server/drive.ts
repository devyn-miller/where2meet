import { distanceCenter, buildResult, type Located } from "../center";
import { weightedScore } from "../cost";
import { haversineKm, roundTo } from "../geo";
import { bestOf, gridPoints, refine, searchWindow } from "../grid";
import type { CenterResult, LatLng, Priority } from "../types";
import { OrsUnavailable, type OrsClient } from "./ors";
import type { MatrixCell, Store } from "./store";

export const DRIVE_GRID = { coarseN: 7, refineN: 7, rounds: 6, shrink: 0.35, finalists: 5 };

/** 0..167, Monday 00:00 UTC = 24. Used only as a cache key. */
export function hourOfWeek(iso: string): number {
  const d = new Date(iso);
  return d.getUTCDay() * 24 + d.getUTCHours();
}

const r4 = (p: LatLng): LatLng => ({ lat: roundTo(p.lat, 4), lng: roundTo(p.lng, 4) });
const k4 = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
export const matrixKey = (origin: LatLng, candidate: LatLng, how: number) => `${k4(origin)}|${k4(candidate)}|h${how}`;

/** Drive cost table: [candidate][person] minutes and km, Infinity when unroutable. */
export interface DriveTable {
  minutes: number[][];
  km: number[][];
  /** How many ORS matrix requests were made (0 when fully cached). */
  calls: number;
}

/**
 * One matrix lookup for all people x all candidates. Cached cells are reused;
 * a single ORS request covers the rest.
 */
export async function driveTable(
  ors: OrsClient,
  store: Store,
  people: LatLng[],
  candidates: LatLng[],
  how: number,
): Promise<DriveTable> {
  const keys = candidates.map((c) => people.map((p) => matrixKey(p, c, how)));
  const cached = await store.getMatrixCells(keys.flat());
  const missingPeople = new Set<number>();
  const missingCands = new Set<number>();
  keys.forEach((row, ci) =>
    row.forEach((k, pi) => {
      if (!cached.has(k)) {
        missingPeople.add(pi);
        missingCands.add(ci);
      }
    }),
  );
  let calls = 0;
  if (missingPeople.size > 0) {
    const pIdx = [...missingPeople];
    const cIdx = [...missingCands];
    const m = await ors.matrix(
      pIdx.map((i) => people[i]),
      cIdx.map((i) => candidates[i]),
    );
    calls = 1;
    const fresh = new Map<string, MatrixCell>();
    pIdx.forEach((pi, si) =>
      cIdx.forEach((ci, di) => {
        const cell = { durationS: m.durations[si]?.[di] ?? null, distanceM: m.distances[si]?.[di] ?? null };
        fresh.set(keys[ci][pi], cell);
        cached.set(keys[ci][pi], cell);
      }),
    );
    await store.putMatrixCells(fresh);
  }
  const minutes = keys.map((row) =>
    row.map((k) => {
      const d = cached.get(k)?.durationS;
      return d === null || d === undefined ? Infinity : d / 60;
    }),
  );
  const km = keys.map((row) =>
    row.map((k) => {
      const d = cached.get(k)?.distanceM;
      return d === null || d === undefined ? Infinity : d / 1000;
    }),
  );
  return { minutes, km, calls };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Fallback when a person has no routable coarse cell: about 50 km/h. */
const DEFAULT_MIN_PER_KM = 1.2;

/**
 * Per-person minutes-per-km ratios from the coarse matrix, so refinement can
 * estimate drive time from straight-line distance without more ORS calls.
 */
export function calibrate(people: LatLng[], candidates: LatLng[], minutes: number[][]): number[] {
  const all: number[] = [];
  const per = people.map((p, pi) => {
    const ratios: number[] = [];
    candidates.forEach((c, ci) => {
      const m = minutes[ci][pi];
      const km = haversineKm(p, c);
      if (Number.isFinite(m) && km > 0.2) ratios.push(m / km);
    });
    all.push(...ratios);
    return median(ratios);
  });
  const global = median(all) ?? DEFAULT_MIN_PER_KM;
  return per.map((r) => r ?? global);
}

export interface DriveStats {
  matrixCalls: number;
  snapped: boolean;
}

export async function computeDriveResult(args: {
  people: Located[];
  priority: Priority;
  version: number;
  meetingAt: string;
  ors: OrsClient;
  store: Store;
}): Promise<{ result: CenterResult; stats: DriveStats }> {
  const { people, priority, ors, store } = args;
  const how = hourOfWeek(args.meetingAt);
  const weights = people.map((p) => p.weight);
  const score = (row: number[]) => weightedScore(row, weights, priority);
  let matrixCalls = 0;
  const table = async (cands: LatLng[]) => {
    const t = await driveTable(ors, store, people, cands, how);
    matrixCalls += t.calls;
    return t;
  };

  const distCenter = distanceCenter(people, priority);

  // 1. Coarse pass: one matrix call for everyone x every coarse candidate.
  const win = searchWindow(people);
  const coarse = gridPoints(win, DRIVE_GRID.coarseN).map(r4);
  const coarseT = await table(coarse);
  const coarseBest = bestOf(coarse, coarseT.minutes.map(score));
  if (!Number.isFinite(coarseBest.score)) throw new OrsUnavailable("error", "no drivable route reaches everyone");

  // 2. Refine on calibrated straight-line cost only (no ORS calls).
  const k = calibrate(people, coarse, coarseT.minutes);
  const estimate = (pts: LatLng[]) => pts.map((c) => score(people.map((p, i) => k[i] * haversineKm(p, c))));
  const cell = {
    center: coarseBest.point,
    halfLat: (win.halfLat * 2) / (DRIVE_GRID.coarseN - 1) / DRIVE_GRID.shrink,
    halfLng: (win.halfLng * 2) / (DRIVE_GRID.coarseN - 1) / DRIVE_GRID.shrink,
  };
  const refined = refine({ point: coarseBest.point, score: estimate([coarseBest.point])[0] }, cell, estimate, DRIVE_GRID);

  // 3. Verify the top candidates with a real matrix call.
  const seen = new Set<string>();
  const finalists = [coarseBest.point, refined.best.point, ...refined.finalists.map((f) => f.point)]
    .map(r4)
    .filter((p) => (seen.has(k4(p)) ? false : (seen.add(k4(p)), true)));
  const verifyT = await table(finalists);
  const verifyScores = verifyT.minutes.map(score);
  let bestIdx = 0;
  verifyScores.forEach((s, i) => {
    if (s < verifyScores[bestIdx]) bestIdx = i;
  });
  let center = finalists[bestIdx];
  let minutes = verifyT.minutes[bestIdx];
  let km = verifyT.km[bestIdx];
  if (!Number.isFinite(verifyScores[bestIdx])) {
    center = coarseBest.point;
    minutes = coarseT.minutes[coarse.indexOf(coarseBest.point)];
    km = coarseT.km[coarse.indexOf(coarseBest.point)];
  }

  // 4. Snap to the nearest drivable road and re-check the trips.
  let snapped = false;
  try {
    const s = await ors.snap(center);
    if (s) {
      const sp = r4(s);
      const st = await table([sp]);
      if (Number.isFinite(score(st.minutes[0]))) {
        center = sp;
        minutes = st.minutes[0];
        km = st.km[0];
        snapped = true;
      }
    }
  } catch (e) {
    if (!(e instanceof OrsUnavailable)) throw e;
    // Snapping is a nicety; keep the unsnapped point.
  }

  const result = buildResult({
    version: args.version,
    people,
    requestedMode: "drive",
    mode: "drive",
    priority,
    center,
    distanceCenter: distCenter,
    tripCosts: people.map((_, i) => ({ distanceKm: km[i], durationMin: minutes[i] })),
    snapped,
    notice: null,
  });
  return { result, stats: { matrixCalls, snapped } };
}
