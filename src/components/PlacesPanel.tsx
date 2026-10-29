"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { formatDistance, googleMapsPlace, type Units } from "@/lib/format";
import { PLACE_FILTERS, type Place, type PlaceFilter } from "@/lib/places";
import type { LatLng } from "@/lib/types";

interface Props {
  eventId: string;
  center: LatLng;
  available: boolean;
  units: Units;
}

export function PlacesPanel({ eventId, center, available, units }: Props) {
  const [filter, setFilter] = useState<PlaceFilter>("anything");
  const [wanted, setWanted] = useState(false);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;

  // Fetch only after the person asks, then follow the center and filter.
  useEffect(() => {
    if (!wanted || !available) return;
    let stale = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.places(eventId, filter);
        if (stale) return;
        setPlaces(r.places);
        setNote(r.unavailable ? "Place search is unavailable right now." : r.places.length ? null : "Nothing named nearby for this filter.");
      } catch (e) {
        if (!stale) setNote(e instanceof Error ? e.message : "Could not load places.");
      } finally {
        if (!stale) setLoading(false);
      }
    }, 400);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [wanted, available, eventId, filter, key]);

  return (
    <section className="card stack" aria-label="Places nearby">
      <h2>Places near the center</h2>
      {!available ? (
        <p className="muted small">Place suggestions are unavailable right now.</p>
      ) : (
        <>
          <fieldset className="seg wrap">
            <legend className="sr-only">Kind of place</legend>
            {(Object.keys(PLACE_FILTERS) as PlaceFilter[]).map((f) => (
              <label key={f}>
                <input
                  type="radio"
                  name="place-filter"
                  checked={filter === f}
                  onChange={() => {
                    setFilter(f);
                    setWanted(true);
                  }}
                />
                <span>{PLACE_FILTERS[f].label}</span>
              </label>
            ))}
          </fieldset>
          {!wanted && (
            <button type="button" className="btn" onClick={() => setWanted(true)}>
              Suggest 5 places
            </button>
          )}
          {loading && <p className="muted small">Looking…</p>}
          {note && <p className="muted small">{note}</p>}
          {places && places.length > 0 && (
            <ol className="places">
              {places.map((p) => (
                <li key={p.id}>
                  <a href={googleMapsPlace(p)} target="_blank" rel="noopener noreferrer">
                    {p.name}
                  </a>
                  <span className="muted small">
                    {" "}
                    · {p.categories.join(", ")} · {formatDistance(p.distanceM / 1000, units)} from center
                  </span>
                  {p.openingHours && <div className="small">Hours: {p.openingHours}</div>}
                </li>
              ))}
            </ol>
          )}
          <small className="muted">Places from OpenStreetMap via openrouteservice. Hours are as mapped and may be out of date.</small>
        </>
      )}
    </section>
  );
}
