import { beforeEach, describe, expect, it } from "vitest";
import { POST as createEvent } from "@/app/api/events/route";
import { GET as getEvent, PATCH as patchEvent } from "@/app/api/events/[id]/route";
import { POST as join } from "@/app/api/events/[id]/participants/route";
import { DELETE as removeParticipant, PATCH as patchParticipant } from "@/app/api/events/[id]/participants/[pid]/route";
import { GET as places } from "@/app/api/events/[id]/places/route";
import { POST as geocode } from "@/app/api/geocode/route";
import { haversineKm } from "@/lib/geo";
import { MemoryStore } from "@/lib/server/memory-store";
import { OrsClient, setOrs } from "@/lib/server/ors";
import { setStore } from "@/lib/server/store";
import type { CenterResult, EventPublic, ParticipantPublic } from "@/lib/types";
import { fakeOrs } from "../helpers/fake-ors";

let ip = 0;
const req = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://test${url}`, {
    method,
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.0.0.${ip}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const p = <T extends object>(params: T) => ({ params: Promise.resolve(params) });

async function setup() {
  const res = await createEvent(req("POST", "/api/events", { name: "Lunch", meetingAt: "2026-11-02T17:00:00Z" }));
  expect(res.status).toBe(201);
  const { event, organizerToken } = (await res.json()) as { event: EventPublic; organizerToken: string };
  const org = { "x-organizer-token": organizerToken };
  const add = async (name: string, lat: number, lng: number, precision = 4) => {
    const r = await join(req("POST", `/api/events/${event.id}/participants`, { name, lat, lng, precision }), p({ id: event.id }));
    expect(r.status).toBe(201);
    return (await r.json()) as { participant: ParticipantPublic; editToken: string };
  };
  const read = async (headers: Record<string, string> = {}) =>
    (await (await getEvent(req("GET", `/api/events/${event.id}`, undefined, headers), p({ id: event.id }))).json()) as {
      event: EventPublic & { result: CenterResult };
      participants: ParticipantPublic[];
      isOrganizer: boolean;
      capabilities: { drive: boolean };
    };
  return { id: event.id, org, add, read };
}

describe("API with mocked openrouteservice", () => {
  let ors: ReturnType<typeof fakeOrs>;
  let store: MemoryStore;
  beforeEach(() => {
    ip++;
    store = new MemoryStore();
    setStore(store);
    ors = fakeOrs({ slowNear: { lat: 40.75, lng: -74.0 } });
    setOrs(new OrsClient({ apiKey: "test-key", store, fetchImpl: ors.impl }));
  });

  it("rounds on the server even if the client sends an exact point", async () => {
    const { add, read } = await setup();
    const { participant } = await add("A", 40.748817, -73.985428, 2);
    expect(participant).toMatchObject({ lat: 40.75, lng: -73.99 });
    const { participants } = await read();
    expect(participants[0]).toMatchObject({ lat: 40.75, lng: -73.99 });
    expect(JSON.stringify(participants)).not.toContain("40.7488");
  });

  it("computes a distance center, then a drive center with few matrix calls and caching", async () => {
    const { id, org, add, read } = await setup();
    await add("A", 40.7, -74.1);
    await add("B", 40.8, -73.9);
    let { event } = await read();
    expect(event.result.mode).toBe("distance");
    expect(event.result.center.lat).toBeCloseTo(40.75, 2);
    expect(ors.log.matrix).toHaveLength(0);

    const r = await patchEvent(req("PATCH", `/api/events/${id}`, { mode: "drive" }, org), p({ id }));
    expect(r.status).toBe(200);
    ({ event } = await read());
    const res = event.result;
    expect(res.mode).toBe("drive");
    expect(res.costUnit).toBe("min");
    expect(res.notice).toBeNull();
    // coarse pass + verify + snapped re-check
    expect(ors.log.matrix.length).toBeLessThanOrEqual(3);
    expect(ors.log.matrix[0]).toEqual({ sources: 2, destinations: 49 });
    expect(ors.log.snap).toBe(1);
    expect(res.snapped).toBe(true);
    // The slow zone around the midpoint pushes the drive center away from it.
    expect(res.centersApartKm).toBeGreaterThan(1);
    expect(haversineKm(res.center, { lat: 40.75, lng: -74.0 })).toBeGreaterThan(4);
    for (const t of res.trips) {
      expect(t.durationMin).toBeGreaterThan(0);
      expect(t.distanceKm).toBeGreaterThan(0);
    }

    // Changing only the priority reuses the cached coarse matrix.
    const before = ors.log.matrix.length;
    await patchEvent(req("PATCH", `/api/events/${id}`, { priority: "even" }, org), p({ id }));
    const coarseAgain = ors.log.matrix.slice(before).find((m) => m.destinations === 49);
    expect(coarseAgain).toBeUndefined();
  });

  it("enforces organizer and owner permissions", async () => {
    const { id, org, add, read } = await setup();
    const a = await add("A", 40.7, -74.1);
    const b = await add("B", 40.8, -73.9);
    const url = (pid: string) => `/api/events/${id}/participants/${pid}`;
    const ctx = (pid: string) => p({ id, pid });

    // participant cannot change weights or settings
    expect((await patchParticipant(req("PATCH", url(a.participant.id), { weight: 3 }, { "x-edit-token": a.editToken }), ctx(a.participant.id))).status).toBe(403);
    expect((await patchEvent(req("PATCH", `/api/events/${id}`, { priority: "even" }, { "x-edit-token": a.editToken }), p({ id }))).status).toBe(403);
    // participant cannot move or delete someone else's pin
    expect((await patchParticipant(req("PATCH", url(b.participant.id), { lat: 1, lng: 1 }, { "x-edit-token": a.editToken }), ctx(b.participant.id))).status).toBe(403);
    expect((await removeParticipant(req("DELETE", url(b.participant.id), undefined, { "x-edit-token": a.editToken }), ctx(b.participant.id))).status).toBe(403);
    // organizer cannot move someone's pin, but can weight and remove them
    expect((await patchParticipant(req("PATCH", url(b.participant.id), { lat: 1, lng: 1 }, org), ctx(b.participant.id))).status).toBe(403);
    expect((await patchParticipant(req("PATCH", url(b.participant.id), { weight: 2 }, org), ctx(b.participant.id))).status).toBe(200);
    expect((await patchParticipant(req("PATCH", url(b.participant.id), { weight: 2.5 }, org), ctx(b.participant.id))).status).toBe(400);
    // owner can move their own pin
    expect((await patchParticipant(req("PATCH", url(a.participant.id), { lat: 40.71, lng: -74.11 }, { "x-edit-token": a.editToken }), ctx(a.participant.id))).status).toBe(200);
    expect((await removeParticipant(req("DELETE", url(b.participant.id), undefined, org), ctx(b.participant.id))).status).toBe(200);
    const { participants, isOrganizer } = await read(org);
    expect(participants.map((x) => x.name)).toEqual(["A"]);
    expect(isOrganizer).toBe(true);
  });

  it("drive mode requires a meeting time and locks again when it is cleared", async () => {
    const res = await createEvent(req("POST", "/api/events", { name: "No time" }));
    const { event, organizerToken } = await res.json();
    const org = { "x-organizer-token": organizerToken };
    const ctx = p({ id: event.id });
    expect((await patchEvent(req("PATCH", `/api/events/${event.id}`, { mode: "drive" }, org), ctx)).status).toBe(400);
    await patchEvent(req("PATCH", `/api/events/${event.id}`, { meetingAt: "2026-11-02T17:00:00Z", mode: "drive" }, org), ctx);
    const r = await patchEvent(req("PATCH", `/api/events/${event.id}`, { meetingAt: null }, org), ctx);
    expect((await r.json()).event.mode).toBe("distance");
  });

  it("proxies geocoding and places through ORS, keeping only named places", async () => {
    const { id, add } = await setup();
    await add("A", 40.7, -74.1);
    await add("B", 40.8, -73.9);
    const g = await (await geocode(req("POST", "/api/geocode", { event: id, q: "empire state" }))).json();
    expect(g.results[0]).toMatchObject({ label: expect.stringContaining("Empire"), lat: 40.74844 });
    const pl = await (await places(req("GET", `/api/events/${id}/places?filter=coffee`), p({ id }))).json();
    expect(pl.places).toHaveLength(1);
    expect(pl.places[0]).toMatchObject({ name: "Corner Cafe", openingHours: "Mo-Fr 07:00-18:00" });
  });

  it("rate limits writes per IP", async () => {
    const { id } = await setup();
    let last = 0;
    for (let i = 0; i < 61; i++) {
      last = (await join(req("POST", `/api/events/${id}/participants`, { name: `P${i}` }), p({ id }))).status;
    }
    expect(last).toBe(429);
  });
});
