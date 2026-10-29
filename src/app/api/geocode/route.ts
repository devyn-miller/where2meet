import { isValidLatLng } from "@/lib/geo";
import { EVENT_ID_RE } from "@/lib/server/auth";
import { clientIp, errors, json, readJson } from "@/lib/server/http";
import { getOrs, OrsUnavailable } from "@/lib/server/ors";
import { allow } from "@/lib/server/rate-limit";
import { getStore } from "@/lib/server/store";

/**
 * Address search proxy. The query and results pass straight through: nothing
 * here is stored or logged. It is a POST so the typed address never appears in
 * a URL (and so never in host access logs). Results go back to the searcher's
 * browser, which rounds the chosen point before sending it anywhere.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return errors.bad("Expected a JSON body.");
  const eventId = typeof body.event === "string" ? body.event : "";
  if (!EVENT_ID_RE.test(eventId)) return errors.bad("Missing event.");
  if (!allow("geocode", clientIp(req), eventId)) return errors.tooMany();
  const q = typeof body.q === "string" ? body.q.trim() : "";
  if (q.length < 3 || q.length > 200) return json({ results: [], unavailable: false });
  const store = await getStore();
  if (!(await store.getEvent(eventId))) return errors.notFound();

  const focus = body.focus && typeof body.focus === "object" ? (body.focus as { lat: unknown; lng: unknown }) : null;
  try {
    const results = await getOrs(store).geocode(q, focus && isValidLatLng(focus) ? focus : undefined);
    return json({ results, unavailable: false });
  } catch (e) {
    if (e instanceof OrsUnavailable) return json({ results: [], unavailable: true });
    throw e;
  }
}
