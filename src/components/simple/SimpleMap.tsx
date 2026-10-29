"use client";

// Simple-mode map: detailed basemap (light or dark), plain grey streets, simulated water and closures, and up to three
// routes (the best one glows amber). Pins A and B can be dragged.

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { coordsOf, type StepState, type Streets } from "@/lib/streets";
import { applyBasemapTheme, basemapStyle, LABELS_FROM } from "@/lib/basemap";
import { BEST_GLOW, type PlannedRoute } from "@/lib/planner";
import Icon from "../street/Icons";

export interface SimpleLayers { roads: boolean; rain: boolean; depth: boolean; closures: boolean }
export interface Pt { lon: number; lat: number; name: string }

interface Props {
  streets: Streets;
  state: StepState | null;
  layers: SimpleLayers;
  routes: PlannedRoute[];
  winner: string | null;
  sel: string | null;
  from: Pt | null;
  to: Pt | null;
  crosshair: boolean;
  inspect: boolean;
  onMapClick: (lon: number, lat: number, street: number | null) => void;
  onDrag: (k: "from" | "to", lon: number, lat: number) => void;
  onRoute: (key: string) => void;
  dark: boolean;
}

const ROAD = { light: ["#8b93a7", "#a9b0bf"], dark: ["#6a7d93", "#4d5e72"] };
const roadColor = (dark: boolean) => ["match", ["get", "c"], [0, 1], ROAD[dark ? "dark" : "light"][0], ROAD[dark ? "dark" : "light"][1]] as unknown as maplibregl.ExpressionSpecification;
const WIDTH = (k: number) => ["interpolate", ["exponential", 1.6], ["zoom"],
  10, ["match", ["get", "c"], 0, 1.4 * k, 1, 1.2 * k, 2, 0.9 * k, 3, 0.6 * k, 0.25 * k],
  16, ["match", ["get", "c"], 0, 9 * k, 1, 8 * k, 2, 6.5 * k, 3, 5 * k, 3 * k]] as unknown as maplibregl.ExpressionSpecification;
// pad fitted routes clear of the dropdowns (top), the controls (right) and the summary (bottom)
const PAD = () => (window.innerWidth > 900 ? { top: 80, left: 40, right: 70, bottom: 150 } : { top: 70, left: 20, right: 60, bottom: 110 });

export default function SimpleMap(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  // the live map, not a boolean: a rebuilt map (hidden page shown again) is a new value, so every effect re-runs on it
  const [ready, setReady] = useState<MLMap | null>(null);
  const shown = useRef<Uint32Array>(new Uint32Array(0));
  const fitted = useRef<string | null>(null);
  const marks = useRef<{ from?: Marker; to?: Marker }>({});
  const cb = useRef({ onMapClick: p.onMapClick, onDrag: p.onDrag, onRoute: p.onRoute, inspect: p.inspect });
  useEffect(() => { cb.current = { onMapClick: p.onMapClick, onDrag: p.onDrag, onRoute: p.onRoute, inspect: p.inspect }; });
  // hidden pages stay alive (cacheComponents → <Activity>): the map is removed on hide and rebuilt on show
  const darkNow = useRef(p.dark);
  const themed = useRef(p.dark);
  useEffect(() => { darkNow.current = p.dark; });

  useEffect(() => {
    let cancelled = false;
    let m: MLMap | undefined;
    (async () => {
      const maplibre = (await import("maplibre-gl")).default;
      if (cancelled || !el.current) return;
      const [x0, y0, x1, y1] = p.streets.meta.bbox;
      themed.current = darkNow.current;
      const style = basemapStyle(darkNow.current);
      m = new maplibre.Map({
        container: el.current, style, bounds: [[x0, y0], [x1, y1]], fitBoundsOptions: { padding: 30 },
        minZoom: 10, maxZoom: 18, maxBounds: [[79.95, 12.75], [80.55, 13.3]], attributionControl: false, fadeDuration: 0,
        dragRotate: false, pitchWithRotate: false,
      });
      m.touchZoomRotate.disableRotation();
      m.addControl(new maplibre.AttributionControl({ compact: true, customAttribution: p.streets.meta.attribution }), "bottom-right");
      m.addControl(new maplibre.ScaleControl({ unit: "metric" }), "bottom-left");
      m.on("error", (e) => { if ((e as { sourceId?: string }).sourceId !== "openmaptiles") console.error(e.error ?? e); });
      m.once("style.load", () => {
        if (!m || cancelled) return;
        m.addSource("streets", { type: "vector", tiles: [`${location.origin}/data/streets/tiles/{z}/{x}/{y}.pbf`], minzoom: 10, maxzoom: 14 });
        m.addLayer({ id: "roads", type: "line", source: "streets", "source-layer": "streets", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": roadColor(darkNow.current), "line-width": WIDTH(0.9), "line-opacity": 0.8 } }, LABELS_FROM);
        m.addLayer({ id: "depth", type: "line", source: "streets", "source-layer": "streets", layout: { "line-cap": "round" }, paint: {
          // only water a driver would notice (> 8 cm, the simulation's "wet, slow" threshold)
          "line-color": ["interpolate", ["linear"], ["coalesce", ["feature-state", "d"], 0], 8, "rgb(34,211,238)", 40, "rgb(37,99,235)"],
          "line-width": WIDTH(1.8), "line-opacity": ["case", [">=", ["coalesce", ["feature-state", "d"], 0], 8], 0.85, 0],
        } }, LABELS_FROM);
        m.addLayer({ id: "closures", type: "line", source: "streets", "source-layer": "streets", layout: { "line-cap": "butt" }, paint: {
          "line-color": "#ef4444", "line-width": WIDTH(1.3), "line-dasharray": [1.2, 1],
          "line-opacity": ["case", ["boolean", ["feature-state", "cl"], false], 0.95, 0],
        } }, LABELS_FROM);
        m.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "route-glow", type: "line", source: "routes", filter: ["get", "win"], layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": BEST_GLOW, "line-width": 20, "line-opacity": 0.38, "line-blur": 6 } });
        m.addLayer({ id: "route-gold", type: "line", source: "routes", filter: ["get", "win"], layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": BEST_GLOW, "line-width": 10, "line-opacity": 0.95 } });
        m.addLayer({ id: "route-line", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "win"], 6, ["get", "sel"], 5, 4], "line-opacity": ["case", ["get", "win"], 1, 0.9] } });
        m.on("click", "route-line", (e) => { const k = e.features?.[0]?.properties?.key; if (k) cb.current.onRoute(String(k)); });
        m.on("mouseenter", "route-line", () => { m!.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", "route-line", () => { m!.getCanvas().style.cursor = ""; });
        m.on("click", (e) => {
          if (m!.queryRenderedFeatures(e.point, { layers: ["route-line"] }).length && !cb.current.inspect) return;
          let street: number | null = null;
          if (cb.current.inspect) {
            const { x, y } = e.point, r = 8;
            const f = m!.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers: ["roads"] })[0];
            street = f?.id !== undefined ? Number(f.id) : -1;
          }
          cb.current.onMapClick(e.lngLat.lng, e.lngLat.lat, street);
        });
        map.current = m;
        (window as unknown as { __rpSimpleMap?: MLMap }).__rpSimpleMap = m;
        setReady(m);
      });
    })();
    return () => { cancelled = true; m?.remove(); map.current = null; setReady(null); shown.current = new Uint32Array(0); marks.current = {}; fitted.current = null; };
  }, [p.streets]);

  // water + closures: touch only streets listed now or last time
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !p.state) return;
    // reset, never removeFeatureState: MapLibre 5 throws when a removed feature is set again before the next frame
    for (const i of shown.current) m.setFeatureState({ source: "streets", sourceLayer: "streets", id: i }, { d: 0, cl: false });
    for (const i of p.state.listed) m.setFeatureState({ source: "streets", sourceLayer: "streets", id: i }, { d: p.state.depth[i], cl: p.state.status[i] >= 3 });
    shown.current = p.state.listed;
  }, [ready, p.state]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.setLayoutProperty("roads", "visibility", p.layers.roads ? "visible" : "none");
    m.setLayoutProperty("depth", "visibility", p.layers.depth ? "visible" : "none");
    m.setLayoutProperty("closures", "visibility", p.layers.closures ? "visible" : "none");
  }, [ready, p.layers]);

  // theme switch: repaint in place
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || themed.current === p.dark) return;
    themed.current = p.dark;
    applyBasemapTheme(m, p.dark);
    m.setPaintProperty("roads", "line-color", roadColor(p.dark));
  }, [ready, p.dark]);

  // routes: the winner last so it sits on top
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const feats = p.routes.map((r) => ({
      type: "Feature" as const, properties: { key: r.key, color: r.color, win: r.key === p.winner, sel: r.key === p.sel },
      geometry: { type: "MultiLineString" as const, coordinates: r.route.streets.map((i) => coordsOf(p.streets, i)) },
    })).sort((a, b) => Number(a.properties.win) - Number(b.properties.win));
    (m.getSource("routes") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats });
    const fk = JSON.stringify([p.from?.lon, p.from?.lat, p.to?.lon, p.to?.lat]);
    if (p.routes.length && fitted.current !== fk) {
      fitted.current = fk;
      let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
      for (const f of feats) for (const line of f.geometry.coordinates) for (const [x, y] of line) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      m.fitBounds([[x0, y0], [x1, y1]], { padding: PAD(), duration: still ? 0 : 600, maxZoom: 16 });
    }
  }, [ready, p.routes, p.winner, p.sel, p.from, p.to, p.streets]);

  // pins A and B, draggable
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    let gone = false;
    (async () => {
      const maplibre = (await import("maplibre-gl")).default;
      if (gone) return;
      for (const k of ["from", "to"] as const) {
        const pt = k === "from" ? p.from : p.to, cur = marks.current[k];
        if (!pt) { cur?.remove(); marks.current[k] = undefined; continue; }
        if (cur) { cur.setLngLat([pt.lon, pt.lat]); continue; }
        const div = document.createElement("div");
        div.className = `rps-pin ${k === "from" ? "start" : "end"}`;
        div.innerHTML = `<i></i><span>${k === "from" ? "A" : "B"}</span>`;
        div.title = `${k === "from" ? "Start" : "Destination"} (drag to move)`;
        const mk = new maplibre.Marker({ element: div, draggable: true }).setLngLat([pt.lon, pt.lat]).addTo(m);
        mk.on("dragend", () => { const ll = mk.getLngLat(); cb.current.onDrag(k, ll.lng, ll.lat); });
        marks.current[k] = mk;
      }
    })();
    return () => { gone = true; };
  }, [ready, p.from, p.to]);

  const zoom = (d: number) => map.current?.easeTo({ zoom: (map.current.getZoom() ?? 12) + d, duration: 250 });
  const recenter = () => {
    const m = map.current;
    if (!m) return;
    const [x0, y0, x1, y1] = p.streets.meta.bbox;
    if (!p.routes.length) m.fitBounds([[x0, y0], [x1, y1]], { padding: 30 });
    else {
      let a = 180, b = 90, c = -180, d = -90;
      for (const r of p.routes) for (const i of r.route.streets) for (const [x, y] of coordsOf(p.streets, i)) {
        a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y);
      }
      m.fitBounds([[a, b], [c, d]], { padding: PAD(), maxZoom: 16 });
    }
  };
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.current?.closest(".rps-stage")?.requestFullscreen().catch(() => {});
  };

  return (
    <>
      <div ref={el} className={`rps-map ${p.crosshair ? "picking" : ""}`} role="region"
           aria-label="Map of Chennai streets with simulated water, closures and your routes" />
      <div className="rps-mapctl">
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1)}><Icon name="plus" size={18} /></button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(-1)}><Icon name="minus" size={18} /></button>
        <button type="button" aria-label="Recenter" title="Recenter on the routes" onClick={recenter}><Icon name="target" size={18} /></button>
        {typeof document !== "undefined" && document.fullscreenEnabled && (
          <button type="button" aria-label={full ? "Exit full screen" : "Full screen"} aria-pressed={full} title={full ? "Exit full screen (Esc)" : "Full screen"} onClick={fullscreen}>
            <Icon name={full ? "shrink" : "expand"} size={18} />
          </button>
        )}
      </div>
    </>
  );
}
