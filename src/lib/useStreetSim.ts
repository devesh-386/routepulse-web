"use client";

// The street simulation as both street pages load it: the static bundle, the street geometry and graph, then
// one scenario at a time. Opens where closures first pass 0.25 % of streets: risk is building and routes still differ.

import { useCallback, useEffect, useState } from "react";
import { loadScenario, loadStatic, type ScenarioData, type StaticBundle } from "./bundle";
import { buildGraph, loadStreets, loadStreetScenario, type Graph, type Streets, type StreetScenario } from "./streets";

export function useStreetSim(scenario: string) {
  const [bundle, setBundle] = useState<StaticBundle | null>(null);
  const [streets, setStreets] = useState<Streets | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sim, setSim] = useState<StreetScenario | null>(null);
  const [rainData, setRainData] = useState<ScenarioData | null>(null);
  const [hour, setHourState] = useState<number | null>(null);

  const setHour = useCallback((h: number | ((h: number) => number)) =>
    setHourState((cur) => (typeof h === "function" ? h(cur ?? 0) : h)), []);

  useEffect(() => {
    Promise.all([loadStatic(), loadStreets()])
      .then(([b, s]) => { setBundle(b); setStreets(s); setGraph(buildGraph(s)); })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    if (!bundle || !streets) return;
    let live = true;
    Promise.all([loadStreetScenario(scenario, streets.meta.count), loadScenario(scenario, bundle.manifest)])
      .then(([s, r]) => {
        if (!live) return;
        setSim(s); setRainData(r);
        setHourState((cur) => {
          if (cur !== null) return cur;
          const first = s.closedSeries(bundle.manifest.hours).findIndex((n) => n >= streets.meta.count * 0.0025);
          return first >= 0 ? first : 0;
        });
      })
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => { live = false; };
  }, [bundle, streets, scenario]);

  // the loaded scenario only once it is the one asked for, so a switch never shows the previous one's state
  const live = sim?.id === scenario ? sim : null;
  return { bundle, streets, graph, error, live, rainData, hour, setHour };
}
