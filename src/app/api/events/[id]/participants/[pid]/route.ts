import { roundPoint } from "@/lib/geo";
import { EVENT_ID_RE, isOrganizer, isOwner } from "@/lib/server/auth";
import { recompute } from "@/lib/server/compute";
import { clientIp, errors, json, readJson } from "@/lib/server/http";
import { allow } from "@/lib/server/rate-limit";
import { getStore, type ParticipantPatch } from "@/lib/server/store";
import * as v from "@/lib/server/validate";

type Ctx = { params: Promise<{ id: string; pid: string }> };

const OWNER_FIELDS = ["name", "lat", "lng", "precision"];
const ORGANIZER_FIELDS = ["weight"];

export async function PATCH(req: Request, ctx: Ctx) {
  const { id, pid } = await ctx.params;
  if (!EVENT_ID_RE.test(id)) return errors.notFound();
  if (!allow("write", clientIp(req), id)) return errors.tooMany();
  const store = await getStore();
  const current = await store.getParticipant(id, pid);
  if (!current) return errors.notFound();
  const body = await readJson(req);
  if (!body) return errors.bad("Expected a JSON body.");

  const [owner, organizer] = await Promise.all([isOwner(req, store, pid), isOrganizer(req, store, id)]);
  const fields = Object.keys(body);
  if (fields.some((f) => OWNER_FIELDS.includes(f)) && !owner) return errors.forbidden();
  if (fields.some((f) => ORGANIZER_FIELDS.includes(f)) && !organizer) return errors.forbidden();

  const patch: ParticipantPatch = {};
  if ("name" in body) {
    const r = v.name(body.name, 60);
    if (!r.ok) return errors.bad(r.error);
    patch.name = r.value;
  }
  const precision = "precision" in body ? v.precision(body.precision) : ({ ok: true, value: current.precision } as const);
  if (!precision.ok) return errors.bad(precision.error);
  patch.precision = precision.value;
  if ("lat" in body || "lng" in body) {
    const r = v.location(body.lat ?? null, body.lng ?? null, precision.value);
    if (!r.ok) return errors.bad(r.error);
    patch.lat = r.value?.lat ?? null;
    patch.lng = r.value?.lng ?? null;
  } else if (precision.value !== current.precision && current.lat !== null && current.lng !== null) {
    // Precision changed without a new point: re-round what we have.
    const r = roundPoint({ lat: current.lat, lng: current.lng }, precision.value);
    patch.lat = r.lat;
    patch.lng = r.lng;
  }
  if ("weight" in body) {
    const r = v.weight(body.weight);
    if (!r.ok) return errors.bad(r.error);
    patch.weight = r.value;
  }

  const participant = await store.updateParticipant(id, pid, patch);
  await recompute(id);
  return json({ participant });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id, pid } = await ctx.params;
  if (!EVENT_ID_RE.test(id)) return errors.notFound();
  if (!allow("write", clientIp(req), id)) return errors.tooMany();
  const store = await getStore();
  if (!(await store.getParticipant(id, pid))) return errors.notFound();
  const [owner, organizer] = await Promise.all([isOwner(req, store, pid), isOrganizer(req, store, id)]);
  if (!owner && !organizer) return errors.forbidden();
  await store.deleteParticipant(id, pid);
  await recompute(id);
  return json({ ok: true });
}
