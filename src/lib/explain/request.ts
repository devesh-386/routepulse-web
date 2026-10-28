// Strict parsing of the explain request: only ids and enums, never facts from the client.

import { ROUTES, SCENARIO_IDS, MANIFEST, type ScenarioId } from "./data";
import type { Audience, ExplainRequest } from "./evidence";

const AUDIENCES: Audience[] = ["commuter", "bus_operator", "transport_planner"];
const OD_IDS = new Set(ROUTES.od_pairs.map((o) => o.id));
const KEYS = ["scenario", "hour", "od", "audience"];

export type Parsed = { ok: true; req: ExplainRequest } | { ok: false; error: string };

export function parseExplainRequest(body: unknown): Parsed {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !KEYS.includes(k));
  if (extra.length) return { ok: false, error: `unexpected field(s): ${extra.join(", ")}` };
  if (typeof b.scenario !== "string" || !SCENARIO_IDS.includes(b.scenario as ScenarioId)) {
    return { ok: false, error: `scenario must be one of ${SCENARIO_IDS.join(", ")}` };
  }
  if (typeof b.hour !== "number" || !Number.isInteger(b.hour) || b.hour < 0 || b.hour >= MANIFEST.hours) {
    return { ok: false, error: `hour must be an integer from 0 to ${MANIFEST.hours - 1}` };
  }
  if (typeof b.od !== "string" || !OD_IDS.has(b.od)) return { ok: false, error: "od must be a known OD pair id" };
  if (typeof b.audience !== "string" || !AUDIENCES.includes(b.audience as Audience)) {
    return { ok: false, error: `audience must be one of ${AUDIENCES.join(", ")}` };
  }
  return { ok: true, req: { scenario: b.scenario as ScenarioId, hour: b.hour, od: b.od, audience: b.audience as Audience } };
}
