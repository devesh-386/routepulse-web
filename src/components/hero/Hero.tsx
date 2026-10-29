"use client";

// Landing page: a stylised car drives the Marina coast road at street level, between 3D buildings
// (Overture footprints), with the Bay of Bengal moving beside it. The roads and buildings are real;
// the car and its path are a demo. Three cards lead to the modes.

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { bearing, pathOf, pointAt, type Path } from "@/lib/path";
import { coordsOf, loadStreets, type Streets } from "@/lib/streets";
import { TransitionLink as Link } from "../shell/RouteTransition";
import Icon, { type IconName } from "../street/Icons";
import "./hero.css";

const BEACH_ROAD = "Kamarajar Promenade";
const CAR = { mps: 19, zoom: 18.6, pitch: 72, aheadM: 24, scale: 3 };

/**
 * A loop on the Marina beach road: north on its northbound carriageway (the sea on the right of the screen,
 * clear of the text), back south on the other. Each carriageway is one-way in coordinate order, so its
 * segments chain by latitude.
 */
function beachDrive(s: Streets): Path | null {
  const nameIx = s.meta.names.indexOf(BEACH_ROAD);
  if (nameIx < 0) return null;
  const north: [number, number][][] = [], south: [number, number][][] = [];
  for (let i = 0; i < s.meta.count; i++) {
    if (s.name[i] !== nameIx) continue;
    const c = coordsOf(s, i);
    (c[c.length - 1][1] > c[0][1] ? north : south).push(c);
  }
  north.sort((a, b) => a[0][1] - b[0][1]);
  south.sort((a, b) => b[0][1] - a[0][1]);
  return pathOf([...north.flat(), ...south.flat()]);
}

const MODES: { href: string; icon: IconName; title: string; who: string; text: string }[] = [
  { href: "/simple", icon: "map", title: "Simple", who: "For everyone", text: "Type where you're going. Get the safest way there in a few taps." },
  { href: "/max", icon: "cube", title: "Max", who: "For power users", text: "Every street's flood risk, 3D buildings and a street-level drive mode." },
  { href: "/control-room", icon: "monitor", title: "Control room", who: "For operators", text: "City-wide threats, sectors and the event log on one screen." },
];

function style(): StyleSpecification {
  const empty = { type: "FeatureCollection" as const, features: [] };
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sky: { "sky-color": "#0b1b31", "horizon-color": "#1d4772", "fog-color": "#0b1b31", "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.35 },
    light: { anchor: "map", position: [1.3, 225, 40], color: "#ffffff", intensity: 0.55 },
    sources: {
      ofm: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors" },
      streets: { type: "vector", tiles: [`${location.origin}/data/streets/tiles/{z}/{x}/{y}.pbf`], minzoom: 10, maxzoom: 14 },
      buildings: { type: "vector", tiles: [`${location.origin}/data/buildings/tiles/{z}/{x}/{y}.pbf`], minzoom: 13, maxzoom: 14, bounds: [80.17, 12.88, 80.32, 13.17], attribution: "Buildings © Overture Maps" },
      // filled every frame by the drive
      car: { type: "geojson", data: empty },
      beam: { type: "geojson", data: empty },
      trail: { type: "geojson", data: empty, lineMetrics: true },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0a121c" } },
      { id: "park", type: "fill", source: "ofm", "source-layer": "park", paint: { "fill-color": "#0f2a22", "fill-opacity": 0.8 } },
      { id: "landcover", type: "fill", source: "ofm", "source-layer": "landcover", filter: ["in", ["get", "class"], ["literal", ["grass", "wood", "sand"]]],
        paint: { "fill-color": ["match", ["get", "class"], "sand", "#3a3424", "#10261f"], "fill-opacity": 0.75 } },
      { id: "water", type: "fill", source: "ofm", "source-layer": "water", paint: { "fill-color": "#0f5a8f" } },
      { id: "water-waves", type: "fill", source: "ofm", "source-layer": "water", paint: { "fill-pattern": "waves", "fill-opacity": 0.8 } },
      { id: "roads-glow", type: "line", source: "streets", "source-layer": "streets", filter: ["<", ["get", "c"], 3],
        layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2f7bff", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 13, 3, 19, 46], "line-blur": 8, "line-opacity": 0.35 } },
      { id: "roads", type: "line", source: "streets", "source-layer": "streets", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["match", ["get", "c"], [0, 1], "#3a4a5f", 2, "#334155", "#2a3443"], "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 13, ["match", ["get", "c"], [0, 1], 2, 1], 19, ["match", ["get", "c"], [0, 1], 34, 2, 26, 16]] } },
      { id: "lanes", type: "line", source: "streets", "source-layer": "streets", minzoom: 16, filter: ["<", ["get", "c"], 3],
        paint: { "line-color": "#c9d6e6", "line-width": 1, "line-dasharray": [6, 8], "line-opacity": 0.5 } },
      { id: "beam", type: "fill", source: "beam", paint: { "fill-color": "#fff4c8", "fill-opacity": 0.2 } },
      { id: "trail", type: "line", source: "trail", layout: { "line-cap": "round" },
        paint: { "line-width": 6, "line-blur": 3, "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "rgba(61,155,255,0)", 1, "rgba(61,214,255,0.9)"] } },
      // walls in a few related tones (by height and footprint id), then a thin lighter roof cap so blocks read as buildings
      { id: "buildings", type: "fill-extrusion", source: "buildings", "source-layer": "buildings", paint: {
        "fill-extrusion-color": ["interpolate", ["linear"], ["+", ["get", "h"], ["*", 4, ["%", ["get", "h"], 3]]],
          3, "#33465f", 10, "#3d5675", 18, "#4a6a8f", 35, "#5f86b0", 70, "#7aa3cf"],
        "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.96, "fill-extrusion-vertical-gradient": true } },
      { id: "roofs", type: "fill-extrusion", source: "buildings", "source-layer": "buildings", paint: {
        "fill-extrusion-color": "#9dbbe0", "fill-extrusion-base": ["get", "h"], "fill-extrusion-height": ["+", ["get", "h"], 0.35], "fill-extrusion-opacity": 0.96 } },
      { id: "car", type: "fill-extrusion", source: "car", paint: {
        "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-opacity": 1 } },
      { id: "labels", type: "symbol", source: "streets", "source-layer": "streets", minzoom: 15, filter: ["all", ["has", "n"], ["<", ["get", "c"], 3]],
        layout: { "symbol-placement": "line", "text-field": ["get", "n"], "text-font": ["Noto Sans Regular"], "text-size": 13, "symbol-spacing": 400 },
        paint: { "text-color": "#cfe0f5", "text-halo-color": "#0a121c", "text-halo-width": 1.6 } },
    ],
  };
}

// a soft wave texture for the sea; drifting it gives the water motion
function waves(): ImageData {
  const n = 64, c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(0,0,0,0)"; g.fillRect(0, 0, n, n);
  g.strokeStyle = "rgba(120,190,255,0.35)"; g.lineWidth = 1.2;
  for (let row = 0; row < 4; row++) {
    g.beginPath();
    for (let x = 0; x <= n; x++) {
      const y = row * 16 + 8 + Math.sin((x / n) * Math.PI * 2 + row) * 3;
      if (x) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  }
  return g.getImageData(0, 0, n, n);
}

// a box of length l × width w (metres) centred `off` metres ahead of p, rotated to the heading
function box(p: [number, number], hdg: number, l: number, w: number, off = 0): [number, number][][] {
  const kx = 1 / (111320 * Math.cos(p[1] * Math.PI / 180)), ky = 1 / 110540, t = hdg * Math.PI / 180;
  const f = [Math.sin(t), Math.cos(t)], r = [Math.cos(t), -Math.sin(t)];
  const at = (a: number, b: number): [number, number] => [p[0] + (f[0] * a + r[0] * b) * kx, p[1] + (f[1] * a + r[1] * b) * ky];
  return [[at(off + l / 2, -w / 2), at(off + l / 2, w / 2), at(off - l / 2, w / 2), at(off - l / 2, -w / 2), at(off + l / 2, -w / 2)]];
}

function carShapes(p: [number, number], hdg: number) {
  const s = CAR.scale, part = (l: number, w: number, off: number, base: number, top: number, color: string, side = 0) => {
    const q: [number, number] = side ? [p[0] + Math.cos(hdg * Math.PI / 180) * side * s / (111320 * Math.cos(p[1] * Math.PI / 180)), p[1] - Math.sin(hdg * Math.PI / 180) * side * s / 110540] : p;
    return { type: "Feature" as const, properties: { base: base * s, top: top * s, color }, geometry: { type: "Polygon" as const, coordinates: box(q, hdg, l * s, w * s, off * s) } };
  };
  return {
    type: "FeatureCollection" as const,
    features: [
      part(4.5, 1.85, 0, 0.25, 0.95, "#f2f7ff"),
      part(2.3, 1.6, -0.25, 0.95, 1.45, "#3d9bff"),
      part(0.18, 0.4, -2.2, 0.55, 0.85, "#ff3b4f", -0.65), part(0.18, 0.4, -2.2, 0.55, 0.85, "#ff3b4f", 0.65),
      part(0.15, 0.45, 2.22, 0.5, 0.75, "#fff6d6", -0.6), part(0.15, 0.45, 2.22, 0.5, 0.75, "#fff6d6", 0.6),
    ],
  };
}

function beam(p: [number, number], hdg: number) {
  const kx = 1 / (111320 * Math.cos(p[1] * Math.PI / 180)), ky = 1 / 110540, t = hdg * Math.PI / 180, s = CAR.scale;
  const f = [Math.sin(t), Math.cos(t)], r = [Math.cos(t), -Math.sin(t)];
  const at = (a: number, b: number): [number, number] => [p[0] + (f[0] * a + r[0] * b) * kx, p[1] + (f[1] * a + r[1] * b) * ky];
  return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [[at(2.3 * s, -0.9 * s), at(2.3 * s, 0.9 * s), at(16 * s, 4.5 * s), at(16 * s, -4.5 * s), at(2.3 * s, -0.9 * s)]] } };
}

export default function Hero() {
  const el = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused || still; }, [paused, still]);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setStill(q.matches);
    on(); q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    let cancelled = false, raf = 0;
    let m: MLMap | undefined;
    (async () => {
      const maplibre = (await import("maplibre-gl")).default;
      if (cancelled || !el.current) return;
      m = new maplibre.Map({
        container: el.current, style: style(), center: [80.2795, 13.045], zoom: CAR.zoom, pitch: CAR.pitch, bearing: 5, maxPitch: 80,
        interactive: false, attributionControl: false, fadeDuration: 0,
      });
      m.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-right");
      m.on("styleimagemissing", (e) => { if (e.id === "waves" && !m!.hasImage("waves")) m!.addImage("waves", waves()); });
      m.on("error", (e) => console.warn("hero map:", e.error?.message ?? e));
      (window as unknown as { __rpHeroMap?: MLMap }).__rpHeroMap = m;

      const streets = await loadStreets();
      if (cancelled) return;
      const path = beachDrive(streets);
      if (!path) return;

      let d = path.total * 0.08, hdg: number | null = null, last = performance.now(), wave = 0;
      const frame = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (!pausedRef.current) { d = (d + dt * CAR.mps) % path.total; wave = (wave + dt * 6) % 64; }
        const here = pointAt(path, d), ahead = pointAt(path, d + 30);
        const want = bearing(here, ahead);
        hdg = hdg === null ? want : hdg + ((((want - hdg + 540) % 360) - 180) * Math.min(1, dt * 3));
        const trailPts: [number, number][] = [];
        for (let k = 30; k >= 0; k--) trailPts.push(pointAt(path, Math.max(0, d - k * 8)));
        if (m!.isStyleLoaded()) {
          (m!.getSource("car") as GeoJSONSource).setData(carShapes(here, hdg));
          (m!.getSource("beam") as GeoJSONSource).setData(beam(here, hdg));
          (m!.getSource("trail") as GeoJSONSource).setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: trailPts } });
          m!.setPaintProperty("water-waves", "fill-translate", [wave, wave * 0.35]);
        }
        const look = pointAt(path, d + CAR.aheadM);
        m!.jumpTo({ center: look, bearing: hdg, pitch: CAR.pitch, zoom: CAR.zoom });
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    })();
    return () => { cancelled = true; cancelAnimationFrame(raf); m?.remove(); };
  }, []);

  return (
    <div className="hero">
      <div ref={el} className="hero-map" aria-hidden="true" />
      <div className="hero-scrim" aria-hidden="true" />
      <header className="hero-top">
        <Link href="/" className="hero-brand" aria-label="RoutePulse home">
          <span className="hero-logo"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h4l2-5 4 10 2-5h4" /></svg></span>
          RoutePulse
        </Link>
        <span className="hero-pill">Simulated data · not a forecast</span>
        <nav className="hero-nav" aria-label="Modes">
          {MODES.map((m) => <Link key={m.href} href={m.href}>{m.title}</Link>)}
        </nav>
      </header>

      <main className="hero-main">
        <p className="hero-kicker">Chennai · 80,905 streets · 605,401 buildings</p>
        <h1>Know which roads will flood <span>before you drive.</span></h1>
        <p className="hero-lede">RoutePulse simulates rain, waterlogging and closures on every Chennai street, then finds the way around them. Pick the mode that fits you.</p>
        <div className="hero-modes">
          {MODES.map((m) => (
            <Link key={m.href} href={m.href} className="hero-card">
              <span className="hero-card-icon"><Icon name={m.icon} size={22} /></span>
              <span className="hero-card-who">{m.who}</span>
              <b>{m.title} mode</b>
              <span className="hero-card-text">{m.text}</span>
              <span className="hero-card-go">Open <Icon name="arrow" size={14} /></span>
            </Link>
          ))}
        </div>
      </main>

      <button type="button" className="hero-pause" aria-pressed={paused} onClick={() => setPaused((v) => !v)} disabled={still}
              title={still ? "Animation is off because your system asks for reduced motion" : undefined}>
        <Icon name={paused || still ? "play" : "pause"} size={14} />{still ? "Motion off" : paused ? "Play drive" : "Pause drive"}
      </button>
      <footer className="hero-credits">
        Streets &amp; place names © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> ·
        Buildings © Overture Maps (OpenStreetMap, Google Open Buildings, Microsoft); heights mostly estimated ·
        Sea &amp; land © <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> / OpenMapTiles ·
        3D street view inspired by Google Maps; RoutePulse is not affiliated with Google. The car and its drive are a demo.
      </footer>
    </div>
  );
}
