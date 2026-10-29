export type Precision = 1 | 2 | 3 | 4;
export type Mode = "distance" | "drive";
export type Priority = "total" | "even";

export interface LatLng {
  lat: number;
  lng: number;
}

export const PRECISIONS: { value: Precision; label: string; hint: string }[] = [
  { value: 4, label: "Exact", hint: "about 10 m" },
  { value: 3, label: "Block", hint: "about 100 m" },
  { value: 2, label: "Neighborhood", hint: "about 1 km" },
  { value: 1, label: "Town", hint: "about 10 km" },
];

export const WEIGHTS = [0.5, 1, 1.5, 2, 3] as const;
export type Weight = (typeof WEIGHTS)[number];

export interface EventPublic {
  id: string;
  name: string;
  meetingAt: string | null;
  mode: Mode;
  priority: Priority;
  version: number;
  result: CenterResult | null;
  createdAt: string;
}

export interface ParticipantPublic {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  precision: Precision;
  weight: number;
}

export interface Trip {
  participantId: string;
  name: string;
  weight: number;
  /** Straight-line km in distance mode, road km in drive mode. */
  distanceKm: number;
  /** Drive minutes; null in distance mode. */
  durationMin: number | null;
  /** Cost in costUnit (km or min), before weighting. */
  cost: number;
  weightedCost: number;
}

export interface CenterResult {
  version: number;
  computedAt: string;
  requestedMode: Mode;
  /** The mode actually used (drive falls back to distance when ORS is unavailable). */
  mode: Mode;
  priority: Priority;
  costUnit: "km" | "min";
  center: LatLng;
  /** Center using straight-line distance, always computed. */
  distanceCenter: LatLng;
  /** km between the drive-time center and distance center; null in distance mode. */
  centersApartKm: number | null;
  snapped: boolean;
  trips: Trip[];
  longestId: string | null;
  shortestId: string | null;
  /** sum(w * cost) / sum(w), in costUnit. */
  weightedAverage: number;
  notice: string | null;
}
