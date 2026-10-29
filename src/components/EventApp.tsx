"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type EventData } from "@/lib/client/api";
import { useTheme, useUnits } from "@/lib/client/prefs";
import { subscribeToEvent } from "@/lib/client/realtime";
import { keys, storage, type MyRow } from "@/lib/client/storage";
import { roundPoint } from "@/lib/geo";
import type { LatLng, Precision } from "@/lib/types";
import { JoinForm } from "./JoinForm";
import { LocationControls } from "./LocationControls";
import { MapView, type MapHandle } from "./MapView";
import { OrganizerPanel } from "./OrganizerPanel";
import { PlacesPanel } from "./PlacesPanel";
import { ResultCard } from "./ResultCard";
import { ShareBox } from "./ShareBox";

export function EventApp({ eventId }: { eventId: string }) {
  const [data, setData] = useState<EventData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [me, setMe] = useState<MyRow | null>(null);
  const [organizerToken, setOrganizerToken] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { units, setUnits } = useUnits();
  const theme = useTheme();
  const mapRef = useRef<MapHandle>(null);
  /** My exact point, kept only in memory so precision can be changed without re-picking. Never sent. */
  const exactRef = useRef<LatLng | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const n = ++seq.current;
    try {
      const d = await api.getEvent(eventId);
      if (n !== seq.current) return;
      setData(d);
      setLoadError(null);
      const mine = storage.get<MyRow>(keys.me(eventId));
      if (mine && !d.participants.some((p) => p.id === mine.participantId)) {
        // The organizer removed us.
        storage.remove(keys.me(eventId));
        setMe(null);
      }
    } catch (e) {
      if (n === seq.current) setLoadError(e instanceof Error ? e.message : "Could not load the event.");
    }
  }, [eventId]);

  useEffect(() => {
    const m = window.location.hash.match(/org=([A-Za-z0-9_-]+)/);
    if (m) {
      storage.set(keys.organizer(eventId), m[1]);
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setOrganizerToken(storage.get<string>(keys.organizer(eventId)));
    setMe(storage.get<MyRow>(keys.me(eventId)));
    void refresh();
  }, [eventId, refresh]);

  // Live updates: Supabase broadcast when configured, polling as a backstop.
  const realtime = data?.capabilities.realtime ?? false;
  useEffect(() => {
    const unsub = subscribeToEvent(eventId, () => void refresh());
    const id = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void refresh();
      },
      realtime ? 20_000 : 2_000,
    );
    return () => {
      unsub?.();
      window.clearInterval(id);
    };
  }, [eventId, realtime, refresh]);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setSaving(true);
      try {
        await fn();
        setStatus(label);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setSaving(false);
        await refresh();
      }
    },
    [refresh],
  );

  const myRow = data?.participants.find((p) => p.id === me?.participantId) ?? null;

  const placeMine = useCallback(
    (exact: LatLng, precision?: Precision) => {
      if (!me || !myRow) return;
      const p = precision ?? myRow.precision;
      exactRef.current = exact;
      const r = roundPoint(exact, p);
      // Show the rounded point right away.
      setData((d) =>
        d && { ...d, participants: d.participants.map((x) => (x.id === me.participantId ? { ...x, ...r, precision: p } : x)) },
      );
      void run("Pin updated.", () => api.updateParticipant(eventId, me.participantId, { lat: r.lat, lng: r.lng, precision: p }));
    },
    [eventId, me, myRow, run],
  );

  const setPrecision = (p: Precision) => {
    if (!me || !myRow) return;
    if (exactRef.current) placeMine(exactRef.current, p);
    else void run("Precision updated.", () => api.updateParticipant(eventId, me.participantId, { precision: p }));
  };

  if (loadError && !data) {
    return (
      <main className="home">
        <h1>Event not found</h1>
        <p className="muted">{loadError}</p>
        <Link className="btn" href="/">
          Create an event
        </Link>
      </main>
    );
  }

  const event = data?.event ?? null;
  const result = event?.result ?? null;
  const isOrganizer = data?.isOrganizer ?? false;

  return (
    <div className="app">
      <div className="map-pane">
        <MapView
          ref={mapRef}
          participants={data?.participants ?? []}
          meId={me?.participantId ?? null}
          mePrecision={myRow?.precision ?? 3}
          result={result}
          units={units}
          dark={theme.dark}
          canPlace={Boolean(myRow)}
          onPlace={placeMine}
        />
      </div>
      <aside className={`panel ${panelOpen ? "open" : "closed"}`} aria-label="Event details">
        <div className="panel-head">
          <div className="title">
            <h1>{event?.name ?? "Loading…"}</h1>
            {event?.meetingAt && (
              <p className="muted small">
                {new Date(event.meetingAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            )}
          </div>
          <button
            className="btn ghost panel-toggle"
            aria-expanded={panelOpen}
            aria-controls="panel-body"
            onClick={() => setPanelOpen((o) => !o)}
          >
            {panelOpen ? "Hide" : "Show"} details
          </button>
        </div>
        <div className="panel-body" id="panel-body">
          <p className="sr-only" role="status" aria-live="polite">
            {saving ? "Saving…" : status}
          </p>
          {event && (
            <>
              <ResultCard
                result={result}
                participants={data!.participants}
                units={units}
                meId={me?.participantId ?? null}
                saving={saving}
              />

              {!myRow ? (
                <JoinForm
                  onJoin={(name, precision) =>
                    run("Joined.", async () => {
                      const r = await api.join(eventId, { name, precision });
                      const row = { participantId: r.participant.id, editToken: r.editToken };
                      storage.set(keys.me(eventId), row);
                      setMe(row);
                    })
                  }
                />
              ) : (
                <LocationControls
                  eventId={eventId}
                  me={myRow}
                  geocodeAvailable={data!.capabilities.geocode}
                  focus={result?.center}
                  onPick={(p) => {
                    placeMine(p);
                    mapRef.current?.flyTo(p);
                  }}
                  onPinAtMapCenter={() => {
                    const c = mapRef.current?.getCenter();
                    if (c) placeMine(c);
                  }}
                  onPrecision={setPrecision}
                  onClear={() => {
                    exactRef.current = null;
                    void run("Pin removed.", () => api.updateParticipant(eventId, myRow.id, { lat: null, lng: null }));
                  }}
                  onLeave={() =>
                    run("You left the event.", async () => {
                      await api.removeParticipant(eventId, myRow.id);
                      storage.remove(keys.me(eventId));
                      exactRef.current = null;
                      setMe(null);
                    })
                  }
                />
              )}


              <ShareBox eventId={eventId} organizerToken={isOrganizer ? organizerToken : null} />

              {result && <PlacesPanel eventId={eventId} center={result.center} available={data!.capabilities.places} units={units} />}

              {isOrganizer && (
                <OrganizerPanel
                  event={event}
                  participants={data!.participants}
                  driveAvailable={data!.capabilities.drive}
                  onEvent={(patch) => run("Settings saved.", () => api.updateEvent(eventId, patch))}
                  onWeight={(pid, weight) => run("Weight saved.", () => api.updateParticipant(eventId, pid, { weight }))}
                  onRemove={(pid) => run("Removed.", () => api.removeParticipant(eventId, pid))}
                />
              )}

              <section className="card prefs" aria-label="Display settings">
                <fieldset className="seg">
                  <legend>Units</legend>
                  {(["mi", "km"] as const).map((u) => (
                    <label key={u}>
                      <input type="radio" name="units" checked={units === u} onChange={() => setUnits(u)} />
                      <span>{u === "mi" ? "Miles" : "Kilometers"}</span>
                    </label>
                  ))}
                </fieldset>
                <fieldset className="seg">
                  <legend>Theme</legend>
                  {(["system", "light", "dark"] as const).map((t) => (
                    <label key={t}>
                      <input type="radio" name="theme" checked={theme.pref === t} onChange={() => theme.setPref(t)} />
                      <span>{t[0].toUpperCase() + t.slice(1)}</span>
                    </label>
                  ))}
                </fieldset>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
