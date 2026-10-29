import { roundTo } from "../geo";
import { PLACE_FILTERS, type Place, type PlaceFilter } from "../places";
import type { LatLng } from "../types";
import type { OrsClient } from "./ors";

const TTL_MS = 60 * 60 * 1000;
const cache: Map<string, { at: number; places: Place[] }> = ((globalThis as { __w2mPlaces?: Map<string, { at: number; places: Place[] }> }).__w2mPlaces ??= new Map());

/**
 * Up to 5 real, named places near the center. Searches 1 km, then 2 km (the
 * ORS maximum) if too few turn up.
 */
export async function nearbyPlaces(ors: OrsClient, center: LatLng, filter: PlaceFilter): Promise<Place[]> {
  const key = `${roundTo(center.lat, 3)},${roundTo(center.lng, 3)}|${filter}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.places;

  const ids = [...PLACE_FILTERS[filter].ids];
  let found = await ors.pois(center, ids, 1000);
  if (found.length < 5) found = await ors.pois(center, ids, 2000);
  const places = found.sort((a, b) => a.distanceM - b.distanceM).slice(0, 5);
  cache.set(key, { at: Date.now(), places });
  return places;
}
