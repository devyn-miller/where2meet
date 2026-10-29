import { describe, expect, it } from "vitest";
import { cellBounds, haversineKm, roundPoint, roundTo } from "@/lib/geo";

describe("roundTo", () => {
  it("rounds to each precision", () => {
    const lat = 40.748817;
    expect(roundTo(lat, 4)).toBe(40.7488);
    expect(roundTo(lat, 3)).toBe(40.749);
    expect(roundTo(lat, 2)).toBe(40.75);
    expect(roundTo(lat, 1)).toBe(40.7);
  });

  it("rounds half away from zero, like Postgres", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(-73.98565, 4)).toBe(-73.9857);
    expect(roundTo(0.05, 1)).toBe(0.1);
  });

  it("never returns negative zero", () => {
    expect(Object.is(roundTo(-0.00001, 2), 0)).toBe(true);
  });

  it("rejects non-finite input", () => {
    expect(() => roundTo(NaN, 2)).toThrow();
  });

  it("is idempotent", () => {
    for (const d of [1, 2, 3, 4]) {
      const once = roundTo(-122.419416, d);
      expect(roundTo(once, d)).toBe(once);
    }
  });
});

describe("roundPoint and cellBounds", () => {
  it("the exact point lies inside the cell of its rounded point", () => {
    const exact = { lat: 37.774929, lng: -122.419416 };
    for (const p of [1, 2, 3, 4] as const) {
      const r = roundPoint(exact, p);
      const b = cellBounds(r, p);
      expect(exact.lat).toBeGreaterThanOrEqual(b.south);
      expect(exact.lat).toBeLessThanOrEqual(b.north);
      expect(exact.lng).toBeGreaterThanOrEqual(b.west);
      expect(exact.lng).toBeLessThanOrEqual(b.east);
      expect(b.north - b.south).toBeCloseTo(10 ** -p, 10);
    }
  });
});

describe("haversineKm", () => {
  it("is about 111 km per degree of latitude", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.2, 0);
  });
  it("is zero for the same point", () => {
    expect(haversineKm({ lat: 10, lng: 10 }, { lat: 10, lng: 10 })).toBe(0);
  });
});
