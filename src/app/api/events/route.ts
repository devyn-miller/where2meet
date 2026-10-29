import { clientIp, errors, json, readJson } from "@/lib/server/http";
import { allow } from "@/lib/server/rate-limit";
import { getStore } from "@/lib/server/store";
import { hashToken, newEventId, newToken } from "@/lib/server/tokens";
import * as v from "@/lib/server/validate";

export async function POST(req: Request) {
  if (!allow("create", clientIp(req))) return errors.tooMany();
  const body = await readJson(req);
  if (!body) return errors.bad("Expected a JSON body.");
  const n = v.name(body.name, 100);
  if (!n.ok) return errors.bad(n.error);
  const m = v.meetingAt(body.meetingAt ?? null);
  if (!m.ok) return errors.bad(m.error);

  const store = await getStore();
  const organizerToken = newToken();
  const event = await store.createEvent({
    id: newEventId(),
    name: n.value,
    meetingAt: m.value,
    organizerTokenHash: hashToken(organizerToken),
  });
  return json({ event, organizerToken }, 201);
}
