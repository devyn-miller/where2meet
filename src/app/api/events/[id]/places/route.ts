import { isPlaceFilter } from "@/lib/places";
import { EVENT_ID_RE } from "@/lib/server/auth";
import { clientIp, errors, json } from "@/lib/server/http";
import { getOrs, OrsUnavailable } from "@/lib/server/ors";
import { nearbyPlaces } from "@/lib/server/places";
import { allow } from "@/lib/server/rate-limit";
import { getStore } from "@/lib/server/store";

type Ctx = { params: Promise<{ id: string }> };

/** Places near the event's current center. The center comes from the server, not the request. */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!EVENT_ID_RE.test(id)) return errors.notFound();
  if (!allow("places", clientIp(req), id)) return errors.tooMany();
  const filter = new URL(req.url).searchParams.get("filter") ?? "anything";
  if (!isPlaceFilter(filter)) return errors.bad("Unknown filter.");
  const store = await getStore();
  const event = await store.getEvent(id);
  if (!event) return errors.notFound();
  if (!event.result) return json({ places: [], unavailable: false });
  try {
    const places = await nearbyPlaces(getOrs(store), event.result.center, filter);
    return json({ places, unavailable: false });
  } catch (e) {
    if (e instanceof OrsUnavailable) return json({ places: [], unavailable: true });
    throw e;
  }
}
