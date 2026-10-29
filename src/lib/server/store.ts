import type { CenterResult, EventPublic, Mode, ParticipantPublic, Precision, Priority } from "../types";

export interface NewEvent {
  id: string;
  name: string;
  meetingAt: string | null;
  organizerTokenHash: string;
}

export interface EventPatch {
  name?: string;
  meetingAt?: string | null;
  mode?: Mode;
  priority?: Priority;
}

export interface NewParticipant {
  eventId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  precision: Precision;
  editTokenHash: string;
}

export interface ParticipantPatch {
  name?: string;
  lat?: number | null;
  lng?: number | null;
  precision?: Precision;
  weight?: number;
}

export interface MatrixCell {
  durationS: number | null;
  distanceM: number | null;
}

/**
 * Persistence for events, participants, and the ORS cache/usage counters.
 * Coordinates passed in must already be rounded; implementations never see
 * an exact point.
 */
export interface Store {
  readonly kind: "memory" | "supabase";
  createEvent(e: NewEvent): Promise<EventPublic>;
  getEvent(id: string): Promise<EventPublic | null>;
  getOrganizerTokenHash(eventId: string): Promise<string | null>;
  updateEvent(id: string, patch: EventPatch): Promise<EventPublic | null>;
  /** Save only if the event's version still equals `version`. */
  saveResult(id: string, version: number, result: CenterResult | null): Promise<boolean>;

  listParticipants(eventId: string): Promise<ParticipantPublic[]>;
  countParticipants(eventId: string): Promise<number>;
  getParticipant(eventId: string, id: string): Promise<ParticipantPublic | null>;
  getEditTokenHash(participantId: string): Promise<string | null>;
  addParticipant(p: NewParticipant): Promise<ParticipantPublic>;
  updateParticipant(eventId: string, id: string, patch: ParticipantPatch): Promise<ParticipantPublic | null>;
  deleteParticipant(eventId: string, id: string): Promise<boolean>;

  getMatrixCells(keys: string[]): Promise<Map<string, MatrixCell>>;
  putMatrixCells(cells: Map<string, MatrixCell>): Promise<void>;
  /** Add `by` to today's counter for `kind` and return the new total. */
  incrementUsage(day: string, kind: string, by: number): Promise<number>;
  getUsage(day: string, kind: string): Promise<number>;
}

let cached: Store | null = null;

export async function getStore(): Promise<Store> {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const { SupabaseStore } = await import("./supabase-store");
    cached = new SupabaseStore(url, key);
  } else {
    const { memoryStore } = await import("./memory-store");
    cached = memoryStore();
  }
  return cached;
}

/** For tests. */
export function setStore(s: Store | null) {
  cached = s;
}
