import type { LatLng, Precision } from "./types";

export function isPrecision(p: unknown): p is Precision {
  return p === 1 || p === 2 || p === 3 || p === 4;
}

/**
 * Round half away from zero to `decimals` places. Uses exponent notation so
 * values like 1.005 round as written rather than by their binary float value.
 * Matches Postgres round(numeric, int).
 */
export function roundTo(x: number, decimals: number): number {
  if (!Number.isFinite(x)) throw new RangeError("coordinate must be finite");
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const r = Number(Math.round(Number(`${abs}e${decimals}`)) + `e-${decimals}`);
  return r === 0 ? 0 : sign * r;
}

export function roundPoint(p: LatLng, precision: Precision): LatLng {
  return { lat: roundTo(p.lat, precision), lng: roundTo(p.lng, precision) };
}

export function isValidLatLng(p: { lat: unknown; lng: unknown }): p is LatLng {
  return (
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

/** The square of real-world points that round to `p` at this precision. */
export function cellBounds(p: LatLng, precision: Precision) {
  const half = 0.5 * 10 ** -precision;
  return { south: p.lat - half, north: p.lat + half, west: p.lng - half, east: p.lng + half };
}

export function cellPolygon(p: LatLng, precision: Precision): [number, number][] {
  const b = cellBounds(p, precision);
  return [
    [b.west, b.south],
    [b.east, b.south],
    [b.east, b.north],
    [b.west, b.north],
    [b.west, b.south],
  ];
}

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface BBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

export function boundingBox(points: LatLng[]): BBox {
  if (points.length === 0) throw new Error("no points");
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const p of points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
  }
  return { south, north, west, east };
}

export const KM_PER_MILE = 1.609344;
