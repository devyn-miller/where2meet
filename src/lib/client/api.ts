import type { Place, PlaceFilter } from "../places";
import type { EventPublic, Mode, ParticipantPublic, Precision, Priority } from "../types";
import { keys, storage, type MyRow } from "./storage";

export interface Capabilities {
  drive: boolean;
  geocode: boolean;
  places: boolean;
  realtime: boolean;
}

export interface EventData {
  event: EventPublic;
  participants: ParticipantPublic[];
  isOrganizer: boolean;
  capabilities: Capabilities;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function authHeaders(eventId: string): Record<string, string> {
  const h: Record<string, string> = {};
  const org = storage.get<string>(keys.organizer(eventId));
  if (org) h["x-organizer-token"] = org;
  const me = storage.get<MyRow>(keys.me(eventId));
  if (me) h["x-edit-token"] = me.editToken;
  return h;
}

async function call<T>(eventId: string | null, path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(eventId ? authHeaders(eventId) : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  createEvent: (name: string, meetingAt: string | null) =>
    call<{ event: EventPublic; organizerToken: string }>(null, "/api/events", "POST", { name, meetingAt }),
  getEvent: (id: string) => call<EventData>(id, `/api/events/${id}`),
  updateEvent: (id: string, patch: { name?: string; meetingAt?: string | null; mode?: Mode; priority?: Priority }) =>
    call<{ event: EventPublic }>(id, `/api/events/${id}`, "PATCH", patch),
  join: (id: string, body: { name: string; precision: Precision; lat?: number; lng?: number }) =>
    call<{ participant: ParticipantPublic; editToken: string }>(id, `/api/events/${id}/participants`, "POST", body),
  updateParticipant: (
    id: string,
    pid: string,
    patch: { name?: string; lat?: number | null; lng?: number | null; precision?: Precision; weight?: number },
  ) => call<{ participant: ParticipantPublic }>(id, `/api/events/${id}/participants/${pid}`, "PATCH", patch),
  removeParticipant: (id: string, pid: string) => call<{ ok: true }>(id, `/api/events/${id}/participants/${pid}`, "DELETE"),
  geocode: (id: string, q: string, focus?: { lat: number; lng: number }) =>
    call<{ results: { label: string; lat: number; lng: number }[]; unavailable: boolean }>(null, "/api/geocode", "POST", {
      event: id,
      q,
      // Only a coarse hint, to bias results toward the group.
      focus: focus && { lat: Math.round(focus.lat * 10) / 10, lng: Math.round(focus.lng * 10) / 10 },
    }),
  places: (id: string, filter: PlaceFilter) =>
    call<{ places: Place[]; unavailable: boolean }>(null, `/api/events/${id}/places?filter=${filter}`),
};
