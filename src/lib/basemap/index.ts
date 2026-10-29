// Detailed vector basemap for every mode: OpenFreeMap's "liberty" layers (water, parks, land use, road
// hierarchy, rail, buildings, road shields, POIs, bilingual place and road names). Free, no key.
// Light mode uses liberty's own colours; dark mode repaints the same layers in the app's navy palette, so both
// themes show the same detail. Layer ids get a "bm-" prefix so they never clash with the app's own layers.

import type { LayerSpecification, Map as MLMap, StyleSpecification } from "maplibre-gl";
import { PLACES } from "../streets";
import liberty from "./liberty.json";

const SRC = "openmaptiles";
export const BASEMAP_ATTRIBUTION = "© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors";

// The app labels its own places (sectors, stations); the basemap must not print them a second time.
const OWN_NAMES = ["literal", PLACES.map((p) => p.name)];
const notOwn = ["!", ["in", ["coalesce", ["get", "name_en"], ["get", "name"]], OWN_NAMES]];

type Paint = Record<string, unknown>;
// dark repaint: first matching rule wins; keys absent from a layer are skipped
const DARK: [RegExp, Paint][] = [
  [/water_name|waterway_line_label/, { "text-color": "#6fa9d6", "text-halo-color": "#0b1520" }],
  [/^label_(city|state|country)/, { "text-color": "#e5edf6", "text-halo-color": "#0b1520" }],
  [/^label_/, { "text-color": "#b5c4d3", "text-halo-color": "#0b1520" }],
  [/^poi|airport/, { "text-color": "#93a6ba", "text-halo-color": "#0b1520" }],
  [/^highway-name/, { "text-color": "#8ea2b6", "text-halo-color": "#0b1520" }],
  [/one_way/, { "icon-opacity": 0.35 }],
  [/^background$/, { "background-color": "#0b1520" }],
  [/^park|landcover_(wood|grass)/, { "fill-color": "#0f2620", "line-color": "#16352b" }],
  [/landcover_wetland/, { "fill-color": "#0e2229" }],
  [/landcover_sand/, { "fill-color": "#1a1f24" }],
  [/landcover_ice/, { "fill-color": "#1a2633" }],
  [/landuse_residential/, { "fill-color": "#0e1a26" }],
  [/landuse_(hospital|school)/, { "fill-color": "#1a1a2a" }],
  [/landuse_(pitch|track)/, { "fill-color": "#11281f", "line-color": "#16352b" }],
  [/landuse_cemetery/, { "fill-color": "#122220" }],
  [/^water$|^waterway/, { "fill-color": "#0b2a45", "line-color": "#0f3556" }],
  [/^aeroway/, { "fill-color": "#16212d", "line-color": "#223142" }],
  [/casing/, { "line-color": "#0b1520" }],
  [/rail/, { "line-color": "#334457" }],
  [/motorway/, { "line-color": "#4e6073" }],
  [/trunk_primary/, { "line-color": "#3b4c5f" }],
  [/secondary_tertiary/, { "line-color": "#2e3e50" }],
  [/minor|street|link/, { "line-color": "#24323f" }],
  [/service|track|path|pedestrian/, { "line-color": "#1d2935" }],
  [/road_area/, { "fill-color": "#1a2633" }],
  [/^building$/, { "fill-color": "#122131", "fill-outline-color": "#1a2c3f" }],
  [/^boundary/, { "line-color": "#46576b" }],
];

function darkPaint(id: string, paint: Paint | undefined): Paint | undefined {
  if (!paint) return paint;
  const rule = DARK.find(([re]) => re.test(id))?.[1];
  const out: Paint = { ...paint };
  delete out["fill-pattern"]; // liberty's wood/hatch patterns are light-coloured bitmaps
  if (rule) for (const k of Object.keys(rule)) if (k in out || k.startsWith("text-") || k === "icon-opacity") out[k] = rule[k];
  return out;
}

const PLACE_OR_POI = /^label_|^poi_/;

/** The basemap's layers for one theme, ids prefixed with "bm-". */
export function basemapLayers(dark: boolean): LayerSpecification[] {
  return (liberty.layers as unknown as LayerSpecification[]).map((l) => {
    const out = { ...l, id: `bm-${l.id}` } as LayerSpecification & { paint?: Paint; filter?: unknown; layout?: Paint };
    if (dark && out.paint) out.paint = darkPaint(l.id, out.paint);
    if (PLACE_OR_POI.test(l.id)) out.filter = out.filter ? ["all", out.filter, notOwn] : notOwn;
    return out as LayerSpecification;
  });
}

/** A complete style with only the basemap; the app adds its layers below the first label (see `labelsFrom`). */
export function basemapStyle(dark: boolean): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
    sources: { [SRC]: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: BASEMAP_ATTRIBUTION } },
    layers: basemapLayers(dark),
  };
}

/** Id of the first basemap label layer: app layers inserted before it stay under the names. */
export const LABELS_FROM = `bm-${(liberty.layers as { id: string; type: string }[]).find((l) => l.type === "symbol")!.id}`;

/** Repaint the basemap in place for a theme change, keeping every app layer and its state. */
export function applyBasemapTheme(m: MLMap, dark: boolean) {
  const now = new Map(m.getStyle().layers.map((x) => [x.id, (x as { paint?: Paint }).paint ?? {}]));
  for (const l of basemapLayers(dark) as (LayerSpecification & { paint?: Paint })[]) {
    const have = now.get(l.id);
    if (!have) continue;
    const want = l.paint ?? {};
    for (const k of new Set([...Object.keys(want), ...Object.keys(have)])) {
      m.setPaintProperty(l.id, k, want[k] ?? undefined);
    }
  }
}
