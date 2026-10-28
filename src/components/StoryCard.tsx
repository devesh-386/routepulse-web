"use client";

import type { Manifest, RoutesFile, ScenarioData, Scenario, Story } from "@/lib/bundle";
import { hourLabel } from "@/lib/bundle";
import { compareRoutes } from "@/lib/routes";

interface Props {
  story: Story;
  step: number;
  manifest: Manifest;
  routes: RoutesFile;
  scenarios: Scenario[];
  data: ScenarioData | null;     // the story's scenario, once loaded
  go: (step: number | null) => void;
}

/** Every sentence here is computed from the bundle for the step's hour; nothing is scripted. */
function stepText(p: Props): string {
  const s = p.story.steps[p.step];
  if (!p.data) return "Loading the scenario…";
  const od = p.routes.od_pairs.find((o) => o.id === p.story.od_pair)!;
  const cmp = compareRoutes(p.routes, p.data, od.id, s.hour);
  const row = (id: string) => cmp.rows.find((r) => r.routeId === id)!;
  const when = hourLabel(p.manifest, s.hour);
  const r = row(s.route);
  const scenario = p.scenarios.find((x) => x.id === p.story.scenario)!.name;
  switch (s.focus) {
    case "baseline":
      return `${when}, ${scenario} scenario. Travelling ${od.label}, the shortest route ${r.routeId} is ${r.status} `
        + (r.etaMin !== null ? `with a simulated ETA of ${r.etaMin} min (free-flow ${r.freeFlowEtaMin} min).` : "with no simulated ETA.");
    case "storm":
      return `${when}. The storm builds: ${p.data.closedCount(s.hour, p.manifest.closed_min_code)} road segments are closed `
        + `across the network, and ${r.routeId} has standing water up to ${r.maxDepthCm} cm. Press Play to watch it develop.`;
    case "switch": {
      const prev = row(s.previous_route!);
      return `${when}. ${prev.routeId} is now ${prev.status} with ${prev.segmentsClosed} closed segments, so the `
        + `best-performing route in this scenario becomes ${r.routeId} (simulated ETA ${r.etaMin} min). `
        + `Switch between Commuter, Bus operator and Planner to see the same moment through each lens.`;
    }
    case "explain":
      return "Why did the route change? The explanation in the side panel cites the evidence for every number, "
        + "and marks what is simulation state, what is derived and what is model output.";
  }
}

export default function StoryCard(p: Props) {
  const s = p.story.steps[p.step];
  const last = p.step === p.story.steps.length - 1;
  return (
    <section className="story" role="region" aria-label="Guided story" data-testid="story" data-step={p.step}>
      <div className="story-top">
        <span className="small muted">Step {p.step + 1} of {p.story.steps.length}</span>
        <button type="button" className="linklike small" onClick={() => p.go(null)}>Exit story</button>
      </div>
      <h3>{s.title}</h3>
      <p className="small" aria-live="polite">{stepText(p)}</p>
      <div className="story-nav">
        <button type="button" className="seg-btn" disabled={p.step === 0} onClick={() => p.go(p.step - 1)}>Back</button>
        <button type="button" className="btn" onClick={() => p.go(last ? null : p.step + 1)}>{last ? "Finish" : "Next"}</button>
      </div>
      <details className="small">
        <summary>How this moment was chosen</summary>
        <p>{p.story.selection_rule}</p>
      </details>
    </section>
  );
}
