"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { loadScenario, loadStatic, type ScenarioData, type StaticBundle } from "@/lib/bundle";
import MapView, { type MapMode } from "./MapView";
import Scrubber from "./Scrubber";
import Legend from "./Legend";
import RoutePanel from "./RoutePanel";
import ExplainPanel from "./ExplainPanel";
import LensPanel from "./LensPanel";
import StoryCard from "./StoryCard";
import type { Audience } from "@/lib/explain/evidence";

const AUDIENCES: [Audience, string][] = [
  ["commuter", "Commuter"], ["bus_operator", "Bus operator"], ["transport_planner", "Planner"],
];

export default function Dashboard() {
  const [bundle, setBundle] = useState<StaticBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState("SC04");
  const [loaded, setLoaded] = useState<ScenarioData | null>(null);
  // stale while the next scenario loads: show nothing rather than the old scenario's data
  const data = loaded?.id === scenario ? loaded : null;
  const [hour, setHourState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 4>(1);
  const [mode, setMode] = useState<MapMode>("now");
  const [odChoice, setOdId] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>("commuter");
  const [focusedSegment, setFocusedSegment] = useState<string | null>(null);
  const [storyStep, setStoryStep] = useState<number | null>(null);
  const [explainToken, setExplainToken] = useState(0);

  const setHour = useCallback((h: number | ((h: number) => number)) => setHourState(h), []);

  useEffect(() => {
    loadStatic().then(setBundle).catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    if (!bundle) return;
    let live = true;
    loadScenario(scenario, bundle.manifest)
      .then((d) => { if (live) setLoaded(d); })
      .catch((e) => { if (live) setError(String(e.message ?? e)); });
    return () => { live = false; };
  }, [bundle, scenario]);

  if (error) {
    return <main className="fatal" role="alert"><h1>Could not load the simulation data</h1><p>{error}</p></main>;
  }
  if (!bundle) return <main className="loading" aria-busy="true">Loading simulation…</main>;

  const sc = bundle.scenarios.find((s) => s.id === scenario)!;
  // start on the pair the story is about; it has a real recommendation switch
  const odId = odChoice ?? bundle.story.od_pair;
  const goStory = (i: number | null) => {
    setStoryStep(i);
    if (i === null) return;
    const st = bundle.story.steps[i];
    setPlaying(false);
    setScenario(bundle.story.scenario);
    setOdId(bundle.story.od_pair);
    setHour(st.hour);
    setMode("now");
    setFocused(st.route);
    setFocusedSegment(null);
    if (st.focus === "explain") setExplainToken((t) => t + 1);
  };
  const highlight = focusedSegment ? [focusedSegment] : focused ? bundle.routes.routes[focused]?.segments ?? [] : [];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>RoutePulse</h1>
          <span className="muted small">Climate-aware mobility · Tamil Nadu</span>
        </div>
        <Link href="/" className="linklike small">Chennai street view</Link>
        <label className="field">
          <span className="small muted">Scenario</span>
          <select value={scenario} onChange={(e) => { setPlaying(false); setScenario(e.target.value); }}>
            {bundle.scenarios.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
          </select>
        </label>
        <button type="button" className="btn" onClick={() => goStory(storyStep === null ? 0 : null)}
                aria-pressed={storyStep !== null}>
          {storyStep === null ? "Guided story" : "Exit story"}
        </button>
        <div className="seg" role="group" aria-label="Map layer">
          <button type="button" className={`seg-btn ${mode === "now" ? "on" : ""}`} aria-pressed={mode === "now"}
                  onClick={() => setMode("now")}>Now</button>
          <button type="button" className={`seg-btn ${mode === "forecast" ? "on" : ""}`} aria-pressed={mode === "forecast"}
                  onClick={() => setMode("forecast")}>Forecast +3 h</button>
        </div>
      </header>

      <p className="banner" role="note">
        <strong>Simulated scenario: not a real-world forecast.</strong> Every road status, travel time, bus
        outcome and probability here comes from a synthetic simulation.
      </p>

      <main className="layout">
        <section className="map-wrap" aria-label="Map and timeline">
          <MapView manifest={bundle.manifest} network={bundle.network} data={data}
                   storms={bundle.storms[scenario] ?? []} hour={hour} mode={mode} highlight={highlight} />
          <Legend manifest={bundle.manifest} mode={mode} hour={hour} />
          {storyStep !== null && (
            <StoryCard story={bundle.story} step={storyStep} manifest={bundle.manifest} routes={bundle.routes}
                       scenarios={bundle.scenarios} data={data?.id === bundle.story.scenario ? data : null} go={goStory} />
          )}
          <Scrubber manifest={bundle.manifest} data={data} hour={hour} setHour={setHour}
                    playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} />
        </section>
        <aside className="panel" aria-label="Details">
          <div>
            <h2>{sc.name}</h2>
            <p className="muted small">{sc.description}</p>
          </div>
          <div className="seg audience" role="group" aria-label="Who is this for">
            {AUDIENCES.map(([id, label]) => (
              <button key={id} type="button" className={`seg-btn ${audience === id ? "on" : ""}`}
                      aria-pressed={audience === id} onClick={() => { setAudience(id); setFocusedSegment(null); }}>{label}</button>
            ))}
          </div>
          <LensPanel audience={audience} manifest={bundle.manifest} network={bundle.network}
                     routes={bundle.routes} vulnerability={bundle.vulnerability} data={data} hour={hour}
                     odId={odId} focusedSegment={focusedSegment} setFocusedSegment={setFocusedSegment} />
          <RoutePanel manifest={bundle.manifest} routes={bundle.routes} data={data} hour={hour}
                      odId={odId} setOdId={setOdId} focused={focused} setFocused={setFocused} />
          <ExplainPanel scenario={scenario} hour={hour} od={odId} audience={audience} runToken={explainToken} />
        </aside>
      </main>
    </div>
  );
}
