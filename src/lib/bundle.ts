// Loads the static bundle written by routepulse-dataset/build_bundle.py and checks it
// against manifest.json (the data contract) before anything uses it.

export const SCHEMA_VERSION = "1.0";

export type StatusCode = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface FileMeta {
  bytes: number;
  dtype: "uint8" | "json";
  shape?: number[];
  fields?: string[];
  scenario?: string;
}

export interface Manifest {
  schema_version: string;
  hours: number;
  start: string;
  segments: number;
  grid_cells: number;
  status_codes: string[];
  closed_min_code: number;
  segment_fields: { name: string; unit: string; meaning: string }[];
  no_forecast_value: number;
  forecast: {
    meaning: string;
    inputs: string;
    held_out_brier: number;
    held_out_persistence_brier: number;
    max_calibration_gap_pct: number;
    evaluated_on: string;
  };
  disclaimer: string;
  files: Record<string, FileMeta>;
}

export interface Network {
  nodes: { id: string; name: string; district: string; lat: number; lon: number; kind: string }[];
  segments: {
    id: string; ix: number; from: string; to: string; ref: string; class: string;
    length_km: number; free_flow_kph: number; underpass: boolean; landslide_prone: boolean;
    coords: [number, number][];
  }[];
  grid: { cell_size_deg: number; cells: [number, number][] };
}

export interface Scenario {
  id: string; name: string; description: string; severity: string; demand_multiplier: number;
}

export interface Storm {
  id: string; kind: string; start: string; duration_h: number; radius_km: number;
  peak_mm_h: number; track: [number, number][];
}

export interface RoutesFile {
  od_pairs: { id: string; label: string; origin: string; destination: string; routes: string[] }[];
  routes: Record<string, { od: string; rank: number; length_km: number; segments: string[] }>;
  bus_services: {
    id: string; operator: string; label: string; road_route: string; class: string;
    daily_trips: number; departure_hours: number[];
  }[];
}

export interface Assessments {
  hours: number[];
  routes: Record<string, {
    route_status: ("passable" | "blocked")[];
    segments_closed: number[];
    eta_min: (number | null)[];
    free_flow_eta_min: number[];
    delay_min: (number | null)[];
    max_water_depth_cm: number[];
    mean_vc_ratio: number[];
    max_rainfall_24h_mm: number[];
    climate_risk_score: number[];
    risk_band: ("low" | "moderate" | "high" | "severe")[];
    recommended: boolean[];
  }>;
}

export interface BusFile {
  columns: string[];
  outcomes: string[];
  // service_ix, hour, outcome, scheduled_min, actual_min, delay_min, segments_closed
  trips: [number, number, number, number, number | null, number | null, number][];
}

export interface Vulnerability {
  segments: { segment_id: string; rank: number; ref: string; worlds_with_closure_pct: number;
              p95_depth_cm: number; underpass: boolean; landslide_prone: boolean }[];
  method: { worlds: number; hours_per_world: number; score: string; varied_per_world: string[];
            caveat: string };
}

export interface Story {
  scenario: string;
  od_pair: string;
  steps: { hour: number; title: string; focus: "baseline" | "storm" | "switch" | "explain";
           route: string; previous_route?: string; previous_recommended_hour?: number }[];
  selection_rule: string;
}

/** One scenario's time series, decoded. */
export class ScenarioData {
  constructor(
    readonly id: string,
    private cube: Uint8Array,       // [field][hour][segment]
    private rain: Uint8Array,       // [hour][cell]
    readonly assessments: Assessments,
    readonly bus: BusFile,
    private hours: number,
    private segments: number,
    readonly cells: number,
  ) {}

  private at(field: number, hour: number, seg: number) {
    return this.cube[(field * this.hours + hour) * this.segments + seg];
  }
  status(hour: number, seg: number) { return this.at(0, hour, seg) as StatusCode; }
  speedKph(hour: number, seg: number) { return this.at(1, hour, seg); }
  depthCm(hour: number, seg: number) { return this.at(2, hour, seg); }
  rainMm(hour: number, seg: number) { return this.at(3, hour, seg); }
  /** Percent, or null where no forecast exists (needs 24 h history and a target hour). */
  pClosed3h(hour: number, seg: number, noForecast: number): number | null {
    const v = this.at(4, hour, seg);
    return v === noForecast ? null : v;
  }
  cellRain(hour: number, cell: number) { return this.rain[hour * this.cells + cell]; }

  closedCount(hour: number, closedMin: number) {
    let n = 0;
    for (let s = 0; s < this.segments; s++) if (this.status(hour, s) >= closedMin) n++;
    return n;
  }

  /** Index of the 3-hourly assessment in force at `hour` (latest one not after it). */
  assessmentIndex(hour: number) {
    const h = this.assessments.hours;
    let i = 0;
    while (i + 1 < h.length && h[i + 1] <= hour) i++;
    return i;
  }
}

export interface StaticBundle {
  manifest: Manifest;
  network: Network;
  scenarios: Scenario[];
  storms: Record<string, Storm[]>;
  routes: RoutesFile;
  vulnerability: Vulnerability;
  story: Story;
}

const BASE = "/data";

export class BundleError extends Error {}

async function getJson<T>(name: string): Promise<T> {
  const r = await fetch(`${BASE}/${name}`);
  if (!r.ok) throw new BundleError(`${name}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

async function getBin(name: string, manifest: Manifest): Promise<Uint8Array> {
  const meta = manifest.files[name];
  if (!meta || meta.dtype !== "uint8" || !meta.shape) throw new BundleError(`${name}: not in manifest`);
  const r = await fetch(`${BASE}/${name}`);
  if (!r.ok) throw new BundleError(`${name}: HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const expected = meta.shape.reduce((a, b) => a * b, 1);
  if (buf.length !== meta.bytes || buf.length !== expected) {
    throw new BundleError(`${name}: ${buf.length} bytes, manifest says ${meta.bytes} (shape ${meta.shape})`);
  }
  return buf;
}

export async function loadStatic(): Promise<StaticBundle> {
  const manifest = await getJson<Manifest>("manifest.json");
  if (manifest.schema_version !== SCHEMA_VERSION) {
    throw new BundleError(`bundle schema ${manifest.schema_version}, app expects ${SCHEMA_VERSION}`);
  }
  const [network, scenarios, storms, routes, vulnerability, story] = await Promise.all([
    getJson<Network>("network.json"),
    getJson<Scenario[]>("scenarios.json"),
    getJson<Record<string, Storm[]>>("storms.json"),
    getJson<RoutesFile>("routes.json"),
    getJson<Vulnerability>("vulnerability.json"),
    getJson<Story>("story.json"),
  ]);
  if (network.segments.length !== manifest.segments || network.grid.cells.length !== manifest.grid_cells) {
    throw new BundleError("network.json does not match the manifest's segment or cell count");
  }
  return { manifest, network, scenarios, storms, routes, vulnerability, story };
}

const cache = new Map<string, Promise<ScenarioData>>();

export function loadScenario(id: string, manifest: Manifest): Promise<ScenarioData> {
  const k = id.toLowerCase();
  if (!cache.has(k)) {
    cache.set(k, (async () => {
      const [cube, rain, assessments, bus] = await Promise.all([
        getBin(`${k}.bin`, manifest),
        getBin(`${k}_rain.bin`, manifest),
        getJson<Assessments>(`${k}_routes.json`),
        getJson<BusFile>(`${k}_bus.json`),
      ]);
      return new ScenarioData(id, cube, rain, assessments, bus, manifest.hours,
                              manifest.segments, manifest.grid_cells);
    })());
    // don't cache a failure
    cache.get(k)!.catch(() => cache.delete(k));
  }
  return cache.get(k)!;
}

export function hourDate(manifest: Manifest, hour: number) {
  return new Date(new Date(manifest.start + "Z").getTime() + hour * 3600_000);
}

export function hourLabel(manifest: Manifest, hour: number) {
  const d = hourDate(manifest, hour);
  const day = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const time = `${String(d.getUTCHours()).padStart(2, "0")}:00`;
  return `${day}, ${time}`;
}

// the rain grid as square polygons, feature id = cell index
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
