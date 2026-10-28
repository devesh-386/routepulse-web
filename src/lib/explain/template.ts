// Deterministic explanations: each sentence is written from evidence items and carries
// their ids. Used when no LLM is configured or an LLM answer fails validation.

import { display, type EvidencePack } from "./evidence";
import type { Sentence } from "./validate";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function templateExplanation(pack: EvidencePack): Sentence[] {
  const it = pack.items;
  const v = (id: string) => it[id]?.value;
  const d = (id: string) => display(it[id]);
  const routes = pack.routeIds;
  const best = routes.find((r) => v(`route.${r}.recommended`) === true);
  const primary = routes[0];
  const out: Sentence[] = [];
  const say = (text: string, ...ids: string[]) => out.push({ text, evidence_ids: ids });

  const status = (r: string) => {
    const closed = v(`route.${r}.segments_closed`) as number;
    return v(`route.${r}.status`) === "blocked"
      ? say(`${r} is blocked, with ${closed} ${plural(closed, "segment", "segments")} closed and standing water up to ${d(`route.${r}.max_water_depth_cm`)} cm.`,
            `route.${r}.status`, `route.${r}.segments_closed`, `route.${r}.max_water_depth_cm`)
      : say(`${r} is passable, with a simulated ETA of ${d(`route.${r}.eta_min`)} min against ${d(`route.${r}.free_flow_eta_min`)} min in free-flow.`,
            `route.${r}.status`, `route.${r}.eta_min`, `route.${r}.free_flow_eta_min`);
  };

  say(`This is the ${pack.scenarioName} scenario for ${pack.od.label}, as assessed at ${pack.timeLabel}.`,
      "scenario.name", "od.label", "time.label");

  if (pack.audience === "commuter") {
    if (best) {
      say(`The best-performing route in this scenario is ${best}, with a simulated ETA of ${d(`route.${best}.eta_min`)} min and a simulated delay of ${d(`route.${best}.delay_min`)} min.`,
          `route.${best}.recommended`, `route.${best}.eta_min`, `route.${best}.delay_min`);
    } else {
      say(`No route for this pair is passable at this time; ${primary} has ${d(`route.${primary}.segments_closed`)} closed ${plural(v(`route.${primary}.segments_closed`) as number, "segment", "segments")}.`,
          `route.${primary}.status`, `route.${primary}.segments_closed`, `route.${primary}.recommended`);
    }
    for (const r of routes) if (r !== best) status(r);
  } else if (pack.audience === "bus_operator") {
    for (const b of pack.busIds) {
      const dep = v(`bus.${b}.departures`) as number;
      if (!dep) {
        say(`${b} has no departures scheduled in this assessment window.`, `bus.${b}.departures`);
        continue;
      }
      say(`${b} has ${dep} ${plural(dep, "departure", "departures")} in this assessment window: ${d(`bus.${b}.completed`)} completed, ${d(`bus.${b}.diverted`)} diverted, ${d(`bus.${b}.cancelled`)} cancelled and ${d(`bus.${b}.terminated_short`)} turned back.`,
          `bus.${b}.departures`, `bus.${b}.completed`, `bus.${b}.diverted`, `bus.${b}.cancelled`, `bus.${b}.terminated_short`);
    }
    if (!pack.busIds.length) say(`No simulated bus service runs on ${pack.od.label}.`, "od.label");
    for (const r of routes) status(r);
  } else {
    for (const r of routes) {
      say(`${r} has a simulated route-risk score of ${d(`route.${r}.risk_score`)} (${d(`route.${r}.risk_band`)}), with standing water up to ${d(`route.${r}.max_water_depth_cm`)} cm, ${d(`route.${r}.max_rainfall_24h_mm`)} mm of rain on its wettest segment over the past day and a mean volume-to-capacity ratio of ${d(`route.${r}.mean_vc_ratio`)}.`,
          `route.${r}.risk_score`, `route.${r}.risk_band`, `route.${r}.max_water_depth_cm`,
          `route.${r}.max_rainfall_24h_mm`, `route.${r}.mean_vc_ratio`);
    }
  }

  // the model's view, for whichever route the reader should look at
  const focus = best ?? primary;
  const p = v(`route.${focus}.p_closed_3h_max_pct`);
  if (typeof p === "number") {
    say(`The model's highest simulated probability that a segment on ${focus} is closed at +3 h is ${p} %.`,
        `route.${focus}.p_closed_3h_max_pct`);
  }
  return out;
}
