import { randomUUID } from "crypto";
import type { CenterResult, EventPublic, ParticipantPublic } from "../types";
import type { EventPatch, MatrixCell, NewEvent, NewParticipant, ParticipantPatch, Store } from "./store";

interface EventRow extends EventPublic {
  organizerTokenHash: string;
}
interface ParticipantRow extends ParticipantPublic {
  eventId: string;
  editTokenHash: string;
  createdAt: number;
}

const publicEvent = ({ organizerTokenHash: _o, ...e }: EventRow): EventPublic => structuredClone(e);
const publicParticipant = ({ eventId: _e, editTokenHash: _t, createdAt: _c, ...p }: ParticipantRow): ParticipantPublic => ({ ...p });

/** In-process store for local development and tests. Not for production. */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private events = new Map<string, EventRow>();
  private participants = new Map<string, ParticipantRow>();
  private cache = new Map<string, MatrixCell>();
  private usage = new Map<string, number>();
  private seq = 0;

  private bump(eventId: string) {
    const e = this.events.get(eventId);
    if (e) e.version += 1;
  }

  async createEvent(n: NewEvent) {
    const row: EventRow = {
      id: n.id,
      name: n.name,
      meetingAt: n.meetingAt,
      mode: "distance",
      priority: "total",
      version: 1,
      result: null,
      createdAt: new Date().toISOString(),
      organizerTokenHash: n.organizerTokenHash,
    };
    this.events.set(n.id, row);
    return publicEvent(row);
  }
  async getEvent(id: string) {
    const e = this.events.get(id);
    return e ? publicEvent(e) : null;
  }
  async getOrganizerTokenHash(id: string) {
    return this.events.get(id)?.organizerTokenHash ?? null;
  }
  async updateEvent(id: string, patch: EventPatch) {
    const e = this.events.get(id);
    if (!e) return null;
    Object.assign(e, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    e.version += 1;
    return publicEvent(e);
  }
  async saveResult(id: string, version: number, result: CenterResult | null) {
    const e = this.events.get(id);
    if (!e || e.version !== version) return false;
    e.result = structuredClone(result);
    return true;
  }

  async listParticipants(eventId: string) {
    return [...this.participants.values()]
      .filter((p) => p.eventId === eventId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(publicParticipant);
  }
  async countParticipants(eventId: string) {
    return (await this.listParticipants(eventId)).length;
  }
  async getParticipant(eventId: string, id: string) {
    const p = this.participants.get(id);
    return p && p.eventId === eventId ? publicParticipant(p) : null;
  }
  async getEditTokenHash(id: string) {
    return this.participants.get(id)?.editTokenHash ?? null;
  }
  async addParticipant(n: NewParticipant) {
    const row: ParticipantRow = {
      id: randomUUID(),
      eventId: n.eventId,
      name: n.name,
      lat: n.lat,
      lng: n.lng,
      precision: n.precision,
      weight: 1,
      editTokenHash: n.editTokenHash,
      createdAt: ++this.seq,
    };
    this.participants.set(row.id, row);
    this.bump(n.eventId);
    return publicParticipant(row);
  }
  async updateParticipant(eventId: string, id: string, patch: ParticipantPatch) {
    const p = this.participants.get(id);
    if (!p || p.eventId !== eventId) return null;
    Object.assign(p, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    this.bump(eventId);
    return publicParticipant(p);
  }
  async deleteParticipant(eventId: string, id: string) {
    const p = this.participants.get(id);
    if (!p || p.eventId !== eventId) return false;
    this.participants.delete(id);
    this.bump(eventId);
    return true;
  }

  async getMatrixCells(keys: string[]) {
    const out = new Map<string, MatrixCell>();
    for (const k of keys) {
      const c = this.cache.get(k);
      if (c) out.set(k, c);
    }
    return out;
  }
  async putMatrixCells(cells: Map<string, MatrixCell>) {
    for (const [k, v] of cells) this.cache.set(k, v);
  }
  async incrementUsage(day: string, kind: string, by: number) {
    const k = `${day}|${kind}`;
    const n = (this.usage.get(k) ?? 0) + by;
    this.usage.set(k, n);
    return n;
  }
  async getUsage(day: string, kind: string) {
    return this.usage.get(`${day}|${kind}`) ?? 0;
  }
}

/** One store per process, shared across route modules (Next may load them separately). */
export function memoryStore(): MemoryStore {
  const g = globalThis as { __w2mMemoryStore?: MemoryStore };
  if (!g.__w2mMemoryStore) {
    console.warn("[where2meet] SUPABASE_URL not set: using the in-memory store (data is lost on restart).");
    g.__w2mMemoryStore = new MemoryStore();
  }
  return g.__w2mMemoryStore;
}
