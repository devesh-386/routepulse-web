// Server-side copies of the bundle (src/generated, written by build_bundle.py). The
// explanation layer reads facts only from here, never from anything the client sends.

import manifest from "@/generated/manifest.json";
import network from "@/generated/network.json";
import routes from "@/generated/routes.json";
import scenarios from "@/generated/scenarios.json";
import story from "@/generated/story.json";
import narratives from "@/generated/narratives.json";
import sc01r from "@/generated/sc01_routes.json";
import sc02r from "@/generated/sc02_routes.json";
import sc03r from "@/generated/sc03_routes.json";
import sc04r from "@/generated/sc04_routes.json";
import sc05r from "@/generated/sc05_routes.json";
import sc01b from "@/generated/sc01_bus.json";
import sc02b from "@/generated/sc02_bus.json";
import sc03b from "@/generated/sc03_bus.json";
import sc04b from "@/generated/sc04_bus.json";
import sc05b from "@/generated/sc05_bus.json";
import sc01f from "@/generated/sc01_route_forecast.json";
import sc02f from "@/generated/sc02_route_forecast.json";
import sc03f from "@/generated/sc03_route_forecast.json";
import sc04f from "@/generated/sc04_route_forecast.json";
import sc05f from "@/generated/sc05_route_forecast.json";
import type { Assessments, BusFile, Manifest, Network, RoutesFile, Scenario, Story } from "@/lib/bundle";

export interface RouteForecast { hours: number[]; meaning: string; routes: Record<string, (number | null)[]> }

export const MANIFEST = manifest as unknown as Manifest;
export const NETWORK = network as unknown as Network;
export const ROUTES = routes as unknown as RoutesFile;
export const SCENARIOS = scenarios as unknown as Scenario[];
export const STORY = story as unknown as Story;
export const NARRATIVES = narratives as unknown as {
  audience: string; question: string; context: Record<string, unknown>; reference_explanation: string;
}[];

export const SCENARIO_IDS = ["SC01", "SC02", "SC03", "SC04", "SC05"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const ASSESSMENTS: Record<ScenarioId, Assessments> = {
  SC01: sc01r as unknown as Assessments, SC02: sc02r as unknown as Assessments,
  SC03: sc03r as unknown as Assessments, SC04: sc04r as unknown as Assessments,
  SC05: sc05r as unknown as Assessments,
};
export const BUS: Record<ScenarioId, BusFile> = {
  SC01: sc01b as unknown as BusFile, SC02: sc02b as unknown as BusFile, SC03: sc03b as unknown as BusFile,
  SC04: sc04b as unknown as BusFile, SC05: sc05b as unknown as BusFile,
};
export const ROUTE_FORECAST: Record<ScenarioId, RouteForecast> = {
  SC01: sc01f as unknown as RouteForecast, SC02: sc02f as unknown as RouteForecast,
  SC03: sc03f as unknown as RouteForecast, SC04: sc04f as unknown as RouteForecast,
  SC05: sc05f as unknown as RouteForecast,
};
