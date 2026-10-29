import { isValidLatLng } from "@/lib/geo";
import { EVENT_ID_RE } from "@/lib/server/auth";
import { clientIp, errors, json } from "@/lib/server/http";
import { getOrs, OrsUnavailable } from "@/lib/server/ors";
import { allow } from "@/lib/server/rate-limit";
import { getStore } from "@/lib/server/store";

/**
 * Address search proxy. The query and results pass straight through: nothing
 * here is stored or logged. Results go back to the searcher's browser, which
 * rounds the chosen point before sending it anywhere.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const eventId = params.get("event") ?? "";
  if (!EVENT_ID_RE.test(eventId)) return errors.bad("Missing event.");
  if (!allow("geocode", clientIp(req), eventId)) return errors.tooMany();
  const q = (params.get("q") ?? "").trim();
  if (q.length < 3 || q.length > 200) return json({ results: [] });
  const store = await getStore();
  if (!(await store.getEvent(eventId))) return errors.notFound();

  const focus = { lat: Number(params.get("lat")), lng: Number(params.get("lng")) };
  try {
    const results = await getOrs(store).geocode(
      q,
      params.has("lat") && isValidLatLng(focus) ? focus : undefined,
    );
    return json({ results, unavailable: false });
  } catch (e) {
    if (e instanceof OrsUnavailable) return json({ results: [], unavailable: true });
    throw e;
  }
}
