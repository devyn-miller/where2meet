import type { Store } from "./store";
import { tokenMatches } from "./tokens";

export async function isOrganizer(req: Request, store: Store, eventId: string): Promise<boolean> {
  const t = req.headers.get("x-organizer-token");
  if (!t) return false;
  return tokenMatches(t, await store.getOrganizerTokenHash(eventId));
}

export async function isOwner(req: Request, store: Store, participantId: string): Promise<boolean> {
  const t = req.headers.get("x-edit-token");
  if (!t) return false;
  return tokenMatches(t, await store.getEditTokenHash(participantId));
}

export const EVENT_ID_RE = /^[A-Za-z0-9]{10,32}$/;
