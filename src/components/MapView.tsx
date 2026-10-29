"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MlMap, Marker, StyleSpecification } from "maplibre-gl";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cellPolygon } from "@/lib/geo";
import { formatCost, hueFor, initials, pinSize, type Units } from "@/lib/format";
import type { CenterResult, LatLng, ParticipantPublic, Precision } from "@/lib/types";

/** OpenFreeMap: free vector tiles, no key, attribution comes from the tile source. */
const STYLE_URL = {
  light: process.env.NEXT_PUBLIC_MAP_STYLE_LIGHT || "https://tiles.openfreemap.org/styles/liberty",
  dark: process.env.NEXT_PUBLIC_MAP_STYLE_DARK || "https://tiles.openfreemap.org/styles/dark",
};

/** Used only if the tile style can't load, so pins and the center still work. */
const FALLBACK_STYLE = (dark: boolean): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": dark ? "#1b1f24" : "#eef0f2" } }],
});

const FONT = ["Noto Sans Regular"];

export interface MapHandle {
  getCenter(): LatLng | null;
  flyTo(p: LatLng, zoom?: number): void;
}

interface Props {
  participants: ParticipantPublic[];
  meId: string | null;
  mePrecision: Precision;
  result: CenterResult | null;
  units: Units;
  dark: boolean;
  canPlace: boolean;
  onPlace: (exact: LatLng) => void;
}

type Located = ParticipantPublic & { lat: number; lng: number };

export const MapView = forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const centerMarkers = useRef<{ main?: Marker; alt?: Marker }>({});
  const latest = useRef(props);
  latest.current = props;
  const [styleTick, setStyleTick] = useState(0);
  const [failed, setFailed] = useState(false);
  const fittedCount = useRef(-1);

  useImperativeHandle(ref, () => ({
    getCenter() {
      const c = mapRef.current?.getCenter();
      return c ? { lat: c.lat, lng: c.lng } : null;
    },
    flyTo(p, zoom = 13) {
      mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: Math.max(mapRef.current.getZoom(), zoom) });
    },
  }));

  // Create the map once.
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    const pins = markers.current;
    (async () => {
      const ml = await import("maplibre-gl");
      if (disposed || !container.current) return;
      lib.current = ml;
      let loadedOnce = false;
      let usingFallback = false;
      const map = new ml.Map({
        container: container.current,
        style: STYLE_URL[latest.current.dark ? "dark" : "light"],
        center: [-98.5, 39.8],
        zoom: 3,
        attributionControl: { compact: true },
        // Keyboard panning/zooming of the map itself.
        keyboard: true,
      });
      mapRef.current = map;
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.on("style.load", () => {
        loadedOnce = true;
        addLayers(map);
        setStyleTick((t) => t + 1);
      });
      map.on("error", () => {
        if (!loadedOnce && !usingFallback) {
          usingFallback = true;
          setFailed(true);
          map.setStyle(FALLBACK_STYLE(latest.current.dark));
        }
      });
      map.on("click", (e) => {
        if (latest.current.canPlace) latest.current.onPlace({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
      ro = new ResizeObserver(() => map.resize());
      ro.observe(container.current);
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      pins.clear();
      centerMarkers.current = {};
    };
  }, []);

  // Theme change: swap the basemap; layers are re-added on style.load.
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(failed ? FALLBACK_STYLE(props.dark) : STYLE_URL[props.dark ? "dark" : "light"]);
  }, [props.dark, failed]);

  const { participants, meId, mePrecision, result, units } = props;

  // Cell, lines and labels.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("w2m-cell")) return;
    const located = participants.filter((p): p is Located => p.lat !== null && p.lng !== null);
    const me = located.find((p) => p.id === meId);
    (map.getSource("w2m-cell") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: me
        ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [cellPolygon(me, mePrecision)] } }]
        : [],
    });
    const trips = new Map(result?.trips.map((t) => [t.participantId, t]) ?? []);
    (map.getSource("w2m-lines") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: result
        ? located
            .filter((p) => trips.has(p.id))
            .map((p) => ({
              type: "Feature" as const,
              properties: { label: formatCost(trips.get(p.id)!.cost, result.costUnit, units) },
              geometry: {
                type: "LineString" as const,
                coordinates: [
                  [p.lng, p.lat],
                  [result.center.lng, result.center.lat],
                ],
              },
            }))
        : [],
    });
  }, [participants, meId, mePrecision, result, units, styleTick]);

  // Participant pins (HTML markers so they're focusable and sized by weight).
  useEffect(() => {
    const map = mapRef.current;
    const ml = lib.current;
    if (!map || !ml) return;
    const located = participants.filter((p): p is Located => p.lat !== null && p.lng !== null);
    const live = new Set(located.map((p) => p.id));
    for (const [id, m] of markers.current) {
      if (!live.has(id)) {
        m.remove();
        markers.current.delete(id);
      }
    }
    for (const p of located) {
      const mine = p.id === meId;
      let m = markers.current.get(p.id);
      if (!m) {
        const el = document.createElement("div");
        el.className = "pin";
        el.tabIndex = 0;
        el.setAttribute("role", "button");
        m = new ml.Marker({ element: el, draggable: false });
        m.on("dragend", () => {
          const ll = m!.getLngLat();
          latest.current.onPlace({ lat: ll.lat, lng: ll.lng });
        });
        el.addEventListener("keydown", (e) => {
          const cur = latest.current;
          if (el.dataset.mine !== "true") return;
          const step = 10 ** -cur.mePrecision;
          const ll = m!.getLngLat();
          const moves: Record<string, [number, number]> = {
            ArrowUp: [step, 0],
            ArrowDown: [-step, 0],
            ArrowLeft: [0, -step],
            ArrowRight: [0, step],
          };
          const mv = moves[e.key];
          if (!mv) return;
          e.preventDefault();
          e.stopPropagation();
          cur.onPlace({ lat: ll.lat + mv[0], lng: ll.lng + mv[1] });
        });
        // Clicking a pin shouldn't also count as a map tap.
        el.addEventListener("click", (e) => e.stopPropagation());
        m.setLngLat([p.lng, p.lat]).addTo(map);
        markers.current.set(p.id, m);
      }
      const el = m.getElement();
      const size = pinSize(p.weight);
      el.style.width = el.style.height = `${size}px`;
      el.style.setProperty("--hue", String(hueFor(p.id)));
      el.textContent = initials(p.name);
      el.dataset.mine = String(mine);
      el.dataset.testid = mine ? "my-pin" : "pin";
      el.setAttribute(
        "aria-label",
        mine
          ? `Your pin (${p.name}). Drag, or use arrow keys to move it one cell.`
          : `${p.name}, weight ${p.weight}`,
      );
      m.setDraggable(mine);
      m.setLngLat([p.lng, p.lat]);
    }
    if (located.length !== fittedCount.current && located.length > 0) {
      fittedCount.current = located.length;
      const b = new ml.LngLatBounds();
      located.forEach((p) => b.extend([p.lng, p.lat]));
      if (result) b.extend([result.center.lng, result.center.lat]);
      map.fitBounds(b, { padding: 60, maxZoom: 13, duration: 600 });
    }
  }, [participants, meId, result, styleTick]);

  // Center markers.
  useEffect(() => {
    const map = mapRef.current;
    const ml = lib.current;
    if (!map || !ml) return;
    const cm = centerMarkers.current;
    const place = (key: "main" | "alt", p: LatLng | null, label: string, cls: string) => {
      if (!p) {
        cm[key]?.remove();
        cm[key] = undefined;
        return;
      }
      if (!cm[key]) {
        const el = document.createElement("div");
        el.className = cls;
        el.setAttribute("role", "img");
        el.addEventListener("click", (e) => e.stopPropagation());
        cm[key] = new ml.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
      }
      cm[key]!.getElement().setAttribute("aria-label", label);
      cm[key]!.setLngLat([p.lng, p.lat]);
    };
    place("main", result?.center ?? null, "Meeting center", "center-marker");
    const showAlt = result && result.mode === "drive" && (result.centersApartKm ?? 0) > 0.05;
    place("alt", showAlt ? result.distanceCenter : null, "Straight-line center", "center-marker alt");
  }, [result, styleTick]);

  return (
    <div className="map-shell">
      <div ref={container} className="map" data-testid="map" aria-label="Map. Tap to place your pin." />
      {failed && <p className="map-note">Map tiles could not load. Pins and the center still work.</p>}
    </div>
  );
});

function addLayers(map: MlMap) {
  const empty = { type: "FeatureCollection" as const, features: [] };
  if (!map.getSource("w2m-cell")) map.addSource("w2m-cell", { type: "geojson", data: empty });
  if (!map.getSource("w2m-lines")) map.addSource("w2m-lines", { type: "geojson", data: empty });
  map.addLayer({
    id: "w2m-cell-fill",
    type: "fill",
    source: "w2m-cell",
    paint: { "fill-color": "#2563eb", "fill-opacity": 0.18 },
  });
  map.addLayer({
    id: "w2m-cell-line",
    type: "line",
    source: "w2m-cell",
    paint: { "line-color": "#2563eb", "line-width": 2 },
  });
  map.addLayer({
    id: "w2m-lines",
    type: "line",
    source: "w2m-lines",
    paint: { "line-color": "#e11d48", "line-width": 2, "line-dasharray": [2, 2] },
  });
  if (map.getStyle().glyphs) {
    map.addLayer({
      id: "w2m-line-labels",
      type: "symbol",
      source: "w2m-lines",
      layout: {
        "symbol-placement": "line-center",
        "text-field": ["get", "label"],
        "text-font": FONT,
        "text-size": 13,
        "text-allow-overlap": true,
      },
      paint: { "text-color": "#111", "text-halo-color": "#fff", "text-halo-width": 2 },
    });
  }
}
