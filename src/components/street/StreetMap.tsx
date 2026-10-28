"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Network, ScenarioData } from "@/lib/bundle";
import { BAND_CODE, BANDS, bandOf, PLACES, type Band, type Route, type StepState, type Streets, coordsOf } from "@/lib/streets";
import { baseStyle } from "@/lib/style";
import { gridGeoJSON } from "../MapView";
import { accuracyCircle, type Fix } from "@/lib/geo";

export interface Layers { risk: boolean; rain: boolean; water: boolean; closures: boolean }

interface Props {
  streets: Streets;
  network: Network;
  state: StepState | null;
  rainData: ScenarioData | null;
  hour: number;
  layers: Layers;
  bands: Set<Band>;
  routes: Route[];
  activeRoute: number;
  selected: number | null;
  onSelect: (i: number) => void;
  endpoints: readonly [[number, number] | null, [number, number] | null];
  me: Fix | null;
  follow: boolean;
}

const CENTER: [number, number] = [80.245, 13.045];
// band code → colour, code 0 = no estimate
const BAND_COLOR = ["match", ["coalesce", ["feature-state", "b"], 1],
  ...BANDS.flatMap((b) => [BAND_CODE[b.id], b.color]), BANDS[3].color] as unknown as maplibregl.ExpressionSpecification;
// widths by road class: trunk, primary, secondary, tertiary, minor
const WIDTH = (k: number) => ["interpolate", ["exponential", 1.6], ["zoom"],
  10, ["match", ["get", "c"], 0, 1.6 * k, 1, 1.3 * k, 2, 1.0 * k, 3, 0.7 * k, 0.25 * k],
  16, ["match", ["get", "c"], 0, 9 * k, 1, 8 * k, 2, 6.5 * k, 3, 5 * k, 3 * k]] as unknown as maplibregl.ExpressionSpecification;

export default function StreetMap(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const shown = useRef<Uint32Array>(new Uint32Array(0));
  const onSelect = useRef(p.onSelect);
  useEffect(() => { onSelect.current = p.onSelect; }, [p.onSelect]);

  useEffect(() => {
    let cancelled = false;
    let m: MLMap | undefined;
    (async () => {
      const maplibre = (await import("maplibre-gl")).default;
      if (cancelled || !el.current) return;
      m = new maplibre.Map({
        container: el.current, style: baseStyle(true), center: CENTER, zoom: 11.7, minZoom: 10, maxZoom: 17,
        maxBounds: [[79.95, 12.75], [80.55, 13.3]], attributionControl: false, fadeDuration: 0,
      });
      m.addControl(new maplibre.NavigationControl({ visualizePitch: false }), "bottom-right");
      m.addControl(new maplibre.ScaleControl({ unit: "metric" }), "bottom-left");
      m.addControl(new maplibre.AttributionControl({ compact: true, customAttribution: p.streets.meta.attribution }));
      m.on("error", (e) => { if ((e as { sourceId?: string }).sourceId !== "basemap") console.error(e.error ?? e); });
      for (const pl of PLACES) {
        const label = document.createElement("div");
        label.className = "place-label";
        label.textContent = pl.name;
        new maplibre.Marker({ element: label, anchor: "left", offset: [10, 0] }).setLngLat([pl.lon, pl.lat]).addTo(m);
      }
      const setup = () => {
        if (!m || cancelled) return;
        m.addSource("rain", { type: "geojson", data: gridGeoJSON(p.network) });
        m.addLayer({ id: "rain", type: "fill", source: "rain", layout: { visibility: "none" }, paint: {
          "fill-color": ["interpolate", ["linear"], ["coalesce", ["feature-state", "rain"], 0], 0, "#2b6cb0", 20, "#4c6ef5", 60, "#9b6cf5"],
          "fill-opacity": ["interpolate", ["linear"], ["coalesce", ["feature-state", "rain"], 0], 0, 0, 2, 0, 5, 0.14, 20, 0.3, 60, 0.45],
        } });
        // pre-cut by build_street_sim.py; the browser only fetches the tiles in view
        m.addSource("streets", { type: "vector", tiles: [`${location.origin}/data/streets/tiles/{z}/{x}/{y}.pbf`], minzoom: 10, maxzoom: 14 });
        m.addLayer({ id: "water", type: "line", source: "streets", "source-layer": "streets", layout: { "line-cap": "round", visibility: "none" }, paint: {
          "line-color": "#38bdf8", "line-blur": 3, "line-width": WIDTH(3.2),
          "line-opacity": ["case", [">=", ["coalesce", ["feature-state", "d"], 0], 18], 0.7, 0],
        } });
        m.addLayer({ id: "streets", type: "line", source: "streets", "source-layer": "streets", layout: { "line-cap": "round", "line-join": "round" }, paint: {
          "line-color": BAND_COLOR, "line-width": WIDTH(1), "line-opacity": 0.92,
        } });
        m.addLayer({ id: "closures", type: "line", source: "streets", "source-layer": "streets", layout: { "line-cap": "butt" }, paint: {
          "line-color": "#ffffff", "line-width": WIDTH(0.55), "line-dasharray": [1.2, 1.4],
          "line-opacity": ["case", ["boolean", ["feature-state", "cl"], false], 0.9, 0],
        } });
        m.addLayer({ id: "selected", type: "line", source: "streets", "source-layer": "streets", layout: { "line-cap": "round" }, paint: {
          "line-color": "#ffffff", "line-width": WIDTH(2.4), "line-gap-width": 0,
          "line-opacity": ["case", ["boolean", ["feature-state", "sel"], false], 0.95, 0],
        } }, "streets");
        m.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "routes-casing", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#06111d", "line-width": ["case", ["get", "active"], 9, 6], "line-opacity": 0.85 } });
        m.addLayer({ id: "routes", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["case", ["get", "active"], "#3d9bff", "#a8b8cc"], "line-width": ["case", ["get", "active"], 5, 3],
                   "line-opacity": ["case", ["get", "active"], 1, 0.7] } });
        m.addSource("ends", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "ends", type: "circle", source: "ends", paint: {
          "circle-radius": 7, "circle-color": ["case", ["==", ["get", "k"], "a"], "#3fbf78", "#ff4d5e"],
          "circle-stroke-color": "#06111d", "circle-stroke-width": 3 } });
        m.addSource("me", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "me-accuracy", type: "fill", source: "me", filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#3d9bff", "fill-opacity": 0.14, "fill-outline-color": "#3d9bff" } });
        m.addLayer({ id: "me-dot", type: "circle", source: "me", filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-radius": 7, "circle-color": "#3d9bff", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
        m.on("click", "streets", (e) => { const f = e.features?.[0]; if (f?.id !== undefined) onSelect.current(Number(f.id)); });
        m.on("mouseenter", "streets", () => { m!.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", "streets", () => { m!.getCanvas().style.cursor = ""; });
        map.current = m;
        (window as unknown as { __rpStreetMap?: MLMap }).__rpStreetMap = m;
        setReady(true);
      };
      if (m.isStyleLoaded()) setup(); else m.once("style.load", setup);
    })();
    return () => { cancelled = true; m?.remove(); map.current = null; };
  }, [p.streets, p.network]);

  // street state: touch only streets listed now or listed last time
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !p.state) return;
    const st = p.state;
    for (const i of shown.current) m.removeFeatureState({ source: "streets", sourceLayer: "streets", id: i });
    for (const i of st.listed) {
      m.setFeatureState({ source: "streets", sourceLayer: "streets", id: i }, { b: BAND_CODE[bandOf(st.p[i])], d: st.depth[i], cl: st.status[i] >= 3 });
    }
    shown.current = st.listed;
    // on the last step nothing has a forecast, so unlisted streets are "no estimate" too
    const noFc = st.p[0] === 255 ? BAND_CODE.none : BAND_CODE.low;
    m.setPaintProperty("streets", "line-color", ["match", ["coalesce", ["feature-state", "b"], noFc],
      ...BANDS.flatMap((b) => [BAND_CODE[b.id], b.color]), BANDS[3].color]);
  }, [ready, p.state]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !p.rainData) return;
    for (let c = 0; c < p.rainData.cells; c++) m.setFeatureState({ source: "rain", id: c }, { rain: p.rainData.cellRain(p.hour, c) });
  }, [ready, p.rainData, p.hour]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.setLayoutProperty("rain", "visibility", p.layers.rain ? "visible" : "none");
    m.setLayoutProperty("water", "visibility", p.layers.water ? "visible" : "none");
    m.setLayoutProperty("closures", "visibility", p.layers.closures ? "visible" : "none");
    m.setLayoutProperty("streets", "visibility", p.layers.risk ? "visible" : "none");
    const visible = BANDS.filter((b) => p.bands.has(b.id)).map((b) => BAND_CODE[b.id]);
    m.setPaintProperty("streets", "line-opacity",
      ["case", ["in", ["coalesce", ["feature-state", "b"], BAND_CODE.low], ["literal", visible]], 0.92, 0.06]);
  }, [ready, p.layers, p.bands]);

  const prevSel = useRef<number | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    if (prevSel.current !== null) m.setFeatureState({ source: "streets", sourceLayer: "streets", id: prevSel.current }, { sel: false });
    if (p.selected !== null) m.setFeatureState({ source: "streets", sourceLayer: "streets", id: p.selected }, { sel: true });
    prevSel.current = p.selected;
  }, [ready, p.selected]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const feats = p.routes.map((r, k) => ({
      type: "Feature" as const, properties: { active: k === p.activeRoute, kind: r.kind },
      geometry: { type: "MultiLineString" as const, coordinates: r.streets.map((i) => coordsOf(p.streets, i)) },
    }));
    // draw the active route last so it sits on top
    feats.sort((a, b) => Number(a.properties.active) - Number(b.properties.active));
    (m.getSource("routes") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats });
    (m.getSource("ends") as GeoJSONSource).setData({ type: "FeatureCollection", features: p.endpoints.flatMap((c, k) =>
      c ? [{ type: "Feature" as const, properties: { k: k ? "b" : "a" }, geometry: { type: "Point" as const, coordinates: c } }] : []) });
  }, [ready, p.routes, p.activeRoute, p.endpoints, p.streets]);

  // live position: dot + accuracy halo; follow mode keeps it centred
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const me = p.me;
    (m.getSource("me") as GeoJSONSource).setData({ type: "FeatureCollection", features: me ? [
      accuracyCircle(me.lon, me.lat, Math.max(me.accuracyM, 5)),
      { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [me.lon, me.lat] } },
    ] : [] });
    if (me && p.follow) {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const target = { center: [me.lon, me.lat] as [number, number], zoom: Math.max(m.getZoom(), 14) };
      if (still) m.jumpTo(target); else m.easeTo({ ...target, duration: 600 });
    }
  }, [ready, p.me, p.follow]);

  return <div ref={el} className="sv-map" role="region" aria-label="Map of Chennai streets coloured by simulated closure risk at +3 hours" />;
}
