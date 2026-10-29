import { EVENT_ID_RE, isOrganizer } from "@/lib/server/auth";
import { recompute } from "@/lib/server/compute";
import { clientIp, errors, json, readJson } from "@/lib/server/http";
import { getOrs } from "@/lib/server/ors";
import { allow } from "@/lib/server/rate-limit";
import { getStore } from "@/lib/server/store";
import * as v from "@/lib/server/validate";
import type { EventPatch } from "@/lib/server/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!EVENT_ID_RE.test(id)) return errors.notFound();
  if (!allow("read", clientIp(req), id)) return errors.tooMany();
  const store = await getStore();
  const event = await store.getEvent(id);
  if (!event) return errors.notFound();
  const ors = getOrs(store);
  const [participants, organizer, matrix, geocode, pois] = await Promise.all([
    store.listParticipants(id),
    isOrganizer(req, store, id),
    ors.available("matrix"),
    ors.available("geocode"),
    ors.available("pois"),
  ]);
  return json({
    event,
    participants,
    isOrganizer: organizer,
    capabilities: { drive: matrix, geocode, places: pois, realtime: store.kind === "supabase" },
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!EVENT_ID_RE.test(id)) return errors.notFound();
  if (!allow("write", clientIp(req), id)) return errors.tooMany();
  const store = await getStore();
  const current = await store.getEvent(id);
  if (!current) return errors.notFound();
  if (!(await isOrganizer(req, store, id))) return errors.forbidden();
  const body = await readJson(req);
  if (!body) return errors.bad("Expected a JSON body.");

  const patch: EventPatch = {};
  if ("name" in body) {
    const r = v.name(body.name, 100);
    if (!r.ok) return errors.bad(r.error);
    patch.name = r.value;
  }
  if ("meetingAt" in body) {
    const r = v.meetingAt(body.meetingAt);
    if (!r.ok) return errors.bad(r.error);
    patch.meetingAt = r.value;
  }
  if ("mode" in body) {
    const r = v.mode(body.mode);
    if (!r.ok) return errors.bad(r.error);
    patch.mode = r.value;
  }
  if ("priority" in body) {
    const r = v.priority(body.priority);
    if (!r.ok) return errors.bad(r.error);
    patch.priority = r.value;
  }
  const meeting = patch.meetingAt !== undefined ? patch.meetingAt : current.meetingAt;
  const mode = patch.mode ?? current.mode;
  if (mode === "drive" && !meeting) {
    if (patch.mode === "drive") return errors.bad("Set a meeting time to use drive-time mode.");
    patch.mode = "distance"; // meeting time cleared: drive mode locks again
  }

  await store.updateEvent(id, patch);
  await recompute(id);
  return json({ event: await store.getEvent(id) });
}
