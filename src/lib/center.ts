import { weightedAverage, weightedScore } from "./cost";
import { haversineKm } from "./geo";
import { DEFAULT_GRID, gridSearch, type GridOptions } from "./grid";
import type { CenterResult, LatLng, Mode, Priority, Trip } from "./types";

export interface Located {
  id: string;
  name: string;
  lat: number;
  lng: number;
  weight: number;
}

/** Straight-line cost matrix: costs[candidate][person] in km. */
export function haversineCosts(people: LatLng[], candidates: LatLng[]): number[][] {
  return candidates.map((c) => people.map((p) => haversineKm(p, c)));
}

export function distanceCenter(people: Located[], priority: Priority, opts: GridOptions = DEFAULT_GRID): LatLng {
  const weights = people.map((p) => p.weight);
  const evaluate = (pts: LatLng[]) => haversineCosts(people, pts).map((row) => weightedScore(row, weights, priority));
  return gridSearch(people, evaluate, opts).best.point;
}

export interface TripCost {
  distanceKm: number;
  durationMin: number | null;
}

export function buildResult(args: {
  version: number;
  people: Located[];
  requestedMode: Mode;
  mode: Mode;
  priority: Priority;
  center: LatLng;
  distanceCenter: LatLng;
  tripCosts: TripCost[];
  snapped: boolean;
  notice: string | null;
}): CenterResult {
  const { people, mode, tripCosts } = args;
  const costUnit = mode === "drive" ? "min" : "km";
  const trips: Trip[] = people.map((p, i) => {
    const t = tripCosts[i];
    const cost = mode === "drive" ? (t.durationMin ?? Infinity) : t.distanceKm;
    return {
      participantId: p.id,
      name: p.name,
      weight: p.weight,
      distanceKm: t.distanceKm,
      durationMin: t.durationMin,
      cost,
      weightedCost: cost * p.weight,
    };
  });
  let longestId: string | null = null;
  let shortestId: string | null = null;
  if (trips.length > 0) {
    const byCost = [...trips].sort((a, b) => a.cost - b.cost);
    shortestId = byCost[0].participantId;
    longestId = byCost[byCost.length - 1].participantId;
  }
  return {
    version: args.version,
    computedAt: new Date().toISOString(),
    requestedMode: args.requestedMode,
    mode,
    priority: args.priority,
    costUnit,
    center: args.center,
    distanceCenter: args.distanceCenter,
    centersApartKm: mode === "drive" ? haversineKm(args.center, args.distanceCenter) : null,
    snapped: args.snapped,
    trips,
    longestId,
    shortestId,
    weightedAverage: weightedAverage(
      trips.map((t) => t.cost),
      trips.map((t) => t.weight),
    ),
    notice: args.notice,
  };
}

/** Full straight-line result. */
export function computeDistanceResult(
  people: Located[],
  priority: Priority,
  version: number,
  requestedMode: Mode = "distance",
  notice: string | null = null,
): CenterResult {
  const center = distanceCenter(people, priority);
  return buildResult({
    version,
    people,
    requestedMode,
    mode: "distance",
    priority,
    center,
    distanceCenter: center,
    tripCosts: people.map((p) => ({ distanceKm: haversineKm(p, center), durationMin: null })),
    snapped: false,
    notice,
  });
}
