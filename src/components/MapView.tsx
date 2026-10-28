"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Manifest, Network, ScenarioData, Storm } from "@/lib/bundle";
import { FORECAST_STOPS, LABEL_KINDS, baseStyle, statusColors } from "@/lib/style";
import { useDark } from "@/lib/useDark";

export type MapMode = "now" | "forecast";

interface Props {
  manifest: Manifest;
  network: Network;
  data: ScenarioData | null;
  storms: Storm[];
  hour: number;
  mode: MapMode;
  highlight: string[];          // segment ids of the focused route
  onSegmentClick?: (segmentId: string) => void;
}

// east edge leaves room for the Chennai label
const BOUNDS: [[number, number], [number, number]] = [[76.1, 7.9], [81.0, 13.5]];

function segmentGeoJSON(net: Network): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: net.segments.map((s) => ({
      type: "Feature", id: s.ix,
      properties: { id: s.id, ref: s.ref },
      geometry: { type: "LineString", coordinates: s.coords },
    })),
  };
}

export function gridGeoJSON(net: Network): GeoJSON.FeatureCollection {
  const h = net.grid.cell_size_deg / 2;
  return {
    type: "FeatureCollection",
    features: net.grid.cells.map(([x, y], i) => ({
      type: "Feature", id: i, properties: {},
      geometry: { type: "Polygon", coordinates: [[[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h], [x - h, y - h]]] },
    })),
  };
}

function stormGeoJSON(storms: Storm[], manifest: Manifest, hour: number) {
  const t0 = new Date(manifest.start + "Z").getTime();
  const tracks: GeoJSON.Feature[] = [];
  const centres: GeoJSON.Feature[] = [];
  for (const s of storms) {
    const start = Math.round((new Date(s.start + "Z").getTime() - t0) / 3600_000);
    tracks.push({ type: "Feature", properties: { kind: s.kind },
                  geometry: { type: "LineString", coordinates: s.track } });
    const k = hour - start;
    if (k >= 0 && k < s.track.length) {
      centres.push({ type: "Feature", properties: { kind: s.kind, radius_km: s.radius_km },
                     geometry: { type: "Point", coordinates: s.track[k] } });
    }
  }
  return {
    tracks: { type: "FeatureCollection", features: tracks } as GeoJSON.FeatureCollection,
    centres: { type: "FeatureCollection", features: centres } as GeoJSON.FeatureCollection,
  };
}

export default function MapView({ manifest, network, data, storms, hour, mode, highlight, onSegmentClick }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const dark = useDark();
  const clickRef = useRef(onSegmentClick);
  useEffect(() => { clickRef.current = onSegmentClick; }, [onSegmentClick]);

  // create the map once
  useEffect(() => {
    let cancelled = false;
    let m: MLMap | undefined;
    (async () => {
      const maplibre = (await import("maplibre-gl")).default;
      if (cancelled || !el.current) return;
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      m = new maplibre.Map({
        container: el.current,
        style: baseStyle(dark),
        bounds: BOUNDS,
        fitBoundsOptions: { padding: 16 },
        attributionControl: { compact: true },
        fadeDuration: 0,
      });
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      // basemap tiles are optional: report once, keep the map working without them
      let tileWarned = false;
      m.on("error", (e) => {
        const src = (e as { sourceId?: string }).sourceId;
        if (src === "basemap") {
          if (!tileWarned) console.warn("RoutePulse: basemap tiles unavailable, showing roads on a plain background");
          tileWarned = true;
          return;
        }
        console.error(e.error ?? e);
      });
      // greedy declutter: skip a town whose label would sit on top of one already placed
      const placed: [number, number][] = [];
      for (const n of network.nodes) {
        if (!LABEL_KINDS.has(n.kind)) continue;
        if (placed.some(([x, y]) => Math.abs(x - n.lon) < 0.75 && Math.abs(y - n.lat) < 0.22)) continue;
        placed.push([n.lon, n.lat]);
        const label = document.createElement("div");
        label.className = "town";
        label.textContent = n.name.replace(/ (Central|Junction|Town)$/, "");
        new maplibre.Marker({ element: label, anchor: "left", offset: [6, 0] }).setLngLat([n.lon, n.lat]).addTo(m);
      }
      // "load" waits for basemap tiles, which may never arrive; our layers only need the style.
      // An inline style can finish loading inside the constructor, before any listener exists.
      const setup = () => {
        if (!m || cancelled) return;
        m.addSource("rain", { type: "geojson", data: gridGeoJSON(network) });
        m.addLayer({
          id: "rain", type: "fill", source: "rain",
          paint: {
            "fill-color": ["interpolate", ["linear"], ["coalesce", ["feature-state", "rain"], 0],
              0, "#4f8fe0", 10, "#2f6fd0", 40, "#5b2fd0", 100, "#c02fd0"],
            "fill-opacity": ["interpolate", ["linear"], ["coalesce", ["feature-state", "rain"], 0],
              // drizzle stays nearly invisible so the storm itself stands out
              0, 0, 2, 0, 5, 0.12, 15, 0.3, 40, 0.5],
          },
        });
        m.addSource("storm-tracks", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "storm-tracks", type: "line", source: "storm-tracks",
          paint: { "line-color": "#6b5bd6", "line-width": 1.2, "line-dasharray": [2, 2], "line-opacity": 0.7 } });
        m.addSource("segments", { type: "geojson", data: segmentGeoJSON(network) });
        m.addLayer({ id: "segments-casing", type: "line", source: "segments",
          layout: { "line-cap": "round" },
          paint: { "line-color": dark ? "#0b0f14" : "#ffffff",
                   "line-width": ["case", ["boolean", ["feature-state", "hl"], false], 10, 6] } });
        m.addLayer({ id: "segments", type: "line", source: "segments",
          layout: { "line-cap": "round" },
          paint: {
            "line-color": ["coalesce", ["feature-state", "color"], "#888"],
            "line-width": ["case", ["boolean", ["feature-state", "hl"], false], 6.5, 3.5],
          } });
        m.addSource("storm-centres", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "storm-centres", type: "circle", source: "storm-centres",
          paint: { "circle-radius": 7, "circle-color": "#6b5bd6", "circle-stroke-color": "#fff",
                   "circle-stroke-width": 2 } });
        m.on("click", "segments", (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (id) clickRef.current?.(id);
        });
        m.on("mouseenter", "segments", () => { m!.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", "segments", () => { m!.getCanvas().style.cursor = ""; });
        map.current = m;
        // exposed for verification in tests and the browser console
        (window as unknown as { __rpMap?: MLMap }).__rpMap = m;
        setReady(true);
      };
      if (m.isStyleLoaded()) setup();
      else m.once("style.load", setup);
    })();
    return () => { cancelled = true; m?.remove(); map.current = null; };
  }, [network]);

  // storm tracks change per scenario, the centre per hour
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const g = stormGeoJSON(storms, manifest, hour);
    (m.getSource("storm-tracks") as GeoJSONSource).setData(g.tracks);
    (m.getSource("storm-centres") as GeoJSONSource).setData(g.centres);
  }, [ready, storms, manifest, hour]);

  // the hour or mode changed: update feature-state only, never rebuild layers
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !data) return;
    const palette = statusColors(dark);
    for (const s of network.segments) {
      let color: string;
      if (mode === "now") {
        color = palette[data.status(hour, s.ix)];
      } else {
        const p = data.pClosed3h(hour, s.ix, manifest.no_forecast_value);
        color = p === null ? "#8a8f98" : rampColor(p);
      }
      m.setFeatureState({ source: "segments", id: s.ix }, { color });
    }
    for (let c = 0; c < data.cells; c++) {
      m.setFeatureState({ source: "rain", id: c }, { rain: data.cellRain(hour, c) });
    }
  }, [ready, data, hour, mode, network, manifest, dark]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const hl = new Set(highlight);
    for (const s of network.segments) {
      m.setFeatureState({ source: "segments", id: s.ix }, { hl: hl.has(s.id) });
    }
  }, [ready, highlight, network]);

  return <div ref={el} className="map" role="region" aria-label="Map of the simulated Tamil Nadu road network" />;
}

export function rampColor(p: number) {
  let i = 0;
  while (i + 1 < FORECAST_STOPS.length && FORECAST_STOPS[i + 1][0] <= p) i++;
  if (i + 1 >= FORECAST_STOPS.length) return FORECAST_STOPS[i][1];
  const [p0, c0] = FORECAST_STOPS[i];
  const [p1, c1] = FORECAST_STOPS[i + 1];
  const t = (p - p0) / (p1 - p0);
  const mix = (a: string, b: string, k: number) => {
    const x = parseInt(a.slice(k, k + 2), 16), y = parseInt(b.slice(k, k + 2), 16);
    return Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  };
  return `#${mix(c0, c1, 1)}${mix(c0, c1, 3)}${mix(c0, c1, 5)}`;
}
