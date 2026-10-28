"use client";

// Device location and the Google Maps hand-off. The position never leaves the browser:
// nothing here sends it anywhere, and the street view makes no server calls with it.

import { useEffect, useState } from "react";
import { coordsOf, type Streets } from "./streets";

export interface Fix { lon: number; lat: number; accuracyM: number; at: number }
export type GeoStatus = "off" | "asking" | "tracking" | "denied" | "unavailable";

/** Live GPS while `on`; stops the watch when turned off or unmounted. */
export function useGeolocation(on: boolean) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [status, setStatus] = useState<GeoStatus>("off");

  useEffect(() => {
    if (!on) return;
    if (!("geolocation" in navigator)) {
      queueMicrotask(() => setStatus("unavailable"));
      return;
    }
    queueMicrotask(() => setStatus((s) => (s === "tracking" ? s : "asking")));
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setFix({ lon: p.coords.longitude, lat: p.coords.latitude, accuracyM: p.coords.accuracy, at: p.timestamp });
        setStatus("tracking");
      },
      (e) => setStatus(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => { navigator.geolocation.clearWatch(id); setStatus("off"); };
  }, [on]);

  return { fix: on ? fix : null, status: on ? status : "off" as GeoStatus };
}

const M_PER_DEG_LAT = 110540;

export function metres(aLon: number, aLat: number, bLon: number, bLat: number) {
  const k = Math.cos(((aLat + bLat) / 2) * Math.PI / 180) * 111320;
  return Math.hypot((aLon - bLon) * k, (aLat - bLat) * M_PER_DEG_LAT);
}

/** The street segment whose geometry passes closest to a point (vertex distance; segments are ≤ 250 m). */
export function nearestStreet(s: Streets, lon: number, lat: number) {
  const [lon0, lat0] = s.meta.coord_origin;
  const q = s.meta.coord_quantum_deg;
  const k = Math.cos(lat * Math.PI / 180) * 111320;
  let best = -1, bd = Infinity, seg = 0;
  for (let v = 0; v < s.verts.length / 2; v++) {
    while (s.offsets[seg + 1] <= v) seg++;
    const dx = (lon0 + s.verts[2 * v] * q - lon) * k, dy = (lat0 + s.verts[2 * v + 1] * q - lat) * M_PER_DEG_LAT;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = seg; }
  }
  return { street: best, distanceM: Math.sqrt(bd) };
}

/** Inside the simulated area: within the street data's box and close to a mapped street. */
export function inCoverage(s: Streets, lon: number, lat: number, nearestM: number) {
  const [x0, y0, x1, y1] = s.meta.bbox;
  return lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1 && nearestM <= 300;
}

/** A circle polygon for the accuracy halo (metres → degrees). */
export function accuracyCircle(lon: number, lat: number, r: number): GeoJSON.Feature {
  const k = Math.cos(lat * Math.PI / 180) * 111320;
  const ring = Array.from({ length: 49 }, (_, i) => {
    const a = (i / 48) * 2 * Math.PI;
    return [lon + (r * Math.cos(a)) / k, lat + (r * Math.sin(a)) / M_PER_DEG_LAT];
  });
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

/**
 * Google Maps directions URL that keeps navigation on the chosen route with waypoints sampled
 * evenly along it. Google's URL scheme takes up to 9 waypoints, but only 3 in mobile browsers.
 * Works in the browser and opens the Google Maps app on phones. No API key, no cost.
 */
export function googleMapsUrl(s: Streets, streets: number[], from: [number, number], to: [number, number], maxWaypoints = 8) {
  const pts = streets.map((i) => { const c = coordsOf(s, i); return c[Math.floor(c.length / 2)]; });
  const n = Math.min(maxWaypoints, Math.max(0, pts.length - 2));
  const way = Array.from({ length: n }, (_, k) => pts[Math.round(((k + 1) * (pts.length - 1)) / (n + 1))]);
  const ll = ([lon, lat]: [number, number]) => `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const u = new URL("https://www.google.com/maps/dir/");
  u.searchParams.set("api", "1");
  u.searchParams.set("origin", ll(from));
  u.searchParams.set("destination", ll(to));
  if (way.length) u.searchParams.set("waypoints", way.map(ll).join("|"));
  u.searchParams.set("travelmode", "driving");
  return u.toString();
}
