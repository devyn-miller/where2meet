import type { LatLng } from "../types";
import type { Store } from "./store";

/** ORS free-tier daily quotas. */
export const ORS_DAILY_LIMITS = {
  directions: 2000,
  matrix: 500,
  geocode: 1000,
  snap: 2000,
  pois: 500,
} as const;
export type OrsKind = keyof typeof ORS_DAILY_LIMITS;

/** Keep a little headroom so a burst can't push us over the provider's limit. */
const SAFETY = 0.95;

export class OrsUnavailable extends Error {
  constructor(
    public reason: "no-key" | "budget" | "quota" | "rate" | "error",
    message?: string,
  ) {
    super(message ?? `openrouteservice unavailable (${reason})`);
  }
}

export interface MatrixResponse {
  /** [source][destination] seconds; null when unroutable. */
  durations: (number | null)[][];
  /** [source][destination] meters. */
  distances: (number | null)[][];
}

export interface GeocodeHit {
  label: string;
  lat: number;
  lng: number;
}

export interface OsmPlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  categories: string[];
  openingHours: string | null;
  distanceM: number;
}

export interface OrsOptions {
  apiKey: string | undefined;
  store: Store;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const ll = (p: LatLng) => [p.lng, p.lat];

export class OrsClient {
  private baseUrl: string;
  private cooldownUntil = new Map<OrsKind, number>();

  constructor(private opts: OrsOptions) {
    this.baseUrl = opts.baseUrl ?? "https://api.openrouteservice.org";
  }

  get configured() {
    return Boolean(this.opts.apiKey);
  }

  private day() {
    return (this.opts.now?.() ?? new Date()).toISOString().slice(0, 10);
  }

  /** Whether a call of this kind would be attempted right now. */
  async available(kind: OrsKind): Promise<boolean> {
    if (!this.opts.apiKey) return false;
    if ((this.cooldownUntil.get(kind) ?? 0) > Date.now()) return false;
    const used = await this.opts.store.getUsage(this.day(), kind);
    return used < ORS_DAILY_LIMITS[kind] * SAFETY;
  }

  private async call<T>(kind: OrsKind, path: string, init: RequestInit): Promise<T> {
    if (!this.opts.apiKey) throw new OrsUnavailable("no-key");
    if ((this.cooldownUntil.get(kind) ?? 0) > Date.now()) throw new OrsUnavailable("rate");
    const day = this.day();
    const used = await this.opts.store.getUsage(day, kind);
    if (used >= ORS_DAILY_LIMITS[kind] * SAFETY) throw new OrsUnavailable("budget");
    await this.opts.store.incrementUsage(day, kind, 1);

    const f = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: this.opts.apiKey,
          Accept: "application/json, application/geo+json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new OrsUnavailable("error", "openrouteservice did not respond");
    }
    if (res.status === 403) {
      // Daily quota exhausted on the provider side: stop trying until tomorrow.
      await this.opts.store.incrementUsage(day, kind, ORS_DAILY_LIMITS[kind]);
      throw new OrsUnavailable("quota");
    }
    if (res.status === 429) {
      // Per-minute limit: back off briefly.
      this.cooldownUntil.set(kind, Date.now() + 60_000);
      throw new OrsUnavailable("rate");
    }
    if (!res.ok) throw new OrsUnavailable("error", `openrouteservice ${res.status}`);
    return (await res.json()) as T;
  }

  async matrix(sources: LatLng[], destinations: LatLng[]): Promise<MatrixResponse> {
    const locations = [...sources, ...destinations].map(ll);
    const body = {
      locations,
      sources: sources.map((_, i) => i),
      destinations: destinations.map((_, i) => sources.length + i),
      metrics: ["duration", "distance"],
      units: "m",
    };
    const r = await this.call<{ durations?: (number | null)[][]; distances?: (number | null)[][] }>(
      "matrix",
      "/v2/matrix/driving-car",
      { method: "POST", body: JSON.stringify(body) },
    );
    if (!r.durations || !r.distances) throw new OrsUnavailable("error", "matrix response missing data");
    return { durations: r.durations, distances: r.distances };
  }

  /** Nearest drivable road point within `radiusM`, or null. */
  async snap(p: LatLng, radiusM = 500): Promise<LatLng | null> {
    const r = await this.call<{ locations?: ({ location: [number, number] } | null)[] }>("snap", "/v2/snap/driving-car", {
      method: "POST",
      body: JSON.stringify({ locations: [ll(p)], radius: radiusM }),
    });
    const hit = r.locations?.[0];
    return hit ? { lat: hit.location[1], lng: hit.location[0] } : null;
  }

  async geocode(text: string, focus?: LatLng): Promise<GeocodeHit[]> {
    const q = new URLSearchParams({ text, size: "6" });
    if (focus) {
      q.set("focus.point.lat", String(focus.lat));
      q.set("focus.point.lon", String(focus.lng));
    }
    const r = await this.call<{
      features?: { geometry: { coordinates: [number, number] }; properties: { label?: string; name?: string } }[];
    }>("geocode", `/geocode/autocomplete?${q}`, { method: "GET" });
    return (r.features ?? []).map((f) => ({
      label: f.properties.label ?? f.properties.name ?? "",
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
    }));
  }

  async pois(center: LatLng, categoryIds: number[], bufferM: number, limit = 50): Promise<OsmPlace[]> {
    const r = await this.call<{
      features?: {
        geometry: { coordinates: [number, number] };
        properties: {
          osm_id: number;
          osm_type: number;
          distance?: number;
          category_ids?: Record<string, { category_name: string; category_group: string }>;
          osm_tags?: Record<string, string>;
        };
      }[];
    }>("pois", "/pois", {
      method: "POST",
      body: JSON.stringify({
        request: "pois",
        geometry: { geojson: { type: "Point", coordinates: ll(center) }, buffer: bufferM },
        filters: { category_ids: categoryIds },
        limit,
        sortby: "distance",
      }),
    });
    return (r.features ?? [])
      .filter((f) => f.properties.osm_tags?.name)
      .map((f) => ({
        id: `${f.properties.osm_type}/${f.properties.osm_id}`,
        name: f.properties.osm_tags!.name,
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        categories: Object.values(f.properties.category_ids ?? {}).map((c) => c.category_name.replace(/_/g, " ")),
        openingHours: f.properties.osm_tags?.opening_hours ?? null,
        distanceM: f.properties.distance ?? 0,
      }));
  }
}

let shared: OrsClient | null = null;
export function getOrs(store: Store): OrsClient {
  if (!shared) shared = new OrsClient({ apiKey: process.env.ORS_API_KEY, store });
  return shared;
}
export function setOrs(c: OrsClient | null) {
  shared = c;
}
