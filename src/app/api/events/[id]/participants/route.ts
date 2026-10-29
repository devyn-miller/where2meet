import { EVENT_ID_RE } from "@/lib/server/auth";
import { recompute } from "@/lib/server/compute";
import { clientIp, errors, json, readJson } from "@/lib/server/http";
import { allow } from "@/lib/server/rate-limit";
import { getStore } from "@/lib/server/store";
import { hashToken, newToken } from "@/lib/server/tokens";
import * as v from "@/lib/server/validate";

const MAX_PARTICIPANTS = 50;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!EVENT_ID_RE.test(id)) return errors.notFound();
  if (!allow("write", clientIp(req), id)) return errors.tooMany();
  const store = await getStore();
  if (!(await store.getEvent(id))) return errors.notFound();
  const body = await readJson(req);
  if (!body) return errors.bad("Expected a JSON body.");

  const n = v.name(body.name, 60);
  if (!n.ok) return errors.bad(n.error);
  const p = v.precision(body.precision ?? 3);
  if (!p.ok) return errors.bad(p.error);
  const loc = v.location(body.lat ?? null, body.lng ?? null, p.value);
  if (!loc.ok) return errors.bad(loc.error);
  if ((await store.countParticipants(id)) >= MAX_PARTICIPANTS) {
    return errors.bad(`This event is full (${MAX_PARTICIPANTS} people).`);
  }

  const editToken = newToken();
  const participant = await store.addParticipant({
    eventId: id,
    name: n.value,
    precision: p.value,
    lat: loc.value?.lat ?? null,
    lng: loc.value?.lng ?? null,
    editTokenHash: hashToken(editToken),
  });
  await recompute(id);
  return json({ participant, editToken }, 201);
}
