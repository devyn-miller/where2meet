import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CenterResult, EventPublic, Mode, ParticipantPublic, Precision, Priority } from "../types";
import type { EventPatch, MatrixCell, NewEvent, NewParticipant, ParticipantPatch, Store } from "./store";

interface EventDb {
  id: string;
  name: string;
  meeting_at: string | null;
  mode: Mode;
  priority: Priority;
  version: number;
  result: CenterResult | null;
  created_at: string;
}
interface ParticipantDb {
  id: string;
  name: string;
  lat: number | string | null;
  lng: number | string | null;
  precision: Precision;
  weight: number | string;
}

const EVENT_COLS = "id,name,meeting_at,mode,priority,version,result,created_at";
const PARTICIPANT_COLS = "id,name,lat,lng,precision,weight";

const toEvent = (r: EventDb): EventPublic => ({
  id: r.id,
  name: r.name,
  meetingAt: r.meeting_at,
  mode: r.mode,
  priority: r.priority,
  version: r.version,
  result: r.result,
  createdAt: r.created_at,
});

// numeric columns come back as strings
const num = (v: number | string | null) => (v === null ? null : Number(v));
const toParticipant = (r: ParticipantDb): ParticipantPublic => ({
  id: r.id,
  name: r.name,
  lat: num(r.lat),
  lng: num(r.lng),
  precision: r.precision,
  weight: Number(r.weight),
});

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`supabase: ${res.error.message}`);
  return res.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Service-role store. Used only inside API routes. */
export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async createEvent(n: NewEvent) {
    const row = check(
      await this.db.from("events").insert({ id: n.id, name: n.name, meeting_at: n.meetingAt }).select(EVENT_COLS).single(),
    ) as EventDb;
    check(await this.db.from("event_secrets").insert({ event_id: n.id, organizer_token_hash: n.organizerTokenHash }));
    return toEvent(row);
  }
  async getEvent(id: string) {
    const row = check(await this.db.from("events").select(EVENT_COLS).eq("id", id).maybeSingle()) as EventDb | null;
    return row ? toEvent(row) : null;
  }
  async getOrganizerTokenHash(id: string) {
    const row = check(
      await this.db.from("event_secrets").select("organizer_token_hash").eq("event_id", id).maybeSingle(),
    ) as { organizer_token_hash: string } | null;
    return row?.organizer_token_hash ?? null;
  }
  async updateEvent(id: string, patch: EventPatch) {
    const upd: Record<string, unknown> = {};
    if (patch.name !== undefined) upd.name = patch.name;
    if (patch.meetingAt !== undefined) upd.meeting_at = patch.meetingAt;
    if (patch.mode !== undefined) upd.mode = patch.mode;
    if (patch.priority !== undefined) upd.priority = patch.priority;
    const row = check(await this.db.from("events").update(upd).eq("id", id).select(EVENT_COLS).maybeSingle()) as EventDb | null;
    return row ? toEvent(row) : null;
  }
  async saveResult(id: string, version: number, result: CenterResult | null) {
    const rows = check(
      await this.db.from("events").update({ result }).eq("id", id).eq("version", version).select("id"),
    ) as { id: string }[];
    return rows.length > 0;
  }

  async listParticipants(eventId: string) {
    const rows = check(
      await this.db.from("participants").select(PARTICIPANT_COLS).eq("event_id", eventId).order("created_at"),
    ) as ParticipantDb[];
    return rows.map(toParticipant);
  }
  async countParticipants(eventId: string) {
    const res = await this.db.from("participants").select("id", { count: "exact", head: true }).eq("event_id", eventId);
    if (res.error) throw new Error(`supabase: ${res.error.message}`);
    return res.count ?? 0;
  }
  async getParticipant(eventId: string, id: string) {
    if (!UUID_RE.test(id)) return null;
    const row = check(
      await this.db.from("participants").select(PARTICIPANT_COLS).eq("event_id", eventId).eq("id", id).maybeSingle(),
    ) as ParticipantDb | null;
    return row ? toParticipant(row) : null;
  }
  async getEditTokenHash(id: string) {
    if (!UUID_RE.test(id)) return null;
    const row = check(
      await this.db.from("participant_secrets").select("edit_token_hash").eq("participant_id", id).maybeSingle(),
    ) as { edit_token_hash: string } | null;
    return row?.edit_token_hash ?? null;
  }
  async addParticipant(n: NewParticipant) {
    const row = check(
      await this.db
        .from("participants")
        .insert({ event_id: n.eventId, name: n.name, lat: n.lat, lng: n.lng, precision: n.precision })
        .select(PARTICIPANT_COLS)
        .single(),
    ) as ParticipantDb;
    check(await this.db.from("participant_secrets").insert({ participant_id: row.id, edit_token_hash: n.editTokenHash }));
    return toParticipant(row);
  }
  async updateParticipant(eventId: string, id: string, patch: ParticipantPatch) {
    if (!UUID_RE.test(id)) return null;
    const upd = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const row = check(
      await this.db.from("participants").update(upd).eq("event_id", eventId).eq("id", id).select(PARTICIPANT_COLS).maybeSingle(),
    ) as ParticipantDb | null;
    return row ? toParticipant(row) : null;
  }
  async deleteParticipant(eventId: string, id: string) {
    if (!UUID_RE.test(id)) return false;
    const rows = check(
      await this.db.from("participants").delete().eq("event_id", eventId).eq("id", id).select("id"),
    ) as { id: string }[];
    return rows.length > 0;
  }

  async getMatrixCells(keys: string[]) {
    const out = new Map<string, MatrixCell>();
    // PostgREST URLs have a length limit; query in chunks.
    for (let i = 0; i < keys.length; i += 150) {
      const rows = check(
        await this.db.from("ors_matrix_cache").select("key,duration_s,distance_m").in("key", keys.slice(i, i + 150)),
      ) as { key: string; duration_s: number | null; distance_m: number | null }[];
      for (const r of rows) out.set(r.key, { durationS: r.duration_s, distanceM: r.distance_m });
    }
    return out;
  }
  async putMatrixCells(cells: Map<string, MatrixCell>) {
    if (cells.size === 0) return;
    const rows = [...cells].map(([key, c]) => ({ key, duration_s: c.durationS, distance_m: c.distanceM }));
    check(await this.db.from("ors_matrix_cache").upsert(rows));
  }
  async incrementUsage(day: string, kind: string, by: number) {
    return check(await this.db.rpc("increment_ors_usage", { p_day: day, p_kind: kind, p_by: by })) as number;
  }
  async getUsage(day: string, kind: string) {
    const row = check(
      await this.db.from("ors_usage").select("count").eq("day", day).eq("kind", kind).maybeSingle(),
    ) as { count: number } | null;
    return row?.count ?? 0;
  }
}
