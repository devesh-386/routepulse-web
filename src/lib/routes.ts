// Route comparison at an hour, read straight from the 3-hourly assessments.

import type { RoutesFile, ScenarioData } from "./bundle";

export interface RouteRow {
  routeId: string;
  rank: number;
  lengthKm: number;
  status: "passable" | "blocked";
  segmentsClosed: number;
  etaMin: number | null;
  freeFlowEtaMin: number;
  delayMin: number | null;
  maxDepthCm: number;
  meanVc: number;
  rain24Mm: number;
  riskScore: number;
  riskBand: "low" | "moderate" | "high" | "severe";
  recommended: boolean;
}

export interface Comparison {
  assessedHour: number;
  rows: RouteRow[];
  reason: string;
}

export function compareRoutes(routes: RoutesFile, data: ScenarioData, odId: string, hour: number): Comparison {
  const od = routes.od_pairs.find((o) => o.id === odId)!;
  const i = data.assessmentIndex(hour);
  const rows: RouteRow[] = od.routes.map((rid) => {
    const a = data.assessments.routes[rid];
    return {
      routeId: rid,
      rank: routes.routes[rid].rank,
      lengthKm: routes.routes[rid].length_km,
      status: a.route_status[i],
      segmentsClosed: a.segments_closed[i],
      etaMin: a.eta_min[i],
      freeFlowEtaMin: a.free_flow_eta_min[i],
      delayMin: a.delay_min[i],
      maxDepthCm: a.max_water_depth_cm[i],
      meanVc: a.mean_vc_ratio[i],
      rain24Mm: a.max_rainfall_24h_mm[i],
      riskScore: a.climate_risk_score[i],
      riskBand: a.risk_band[i],
      recommended: a.recommended[i],
    };
  });
  return { assessedHour: data.assessments.hours[i], rows, reason: recommendationReason(rows) };
}

/** Why the flagged route is best, stated only from the rows (the rule: fastest passable, ties by risk). */
export function recommendationReason(rows: RouteRow[]): string {
  const best = rows.find((r) => r.recommended);
  const passable = rows.filter((r) => r.status === "passable");
  const blocked = rows.filter((r) => r.status === "blocked").map((r) => r.routeId);
  if (!best) return "No route for this pair is passable in this scenario at this hour.";
  if (rows.length === 1) return `${best.routeId} is the only modelled route for this pair.`;
  const tied = passable.filter((r) => r.etaMin === best.etaMin && r.routeId !== best.routeId);
  let s: string;
  if (passable.length === 1) {
    s = `${best.routeId} is the only passable route`;
  } else if (tied.length) {
    s = tied.every((r) => best.riskScore < r.riskScore)
      ? `${best.routeId} ties on the lowest simulated ETA (${best.etaMin} min) and has the lower simulated risk score (${best.riskScore})`
      : `${best.routeId} ties on the lowest simulated ETA (${best.etaMin} min) and simulated risk score (${best.riskScore}); the simulation lists it first`;
  } else {
    s = `${best.routeId} has the lowest simulated ETA among the ${passable.length} passable routes (${best.etaMin} min)`;
  }
  if (blocked.length) s += `; ${blocked.join(" and ")} ${blocked.length === 1 ? "is" : "are"} blocked`;
  return s + ".";
}

export function hm(min: number) {
  const t = Math.round(min);           // round first, so 119.6 is "2 h 0 min", never "1 h 60 min"
  const h = Math.floor(t / 60), m = t % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}
