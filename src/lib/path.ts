// A route as one continuous polyline with distances, for anything that moves along it (drive mode, the hero car).

import { metres } from "./geo";
import { coordsOf, type Streets } from "./streets";

export interface Path { pts: [number, number][]; cum: number[]; total: number }

// the route's segments are in travel order but each one's coordinates may run either way: chain them end to start
export function routePath(s: Streets, ids: number[]): Path | null {
  const pts: [number, number][] = [];
  for (const i of ids) {
    let c = coordsOf(s, i);
    if (pts.length) {
      const end = pts[pts.length - 1];
      if (metres(...end, ...c[c.length - 1]) < metres(...end, ...c[0])) c = [...c].reverse();
    } else if (ids.length > 1) {
      const n = coordsOf(s, ids[1]);
      const touch = (p: [number, number]) => Math.min(metres(...p, ...n[0]), metres(...p, ...n[n.length - 1]));
      if (touch(c[0]) < touch(c[c.length - 1])) c = [...c].reverse();
    }
    pts.push(...c);
  }
  return pathOf(pts);
}

export function pathOf(pts: [number, number][]): Path | null {
  if (pts.length < 2) return null;
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + metres(...pts[k - 1], ...pts[k]));
  return { pts, cum, total: cum[cum.length - 1] };
}

export function pointAt(p: Path, d: number): [number, number] {
  d = Math.max(0, Math.min(p.total, d));
  let lo = 0, hi = p.cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p.cum[mid] <= d) lo = mid; else hi = mid; }
  const span = p.cum[hi] - p.cum[lo] || 1, t = (d - p.cum[lo]) / span;
  return [p.pts[lo][0] + (p.pts[hi][0] - p.pts[lo][0]) * t, p.pts[lo][1] + (p.pts[hi][1] - p.pts[lo][1]) * t];
}

/** Compass bearing from a to b, degrees clockwise from north. */
export function bearing(a: [number, number], b: [number, number]) {
  const k = Math.cos(a[1] * Math.PI / 180);
  return Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180 / Math.PI;
}
