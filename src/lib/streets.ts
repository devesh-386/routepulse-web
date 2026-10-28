// Chennai street layer: geometry, per-3-hour simulated state and routing.
// Everything numeric here is precomputed by routepulse-dataset/build_street_sim.py;
// the browser only decodes it and routes over it.

export interface StreetsMeta {
  count: number;
  bbox: [number, number, number, number];
  coord_origin: [number, number];
  coord_quantum_deg: number;
  layout: { name: string; dtype: string; offset: number; length: number }[];
  bytes: number;
  classes: string[];
  free_kph: number[];
  names: string[];
  flags: { tunnel: number; bridge: number; oneway: number };
  status_codes: string[];
  rain_block: { lon0: number; lat0: number; size: number; cells: number[] };
  susceptibility_note: string;
  attribution: string;
}

export interface StreetForecastInfo {
  method: string;
  checked_against_simulation: Record<string, {
    street_hours: number; closed_at_plus_3h: number; average_precision: number;
    brier: number; persistence_brier: number; new_closures_warned_pct: number;
  }>;
  caveat: string;
}

export interface Streets {
  meta: StreetsMeta;
  offsets: Uint32Array;
  verts: Uint16Array;
  name: Uint16Array;
  lengthDm: Uint16Array;
  cls: Uint8Array;
  flags: Uint8Array;
  low: Uint8Array;
  mult: Uint8Array;
  u: Uint8Array;
  v: Uint8Array;
  forecastInfo: StreetForecastInfo;
}

const BASE = "/data/streets";
// a missing or failed file should say so, not surface as "Unexpected token <" from an HTML error page
const ok = (r: Response) => { if (!r.ok) throw new Error(`${r.url.split("/").pop()}: HTTP ${r.status}`); return r; };
const NO_FORECAST = 255;
export const STEP_HOURS = 3;

function view(buf: ArrayBuffer, meta: StreetsMeta, name: string) {
  const l = meta.layout.find((x) => x.name === name)!;
  if (l.dtype === "uint32") return new Uint32Array(buf, l.offset, l.length);
  if (l.dtype === "uint16") return new Uint16Array(buf, l.offset, l.length);
  return new Uint8Array(buf, l.offset, l.length);
}

export async function loadStreets(): Promise<Streets> {
  const [meta, buf, forecastInfo] = await Promise.all([
    fetch(`${BASE}/streets_meta.json`).then((r) => ok(r).json() as Promise<StreetsMeta>),
    fetch(`${BASE}/streets.bin`).then((r) => ok(r).arrayBuffer()),
    fetch(`${BASE}/street_forecast.json`).then((r) => ok(r).json() as Promise<StreetForecastInfo>),
  ]);
  if (buf.byteLength !== meta.bytes) throw new Error(`streets.bin is ${buf.byteLength} bytes, meta says ${meta.bytes}`);
  return {
    meta, forecastInfo,
    offsets: view(buf, meta, "offsets") as Uint32Array,
    verts: view(buf, meta, "verts") as Uint16Array,
    name: view(buf, meta, "name") as Uint16Array,
    lengthDm: view(buf, meta, "length_dm") as Uint16Array,
    cls: view(buf, meta, "class") as Uint8Array,
    flags: view(buf, meta, "flags") as Uint8Array,
    low: view(buf, meta, "low_q") as Uint8Array,
    mult: view(buf, meta, "mult_q") as Uint8Array,
    u: view(buf, meta, "u_q") as Uint8Array,
    v: view(buf, meta, "v_q") as Uint8Array,
  };
}

export function coordsOf(s: Streets, i: number): [number, number][] {
  const [lon0, lat0] = s.meta.coord_origin;
  const q = s.meta.coord_quantum_deg;
  const out: [number, number][] = [];
  for (let k = s.offsets[i]; k < s.offsets[i + 1]; k++) {
    out.push([lon0 + s.verts[2 * k] * q, lat0 + s.verts[2 * k + 1] * q]);
  }
  return out;
}

export const streetName = (s: Streets, i: number) =>
  s.name[i] === 65535 ? null : s.meta.names[s.name[i]];

// ---------------------------------------------------------------- per-step state

export interface StepState {
  status: Uint8Array;    // 0 open … 4 closed, draining
  depth: Uint8Array;     // cm
  p: Uint8Array;         // P(closed at +3 h) %, 255 = no forecast
  listed: Uint32Array;   // streets with any water, status or risk at this step
}

/** One scenario's sparse street state; see write_sparse() in build_street_sim.py. */
export class StreetScenario {
  private steps: number;
  private offs: Uint32Array;
  private idx: Uint32Array;
  private st: Uint8Array;
  private dp: Uint8Array;
  private pr: Uint8Array;
  private cache = new Map<number, StepState>();

  constructor(readonly id: string, buf: ArrayBuffer, private count: number, readonly fcst: number[][]) {
    const head = new DataView(buf);
    this.steps = head.getUint32(0, true);
    this.offs = new Uint32Array(buf.slice(4, 4 * (this.steps + 2)));
    const rows = this.offs[this.steps];
    const base = 4 * (this.steps + 2);
    this.idx = new Uint32Array(buf.slice(base, base + 4 * rows));
    this.st = new Uint8Array(buf, base + 4 * rows, rows);
    this.dp = new Uint8Array(buf, base + 5 * rows, rows);
    this.pr = new Uint8Array(buf, base + 6 * rows, rows);
  }

  stepOf(hour: number) { return Math.min(Math.floor(hour / STEP_HOURS), this.steps - 1); }

  state(step: number): StepState {
    let s = this.cache.get(step);
    if (s) return s;
    const lastStep = this.steps - 1;
    const status = new Uint8Array(this.count);
    const depth = new Uint8Array(this.count);
    // the last step has no +3 h target, so nothing there has a forecast; elsewhere unlisted streets are at 0 %
    const p = new Uint8Array(this.count).fill(step === lastStep ? NO_FORECAST : 0);
    const a = this.offs[step], b = this.offs[step + 1];
    for (let r = a; r < b; r++) {
      const i = this.idx[r];
      status[i] = this.st[r]; depth[i] = this.dp[r]; p[i] = this.pr[r];
    }
    s = { status, depth, p, listed: this.idx.subarray(a, b) };
    if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(step, s);
    return s;
  }

  closedSeries(hours: number) {
    const out: number[] = [];
    for (let h = 0; h < hours; h++) {
      const k = this.stepOf(h);
      let n = 0;
      for (let r = this.offs[k]; r < this.offs[k + 1]; r++) if (this.st[r] >= 3) n++;
      out.push(n);
    }
    return out;
  }
}

const scenarioCache = new Map<string, Promise<StreetScenario>>();
export function loadStreetScenario(id: string, count: number) {
  const k = id.toLowerCase();
  if (!scenarioCache.has(k)) {
    const p = Promise.all([
      fetch(`${BASE}/${k}_streets.bin`).then((r) => ok(r).arrayBuffer()),
      fetch(`${BASE}/${k}_fcst.json`).then((r) => ok(r).json()),
    ]).then(([buf, f]) => new StreetScenario(id, buf, count, f.block_corners_mm));
    p.catch(() => scenarioCache.delete(k));
    scenarioCache.set(k, p);
  }
  return scenarioCache.get(k)!;
}

// ---------------------------------------------------------------- bands and factors

export type Band = "very_high" | "high" | "medium" | "low" | "none";
export const BANDS: { id: Band; label: string; range: string; color: string }[] = [
  { id: "very_high", label: "Very high", range: "≥ 70 %", color: "#ff4d5e" },
  { id: "high", label: "High", range: "40–69 %", color: "#ff8f33" },
  { id: "medium", label: "Medium", range: "10–39 %", color: "#f6c950" },
  { id: "low", label: "Low", range: "< 10 %", color: "#3fbf78" },
  { id: "none", label: "No estimate", range: "last 3 h", color: "#8193a8" },
];
export const BAND_CODE: Record<Band, number> = { very_high: 4, high: 3, medium: 2, low: 1, none: 0 };

export function bandOf(p: number): Band {
  if (p === NO_FORECAST) return "none";
  if (p >= 70) return "very_high";
  if (p >= 40) return "high";
  if (p >= 10) return "medium";
  return "low";
}

/** Rain at a street: bilinear over the four 0.25° cells, times its street-scale multiplier. */
export function streetRain(s: Streets, i: number, corners: number[]) {
  const u = s.u[i] / 255, v = s.v[i] / 255;
  const r = corners[0] * (1 - u) * (1 - v) + corners[1] * u * (1 - v) + corners[2] * (1 - u) * v + corners[3] * u * v;
  return r * (0.8 + 0.4 * (s.mult[i] / 255));
}

export const lowLyingLabel = (q: number) => (q >= 170 ? "High" : q >= 85 ? "Medium" : "Low");

// ---------------------------------------------------------------- routing

export interface Graph {
  nodeOfEnd: Int32Array;      // 2 per street: start node, end node
  adjStart: Int32Array;       // CSR over nodes
  adjEdge: Int32Array;        // street index
  adjTo: Int32Array;
  adjForward: Uint8Array;     // 1 if travelling along the street's geometry
  nodeXY: Float64Array;       // lon, lat
  mainComponent: Uint8Array;  // 1 if the node is in the largest connected component
}

export function buildGraph(s: Streets): Graph {
  const n = s.meta.count;
  const key = new Map<number, number>();
  const nodeOfEnd = new Int32Array(2 * n);
  const xy: number[] = [];
  const [lon0, lat0] = s.meta.coord_origin;
  const q = s.meta.coord_quantum_deg;
  const nodeAt = (k: number) => {
    const x = s.verts[2 * k], y = s.verts[2 * k + 1];
    const id = x * 65536 + y;
    let v = key.get(id);
    if (v === undefined) { v = key.size; key.set(id, v); xy.push(lon0 + x * q, lat0 + y * q); }
    return v;
  };
  for (let i = 0; i < n; i++) {
    nodeOfEnd[2 * i] = nodeAt(s.offsets[i]);
    nodeOfEnd[2 * i + 1] = nodeAt(s.offsets[i + 1] - 1);
  }
  const N = key.size;
  const deg = new Int32Array(N + 1);
  for (let i = 0; i < n; i++) {
    deg[nodeOfEnd[2 * i]]++;
    if (!(s.flags[i] & s.meta.flags.oneway)) deg[nodeOfEnd[2 * i + 1]]++;
  }
  const adjStart = new Int32Array(N + 1);
  for (let k = 0; k < N; k++) adjStart[k + 1] = adjStart[k] + deg[k];
  const fill = adjStart.slice(0, N);
  const M = adjStart[N];
  const adjEdge = new Int32Array(M), adjTo = new Int32Array(M), adjForward = new Uint8Array(M);
  for (let i = 0; i < n; i++) {
    const a = nodeOfEnd[2 * i], b = nodeOfEnd[2 * i + 1];
    let e = fill[a]++; adjEdge[e] = i; adjTo[e] = b; adjForward[e] = 1;
    if (!(s.flags[i] & s.meta.flags.oneway)) { e = fill[b]++; adjEdge[e] = i; adjTo[e] = a; adjForward[e] = 0; }
  }
  // largest component, treating every street as two-way for reachability
  const comp = new Int32Array(N).fill(-1);
  const und: number[][] = Array.from({ length: N }, () => []);
  for (let i = 0; i < n; i++) { und[nodeOfEnd[2 * i]].push(nodeOfEnd[2 * i + 1]); und[nodeOfEnd[2 * i + 1]].push(nodeOfEnd[2 * i]); }
  let best = -1, bestSize = 0, c = 0;
  for (let k = 0; k < N; k++) {
    if (comp[k] !== -1) continue;
    let size = 0;
    const stack = [k]; comp[k] = c;
    while (stack.length) {
      const x = stack.pop()!; size++;
      for (const y of und[x]) if (comp[y] === -1) { comp[y] = c; stack.push(y); }
    }
    if (size > bestSize) { bestSize = size; best = c; }
    c++;
  }
  const mainComponent = new Uint8Array(N);
  for (let k = 0; k < N; k++) mainComponent[k] = comp[k] === best ? 1 : 0;
  return { nodeOfEnd, adjStart, adjEdge, adjTo, adjForward, nodeXY: new Float64Array(xy), mainComponent };
}

/**
 * shortcut: places snap to the largest connected piece of the street graph, because zoom-14
 * tiles drop some T-junction vertices and leave short lanes as islands; split T-junctions in
 * build_streets.py if routing ever needs those lanes.
 */
export function nearestNode(g: Graph, lon: number, lat: number) {
  let best = -1, bd = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i < g.mainComponent.length; i++) {
    if (!g.mainComponent[i]) continue;
    const dx = (g.nodeXY[2 * i] - lon) * k, dy = g.nodeXY[2 * i + 1] - lat;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export type RouteKind = "fastest" | "safer" | "shortest";

export interface Route {
  kind: RouteKind;
  streets: number[];
  minutes: number;
  km: number;
  maxP: number;          // highest P(closed +3 h) on the route, %
  meanP: number;         // length-weighted, %
  deepestCm: number;
  unestimatedKm: number; // length with no +3 h estimate; maxP and meanP cover only the rest
}

/** Travel time on one street now, in minutes, or Infinity if it is closed. */
export function streetMinutes(s: Streets, st: StepState, i: number) {
  if (st.status[i] >= 3) return Infinity;
  const kph = s.meta.free_kph[s.cls[i]] * Math.min(1, Math.max(0.22, 1 - 0.015 * st.depth[i]));
  return (s.lengthDm[i] / 10000) / kph * 60;
}

function edgeCost(kind: RouteKind, s: Streets, st: StepState, i: number) {
  const t = streetMinutes(s, st, i);
  if (!Number.isFinite(t)) return Infinity;
  if (kind === "shortest") return s.lengthDm[i];
  if (kind === "fastest") return t;
  // safer: time, inflated by the street's simulated closure risk and by water already standing
  const p = st.p[i] === NO_FORECAST ? 0 : st.p[i] / 100;
  return t * (1 + 6 * p + (st.depth[i] > 8 ? 2 : 0));
}

export function route(kind: RouteKind, s: Streets, g: Graph, st: StepState, from: number, to: number): Route | null {
  const N = g.mainComponent.length;
  const dist = new Float64Array(N).fill(Infinity);
  const via = new Int32Array(N).fill(-1);
  // binary heap of [cost, node]
  const heap: number[] = [];
  const push = (c: number, v: number) => {
    heap.push(c, v);
    let i = heap.length / 2 - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[2 * p] <= heap[2 * i]) break;
      [heap[2 * p], heap[2 * i]] = [heap[2 * i], heap[2 * p]];
      [heap[2 * p + 1], heap[2 * i + 1]] = [heap[2 * i + 1], heap[2 * p + 1]];
      i = p;
    }
  };
  const pop = () => {
    const c = heap[0], v = heap[1];
    const lastNode = heap.pop()!, lastCost = heap.pop()!;
    if (heap.length) {
      heap[0] = lastCost; heap[1] = lastNode;
      let i = 0;
      const n = heap.length / 2;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < n && heap[2 * l] < heap[2 * m]) m = l;
        if (r < n && heap[2 * r] < heap[2 * m]) m = r;
        if (m === i) break;
        [heap[2 * m], heap[2 * i]] = [heap[2 * i], heap[2 * m]];
        [heap[2 * m + 1], heap[2 * i + 1]] = [heap[2 * i + 1], heap[2 * m + 1]];
        i = m;
      }
    }
    return [c, v];
  };
  dist[from] = 0;
  push(0, from);
  while (heap.length) {
    const [c, v] = pop();
    if (c > dist[v]) continue;
    if (v === to) break;
    for (let e = g.adjStart[v]; e < g.adjStart[v + 1]; e++) {
      const w = edgeCost(kind, s, st, g.adjEdge[e]);
      if (!Number.isFinite(w)) continue;
      const nc = c + w, y = g.adjTo[e];
      if (nc < dist[y]) { dist[y] = nc; via[y] = e; push(nc, y); }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const streets: number[] = [];
  for (let v = to; v !== from; ) {
    const e = via[v];
    streets.push(g.adjEdge[e]);
    const i = g.adjEdge[e];
    v = g.adjForward[e] ? g.nodeOfEnd[2 * i] : g.nodeOfEnd[2 * i + 1];
  }
  streets.reverse();
  let minutes = 0, km = 0, maxP = 0, pSum = 0, deepest = 0, unknown = 0;
  for (const i of streets) {
    const len = s.lengthDm[i] / 10000;
    minutes += streetMinutes(s, st, i); km += len; deepest = Math.max(deepest, st.depth[i]);
    // a missing estimate is unknown, not 0 %: keep it out of the risk figures and report it separately
    if (st.p[i] === NO_FORECAST) { unknown += len; continue; }
    maxP = Math.max(maxP, st.p[i]); pSum += st.p[i] * len;
  }
  const known = km - unknown;
  return { kind, streets, minutes, km, maxP, meanP: known > 1e-9 ? pSum / known : 0, deepestCm: deepest, unestimatedKm: unknown };
}

// ---------------------------------------------------------------- places

/** Approximate neighbourhood centres; routes start and end at the nearest connected street. */
export const PLACES: { id: string; name: string; lon: number; lat: number }[] = [
  { id: "anna-nagar", name: "Anna Nagar", lon: 80.2101, lat: 13.0850 },
  { id: "marina", name: "Marina Beach", lon: 80.2824, lat: 13.0500 },
  { id: "central", name: "Chennai Central", lon: 80.2757, lat: 13.0827 },
  { id: "egmore", name: "Egmore", lon: 80.2609, lat: 13.0732 },
  { id: "t-nagar", name: "T. Nagar", lon: 80.2341, lat: 13.0418 },
  { id: "mylapore", name: "Mylapore", lon: 80.2676, lat: 13.0368 },
  { id: "adyar", name: "Adyar", lon: 80.2565, lat: 13.0012 },
  { id: "guindy", name: "Guindy", lon: 80.2206, lat: 13.0067 },
  { id: "velachery", name: "Velachery", lon: 80.2180, lat: 12.9815 },
  { id: "koyambedu", name: "Koyambedu", lon: 80.1948, lat: 13.0694 },
  { id: "perambur", name: "Perambur", lon: 80.2333, lat: 13.1186 },
  { id: "royapuram", name: "Royapuram", lon: 80.2954, lat: 13.1137 },
  { id: "sholinganallur", name: "Sholinganallur", lon: 80.2279, lat: 12.9010 },
];
