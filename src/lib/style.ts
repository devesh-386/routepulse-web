// Colours and labels shared by the map, legend and panels.

export const STATUS_LABEL = [
  "Open",
  "Wet, slow (> 8 cm water)",
  "Partly flooded (> 18 cm)",
  "Closed: waterlogging",
  "Closed: landslide",
  "Closed: fallen tree",
  "Closed: still draining",
];

// open → wet → flooded → closed. One palette per colour scheme so every road colour keeps
// at least 3:1 contrast against that scheme's map background (checked in verify-ui).
export const STATUS_COLOR_LIGHT = [
  "#3f7a3e", "#9a7400", "#c25400", "#c8102e", "#8a1fa6", "#8f3410", "#6b0f1f",
];
export const STATUS_COLOR_DARK = [
  "#6fbf6d", "#f2c94c", "#ff9a4a", "#ff5a68", "#d58bff", "#d9b38c", "#c4677a",
];
export const MAP_BG = { light: "#e9edf1", dark: "#10161d" };
export const statusColors = (dark: boolean) => (dark ? STATUS_COLOR_DARK : STATUS_COLOR_LIGHT);

// forecast probability ramp (0 → 100 %)
export const FORECAST_STOPS: [number, string][] = [
  [0, "#9fb5c9"], [10, "#f2d27c"], [30, "#f39a3c"], [60, "#e04a33"], [90, "#8f0e2c"],
];

export const RISK_COLOR = { low: "#5b8c5a", moderate: "#e0b100", high: "#f07c1d", severe: "#d6293b" };

import type { StyleSpecification } from "maplibre-gl";

/**
 * A local style: plain background plus optional raster basemap tiles. Nothing the app
 * needs depends on an external style or font server, so if the tiles are unreachable
 * (offline demo, blocked network) the roads, rain and storms still render.
 */
export function baseStyle(dark: boolean): StyleSpecification {
  // no-label tiles: the app draws its own town labels, and doubles would clash
  const flavour = dark ? "dark_nolabels" : "light_nolabels";
  // CARTO serves a watermark tile without a key; the key travels with every tile request,
  // so it is public by nature and should be domain-restricted in the CARTO dashboard
  const key = process.env.NEXT_PUBLIC_CARTO_KEY;
  const q = key ? `?key=${encodeURIComponent(key)}` : "";
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: ["a", "b", "c"].map((s) => `https://${s}.basemaps.cartocdn.com/${flavour}/{z}/{x}/{y}.png${q}`),
        tileSize: 256,
        maxzoom: 18,
        attribution: "© OpenStreetMap contributors © CARTO",
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": dark ? MAP_BG.dark : MAP_BG.light } },
      { id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": dark ? 0.85 : 0.95 } },
    ],
  };
}

// towns labelled on the map with DOM markers (no glyph server needed)
export const LABEL_KINDS = new Set(["metro_core", "city", "port_city", "hill_town"]);
