"use client";

import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { formatLatLng } from "@/lib/format";
import type { LatLng, ParticipantPublic, Precision } from "@/lib/types";
import { PrecisionPicker } from "./PrecisionPicker";

interface Props {
  eventId: string;
  me: ParticipantPublic;
  geocodeAvailable: boolean;
  focus?: LatLng;
  onPick: (exact: LatLng) => void;
  onPinAtMapCenter: () => void;
  onPrecision: (p: Precision) => void;
  onClear: () => void;
  onLeave: () => void;
}

export function LocationControls(props: Props) {
  const { me } = props;
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [active, setActive] = useState(-1);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [geoNote, setGeoNote] = useState<string | null>(null);
  const listId = useId();
  const reqSeq = useRef(0);

  useEffect(() => {
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    const n = ++reqSeq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.geocode(props.eventId, q.trim(), props.focus);
        if (n !== reqSeq.current) return;
        setResults(r.results);
        setActive(r.results.length ? 0 : -1);
        setSearchNote(r.unavailable ? "Address search is unavailable right now. Tap the map instead." : r.results.length ? null : "No matches.");
      } catch (e) {
        if (n === reqSeq.current) setSearchNote(e instanceof Error ? e.message : "Search failed.");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q, props.eventId, props.focus]);

  const choose = (i: number) => {
    const r = results[i];
    if (!r) return;
    props.onPick({ lat: r.lat, lng: r.lng });
    // Don't keep the typed address or the label around.
    setQ("");
    setResults([]);
    setSearchNote(null);
  };

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setGeoNote("This browser can't share location.");
      return;
    }
    setGeoNote("Locating…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoNote(null);
        props.onPick({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => setGeoNote("Couldn't get your location. Search or tap the map instead."),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  return (
    <section className="card stack" aria-label="Your location">
      <h2>Your pin, {me.name}</h2>
      <p className="muted small" data-testid="my-location">
        {me.lat !== null && me.lng !== null
          ? `Shared as ${formatLatLng({ lat: me.lat, lng: me.lng })}. Drag your pin or tap the map to move it.`
          : "Search an address, use your location, or tap the map."}
      </p>

      <div className="field combo">
        <label htmlFor={`${listId}-input`}>Search an address</label>
        <input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          value={q}
          disabled={!props.geocodeAvailable}
          placeholder={props.geocodeAvailable ? "Street, place or town" : "Address search unavailable right now"}
          autoComplete="off"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && active >= 0) {
              e.preventDefault();
              choose(active);
            } else if (e.key === "Escape") {
              setResults([]);
            }
          }}
        />
        {results.length > 0 && (
          <ul role="listbox" id={listId} className="options">
            {results.map((r, i) => (
              <li
                key={`${r.lat},${r.lng},${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(i);
                }}
              >
                {r.label}
              </li>
            ))}
          </ul>
        )}
        {searchNote && <small className="muted">{searchNote}</small>}
      </div>

      <div className="row wrap">
        <button type="button" className="btn" onClick={useMyLocation}>
          Use my location
        </button>
        <button type="button" className="btn" onClick={props.onPinAtMapCenter} data-testid="pin-at-center">
          Pin at map center
        </button>
      </div>
      {geoNote && <small className="muted">{geoNote}</small>}

      <PrecisionPicker value={me.precision} onChange={props.onPrecision} />

      <div className="row wrap">
        {me.lat !== null && (
          <button type="button" className="btn ghost" onClick={props.onClear}>
            Remove my pin
          </button>
        )}
        <button type="button" className="btn ghost danger" onClick={props.onLeave}>
          Leave event
        </button>
      </div>
    </section>
  );
}
