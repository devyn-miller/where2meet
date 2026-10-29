"use client";

import { useEffect, useState } from "react";
import { WEIGHTS, type EventPublic, type Mode, type ParticipantPublic, type Priority } from "@/lib/types";

interface Props {
  event: EventPublic;
  participants: ParticipantPublic[];
  driveAvailable: boolean;
  onEvent: (patch: { meetingAt?: string | null; mode?: Mode; priority?: Priority }) => Promise<void>;
  onWeight: (participantId: string, weight: number) => Promise<void>;
  onRemove: (participantId: string) => Promise<void>;
}

/** ISO -> value for <input type="datetime-local"> in the viewer's time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function OrganizerPanel({ event, participants, driveAvailable, onEvent, onWeight, onRemove }: Props) {
  const [when, setWhen] = useState(toLocalInput(event.meetingAt));
  useEffect(() => setWhen(toLocalInput(event.meetingAt)), [event.meetingAt]);
  const driveLocked = !event.meetingAt;

  return (
    <section className="card stack organizer" aria-label="Organizer settings">
      <h2>Organizer</h2>

      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          void onEvent({ meetingAt: when ? new Date(when).toISOString() : null });
        }}
      >
        <label htmlFor="meeting-at">Meeting date and time</label>
        <div className="row">
          <input id="meeting-at" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <button className="btn">Save</button>
        </div>
      </form>

      <fieldset className="seg">
        <legend>Mode</legend>
        <label>
          <input type="radio" name="mode" checked={event.mode === "distance"} onChange={() => void onEvent({ mode: "distance" })} />
          <span>Distance</span>
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            checked={event.mode === "drive"}
            disabled={driveLocked}
            onChange={() => void onEvent({ mode: "drive" })}
          />
          <span>Drive time</span>
        </label>
        <small className="muted">
          {driveLocked
            ? "Set a meeting time to unlock drive-time mode."
            : driveAvailable
              ? "Drive times come from openrouteservice and don't include live traffic."
              : "Drive times unavailable right now. The center will use straight-line distance."}
        </small>
      </fieldset>

      <fieldset className="seg">
        <legend>Priority</legend>
        <label>
          <input type="radio" name="priority" checked={event.priority === "total"} onChange={() => void onEvent({ priority: "total" })} />
          <span>Least total</span>
        </label>
        <label>
          <input type="radio" name="priority" checked={event.priority === "even"} onChange={() => void onEvent({ priority: "even" })} />
          <span>Even out</span>
        </label>
        <small className="muted">
          {event.priority === "total"
            ? "Minimizes the sum of weight × trip."
            : "Minimizes the longest weighted trip."}
        </small>
      </fieldset>

      <table className="people">
        <caption>People and weights</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Weight</th>
            <th scope="col">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {participants.map((p) => (
            <tr key={p.id}>
              <th scope="row">
                {p.name}
                {p.lat === null && <span className="muted small"> (no pin)</span>}
              </th>
              <td>
                <select
                  aria-label={`Weight for ${p.name}`}
                  value={String(p.weight)}
                  onChange={(e) => void onWeight(p.id, Number(e.target.value))}
                >
                  {WEIGHTS.map((w) => (
                    <option key={w} value={String(w)}>
                      ×{w}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  type="button"
                  className="btn ghost danger small"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => {
                    if (window.confirm(`Remove ${p.name} from this event?`)) void onRemove(p.id);
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <small className="muted">A higher weight pulls the center toward that person.</small>
    </section>
  );
}
