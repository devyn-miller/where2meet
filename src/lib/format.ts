import { KM_PER_MILE } from "./geo";
import type { LatLng } from "./types";

export type Units = "mi" | "km";

export function formatDistance(km: number, units: Units): string {
  if (!Number.isFinite(km)) return "no route";
  const v = units === "mi" ? km / KM_PER_MILE : km;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units}`;
}

export function formatMinutes(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return "no route";
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function formatCost(cost: number, unit: "km" | "min", units: Units): string {
  return unit === "min" ? formatMinutes(cost) : formatDistance(cost, units);
}

export const formatLatLng = (p: LatLng) => `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;

export function googleMapsPlace(p: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
}

export function googleMapsRoute(from: LatLng, to: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`;
}

/** Stable hue per participant id. */
export function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

const PIN_SIZE: Record<string, number> = { "0.5": 20, "1": 26, "1.5": 31, "2": 36, "3": 44 };
export const pinSize = (weight: number) => PIN_SIZE[String(weight)] ?? 26;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
