import { describe, expect, it } from "vitest";
import { distanceCenter, type Located } from "@/lib/center";
import { haversineKm } from "@/lib/geo";
import { gridSearch } from "@/lib/grid";

const person = (id: string, lat: number, lng: number, weight = 1): Located => ({ id, name: id, lat, lng, weight });

describe("grid refinement", () => {
  it("a symmetric pair lands on the midpoint (least total)", () => {
    const c = distanceCenter([person("a", 40.7, -74.1), person("b", 40.7, -73.9)], "total");
    expect(c.lat).toBeCloseTo(40.7, 3);
    expect(c.lng).toBeCloseTo(-74.0, 3);
  });

  it("a symmetric pair lands on the midpoint (even out)", () => {
    const a = person("a", 51.4, -0.2);
    const b = person("b", 51.6, 0.0);
    const c = distanceCenter([a, b], "even");
    // "Even out" is flat to second order along the bisector, so allow a few tens of metres.
    expect(haversineKm(c, { lat: 51.5, lng: -0.1 })).toBeLessThan(0.1);
    expect(Math.abs(haversineKm(a, c) - haversineKm(b, c))).toBeLessThan(0.001);
  });

  it("a symmetric square lands on its center", () => {
    const c = distanceCenter(
      [person("a", 0, 0), person("b", 0, 1), person("c", 1, 0), person("d", 1, 1)],
      "total",
    );
    expect(c.lat).toBeCloseTo(0.5, 3);
    expect(c.lng).toBeCloseTo(0.5, 3);
  });

  it("a heavy weight pulls the center toward that person (even out)", () => {
    const a = person("a", 40.7, -74.1, 3);
    const b = person("b", 40.7, -73.9, 1);
    const c = distanceCenter([a, b], "even");
    const da = haversineKm(a, c);
    const db = haversineKm(b, c);
    expect(da).toBeLessThan(db);
    // max(w*d) is minimised where 3*da = db.
    expect(db / da).toBeCloseTo(3, 1);
  });

  it("a heavy weight pulls the center toward that person (least total)", () => {
    const people = [person("a", 0, 0, 2), person("b", 0, 1), person("c", 1, 0.5)];
    const equal = distanceCenter(people.map((p) => ({ ...p, weight: 1 })), "total");
    const heavy = distanceCenter(people, "total");
    expect(haversineKm(people[0], heavy)).toBeLessThan(haversineKm(people[0], equal));
  });

  it("one person: the center is their point", () => {
    const c = distanceCenter([person("a", 12.3456, 65.4321)], "total");
    expect(c.lat).toBeCloseTo(12.3456, 4);
    expect(c.lng).toBeCloseTo(65.4321, 4);
  });

  it("refines well below the coarse grid spacing", () => {
    // Optimum of f is (0.123, 0.456): off every coarse grid point.
    const target = { lat: 0.123, lng: 0.456 };
    const out = gridSearch([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }], (pts) =>
      pts.map((p) => (p.lat - target.lat) ** 2 + (p.lng - target.lng) ** 2),
    );
    expect(out.best.point.lat).toBeCloseTo(target.lat, 3);
    expect(out.best.point.lng).toBeCloseTo(target.lng, 3);
    expect(out.finalists.length).toBe(5);
  });
});
