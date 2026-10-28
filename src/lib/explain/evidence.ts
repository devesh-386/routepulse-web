// The evidence pack: every fact an explanation may use, each with a stable id, a value,
// a unit and a kind. Built only from the server's copy of the bundle.

import { hourLabel } from "@/lib/bundle";
import { ASSESSMENTS, BUS, MANIFEST, ROUTES, ROUTE_FORECAST, SCENARIOS, type ScenarioId } from "./data";

export type Kind = "observed_sim" | "model_output" | "derived";
export type Unit = "min" | "cm" | "mm" | "km" | "%" | "count" | "ratio" | "score" | "text" | "bool";
export type Audience = "commuter" | "bus_operator" | "transport_planner";

export interface Evidence {
  id: string;
  label: string;
  value: number | string | boolean | null;
  unit: Unit;
  kind: Kind;
  entity?: string;      // the route or bus service the fact is about
}

export interface EvidencePack {
  scenarioId: ScenarioId;
  scenarioName: string;
  hour: number;
  assessedHour: number;
  timeLabel: string;
  od: { id: string; label: string };
  audience: Audience;
  routeIds: string[];
  busIds: string[];
  items: Record<string, Evidence>;
}

export interface ExplainRequest {
  scenario: ScenarioId;
  hour: number;
  od: string;
  audience: Audience;
}

/** How a value is written in an explanation; the validator compares against exactly this. */
export function display(e: Evidence): string {
  if (e.value === null) return "none";
  if (typeof e.value === "number") return String(e.value);
  return String(e.value);
}

export function buildEvidence(req: ExplainRequest): EvidencePack {
  const a = ASSESSMENTS[req.scenario];
  let i = 0;
  while (i + 1 < a.hours.length && a.hours[i + 1] <= req.hour) i++;
  const assessedHour = a.hours[i];
  const od = ROUTES.od_pairs.find((o) => o.id === req.od)!;
  const scenario = SCENARIOS.find((s) => s.id === req.scenario)!;
  const timeLabel = hourLabel(MANIFEST, assessedHour);
  const items: Record<string, Evidence> = {};
  const add = (e: Evidence) => { items[e.id] = e; };

  add({ id: "scenario.name", label: "Scenario", value: scenario.name, unit: "text", kind: "observed_sim" });
  add({ id: "time.label", label: "Assessment time", value: timeLabel, unit: "text", kind: "observed_sim" });
  add({ id: "od.label", label: "Origin to destination", value: od.label, unit: "text", kind: "observed_sim" });

  const fc = ROUTE_FORECAST[req.scenario];
  const fi = fc.hours.indexOf(assessedHour);
  for (const rid of od.routes) {
    const r = a.routes[rid];
    const base = { entity: rid };
    const p = `route.${rid}`;
    add({ ...base, id: `${p}.status`, label: `${rid} status`, value: r.route_status[i], unit: "text", kind: "observed_sim" });
    add({ ...base, id: `${p}.segments_closed`, label: `${rid} closed segments`, value: r.segments_closed[i], unit: "count", kind: "observed_sim" });
    add({ ...base, id: `${p}.eta_min`, label: `${rid} simulated ETA`, value: r.eta_min[i], unit: "min", kind: "observed_sim" });
    add({ ...base, id: `${p}.free_flow_eta_min`, label: `${rid} free-flow ETA`, value: r.free_flow_eta_min[i], unit: "min", kind: "observed_sim" });
    add({ ...base, id: `${p}.delay_min`, label: `${rid} simulated delay vs free-flow`, value: r.delay_min[i], unit: "min", kind: "derived" });
    add({ ...base, id: `${p}.max_water_depth_cm`, label: `${rid} worst standing water`, value: r.max_water_depth_cm[i], unit: "cm", kind: "observed_sim" });
    add({ ...base, id: `${p}.max_rainfall_24h_mm`, label: `${rid} most rain in 24 h on a segment`, value: r.max_rainfall_24h_mm[i], unit: "mm", kind: "observed_sim" });
    add({ ...base, id: `${p}.mean_vc_ratio`, label: `${rid} mean volume-to-capacity ratio`, value: r.mean_vc_ratio[i], unit: "ratio", kind: "observed_sim" });
    add({ ...base, id: `${p}.risk_score`, label: `${rid} simulated route-risk score`, value: r.climate_risk_score[i], unit: "score", kind: "derived" });
    add({ ...base, id: `${p}.risk_band`, label: `${rid} simulated route-risk category`, value: r.risk_band[i], unit: "text", kind: "derived" });
    add({ ...base, id: `${p}.recommended`, label: `${rid} is the best-performing route in this scenario`, value: r.recommended[i], unit: "bool", kind: "derived" });
    add({ ...base, id: `${p}.length_km`, label: `${rid} length`, value: ROUTES.routes[rid].length_km, unit: "km", kind: "observed_sim" });
    add({ ...base, id: `${p}.p_closed_3h_max_pct`, label: `${rid} highest model probability that a segment is closed at +3 h`,
          value: fi >= 0 ? fc.routes[rid][fi] : null, unit: "%", kind: "model_output" });
  }

  // bus services running on this pair's routes: departures in this 3-hour assessment window
  const bus = BUS[req.scenario];
  const busIds: string[] = [];
  ROUTES.bus_services.forEach((svc, sIx) => {
    if (!od.routes.includes(svc.road_route)) return;
    busIds.push(svc.id);
    const trips = bus.trips.filter((t) => t[0] === sIx && t[1] >= assessedHour && t[1] < assessedHour + 3);
    const count = (o: string) => trips.filter((t) => bus.outcomes[t[2]] === o).length;
    const base = { entity: svc.id, kind: "observed_sim" as const, unit: "count" as const };
    add({ ...base, id: `bus.${svc.id}.departures`, label: `${svc.id} departures in this 3-hour window`, value: trips.length });
    for (const o of ["completed", "diverted", "cancelled", "terminated_short"]) {
      add({ ...base, id: `bus.${svc.id}.${o}`, label: `${svc.id} trips ${o.replace("_", " ")}`, value: count(o) });
    }
    add({ id: `bus.${svc.id}.road_route`, label: `${svc.id} runs on`, value: svc.road_route, unit: "text",
          kind: "observed_sim", entity: svc.id });
  });

  return {
    scenarioId: req.scenario, scenarioName: scenario.name, hour: req.hour, assessedHour, timeLabel,
    od: { id: od.id, label: od.label }, audience: req.audience, routeIds: od.routes, busIds, items,
  };
}

/** The kind a sentence is shown as: a model output outranks a derived value, which outranks raw state. */
export function sentenceKind(pack: EvidencePack, ids: string[]): Kind {
  const kinds = ids.map((id) => pack.items[id]?.kind);
  if (kinds.includes("model_output")) return "model_output";
  if (kinds.includes("derived")) return "derived";
  return "observed_sim";
}
