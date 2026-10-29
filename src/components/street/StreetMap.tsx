"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { gridGeoJSON, type Network, type ScenarioData } from "@/lib/bundle";
import { BAND_CODE, BANDS, bandHex, bandOf, PLACES, type Band, type Route, type StepState, type Streets, coordsOf } from "@/lib/streets";
import { applyBasemapTheme, basemapStyle, LABELS_FROM } from "@/lib/basemap";
import { googleAvailable, googleCopyright, googleSession } from "@/lib/basemap/google";
import { accuracyCircle, type Fix } from "@/lib/geo";
import { bearing, pointAt, routePath, type Path } from "@/lib/path";
import Icon from "./Icons";

export interface Layers { risk: boolean; rain: boolean; water: boolean; closures: boolean; buildings: boolean }

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
  view3d?: boolean;
  drive?: boolean;
  onDriveExit?: () => void;
  dark: boolean;
  /** Google roadmap + live traffic under the app's layers (control room), when a key is configured */
  google?: boolean;
}

const CENTER: [number, number] = [80.245, 13.045];
// build_buildings.py: Overture footprints for the street-simulation bbox, h = metres, e = 1 if estimated
const BUILDINGS_BOUNDS: [number, number, number, number] = [80.17, 12.88, 80.32, 13.17];
const BUILDINGS_ATTRIB = "Buildings © Overture Maps";
const PITCH_3D = 60, BEARING_3D = -17;
const DRIVE = { pitch: 66, zoom: 17.2, lookM: 70, mps: [45, 140] as const };

// Buildings: walls vary between five facade tones (picked from the height, so a block reads as separate buildings),
// a thin lighter roof cap, and a low sun from the south-west so walls facing it are lit and the rest fall in shade.
const FACADE = {
  light: ["#e9e2d6", "#ddd4c6", "#d3cbbd", "#efe9df", "#c8c1b4"],
  dark: ["#1d2b3a", "#223244", "#28394c", "#1a2735", "#2d4054"],
};
const ROOF = { light: "#f6f3ee", dark: "#3a5068" };
const facade = (dark: boolean) => {
  const c = FACADE[dark ? "dark" : "light"];
  return ["match", ["%", ["round", ["*", ["get", "h"], 7]], 5], 0, c[0], 1, c[1], 2, c[2], 3, c[3], c[4]] as unknown as maplibregl.ExpressionSpecification;
};
const SUN = (dark: boolean) => ({ anchor: "map" as const, position: [1.2, 210, 32] as [number, number, number], color: dark ? "#cfe0ff" : "#fff6e8", intensity: dark ? 0.3 : 0.45 });
// app colours that change with the theme: [layer, paint property, light, dark]
const THEMED: [string, string, string, string][] = [
  ["routes-casing", "line-color", "#ffffff", "#06111d"],
  ["ends", "circle-stroke-color", "#ffffff", "#06111d"],
  ["closures", "line-color", "#1f2937", "#ffffff"],
  ["selected", "line-color", "#111827", "#ffffff"],
  ["roofs", "fill-extrusion-color", ROOF.light, ROOF.dark],
];

// band code → colour (darker set on a light map); `fallback` is the code of streets with no state this step
const bandColor = (dark: boolean, fallback = BAND_CODE.low) => ["match", ["coalesce", ["feature-state", "b"], fallback],
  ...BANDS.flatMap((b) => [BAND_CODE[b.id], bandHex(b, dark)]), bandHex(BANDS[3], dark)] as unknown as maplibregl.ExpressionSpecification;
// widths by road class: trunk, primary, secondary, tertiary, minor
const WIDTH = (k: number) => ["interpolate", ["exponential", 1.6], ["zoom"],
  10, ["match", ["get", "c"], 0, 1.6 * k, 1, 1.3 * k, 2, 1.0 * k, 3, 0.7 * k, 0.25 * k],
  16, ["match", ["get", "c"], 0, 9 * k, 1, 8 * k, 2, 6.5 * k, 3, 5 * k, 3 * k]] as unknown as maplibregl.ExpressionSpecification;

export default function StreetMap(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [inst, setInst] = useState<MLMap | null>(null);
  // the live map, not a boolean: a rebuilt map (hidden page shown again) is a new value, so every effect re-runs on it
  const ready = inst;
  const shown = useRef<Uint32Array>(new Uint32Array(0));
  const prevSel = useRef<number | null>(null);
  const onSelect = useRef(p.onSelect);
  useEffect(() => { onSelect.current = p.onSelect; }, [p.onSelect]);
  // Next keeps up to 3 visited pages alive hidden (cacheComponents → <Activity>): hiding runs the cleanups below and
  // showing runs the effects again on a new map, so nothing may assume the map is created only once.
  const darkNow = useRef(p.dark);
  const themed = useRef(p.dark);
  useEffect(() => { darkNow.current = p.dark; });
  const [copyright, setCopyright] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let m: MLMap | undefined;
    (async () => {
      const maplibre = (await import("maplibre-gl")).default;
      if (cancelled || !el.current) return;
      m = new maplibre.Map({
        container: el.current, style: basemapStyle(darkNow.current), center: CENTER, zoom: 11.7, minZoom: 10, maxZoom: 17,
        maxBounds: [[79.95, 12.75], [80.55, 13.3]], attributionControl: false, fadeDuration: 0, maxPitch: 70,
      });
      m.addControl(new maplibre.NavigationControl({ visualizePitch: true }), "bottom-right");
      m.addControl(new maplibre.ScaleControl({ unit: "metric" }), "bottom-left");
      m.addControl(new maplibre.AttributionControl({ compact: true, customAttribution: [p.streets.meta.attribution, BUILDINGS_ATTRIB] }));
      m.on("error", (e) => { const s = (e as { sourceId?: string }).sourceId; if (s !== "openmaptiles" && s !== "google") console.error(e.error ?? e); });
      for (const pl of PLACES) {
        const label = document.createElement("div");
        label.className = "place-label";
        label.textContent = pl.name;
        new maplibre.Marker({ element: label, anchor: "left", offset: [10, 0] }).setLngLat([pl.lon, pl.lat]).addTo(m);
      }
      const setup = () => {
        if (!m || cancelled) return;
        const dark = darkNow.current;
        themed.current = dark;
        m.setLight(SUN(dark));
        m.addSource("rain", { type: "geojson", data: gridGeoJSON(p.network) });
        m.addLayer({ id: "rain", type: "fill", source: "rain", layout: { visibility: "none" }, paint: {
          "fill-color": ["interpolate", ["linear"], ["coalesce", ["feature-state", "rain"], 0], 0, "#2b6cb0", 20, "#4c6ef5", 60, "#9b6cf5"],
          "fill-opacity": ["interpolate", ["linear"], ["coalesce", ["feature-state", "rain"], 0], 0, 0, 2, 0, 5, 0.14, 20, 0.3, 60, 0.45],
        } }, LABELS_FROM);
        // pre-cut by build_street_sim.py; the browser only fetches the tiles in view
        m.addSource("streets", { type: "vector", tiles: [`${location.origin}/data/streets/tiles/{z}/{x}/{y}.pbf`], minzoom: 10, maxzoom: 14 });
        m.addLayer({ id: "water", type: "line", source: "streets", "source-layer": "streets", layout: { "line-cap": "round", visibility: "none" }, paint: {
          "line-color": "#38bdf8", "line-blur": 3, "line-width": WIDTH(3.2),
          "line-opacity": ["case", [">=", ["coalesce", ["feature-state", "d"], 0], 18], 0.7, 0],
        } }, LABELS_FROM);
        m.addLayer({ id: "streets", type: "line", source: "streets", "source-layer": "streets", layout: { "line-cap": "round", "line-join": "round" }, paint: {
          "line-color": bandColor(dark), "line-width": WIDTH(1), "line-opacity": 0.92,
        } }, LABELS_FROM);
        m.addLayer({ id: "closures", type: "line", source: "streets", "source-layer": "streets", layout: { "line-cap": "butt" }, paint: {
          "line-color": dark ? "#ffffff" : "#1f2937", "line-width": WIDTH(0.55), "line-dasharray": [1.2, 1.4],
          "line-opacity": ["case", ["boolean", ["feature-state", "cl"], false], 0.9, 0],
        } }, LABELS_FROM);
        m.addLayer({ id: "selected", type: "line", source: "streets", "source-layer": "streets", layout: { "line-cap": "round" }, paint: {
          "line-color": dark ? "#ffffff" : "#111827", "line-width": WIDTH(2.4), "line-gap-width": 0,
          "line-opacity": ["case", ["boolean", ["feature-state", "sel"], false], 0.95, 0],
        } }, "streets");
        // 3D buildings sit over the risk-coloured streets but under the routes, so the route stays readable
        m.addSource("buildings", { type: "vector", tiles: [`${location.origin}/data/buildings/tiles/{z}/{x}/{y}.pbf`],
          minzoom: 13, maxzoom: 14, bounds: BUILDINGS_BOUNDS });
        const grow = (dh: number) => ["interpolate", ["linear"], ["zoom"], 13, 0, 14.5, ["+", ["get", "h"], dh]] as unknown as maplibregl.ExpressionSpecification;
        m.addLayer({ id: "buildings", type: "fill-extrusion", source: "buildings", "source-layer": "buildings", minzoom: 13,
          layout: { visibility: "none" }, paint: {
            "fill-extrusion-color": facade(dark), "fill-extrusion-height": grow(0),
            "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.97, "fill-extrusion-vertical-gradient": true,
          } }, LABELS_FROM);
        m.addLayer({ id: "roofs", type: "fill-extrusion", source: "buildings", "source-layer": "buildings", minzoom: 13,
          layout: { visibility: "none" }, paint: {
            "fill-extrusion-color": dark ? ROOF.dark : ROOF.light, "fill-extrusion-base": grow(0), "fill-extrusion-height": grow(0.4),
            "fill-extrusion-opacity": 0.97, "fill-extrusion-vertical-gradient": false,
          } }, LABELS_FROM);
        m.addSource("routes",{ type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "routes-casing", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": dark ? "#06111d" : "#ffffff", "line-width": ["case", ["get", "active"], 9, 6], "line-opacity": 0.85 } });
        m.addLayer({ id: "routes", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["case", ["get", "active"], "#3d9bff", "#a8b8cc"], "line-width": ["case", ["get", "active"], 5, 3],
                   "line-opacity": ["case", ["get", "active"], 1, 0.7] } });
        m.addSource("ends", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "ends", type: "circle", source: "ends", paint: {
          "circle-radius": 7, "circle-color": ["case", ["==", ["get", "k"], "a"], "#3fbf78", "#ff4d5e"],
          "circle-stroke-color": dark ? "#06111d" : "#ffffff", "circle-stroke-width": 3 } });
        m.addSource("me", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "me-accuracy", type: "fill", source: "me", filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#3d9bff", "fill-opacity": 0.14, "fill-outline-color": "#3d9bff" } });
        m.addLayer({ id: "me-dot", type: "circle", source: "me", filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-radius": 7, "circle-color": "#3d9bff", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
        m.addSource("drive", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "drive", type: "circle", source: "drive", paint: {
          "circle-radius": 8, "circle-color": "#ffffff", "circle-stroke-color": "#3d9bff", "circle-stroke-width": 4,
          "circle-pitch-alignment": "map" } });
        // minor streets are under 1 px wide at city zoom, so a click also accepts a street within 6 px
        m.on("click", (e) => {
          const { x, y } = e.point, r = 6;
          const f = m!.queryRenderedFeatures(e.point, { layers: ["streets"] })[0]
            ?? m!.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers: ["streets"] })[0];
          if (f?.id !== undefined) onSelect.current(Number(f.id));
        });
        m.on("mouseenter", "streets", () => { m!.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", "streets", () => { m!.getCanvas().style.cursor = ""; });
        map.current = m;
        (window as unknown as { __rpStreetMap?: MLMap }).__rpStreetMap = m;
        setInst(m);
      };
      if (m.isStyleLoaded()) setup(); else m.once("style.load", setup);
    })();
    return () => { cancelled = true; m?.remove(); map.current = null; setInst(null); shown.current = new Uint32Array(0); prevSel.current = null; };
  }, [p.streets, p.network]);

  // theme switch: repaint the basemap, buildings, sun and theme-tinted app layers in place (state is kept)
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || themed.current === p.dark) return;
    themed.current = p.dark;
    applyBasemapTheme(m, p.dark);
    m.setLight(SUN(p.dark));
    m.setPaintProperty("buildings", "fill-extrusion-color", facade(p.dark));
    for (const [id, prop, light, dark] of THEMED) m.setPaintProperty(id, prop, p.dark ? dark : light);
  }, [ready, p.dark]);

  // Google roadmap + traffic: a raster under the app's layers; the OpenFreeMap layers hide while it shows
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !p.google || !googleAvailable) return;
    let gone = false, session = "";
    const bm = m.getStyle().layers.filter((l) => l.id.startsWith("bm-")).map((l) => l.id);
    const credit = () => {
      if (!session) return;
      const b = m.getBounds();
      void googleCopyright(session, m.getZoom(), { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() })
        .then((c) => { if (!gone) setCopyright(c); });
    };
    googleSession(p.dark).then((g) => {
      if (gone) return;
      session = g.session;
      m.addSource("google", { type: "raster", tiles: g.tiles, tileSize: 256, maxzoom: 22 });
      m.addLayer({ id: "google", type: "raster", source: "google" }, m.getStyle().layers.find((l) => !l.id.startsWith("bm-"))?.id);
      for (const id of bm) m.setLayoutProperty(id, "visibility", "none");
      credit();
    }).catch((e) => { console.warn(e); });
    m.on("moveend", credit);
    return () => {
      gone = true;
      m.off("moveend", credit);
      setCopyright(null);
      if (!m.style) return; // the map was already removed (StreetMap unmounted first)
      if (m.getLayer("google")) m.removeLayer("google");
      if (m.getSource("google")) m.removeSource("google");
      for (const id of bm) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", "visible");
    };
  }, [ready, p.google, p.dark]);

  // street state: touch only streets listed now or listed last time
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !p.state) return;
    const st = p.state;
    // reset, never removeFeatureState: MapLibre 5 throws when a removed feature is set again before the next frame
    for (const i of shown.current) m.setFeatureState({ source: "streets", sourceLayer: "streets", id: i }, { b: null, d: 0, cl: false });
    for (const i of st.listed) {
      m.setFeatureState({ source: "streets", sourceLayer: "streets", id: i }, { b: BAND_CODE[bandOf(st.p[i])], d: st.depth[i], cl: st.status[i] >= 3 });
    }
    shown.current = st.listed;
    // on the last step nothing has a forecast, so unlisted streets are "no estimate" too
    const noFc = st.p[0] === 255 ? BAND_CODE.none : BAND_CODE.low;
    m.setPaintProperty("streets", "line-color", bandColor(p.dark, noFc));
  }, [ready, p.state, p.dark]);

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
    // flat footprints only clutter the 2D risk map, so buildings show in the 3D views
    const b3d = p.layers.buildings && (p.view3d || p.drive) ? "visible" : "none";
    m.setLayoutProperty("buildings", "visibility", b3d);
    m.setLayoutProperty("roofs", "visibility", b3d);
    const visible = BANDS.filter((b) => p.bands.has(b.id)).map((b) => BAND_CODE[b.id]);
    // unlisted streets take the same default as the colour layer: "no estimate" on the last step, else low
    const noFc = p.state && p.state.p[0] === 255 ? BAND_CODE.none : BAND_CODE.low;
    m.setPaintProperty("streets", "line-opacity",
      ["case", ["in", ["coalesce", ["feature-state", "b"], noFc], ["literal", visible]], 0.92, 0.06]);
  }, [ready, p.layers, p.bands, p.state, p.view3d, p.drive]);

  // 2D ⇄ 3D: tilt and turn the camera; reduced motion jumps
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || p.drive) return;
    const target = p.view3d
      ? { pitch: PITCH_3D, bearing: BEARING_3D, zoom: Math.max(m.getZoom(), 14.6) }
      : { pitch: 0, bearing: 0 };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) m.jumpTo(target);
    else m.easeTo({ ...target, duration: 700 });
  }, [ready, p.view3d, p.drive]);

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

  const active = p.routes[p.activeRoute];
  const path = useMemo(() => (p.drive && active ? routePath(p.streets, active.streets) : null), [p.drive, active, p.streets]);

  return (
    <>
      <div ref={el} className="sv-map" role="region" aria-label="Map of Chennai streets coloured by simulated closure risk at +3 hours" />
      {p.drive && inst && <Drive map={inst} path={path} onExit={p.onDriveExit ?? (() => {})} />}
      {copyright && <div className="sv-google"><b>Google</b><span>{copyright}</span></div>}
    </>
  );
}

// ---------------------------------------------------------------- drive along the active route
// Mounted only while driving, so leaving resets it. A chase camera follows a marker; the slider works with reduced motion.

function Drive({ map: m, path, onExit }: { map: MLMap; path: Path | null; onExit: () => void }) {
  const [still, setStill] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [playing, setPlaying] = useState(false);
  const [fast, setFast] = useState(false);
  const [rawAt, setAt] = useState(0);
  const at = path ? Math.min(rawAt, path.total) : 0;
  const dist = useRef(0);
  const heading = useRef<number | null>(null);

  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setStill(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);

  // marker + camera at `dist`; the camera looks at a point ahead, eased so corners turn smoothly
  const place = useCallback((snap: boolean) => {
    // a re-shown hidden page runs this once with the old, removed map before StreetMap passes the new one
    if (!path || !m.style) return;
    const here = pointAt(path, dist.current), ahead = pointAt(path, dist.current + DRIVE.lookM);
    const want = bearing(here, ahead), prev = heading.current;
    const turn = prev === null ? 0 : ((want - prev + 540) % 360) - 180;
    heading.current = prev === null || snap ? want : prev + turn * 0.12;
    (m.getSource("drive") as GeoJSONSource).setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: here } });
    m.jumpTo({ center: here, bearing: heading.current, pitch: DRIVE.pitch, zoom: DRIVE.zoom });
  }, [m, path]);

  // a new route (the hour moved on) keeps the distance travelled, clamped to its length
  useEffect(() => {
    if (!path) return;
    dist.current = Math.min(dist.current, path.total);
    heading.current = null;
    place(true);
  }, [path, place]);

  useEffect(() => {
    // a drag or rotate by the user takes over the camera: pause
    const stop = (e: { originalEvent?: unknown }) => { if (e.originalEvent) setPlaying(false); };
    m.on("dragstart", stop); m.on("rotatestart", stop); m.on("pitchstart", stop);
    return () => {
      m.off("dragstart", stop); m.off("rotatestart", stop); m.off("pitchstart", stop);
      // leaving the mode removes the map before this cleanup runs
      if (m.style) (m.getSource("drive") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
    };
  }, [m]);

  useEffect(() => {
    if (!playing || !path || still) return;
    let raf = 0, last = performance.now(), shown = last;
    const tick = (now: number) => {
      dist.current = Math.min(path.total, dist.current + ((now - last) / 1000) * DRIVE.mps[fast ? 1 : 0]);
      last = now;
      place(false);
      const end = dist.current >= path.total;
      if (now - shown > 120 || end) { setAt(dist.current); shown = now; }
      if (end) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, path, fast, still, place]);

  const seek = (d: number) => { dist.current = d; heading.current = null; place(true); setAt(d); };

  return (
    <div className="sv-drive" role="group" aria-label="Drive along the route">
      {path ? (
        <>
          <button type="button" className="sv-drive-btn" disabled={still || at >= path.total}
                  aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((v) => !v)}
                  title={still ? "Reduced motion is on: move along the route with the slider" : undefined}>
            <Icon name={playing ? "pause" : "play"} size={16} />
          </button>
          <label className="sv-drive-track">
            <span className="sr-only">Position along the route</span>
            <input type="range" min={0} max={Math.round(path.total)} step={10} value={Math.round(at)}
                   aria-valuetext={`${(at / 1000).toFixed(1)} of ${(path.total / 1000).toFixed(1)} km`}
                   onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }} />
          </label>
          <span className="sv-drive-km">{(at / 1000).toFixed(1)} / {(path.total / 1000).toFixed(1)} km</span>
          <button type="button" className="sv-drive-btn" aria-pressed={fast} disabled={still}
                  aria-label={`Speed ${fast ? "3×" : "1×"}`} onClick={() => setFast((v) => !v)}>{fast ? "3×" : "1×"}</button>
        </>
      ) : <span className="sv-drive-km">No open route at this hour.</span>}
      <button type="button" className="sv-drive-btn sv-drive-exit" onClick={onExit}>
        <Icon name="close" size={14} />Exit
      </button>
    </div>
  );
}
