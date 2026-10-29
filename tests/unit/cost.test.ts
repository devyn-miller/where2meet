import { describe, expect, it } from "vitest";
import { weightedAverage, weightedScore } from "@/lib/cost";

describe("weightedScore", () => {
  it("least total sums weight x cost", () => {
    expect(weightedScore([10, 20], [1, 2], "total")).toBeCloseTo(50, 0);
  });

  it("even out takes the max of weight x cost", () => {
    expect(weightedScore([10, 20], [3, 1], "even")).toBeCloseTo(30, 0);
  });

  it("a higher weight makes that person's cost count more", () => {
    const near = weightedScore([5, 15], [2, 1], "total");
    const far = weightedScore([15, 5], [2, 1], "total");
    expect(near).toBeLessThan(far);
  });

  it("unreachable candidates score Infinity", () => {
    expect(weightedScore([1, Infinity], [1, 1], "total")).toBe(Infinity);
  });

  it("tie-break prefers balanced costs when totals are equal", () => {
    expect(weightedScore([10, 10], [1, 1], "total")).toBeLessThan(weightedScore([5, 15], [1, 1], "total"));
  });
});

describe("weightedAverage", () => {
  it("weights each cost", () => {
    expect(weightedAverage([10, 40], [3, 1])).toBe(17.5);
  });
  it("is zero with no people", () => {
    expect(weightedAverage([], [])).toBe(0);
  });
});
