// Simple-mode trip planning: up to three routes (fastest, safer, shortest searches) for one vehicle at one
// simulated hour, labelled A/B/C and ranked by the chosen priority. The priorities, letters, palette and
// wording follow the RoutePulse v2.0 planner; every number comes from the street simulation.

import {
  nearestNode, route, streetName,
  type Graph, type Route, type StepState, type Streets, type Vehicle,
} from "./streets";

export type Priority = "fastest" | "lowest_risk" | "balanced";
export const PRIORITIES: { id: Priority; label: string; badge: string; desc: string }[] = [
  { id: "fastest", label: "Fastest", badge: "Fastest", desc: "Lowest simulated travel time." },
  { id: "lowest_risk", label: "Least disrupted", badge: "Least disrupted",
    desc: "Lowest simulated closure risk, then least waterlogged length, then time." },
  { id: "balanced", label: "Balanced", badge: "Recommended", desc: "Travel time weighted up by the simulated closure risk (uncalibrated weight)." },
];
export const ROUTE_PALETTE = ["#8b5cf6", "#14b8a6", "#d946ef"];
export const BEST_GLOW = "#ffc933";

export type RiskCategory = "low" | "moderate" | "high" | "unknown";
export interface PlannedRoute {
  key: string;
  letter: string;
  color: string;
  route: Route;
  delay: number;          // minutes vs the same path on dry, empty roads
  affectedPct: number;    // share of the length with standing water
  risk: RiskCategory;
  worst: string;          // worst condition along the way
  via: string[];          // main named streets, in travel order
  rank: Record<Priority, number>;
}
export type PlanError = "same_point" | "no_route";
export interface Plan { routes: PlannedRoute[]; error: PlanError | null }

const WORST = ["Open", "Wet, slow", "Partly flooded"];

export function riskOf(r: Route): RiskCategory {
  if (r.unestimatedKm >= r.km - 1e-9) return "unknown";
  return r.maxP >= 40 ? "high" : r.maxP >= 10 ? "moderate" : "low";
}

function via(s: Streets, ids: number[], n = 3) {
  // named stretches in order, keep the n longest, then restore travel order
  const runs: { name: string; m: number; at: number }[] = [];
  ids.forEach((i, k) => {
    const name = streetName(s, i);
    if (!name) return;
    const last = runs[runs.length - 1];
    if (last && last.name === name) last.m += s.lengthDm[i];
    else runs.push({ name, m: s.lengthDm[i], at: k });
  });
  const seen = new Set<string>();
  return runs.sort((a, b) => b.m - a.m).filter((r) => !seen.has(r.name) && seen.add(r.name)).slice(0, n)
    .sort((a, b) => a.at - b.at).map((r) => r.name);
}

export function planTrip(s: Streets, g: Graph, st: StepState, from: [number, number], to: [number, number], v: Vehicle): Plan {
  const a = nearestNode(g, ...from), b = nearestNode(g, ...to);
  if (a === b) return { routes: [], error: "same_point" };
  const found: Route[] = [];
  for (const kind of ["fastest", "safer", "shortest"] as const) {
    const r = route(kind, s, g, st, a, b, v);
    if (r && !found.some((x) => x.streets.length === r.streets.length && x.streets.every((y, k) => y === r.streets[k]))) found.push(r);
  }
  if (!found.length) return { routes: [], error: "no_route" };
  // letters by path key, so they stay put when only the priority changes
  const keyed = found.map((r) => ({ r, key: r.streets.join(">") })).sort((x, y) => (x.key < y.key ? -1 : 1));
  const planned: PlannedRoute[] = keyed.map(({ r, key }, k) => {
    let wet = 0, worst = 0;
    for (const i of r.streets) {
      if (st.depth[i] >= 1) wet += s.lengthDm[i] / 10000;
      worst = Math.max(worst, Math.min(st.status[i], 2));
    }
    return {
      key, letter: String.fromCharCode(65 + k), color: ROUTE_PALETTE[k % ROUTE_PALETTE.length], route: r,
      delay: r.minutes - r.baseMinutes, affectedPct: r.km > 0 ? (wet / r.km) * 100 : 0, risk: riskOf(r),
      worst: WORST[worst], via: via(s, r.streets), rank: { fastest: 0, lowest_risk: 0, balanced: 0 },
    };
  });
  const order: Record<Priority, (p: PlannedRoute) => number[]> = {
    fastest: (p) => [p.route.minutes, p.route.km],
    lowest_risk: (p) => [p.route.meanP, p.affectedPct, p.route.minutes],
    balanced: (p) => [p.route.minutes * (1 + 0.5 * p.route.meanP / 100), p.route.minutes],
  };
  for (const pr of PRIORITIES) {
    const cmp = (x: PlannedRoute, y: PlannedRoute) => {
      const a2 = order[pr.id](x), b2 = order[pr.id](y);
      for (let k = 0; k < a2.length; k++) if (Math.abs(a2[k] - b2[k]) > 1e-9) return a2[k] - b2[k];
      return x.key < y.key ? -1 : 1;
    };
    [...planned].sort(cmp).forEach((p, k) => { p.rank[pr.id] = k + 1; });
  }
  return { routes: planned, error: null };
}

export const best = (plan: Plan, pr: Priority) => plan.routes.find((p) => p.rank[pr] === 1) ?? null;

export const fmtMin = (m: number) => `${(Math.round(m * 10) / 10).toFixed(1)} min`;
export const fmtDelay = (m: number) => { const r = Math.round(m * 10) / 10; return `${r > 0 ? "+" : ""}${r.toFixed(1)} min`; };
export const fmtKm = (km: number) => `${(Math.round(km * 10) / 10).toFixed(1)} km`;

const DISCLAIMER = " This is a synthetic scenario on real Chennai street geometry. The rain, water and closures are simulated, not observations, a forecast or safety guidance.";

/** Plain-language explanation; every number is taken from the plan. */
export function explain(plan: Plan, pr: Priority, vehicle: string): string {
  const P = PRIORITIES.find((p) => p.id === pr)!;
  if (plan.error === "same_point") return "Start and destination are at the same junction. Move one of them." + DISCLAIMER;
  if (plan.error === "no_route") return `No route exists for a ${vehicle.toLowerCase()} at this time: simulated closures or water deeper than this vehicle can cross cut every way.` + DISCLAIMER;
  const b = best(plan, pr);
  if (!b) return "No route to explain." + DISCLAIMER;
  const out = [`Route ${b.letter} is best for “${P.label}”: ${fmtMin(b.route.minutes)} (${fmtMin(b.route.baseMinutes)} on dry roads, ${fmtDelay(b.delay)}) over ${fmtKm(b.route.km)}.`];
  if (b.via.length) out.push(`It goes via ${b.via.join(", ")}.`);
  out.push(b.risk === "unknown"
    ? "No closure estimate exists for this hour."
    : `${b.affectedPct.toFixed(0)} % of it has standing water; the highest simulated chance that a street on it closes within 3 hours is ${b.route.maxP} %.`);
  for (const r of plan.routes) if (r !== b) out.push(`Route ${r.letter}: ${fmtMin(r.route.minutes)}, ${fmtKm(r.route.km)}, ${r.risk} risk.`);
  return out.join(" ") + DISCLAIMER;
}
