import { haversineKm } from "@/lib/geo";
import type { LatLng } from "@/lib/types";

export interface FakeOrsLog {
  matrix: { sources: number; destinations: number }[];
  snap: number;
  geocode: number;
  pois: number;
}

/**
 * A stand-in for api.openrouteservice.org. Drive time is straight-line
 * distance x 1.3 at 60 km/h; `slowNear` makes trips that end near a point
 * take twice as long, so drive and distance centers differ.
 */
export function fakeOrs(opts: { status?: Partial<Record<string, number>>; slowNear?: LatLng } = {}) {
  const log: FakeOrsLog = { matrix: [], snap: 0, geocode: 0, pois: 0 };
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname;
    const kind = path.includes("matrix") ? "matrix" : path.includes("snap") ? "snap" : path.includes("geocode") ? "geocode" : "pois";
    const forced = opts.status?.[kind];
    if (forced) return respond({ error: "forced" }, forced);
    if (!(init?.headers as Record<string, string>)?.Authorization) return respond({ error: "no key" }, 401);
    const body = init?.body ? JSON.parse(String(init.body)) : null;

    if (kind === "matrix") {
      const locs: [number, number][] = body.locations;
      const src: number[] = body.sources;
      const dst: number[] = body.destinations;
      log.matrix.push({ sources: src.length, destinations: dst.length });
      const pt = (i: number) => ({ lat: locs[i][1], lng: locs[i][0] });
      const durations = src.map((s) =>
        dst.map((d) => {
          const km = haversineKm(pt(s), pt(d)) * 1.3;
          const slow = opts.slowNear && haversineKm(pt(d), opts.slowNear) < 5 ? 2 : 1;
          return (km / 60) * 3600 * slow;
        }),
      );
      const distances = src.map((s) => dst.map((d) => haversineKm(pt(s), pt(d)) * 1300));
      return respond({ durations, distances });
    }
    if (kind === "snap") {
      log.snap++;
      const [lng, lat] = body.locations[0];
      return respond({ locations: [{ location: [lng + 0.0003, lat], snapped_distance: 25 }] });
    }
    if (kind === "geocode") {
      log.geocode++;
      return respond({
        features: [{ geometry: { coordinates: [-73.98565, 40.74844] }, properties: { label: "Empire State Building, New York, NY" } }],
      });
    }
    log.pois++;
    const [lng, lat] = body.geometry.geojson.coordinates;
    return respond({
      type: "FeatureCollection",
      features: [
        { geometry: { coordinates: [lng + 0.001, lat] }, properties: { osm_id: 1, osm_type: 1, distance: 84, category_ids: { "564": { category_name: "cafe", category_group: "sustenance" } }, osm_tags: { name: "Corner Cafe", opening_hours: "Mo-Fr 07:00-18:00" } } },
        { geometry: { coordinates: [lng, lat + 0.002] }, properties: { osm_id: 2, osm_type: 1, distance: 222, category_ids: { "564": { category_name: "cafe", category_group: "sustenance" } }, osm_tags: {} } },
      ],
    });
  };
  return { impl: impl as typeof fetch, log };
}
