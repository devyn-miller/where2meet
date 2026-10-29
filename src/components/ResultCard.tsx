"use client";

import { formatCost, formatDistance, formatLatLng, formatMinutes, googleMapsPlace, googleMapsRoute, type Units } from "@/lib/format";
import type { CenterResult, ParticipantPublic } from "@/lib/types";

interface Props {
  result: CenterResult | null;
  participants: ParticipantPublic[];
  units: Units;
  meId: string | null;
  saving: boolean;
}

export function ResultCard({ result, participants, units, meId, saving }: Props) {
  if (!result) {
    return (
      <section className="card" aria-label="Result" data-testid="result">
        <h2>Meeting point</h2>
        <p className="muted">The center appears once someone adds a pin.</p>
      </section>
    );
  }
  const byId = new Map(participants.map((p) => [p.id, p]));
  const name = (id: string | null) => (id ? (result.trips.find((t) => t.participantId === id)?.name ?? "") : "");
  const longest = result.trips.find((t) => t.participantId === result.longestId);
  const shortest = result.trips.find((t) => t.participantId === result.shortestId);
  const tripText = (t: CenterResult["trips"][number]) =>
    result.mode === "drive" ? `${formatMinutes(t.durationMin)} · ${formatDistance(t.distanceKm, units)}` : formatDistance(t.distanceKm, units);

  return (
    <section className="card stack" aria-label="Result" data-testid="result" aria-busy={saving}>
      <div className="row between">
        <h2>Meeting point</h2>
        <span className="badge">{result.mode === "drive" ? "Drive time" : "Straight line"}</span>
      </div>
      {result.notice && (
        <p className="notice" role="status">
          {result.notice}
        </p>
      )}
      <p>
        <strong data-testid="center-coords">{formatLatLng(result.center)}</strong>{" "}
        <a href={googleMapsPlace(result.center)} target="_blank" rel="noopener noreferrer">
          Open in Google Maps
        </a>
      </p>
      <p className="muted small">
        {result.priority === "total" ? "Least total" : "Even out"}
        {result.mode === "drive" && (
          <>
            {" "}· {result.snapped ? "snapped to the nearest road" : "not snapped to a road"} · ignores live traffic
          </>
        )}
      </p>
      {result.centersApartKm !== null && (
        <p className="small">
          The straight-line center is <strong>{formatDistance(result.centersApartKm, units)}</strong> from the drive-time center.
        </p>
      )}

      <table className="trips">
        <caption className="sr-only">Each person&apos;s trip to the center</caption>
        <thead>
          <tr>
            <th scope="col">Who</th>
            <th scope="col">Trip</th>
            <th scope="col">Weight</th>
            <th scope="col">
              <span className="sr-only">Route</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {result.trips.map((t) => {
            const p = byId.get(t.participantId);
            return (
              <tr key={t.participantId} data-testid="trip">
                <th scope="row">
                  {t.name}
                  {t.participantId === meId && <span className="muted"> (you)</span>}
                </th>
                <td>{tripText(t)}</td>
                <td>×{t.weight}</td>
                <td>
                  {p && p.lat !== null && p.lng !== null && (
                    <a
                      href={googleMapsRoute({ lat: p.lat, lng: p.lng }, result.center)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Route for ${t.name} in Google Maps`}
                    >
                      Route
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dl className="stats">
        {longest && (
          <div>
            <dt>Longest</dt>
            <dd>
              {name(result.longestId)}: {formatCost(longest.cost, result.costUnit, units)}
            </dd>
          </div>
        )}
        {shortest && (
          <div>
            <dt>Shortest</dt>
            <dd>
              {name(result.shortestId)}: {formatCost(shortest.cost, result.costUnit, units)}
            </dd>
          </div>
        )}
        <div>
          <dt>Weighted average</dt>
          <dd>{formatCost(result.weightedAverage, result.costUnit, units)}</dd>
        </div>
      </dl>
    </section>
  );
}
