"use client";

// Control-room view: the same street simulation as `/`, laid out as an operations console.
// Every number on screen is read from the bundle (streets, per-step state, rain); nothing is invented here.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { hourDate, hourLabel, loadScenario, loadStatic, type ScenarioData, type StaticBundle } from "@/lib/bundle";
import {
  BANDS, bandOf, buildGraph, loadStreets, loadStreetScenario, lowLyingLabel, nearestNode, PLACES, route,
  streetName, streetRain, type Band, type Graph, type Route, type RouteKind, type StepState, type Streets, type StreetScenario,
} from "@/lib/streets";
import { metres } from "@/lib/geo";
import Scrubber from "../Scrubber";
import StreetMap, { type Layers } from "../street/StreetMap";
import "../street/street.css";
import "./ops.css";

const KINDS: { kind: RouteKind; code: string; title: string }[] = [
  { kind: "fastest", code: "R1", title: "Fastest" },
  { kind: "safer", code: "R2", title: "Safer" },
  { kind: "shortest", code: "R3", title: "Shortest" },
];
const ALL_BANDS = new Set<Band>(BANDS.map((b) => b.id));
const SECTOR_RADIUS_M = 1500;
const FEED_STEPS = 8;          // event log looks back 8 steps = 24 simulated hours
const MAJOR = 2;               // class index ≤ 2: trunk, primary, secondary

// network condition from the share of streets closed now (thresholds sit around the README's 7.28 % SC04 corridor peak)
const CONDITIONS = [
  { min: 0.1, level: 1, name: "CRITICAL", tone: "crit" },
  { min: 0.03, level: 2, name: "SEVERE", tone: "high" },
  { min: 0.005, level: 3, name: "ELEVATED", tone: "warn" },
  { min: 0.0001, level: 4, name: "GUARDED", tone: "info" },
  { min: -1, level: 5, name: "NORMAL", tone: "ok" },
] as const;

const point = (id: string): [number, number] => { const pl = PLACES.find((p) => p.id === id)!; return [pl.lon, pl.lat]; };

type Event = { hour: number; kind: "closed" | "reopened" | "summary"; text: string; street?: number };

export default function OpsConsole() {
  const [bundle, setBundle] = useState<StaticBundle | null>(null);
  const [streets, setStreets] = useState<Streets | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState("SC04");
  const [sim, setSim] = useState<StreetScenario | null>(null);
  const [rainData, setRainData] = useState<ScenarioData | null>(null);
  const [hour, setHourState] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 4>(1);
  const [layers, setLayers] = useState<Layers>({ risk: true, rain: false, water: true, closures: true });
  const [from, setFrom] = useState("anna-nagar");
  const [to, setTo] = useState("marina");
  const [activeRoute, setActiveRoute] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [now, setNow] = useState<Date | null>(null);

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
        // open where closures first pass 0.25 % of streets, as the street view does
        setHourState((cur) => {
          if (cur !== null) return cur;
          const first = s.closedSeries(bundle.manifest.hours).findIndex((n) => n >= streets.meta.count * 0.0025);
          return first >= 0 ? first : 0;
        });
      })
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => { live = false; };
  }, [bundle, streets, scenario]);

  // wall clock for the top bar; the simulation clock is separate and driven by the timeline
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const last = bundle ? bundle.manifest.hours - 1 : 0;
  // console hotkeys: space plays, arrows step one 3-hour assessment; text fields, selects and the slider keep their own keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      // a focused button keeps Space for itself, but arrows still drive the clock after clicking a threat
      if (e.key === " ") { if (t.tagName !== "BUTTON") { e.preventDefault(); setPlaying((p) => !p); } }
      else if (e.key === "ArrowRight") { e.preventDefault(); setPlaying(false); setHour((h) => Math.min(h + 3, last)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setPlaying(false); setHour((h) => Math.max(h - 3, 0)); }
      else if (e.key === "Escape") setPicked(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, setHour]);

  const h = hour ?? 0;
  const live = sim?.id === scenario ? sim : null;
  const step = live ? live.stepOf(h) : 0;
  const state = live ? live.state(step) : null;
  const series = useMemo(() => (live && bundle ? live.closedSeries(bundle.manifest.hours) : null), [live, bundle]);

  // street midpoints, once, for sector membership
  const sectors = useMemo(() => {
    if (!streets) return null;
    const [lon0, lat0] = streets.meta.coord_origin;
    const q = streets.meta.coord_quantum_deg;
    const members: number[][] = PLACES.map(() => []);
    for (let i = 0; i < streets.meta.count; i++) {
      const k = (streets.offsets[i] + streets.offsets[i + 1]) >> 1;
      const lon = lon0 + streets.verts[2 * k] * q, lat = lat0 + streets.verts[2 * k + 1] * q;
      PLACES.forEach((pl, z) => { if (metres(lon, lat, pl.lon, pl.lat) <= SECTOR_RADIUS_M) members[z].push(i); });
    }
    return members;
  }, [streets]);

  const stats = useMemo(() => {
    if (!state || !streets) return null;
    let closed = 0, deep = 0, vh = 0, high = 0, med = 0;
    for (const i of state.listed) {
      if (state.status[i] >= 3) closed++;
      if (state.depth[i] >= 18) deep++;
      const b = bandOf(state.p[i]);
      if (b === "very_high") vh++; else if (b === "high") high++; else if (b === "medium") med++;
    }
    const share = closed / streets.meta.count;
    const cond = CONDITIONS.find((c) => share >= c.min)!;
    return { closed, deep, vh, high, med, share, cond };
  }, [state, streets]);

  // named roads that matter most, grouped by name (a road is many segments). Ranked by length closed, then
  // length at high risk (≥ 40 %), then peak risk: at a storm peak most roads tie at 100 %, so risk alone ranks nothing.
  const threats = useMemo(() => {
    if (!state || !streets) return [];
    const by = new Map<string, { name: string; street: number; p: number; depth: number; closed: number; segs: number; cls: number;
                                 closedKm: number; riskKm: number; len: number }>();
    for (const i of state.listed) {
      const name = streetName(streets, i);
      if (!name) continue;
      const p = state.p[i] === 255 ? -1 : state.p[i];
      const km = streets.lengthDm[i] / 10000;
      const isClosed = state.status[i] >= 3 ? 1 : 0;
      let t = by.get(name);
      if (!t) {
        t = { name, street: i, p, depth: 0, closed: 0, segs: 0, cls: streets.cls[i], closedKm: 0, riskKm: 0, len: km };
        by.set(name, t);
      }
      t.segs++; t.closed += isClosed;
      if (isClosed) t.closedKm += km; else if (p >= 40) t.riskKm += km;
      t.depth = Math.max(t.depth, state.depth[i]);
      t.cls = Math.min(t.cls, streets.cls[i]);
      // the road's representative segment: riskiest, and the longest among equals (not a 7 m stub)
      if (p > t.p || (p === t.p && km > t.len)) { t.p = p; t.street = i; t.len = km; }
    }
    return [...by.values()]
      .filter((t) => t.p >= 10 || t.closed > 0)
      .sort((a, b) => b.closedKm - a.closedKm || b.riskKm - a.riskKm || b.p - a.p || b.depth - a.depth)
      .slice(0, 9);
  }, [state, streets]);

  const sectorRows = useMemo(() => {
    if (!state || !sectors) return [];
    return PLACES.map((pl, z) => {
      let closed = 0, risk = 0, depth = 0;
      for (const i of sectors[z]) {
        if (state.status[i] >= 3) closed++;
        if (state.p[i] !== 255 && state.p[i] >= 40) risk++;
        if (state.depth[i] > depth) depth = state.depth[i];
      }
      const n = sectors[z].length || 1;
      const share = closed / n;
      const tone = share >= 0.15 ? "crit" : share >= 0.05 ? "high" : share > 0 || risk / n >= 0.05 ? "warn" : "ok";
      return { id: pl.id, name: pl.name, closed, risk, depth, n: sectors[z].length, share, tone };
    });
  }, [state, sectors]);

  // event log: what changed between consecutive 3-hour steps, newest first
  const events = useMemo(() => {
    if (!live || !streets) return [] as Event[];
    const out: Event[] = [];
    for (let j = step; j >= Math.max(1, step - FEED_STEPS + 1); j--) {
      const cur = live.state(j), prev = live.state(j - 1);
      let opened = 0, shut = 0;
      const named: Event[] = [];
      for (const i of cur.listed) {
        if (cur.status[i] >= 3 && prev.status[i] < 3) {
          shut++;
          const nm = streetName(streets, i);
          if (nm && streets.cls[i] <= MAJOR && named.length < 3 && !named.some((e) => e.text.startsWith(nm))) {
            named.push({ hour: j * 3, kind: "closed", text: `${nm} · ${cur.depth[i]} cm`, street: i });
          }
        }
      }
      for (const i of prev.listed) if (prev.status[i] >= 3 && cur.status[i] < 3) opened++;
      if (shut || opened) {
        out.push({ hour: j * 3, kind: "summary", text: `${shut ? `+${shut} closed` : ""}${shut && opened ? " / " : ""}${opened ? `${opened} reopened` : ""}` });
        out.push(...named);
      }
    }
    return out;
  }, [live, streets, step]);

  const ends = useMemo(() => [point(from), point(to)] as const, [from, to]);

  const routes = useMemo(() => {
    if (!streets || !graph || !state) return [];
    const na = nearestNode(graph, ...ends[0]), nb = nearestNode(graph, ...ends[1]);
    if (na === nb) return [];
    // every kind avoids the same closed streets, so if the fastest search finds no path neither will the others
    const fast = route("fastest", streets, graph, state, na, nb);
    if (!fast) return [];
    return KINDS.map((k) => (k.kind === "fastest" ? fast : route(k.kind, streets, graph, state, na, nb))).filter((r): r is Route => r !== null);
  }, [streets, graph, state, ends]);

  const selected = useMemo(() => {
    if (picked !== null) return picked;
    if (threats.length) return threats[0].street;
    return null;
  }, [picked, threats]);

  if (error) return <main className="ops-fatal" role="alert"><h1>FEED LOST</h1><p>Could not load the street simulation: {error}</p></main>;
  if (!bundle || !streets || !graph) {
    return (
      <main className="ops-boot" aria-busy="true">
        <div className="ops-boot-mark">ROUTEPULSE <span>{"//"}</span> OPS</div>
        <div className="ops-boot-bar"><i /></div>
        <p>Linking 80,905 Chennai street segments…</p>
        <small>Simulated exercise · synthetic data</small>
      </main>
    );
  }

  const m = bundle.manifest;
  const sc = bundle.scenarios.find((s) => s.id === scenario)!;
  const cityRain = rainData
    ? [0, 1, 2, 3].reduce((acc, k) => acc + rainData.cellRain(h, streets.meta.rain_block.cells[k]), 0) / 4
    : null;
  const peak = series ? Math.max(...series) : 0;
  const peakHour = series ? series.indexOf(peak) : -1;
  const simClock = hourDate(m, h);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmtSim = (hr: number) => { const d = hourDate(m, hr); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:00`; };
  const cond = stats?.cond ?? CONDITIONS[4];

  return (
    <div className={`ops tone-${cond.tone}`}>
      <div className="ops-banner" role="note">
        <span className="ops-banner-dot" aria-hidden="true" />
        SIMULATED EXERCISE · every value on this console is synthetic · not a real-world forecast or live feed
      </div>

      <header className="ops-top">
        <div className="ops-brand">
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M2 14h5l3-8 5 15 3-9h6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" /></svg>
          <div><b>ROUTEPULSE</b><span>Flood Operations Console · Chennai</span></div>
        </div>
        <div className={`ops-condition c-${cond.tone}`} role="status" aria-label={`Network condition ${cond.level}, ${cond.name}`}
             title="Display bands by share of streets closed now: 1 ≥ 10 %, 2 ≥ 3 %, 3 ≥ 0.5 %, 4 any closure, 5 none. Not an official alert standard.">
          <span className="ops-condition-k">NETWORK CONDITION</span>
          <div className="ops-condition-scale" aria-hidden="true">
            {[5, 4, 3, 2, 1].map((l) => <i key={l} className={l >= cond.level ? "on" : ""} />)}
          </div>
          <b>{cond.level} · {cond.name}</b>
        </div>
        <div className="ops-clock">
          <span className="ops-k">SIM CLOCK</span>
          <b>{fmtSim(h)}</b>
          <small>T+{String(h).padStart(3, "0")}h · step {step + 1}/{Math.ceil(m.hours / 3)}</small>
        </div>
        <div className="ops-clock">
          <span className="ops-k">SYSTEM · IST</span>
          <b>{now ? now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false }) : "--:--:--"}</b>
          <small><span className="ops-live" aria-hidden="true" />console online</small>
        </div>
        <span className="ops-spacer" />
        <label className="ops-select">
          <span className="ops-k">SCENARIO</span>
          <select value={scenario} onChange={(e) => { setPlaying(false); setPicked(null); setScenario(e.target.value); }}>
            {bundle.scenarios.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
          </select>
        </label>
        <nav className="ops-nav" aria-label="View">
          <Link href="/">Street view</Link>
          <Link href="/corridors">Corridors</Link>
          <Link href="/ops" aria-current="page" className="on">Ops</Link>
        </nav>
      </header>

      <section className="ops-kpis" aria-label="Network figures at the selected hour">
        <Kpi label="STREETS CLOSED" value={stats ? stats.closed.toLocaleString("en-IN") : "–"} sub={stats ? `${(stats.share * 100).toFixed(2)} % of network` : ""} tone={stats && stats.closed ? "crit" : "ok"} />
        <Kpi label="VERY HIGH RISK +3H" value={stats ? stats.vh.toLocaleString("en-IN") : "–"} sub={stats ? `${stats.high.toLocaleString("en-IN")} high · ${stats.med.toLocaleString("en-IN")} medium` : ""} tone={stats && stats.vh ? "high" : "ok"} />
        <Kpi label="DEEP WATER ≥ 18 CM" value={stats ? stats.deep.toLocaleString("en-IN") : "–"} sub="segments" tone={stats && stats.deep ? "warn" : "ok"} />
        <Kpi label="CITY RAIN" value={cityRain === null ? "–" : cityRain.toFixed(1)} unit="mm/h" sub="mean of 4 grid cells" tone={cityRain && cityRain >= 20 ? "warn" : "info"} />
        <Kpi label="CLOSURE PEAK" value={peak.toLocaleString("en-IN")} sub={peakHour < 0 ? "" : peakHour > h ? `in ${peakHour - h} h · ${fmtSim(peakHour)}` : peakHour === h ? "now" : `passed ${h - peakHour} h ago`} tone="info"
             onClick={peak > 0 ? () => { setPlaying(false); setHour(peakHour); } : undefined} />
        <RiskBar stats={stats} />
      </section>

      <main className="ops-grid">
        <aside className="ops-col" aria-label="Threat board and sectors">
          <Panel code="01" title="THREAT BOARD" meta="ranked by km closed">
            {threats.length === 0 && <p className="ops-empty">No named road above 10 % closure risk at this hour.</p>}
            <ol className="ops-threats">
              {threats.map((t, k) => {
                const band = BANDS.find((b) => b.id === bandOf(t.p < 0 ? 255 : t.p))!;
                return (
                  <li key={t.name}>
                    <button type="button" className={`ops-threat ${selected === t.street ? "on" : ""}`} onClick={() => setPicked(t.street)}
                            data-testid="threat" data-street={t.street} data-closed-km={t.closedKm.toFixed(3)} data-risk-km={t.riskKm.toFixed(3)}>
                      <span className="ops-rank">{String(k + 1).padStart(2, "0")}</span>
                      <span className="ops-threat-main">
                        <b>{t.name}</b>
                        <small>{t.closedKm ? `${t.closedKm.toFixed(1)} km closed` : `${t.riskKm.toFixed(1)} km at risk`} · {streets.meta.classes[t.cls]} · {t.depth} cm</small>
                      </span>
                      <span className="ops-pct" style={{ color: band.color }}>{t.p < 0 ? "–" : `${t.p}%`}</span>
                      <span className="ops-meter" aria-hidden="true"><i style={{ width: `${Math.max(t.p, 0)}%`, background: band.color }} /></span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </Panel>

          <Panel code="02" title="SECTOR STATUS" meta={`${SECTOR_RADIUS_M / 1000} km radius`}>
            <div className="ops-sectors">
              {sectorRows.map((s) => (
                <div key={s.id} className={`ops-sector s-${s.tone}`} title={`${s.n.toLocaleString("en-IN")} segments within ${SECTOR_RADIUS_M / 1000} km`}>
                  <b>{s.name}</b>
                  <span>{s.closed} closed</span>
                  <small>{s.risk} at risk · max {s.depth} cm</small>
                </div>
              ))}
            </div>
          </Panel>
        </aside>

        <section className="ops-center" aria-label="Map and timeline">
          <div className="ops-mapframe">
            <StreetMap streets={streets} network={bundle.network} state={state} rainData={rainData} hour={h}
                       layers={layers} bands={ALL_BANDS} routes={routes} activeRoute={activeRoute}
                       selected={selected} onSelect={setPicked} endpoints={ends} me={null} follow={false} />
            <span className="ops-corner tl" aria-hidden="true" /><span className="ops-corner tr" aria-hidden="true" />
            <span className="ops-corner bl" aria-hidden="true" /><span className="ops-corner br" aria-hidden="true" />
            <div className="ops-hud ops-hud-tl" aria-hidden="true">
              <b>SECTOR MAP · CHENNAI</b>
              <span>{sc.id} · {sc.name}</span>
              <span>{simClock.toUTCString().slice(0, 22)} SIM</span>
            </div>
            <div className="ops-layers" role="group" aria-label="Map layers">
              {([["risk", "RISK"], ["water", "WATER"], ["closures", "CLOSED"], ["rain", "RAIN"]] as const).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={layers[k]} className={layers[k] ? "on" : ""}
                        onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}>{label}</button>
              ))}
            </div>
            <div className="ops-legend" aria-label="Legend">
              {BANDS.slice(0, 4).map((b) => <span key={b.id}><i style={{ background: b.color }} />{b.label}</span>)}
              <span><i className="dash" />Closed</span>
            </div>
          </div>
          {hour !== null && (
            <div className="ops-timeline">
              <Scrubber manifest={m} data={rainData} series={series} seriesLabel="streets" hour={h}
                        setHour={setHour} playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} />
              <p className="ops-keys" aria-hidden="true"><kbd>Space</kbd> play <kbd>←</kbd><kbd>→</kbd> ±3 h <kbd>Esc</kbd> clear target</p>
            </div>
          )}
        </section>

        <aside className="ops-col" aria-label="Target, routes and event log">
          <Panel code="03" title="TARGET" meta={selected !== null ? `SEG ${selected}` : "none"}>
            {selected !== null && state && live
              ? <Target streets={streets} i={selected} state={state} sim={live} rain={rainData} hour={h} manifest={m} />
              : <p className="ops-empty">Click a street or a threat to lock a target.</p>}
          </Panel>

          <Panel code="04" title="ROUTE OPTIONS" meta="never through closed streets">
            <div className="ops-od">
              <select aria-label="From" value={from} onChange={(e) => { setFrom(e.target.value); setActiveRoute(0); }}>
                {PLACES.filter((p) => p.id !== to).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" aria-label="Swap origin and destination" onClick={() => { setFrom(to); setTo(from); }}>⇄</button>
              <select aria-label="To" value={to} onChange={(e) => { setTo(e.target.value); setActiveRoute(0); }}>
                {PLACES.filter((p) => p.id !== from).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {routes.length === 0
              ? <p className="ops-alert" role="status">ALL ROUTES CUT · every path between these places crosses a closed street at this hour.</p>
              : (
                <div className="ops-routes" role="radiogroup" aria-label="Routes">
                  {routes.map((r, k) => {
                    const meta = KINDS.find((x) => x.kind === r.kind)!;
                    return (
                      <button key={r.kind} type="button" role="radio" aria-checked={k === activeRoute}
                              className={`ops-route ${k === activeRoute ? "on" : ""}`} onClick={() => setActiveRoute(k)} data-kind={r.kind}>
                        <span className="ops-route-code">{meta.code}</span>
                        <span className="ops-route-main"><b>{meta.title}</b><small>{r.km.toFixed(1)} km · {r.unestimatedKm >= r.km - 1e-9 ? "risk: no estimate" : `max ${r.maxP}%`} · {r.deepestCm} cm</small></span>
                        <span className="ops-route-eta">{Math.round(r.minutes)}<small>min</small></span>
                        <span className="ops-meter" aria-hidden="true"><i style={{ width: `${Math.min(r.meanP, 100)}%`, background: BANDS.find((b) => b.id === bandOf(Math.round(r.meanP)))!.color }} /></span>
                      </button>
                    );
                  })}
                </div>
              )}
          </Panel>

          <Panel code="05" title="EVENT LOG" meta={`last ${FEED_STEPS * 3} h`} grow>
            {events.length === 0 && <p className="ops-empty">No closures or reopenings in the last {FEED_STEPS * 3} simulated hours.</p>}
            <ul className="ops-log" aria-live="off">
              {events.map((e, k) => (
                <li key={`${e.hour}-${k}`} className={`ev-${e.kind}`}>
                  <time>{fmtSim(e.hour)}</time>
                  <span className="ops-tag">{e.kind === "summary" ? "NET" : e.kind === "closed" ? "CLOSE" : "OPEN"}</span>
                  {e.street !== undefined
                    ? <button type="button" className="ops-loglink" onClick={() => setPicked(e.street!)}>{e.text}</button>
                    : <span>{e.text}</span>}
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </main>
      <footer className="ops-foot">
        <span>{sc.id} · {sc.description}</span>
        <span>Condition = display bands on share of streets closed (1 ≥ 10 %, 2 ≥ 3 %, 3 ≥ 0.5 %, 4 any), not an official standard</span>
        <span>Street geometry {streets.meta.attribution} · conditions update every 3 simulated hours · synthetic data</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Panel({ code, title, meta, grow, children }: { code: string; title: string; meta?: string; grow?: boolean; children: React.ReactNode }) {
  return (
    <section className={`ops-panel ${grow ? "grow" : ""}`} aria-label={title.toLowerCase()}>
      <header><span className="ops-code">{code}</span><h2>{title}</h2>{meta && <small>{meta}</small>}</header>
      <div className="ops-panel-body">{children}</div>
    </section>
  );
}

function Kpi({ label, value, unit, sub, tone, onClick }: { label: string; value: string; unit?: string; sub?: string; tone: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="ops-k">{label}</span>
      <b>{value}{unit && <small> {unit}</small>}</b>
      {sub && <span className="ops-kpi-sub">{sub}</span>}
    </>
  );
  return onClick
    ? <button type="button" className={`ops-kpi k-${tone}`} onClick={onClick} title="Jump to the peak hour">{body}</button>
    : <div className={`ops-kpi k-${tone}`}>{body}</div>;
}

function RiskBar({ stats }: { stats: { vh: number; high: number; med: number } | null }) {
  const total = stats ? stats.vh + stats.high + stats.med : 0;
  const parts = stats ? [[stats.vh, BANDS[0]], [stats.high, BANDS[1]], [stats.med, BANDS[2]]] as const : [];
  return (
    <div className="ops-kpi ops-riskbar k-info">
      <span className="ops-k">RISK MIX · +3H</span>
      <div className="ops-stack" aria-label={stats ? `${stats.vh} very high, ${stats.high} high, ${stats.med} medium` : "no data"}>
        {total > 0 ? parts.map(([n, b]) => <i key={b.id} style={{ flexGrow: n, background: b.color }} title={`${b.label}: ${n}`} />) : <i className="none" />}
      </div>
      <span className="ops-kpi-sub">{total.toLocaleString("en-IN")} segments ≥ 10 %</span>
    </div>
  );
}

function Target({ streets, i, state, sim, rain, hour, manifest }: {
  streets: Streets; i: number; state: StepState; sim: StreetScenario; rain: ScenarioData | null; hour: number; manifest: StaticBundle["manifest"];
}) {
  const p = state.p[i];
  const band = BANDS.find((b) => b.id === bandOf(p))!;
  const step = sim.stepOf(hour);
  const fcst = streetRain(streets, i, sim.fcst[step * 3] ?? [0, 0, 0, 0]);
  const rainNow = rain ? streetRain(streets, i, streets.meta.rain_block.cells.map((c) => rain.cellRain(hour, c))) : 0;
  const closed = state.status[i] >= 3;
  const tunnel = (streets.flags[i] & streets.meta.flags.tunnel) !== 0;
  const bridge = (streets.flags[i] & streets.meta.flags.bridge) !== 0;
  const cls = streets.meta.classes[streets.cls[i]];
  return (
    <div className="ops-target" data-testid="ops-target" data-street={i} data-p={p}>
      <div className="ops-target-head">
        <i style={{ background: band.color }} aria-hidden="true" />
        <div><b>{streetName(streets, i) ?? "Unnamed street"}</b><small>{cls} road{tunnel ? " · underpass" : bridge ? " · bridge" : ""}</small></div>
        <span className={`ops-state ${closed ? "closed" : "open"}`}>{closed ? "CLOSED" : "OPEN"}</span>
      </div>
      <div className="ops-gauge" style={{ ["--p" as string]: p === 255 ? 0 : p, ["--c" as string]: band.color }}>
        <div className="ops-gauge-ring" aria-hidden="true" />
        <div className="ops-gauge-val"><b>{p === 255 ? "–" : `${p}%`}</b><small>closure risk at {hourLabel(manifest, Math.min(step * 3 + 3, manifest.hours - 1)).split(", ").pop()}</small></div>
      </div>
      <dl className="ops-telemetry">
        <div><dt>Band</dt><dd style={{ color: band.color }}>{band.label}</dd></div>
        <div><dt>Water now</dt><dd>{state.depth[i]} cm</dd></div>
        <div><dt>Rain this hour</dt><dd>{rainNow.toFixed(1)} mm</dd></div>
        <div><dt>Forecast 3 h</dt><dd>{fcst.toFixed(1)} mm</dd></div>
        <div><dt>Low-lying proxy</dt><dd>{lowLyingLabel(streets.low[i])}</dd></div>
        <div><dt>Length</dt><dd>{(streets.lengthDm[i] / 10).toFixed(0)} m</dd></div>
      </dl>
    </div>
  );
}
