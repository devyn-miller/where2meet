import { isPrecision, isValidLatLng, roundPoint } from "../geo";
import { WEIGHTS, type LatLng, type Mode, type Precision, type Priority } from "../types";

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Check<T> => ({ ok: true, value });
const fail = (error: string): Check<never> => ({ ok: false, error });

export function name(v: unknown, max: number): Check<string> {
  if (typeof v !== "string") return fail("Name is required.");
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length < 1 || s.length > max) return fail(`Name must be 1 to ${max} characters.`);
  return ok(s);
}

export function meetingAt(v: unknown): Check<string | null> {
  if (v === null || v === "") return ok(null);
  if (typeof v !== "string") return fail("Meeting time must be a date string.");
  const t = Date.parse(v);
  if (Number.isNaN(t)) return fail("Meeting time is not a valid date.");
  return ok(new Date(t).toISOString());
}

export function precision(v: unknown): Check<Precision> {
  return isPrecision(v) ? ok(v) : fail("Precision must be 1, 2, 3 or 4.");
}

export function weight(v: unknown): Check<number> {
  return typeof v === "number" && (WEIGHTS as readonly number[]).includes(v)
    ? ok(v)
    : fail(`Weight must be one of ${WEIGHTS.join(", ")}.`);
}

export function mode(v: unknown): Check<Mode> {
  return v === "distance" || v === "drive" ? ok(v) : fail("Mode must be distance or drive.");
}

export function priority(v: unknown): Check<Priority> {
  return v === "total" || v === "even" ? ok(v) : fail("Priority must be total or even.");
}

/**
 * Round (again) on the server. Whatever the client sent, only the rounded
 * point continues past this function.
 */
export function location(lat: unknown, lng: unknown, p: Precision): Check<LatLng | null> {
  if (lat === null && lng === null) return ok(null);
  const pt = { lat, lng };
  if (!isValidLatLng(pt)) return fail("Location is not a valid latitude/longitude.");
  return ok(roundPoint(pt, p));
}
