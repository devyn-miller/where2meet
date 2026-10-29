import { beforeEach, describe, expect, it } from "vitest";
import { computeDistanceResult } from "@/lib/center";
import { DRIVE_UNAVAILABLE, recompute } from "@/lib/server/compute";
import { MemoryStore } from "@/lib/server/memory-store";
import { ORS_DAILY_LIMITS, OrsClient, OrsUnavailable, setOrs } from "@/lib/server/ors";
import { RateLimiter } from "@/lib/server/rate-limit";
import { setStore } from "@/lib/server/store";
import { fakeOrs } from "../helpers/fake-ors";

const day = () => new Date().toISOString().slice(0, 10);

describe("RateLimiter", () => {
  it("allows up to the limit per window, then resets", () => {
    let t = 0;
    const rl = new RateLimiter(() => t);
    expect([1, 2, 3].map(() => rl.take("k", 2, 1000))).toEqual([true, true, false]);
    expect(rl.take("other", 2, 1000)).toBe(true);
    t = 1000;
    expect(rl.take("k", 2, 1000)).toBe(true);
  });
});

describe("ORS budget and fallback", () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = new MemoryStore();
    setStore(store);
  });

  async function driveEvent() {
    const e = await store.createEvent({ id: "evtAAAAAAAAA", name: "x", meetingAt: "2026-11-02T18:00:00Z", organizerTokenHash: "h" });
    await store.updateEvent(e.id, { mode: "drive" });
    await store.addParticipant({ eventId: e.id, name: "A", lat: 40.7, lng: -74.1, precision: 2, editTokenHash: "a" });
    await store.addParticipant({ eventId: e.id, name: "B", lat: 40.8, lng: -73.9, precision: 2, editTokenHash: "b" });
    return e.id;
  }

  it("refuses calls once the daily budget is used up, without hitting the network", async () => {
    const ors = fakeOrs();
    const client = new OrsClient({ apiKey: "k", store, fetchImpl: ors.impl });
    await store.incrementUsage(day(), "matrix", ORS_DAILY_LIMITS.matrix);
    await expect(client.matrix([{ lat: 0, lng: 0 }], [{ lat: 1, lng: 1 }])).rejects.toBeInstanceOf(OrsUnavailable);
    expect(ors.log.matrix).toHaveLength(0);
    expect(await client.available("matrix")).toBe(false);
  });

  it("a provider 403 (quota) marks the kind exhausted for the day", async () => {
    const ors = fakeOrs({ status: { matrix: 403 } });
    const client = new OrsClient({ apiKey: "k", store, fetchImpl: ors.impl });
    await expect(client.matrix([{ lat: 0, lng: 0 }], [{ lat: 1, lng: 1 }])).rejects.toMatchObject({ reason: "quota" });
    expect(await client.available("matrix")).toBe(false);
  });

  it("a provider 429 backs off briefly", async () => {
    const ors = fakeOrs({ status: { geocode: 429 } });
    const client = new OrsClient({ apiKey: "k", store, fetchImpl: ors.impl });
    await expect(client.geocode("abc")).rejects.toMatchObject({ reason: "rate" });
    expect(await client.available("geocode")).toBe(false);
    expect(await client.available("matrix")).toBe(true);
  });

  it("drive mode falls back to straight-line with a visible notice when matrix is exhausted", async () => {
    const id = await driveEvent();
    setOrs(new OrsClient({ apiKey: "k", store, fetchImpl: fakeOrs().impl }));
    await store.incrementUsage(day(), "matrix", ORS_DAILY_LIMITS.matrix);
    const r = await recompute(id);
    expect(r?.requestedMode).toBe("drive");
    expect(r?.mode).toBe("distance");
    expect(r?.notice).toBe(DRIVE_UNAVAILABLE);
    const people = (await store.listParticipants(id)).map((p) => ({ ...p, lat: p.lat!, lng: p.lng! }));
    expect(r?.center).toEqual(computeDistanceResult(people, "total", 0).center);
  });

  it("drive mode falls back when no ORS key is configured", async () => {
    const id = await driveEvent();
    setOrs(new OrsClient({ apiKey: undefined, store }));
    const r = await recompute(id);
    expect(r?.mode).toBe("distance");
    expect(r?.notice).toBe(DRIVE_UNAVAILABLE);
  });
});
