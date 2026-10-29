import { computeDistanceResult, type Located } from "../center";
import type { CenterResult } from "../types";
import { computeDriveResult } from "./drive";
import { getOrs, OrsUnavailable } from "./ors";
import { broadcastChanged } from "./realtime";
import { getStore } from "./store";

export const DRIVE_UNAVAILABLE = "Drive times unavailable right now. Showing straight-line distance instead.";

/**
 * Recompute and save the center for an event. If someone changes the event
 * while this runs, the save is skipped: their request recomputes it.
 */
export async function recompute(eventId: string): Promise<CenterResult | null> {
  const store = await getStore();
  const event = await store.getEvent(eventId);
  if (!event) return null;
  const people: Located[] = (await store.listParticipants(eventId))
    .filter((p) => p.lat !== null && p.lng !== null)
    .map((p) => ({ id: p.id, name: p.name, lat: p.lat!, lng: p.lng!, weight: p.weight }));

  let result: CenterResult | null = null;
  if (people.length > 0) {
    if (event.mode === "drive" && event.meetingAt) {
      try {
        result = (
          await computeDriveResult({
            people,
            priority: event.priority,
            version: event.version,
            meetingAt: event.meetingAt,
            ors: getOrs(store),
            store,
          })
        ).result;
      } catch (e) {
        if (!(e instanceof OrsUnavailable)) throw e;
        result = computeDistanceResult(people, event.priority, event.version, "drive", DRIVE_UNAVAILABLE);
      }
    } else {
      result = computeDistanceResult(people, event.priority, event.version);
    }
  }
  const saved = await store.saveResult(eventId, event.version, result);
  if (saved) await broadcastChanged(eventId, event.version);
  return result;
}
