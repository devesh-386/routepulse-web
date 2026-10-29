"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hourLabel, type ScenarioData, type StaticBundle } from "@/lib/bundle";
import { useStreetSim } from "@/lib/useStreetSim";
import { useDark } from "@/lib/useDark";
import {
  BANDS, bandHex, bandOf, lowLyingLabel, nearestNode, PLACES, route,
  STEP_HOURS, streetName, streetRain, type Band, type Route, type RouteKind, type Streets, type StreetScenario,
} from "@/lib/streets";
import { googleMapsUrl, inCoverage, metres, nearestStreet, useGeolocation, type GeoStatus } from "@/lib/geo";
import Scrubber from "../Scrubber";
import Curtain from "../shell/Curtain";
import MapMenu from "../shell/MapMenu";
import Icon from "./Icons";
import StreetMap, { type Layers } from "./StreetMap";
import "./street.css";

const ME = "me";
// "scenario|step|origin|destination" → first hour a route reopens, or -1 if none does
const reopenCache = new Map<string, number>();
const CHENNAI: [number, number] = [80.2707, 13.0827];

const KINDS: { kind: RouteKind; title: string; note: string }[] = [
  { kind: "fastest", title: "Fastest", note: "least simulated travel time" },
  { kind: "safer", title: "Safer", note: "avoids streets at risk of closing" },
  { kind: "shortest", title: "Shortest distance", note: "fewest kilometres" },
];

export default function StreetDashboard() {
  const dark = useDark();
  const [scenario, setScenario] = useState("SC04");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 4>(1);
  const [layers, setLayers] = useState<Layers>({ risk: true, rain: false, water: true, closures: true, buildings: true });
  const [view3d, setView3d] = useState(false);
  const [driving, setDriving] = useState(false);
  const [menu, setMenu] = useState<"layers" | "legend" | null>(null);
  // full screen covers the map and the timeline, so time can still be scrubbed
  const mapCol = useRef<HTMLElement>(null);
  const [full, setFull] = useState(false);
  const canFull = typeof document !== "undefined" && document.fullscreenEnabled;
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === mapCol.current && mapCol.current !== null);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void mapCol.current?.requestFullscreen().catch(() => {});
  };
  const [bands, setBands] = useState<Set<Band>>(new Set(BANDS.map((b) => b.id)));
  const [from, setFrom] = useState("anna-nagar");
  const [to, setTo] = useState("marina");
  const [activeRoute, setActiveRoute] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [locate, setLocate] = useState(false);
  const [follow, setFollow] = useState(true);
  const { fix, status: gps } = useGeolocation(locate);
  // phones' browsers accept fewer Google Maps waypoints; the dashboard only renders client-side
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const { bundle, streets, graph, error, live, rainData, hour, setHour } = useStreetSim(scenario);

  const h = hour ?? 0;
  const state = live ? live.state(live.stepOf(h)) : null;
  const series = useMemo(() => (live && bundle ? live.closedSeries(bundle.manifest.hours) : null), [live, bundle]);

  // where the device is, relative to the simulated streets
  const here = useMemo(() => (fix && streets ? nearestStreet(streets, fix.lon, fix.lat) : null), [fix, streets]);
  const covered = !!(fix && here && streets && inCoverage(streets, fix.lon, fix.lat, here.distanceM));
  const point = useCallback((id: string): [number, number] | null => {
    if (id === ME) return fix && covered ? [fix.lon, fix.lat] : null;
    const pl = PLACES.find((p) => p.id === id)!;
    return [pl.lon, pl.lat];
  }, [fix, covered]);
  const placeName = (id: string) => (id === ME ? "My location" : PLACES.find((p) => p.id === id)!.name);
  const ends = useMemo(() => [point(from), point(to)] as const, [point, from, to]);

  const routes = useMemo(() => {
    if (!streets || !graph || !state || !ends[0] || !ends[1]) return [];
    const na = nearestNode(graph, ...ends[0]), nb = nearestNode(graph, ...ends[1]);
    if (na === nb) return [];
    // every kind avoids the same closed streets, so if the fastest search finds no path neither will the others
    const fast = route("fastest", streets, graph, state, na, nb);
    if (!fast) return [];
    return KINDS.map((k) => (k.kind === "fastest" ? fast : route(k.kind, streets, graph, state, na, nb))).filter((r): r is Route => r !== null);
  }, [streets, graph, state, ends]);

  // when every route is cut, find the next 3-hour step at which one opens again. That can take ~100 route
  // searches, so it runs after paint in short slices, once per (scenario, step, journey), and is cached.
  const step = live ? live.stepOf(h) : -1;
  const reopenKey = useMemo(() => (!routes.length && live && graph && ends[0] && ends[1]
    && nearestNode(graph, ...ends[0]) !== nearestNode(graph, ...ends[1]) ? `${live.id}|${step}|${ends[0]}|${ends[1]}` : null),
  [routes, live, graph, ends, step]);
  const [reopenFound, setReopenFound] = useState<{ key: string; hour: number } | null>(null);
  useEffect(() => {
    if (!reopenKey || !streets || !graph || !live || !bundle || !ends[0] || !ends[1]) return;
    const na = nearestNode(graph, ...ends[0]), nb = nearestNode(graph, ...ends[1]);
    const steps = Math.ceil(bundle.manifest.hours / STEP_HOURS);
    let k = step + 1, timer = 0;
    const slice = () => {
      const hit = reopenCache.get(reopenKey);
      if (hit !== undefined) { setReopenFound({ key: reopenKey, hour: hit }); return; }
      const t0 = performance.now();
      for (; k < steps && performance.now() - t0 < 12; k++) {
        if (route("fastest", streets, graph, live.state(k), na, nb)) {
          reopenCache.set(reopenKey, k * STEP_HOURS);
          setReopenFound({ key: reopenKey, hour: k * STEP_HOURS });
          return;
        }
      }
      if (k >= steps) { reopenCache.set(reopenKey, -1); setReopenFound({ key: reopenKey, hour: -1 }); return; }
      timer = window.setTimeout(slice, 0);
    };
    timer = window.setTimeout(slice, 0);
    return () => clearTimeout(timer);
  }, [reopenKey, streets, graph, live, bundle, ends, step]);
  const reopens = reopenFound?.key === reopenKey ? reopenFound.hour : null;

  // a picked street wins; then the street the device is on; then the riskiest street on the route
  const selected = useMemo(() => {
    if (picked !== null) return picked;
    if (covered && here) return here.street;
    if (!state) return null;
    const pool = routes[activeRoute]?.streets ?? [];
    let best = -1, bp = -1;
    for (const i of pool.length ? pool : state.listed) {
      const p = state.p[i] === 255 ? -1 : state.p[i];
      if (p > bp) { bp = p; best = i; }
    }
    return best >= 0 ? best : null;
  }, [picked, covered, here, state, routes, activeRoute]);

  if (error) return <main className="fatal" role="alert"><h1>Could not load the street simulation</h1><p>{error}</p></main>;
  const curtain = (ready: boolean) => (
    <Curtain ready={ready} bg={dark ? "#08111b" : "#eef2f6"} fg={dark ? "#8ea2b6" : "#556678"}>
      <span className="sv-loading"><Icon name="logo" size={28} /><span>Loading 80,905 Chennai street segments…</span></span>
    </Curtain>
  );
  if (!bundle || !streets || !graph) return <>{curtain(false)}</>;

  const sc = bundle.scenarios.find((s) => s.id === scenario)!;
  const cityRain = rainData
    ? [0, 1, 2, 3].reduce((acc, k) => acc + rainData.cellRain(h, streets.meta.rain_block.cells[k]), 0) / 4
    : null;

  return (
    <>{curtain(true)}<div className="sv">
      <header className="sv-top">
        <div className="sv-brand"><Icon name="logo" size={30} className="sv-logo" /><span>RoutePulse</span></div>
        <span className="sv-divider" aria-hidden="true" />
        <p className="sv-subtitle">Climate-aware intelligence layer for everyday navigation in Tamil Nadu</p>
        <span className="sv-mode">Max mode</span>
        <span className="sv-spacer" />
        <div className="sv-pill" title="Simulated rainfall over Chennai at the selected hour">
          <Icon name="rain" size={18} />
          <span><b>{cityRain === null ? "–" : cityRain.toFixed(1)} mm/h</b> simulated rain</span>
        </div>
        <label className="sv-scenario">
          <span className="sr-only">Scenario</span>
          <select value={scenario} onChange={(e) => { setPlaying(false); setPicked(null); setScenario(e.target.value); }}>
            {bundle.scenarios.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
          </select>
        </label>
      </header>

      <main className="sv-grid">
        {/* ------------------------------------------------ left: journey, layers, filter */}
        <aside className="sv-col sv-left" aria-label="Journey and map layers">
          <section className="sv-card sv-journey" aria-label="Journey">
            <button type="button" className={`sv-locate ${locate ? "on" : ""}`} aria-pressed={locate}
                    onClick={() => {
                      if (locate) {
                        setLocate(false);
                        if (from === ME) setFrom("anna-nagar");
                        if (to === ME) setTo(from === "marina" ? "anna-nagar" : "marina");
                      } else {
                        setLocate(true); setFrom(ME); setPicked(null); setActiveRoute(0);
                        if (to === ME) setTo("marina");
                      }
                    }}>
              <Icon name="locate" size={16} />{locate ? "Stop tracking my location" : "Use my location"}
            </button>
            {locate && (
              <LocationStatus status={gps} accuracy={fix?.accuracyM ?? null} covered={covered}
                              street={here && covered ? streetName(streets, here.street) ?? "an unnamed street" : null}
                              kmAway={fix ? metres(fix.lon, fix.lat, ...CHENNAI) / 1000 : null}
                              follow={follow} setFollow={setFollow} />
            )}
            {([["From", from, setFrom, "dot-a", to], ["To", to, setTo, "dot-b", from]] as const).map(([label, value, set, dot, other], k) => (
              <div key={label} className="sv-journey-row">
                {k === 1 && (
                  <button type="button" className="sv-swap" aria-label="Swap origin and destination"
                          onClick={() => { setFrom(to); setTo(from); setPicked(null); }}>
                    <Icon name="swap" size={15} />
                  </button>
                )}
                <label className="sv-field">
                  <span className={`dot ${dot}`} aria-hidden="true" />
                  <span className="sr-only">{label}</span>
                  <select value={value} onChange={(e) => { set(e.target.value); setActiveRoute(0); setPicked(null); }}>
                    {locate && other !== ME && <option value={ME}>My location</option>}
                    {PLACES.filter((p) => p.id !== other).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              </div>
            ))}
            <p className="sv-micro">Routes are computed on the real street network against the simulated conditions at the selected hour. Your location stays in this browser.</p>
          </section>

          <section className="sv-card sv-note" aria-label="About this map">
            <p><b>{sc.name}.</b> {sc.description}</p>
            <p className="sv-micro">Street geometry {streets.meta.attribution}. Flood susceptibility is a low-lying proxy (distance to rivers, canals, drains and the coast; underpasses; bridges), not measured elevation.</p>
          </section>
        </aside>

        {/* ------------------------------------------------ centre: map + time */}
        <section className="sv-mapcol" aria-label="Map and timeline" ref={mapCol}>
          <div className="sv-mapframe">
            <StreetMap streets={streets} network={bundle.network} state={state} rainData={rainData} hour={h}
                       layers={layers} bands={bands} routes={routes} activeRoute={activeRoute}
                       selected={selected} onSelect={setPicked} endpoints={ends} dark={dark}
                       me={covered ? fix : null} follow={follow && covered && !driving}
                       view3d={view3d} drive={driving} onDriveExit={() => setDriving(false)} />
            <div className="sv-tools sv-tools-left">
              <MapMenu id="menu-layers" label="Layers" icon="layers" open={menu === "layers"} setOpen={(o) => setMenu(o ? "layers" : null)}>
                {([
                  ["risk", "Flood risk (roads)", "drop"], ["rain", "Rainfall", "rain"],
                  ["water", "Waterlogging (deep)", "waves"], ["closures", "Road closures", "block"],
                  ["buildings", "3D buildings", "cube"],
                ] as const).map(([k, label, icon]) => (
                  <label key={k} className="sv-toggle">
                    <span><Icon name={icon} />{label}</span>
                    <input type="checkbox" role="switch" checked={layers[k]}
                           onChange={() => setLayers((l) => ({ ...l, [k]: !l[k] }))} />
                    <span className="track" aria-hidden="true" />
                  </label>
                ))}
                <p className="sv-micro">Buildings show in the 3D view. Most heights are estimated from footprint size, not measured.</p>
              </MapMenu>
              <MapMenu id="menu-legend" label="Legend & filter" icon="legend" open={menu === "legend"} setOpen={(o) => setMenu(o ? "legend" : null)}>
                <h3 className="sv-sub">Closure risk <small>+3 hours</small></h3>
                {BANDS.map((b) => (
                  <label key={b.id} className="sv-check">
                    <span><i style={{ background: b.color }} />{b.label}<small>{b.range}</small></span>
                    <input type="checkbox" checked={bands.has(b.id)}
                           onChange={() => setBands((s) => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })} />
                  </label>
                ))}
                <div className="sv-legend-row"><i className="dash" />Closed now</div>
                <div className="sv-legend-row"><i className="glow" />Water over 18 cm</div>
                <p className="sv-micro">Untick a level to hide its streets.</p>
              </MapMenu>
            </div>
            <div className="sv-tools sv-tools-right">
              <div className="sv-seg" role="group" aria-label="Map view">
                <button type="button" aria-pressed={!view3d} onClick={() => setView3d(false)}>2D</button>
                <button type="button" aria-pressed={view3d} onClick={() => setView3d(true)}><Icon name="cube" size={14} />3D</button>
              </div>
              <button type="button" className={`sv-tool ${driving ? "on" : ""}`} aria-pressed={driving}
                      disabled={!routes.length && !driving}
                      title={routes.length ? "Follow the selected route at street level" : "No open route to drive at this hour"}
                      onClick={() => { setDriving((d) => !d); setPlaying(false); setMenu(null); }}>
                <Icon name="drive" size={15} />Drive route
              </button>
              {canFull && (
                <button type="button" className="sv-tool sv-tool-icon" aria-pressed={full} onClick={toggleFull}
                        aria-label={full ? "Exit full screen" : "Full screen"} title={full ? "Exit full screen (Esc)" : "Full screen"}>
                  <Icon name={full ? "shrink" : "expand"} size={16} />
                </button>
              )}
            </div>
            <div className="sv-badge" role="note"><Icon name="flask" size={14} />Simulated scenario{view3d || driving ? " · estimated heights" : ""}</div>
          </div>
          {hour !== null && (
            <Scrubber manifest={bundle.manifest} data={rainData} series={series} seriesLabel="streets" hour={h}
                      setHour={setHour} playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} />
          )}
          <p className="sv-status"><Icon name="flask" size={14} />Street conditions update every 3 simulated hours. Not real-time data; every value here is synthetic.</p>
        </section>

        {/* ------------------------------------------------ right: street + routes */}
        <aside className="sv-col sv-right" aria-label="Street and route details">
          {state && <StreetFinder streets={streets} state={state} selected={selected} onPick={setPicked} />}
          {selected !== null && state
            ? <StreetCard streets={streets} i={selected} state={state} rain={rainData} hour={h} sim={live!}
                          manifest={bundle.manifest} scenario={scenario} onClose={picked !== null ? () => setPicked(null) : undefined} />
            : <section className="sv-card"><p className="sv-micro">Click any street on the map to inspect it.</p></section>}
          <RouteCard routes={routes} active={activeRoute} setActive={(k) => { setActiveRoute(k); setPicked(null); }}
                     reopens={reopens === null ? null : reopens < 0 ? "not before the scenario ends" : hourLabel(bundle.manifest, reopens)}
                     onJump={reopens !== null && reopens >= 0 ? () => { setPlaying(false); setHour(reopens); } : undefined}
                     searching={reopenKey !== null && reopens === null}
                     from={placeName(from)} to={placeName(to)}
                     noEndpoint={!ends[0] || !ends[1]
                       ? gps === "tracking" ? "Your location is outside the simulated Chennai streets, so there is no route from it. Pick a place instead."
                       : gps === "denied" || gps === "unavailable" ? "Your location isn't available. Pick a place instead."
                       : "Waiting for your location…"
                       : null}
                     googleUrl={routes[activeRoute] && ends[0] && ends[1]
                       ? googleMapsUrl(streets, routes[activeRoute].streets, ends[0], ends[1], coarse ? 3 : 8) : null} />
        </aside>
      </main>
    </div></>
  );
}

// ---------------------------------------------------------------- selected street

function StreetCard({ streets, i, state, rain, hour, sim, manifest, scenario, onClose }: {
  streets: Streets; i: number; state: NonNullable<ReturnType<StreetScenario["state"]>>; rain: ScenarioData | null;
  hour: number; sim: StreetScenario; manifest: StaticBundle["manifest"]; scenario: string; onClose?: () => void;
}) {
  const dark = useDark();
  const name = streetName(streets, i) ?? "Unnamed street";
  const cls = streets.meta.classes[streets.cls[i]];
  const p = state.p[i];
  const band = BANDS.find((b) => b.id === bandOf(p))!;
  const depth = state.depth[i];
  const closed = state.status[i] >= 3;
  const step = sim.stepOf(hour);
  const fcst = streetRain(streets, i, sim.fcst[step * 3] ?? [0, 0, 0, 0]);
  const rainNow = rain ? streetRain(streets, i, streets.meta.rain_block.cells.map((c) => rain.cellRain(hour, c))) : 0;
  const low = lowLyingLabel(streets.low[i]);
  const tunnel = (streets.flags[i] & streets.meta.flags.tunnel) !== 0;
  const bridge = (streets.flags[i] & streets.meta.flags.bridge) !== 0;
  const check = streets.forecastInfo.checked_against_simulation[scenario];

  // every sentence is built from the values listed above it
  const why: string[] = [];
  if (p === 255) why.push("No +3 h estimate exists in the last three hours of the scenario.");
  else {
    if (closed) why.push(`It is closed now, with ${depth} cm of standing water.`);
    else if (depth > 0) why.push(`It has ${depth} cm of standing water now.`);
    if (fcst >= 1) why.push(`The simulated forecast puts ${fcst.toFixed(1)} mm of rain on it in the next 3 hours.`);
    if (tunnel) why.push("It is an underpass, so water collects 1.6 times faster.");
    if (bridge) why.push("It is a bridge, which drains quickly.");
    why.push(`Its low-lying proxy is ${low.toLowerCase()}.`);
  }

  return (
    <section className="sv-card sv-street" aria-labelledby="street-h" data-testid="street" data-street={i} data-p={p}>
      <div className="sv-street-head">
        <h2 id="street-h" className="sv-h"><Icon name="pin" />Selected street segment</h2>
        {onClose && <button type="button" className="sv-iconbtn" aria-label="Back to the riskiest street" onClick={onClose}><Icon name="close" size={14} /></button>}
      </div>
      <div className="sv-street-name">
        <i style={{ background: bandHex(band, dark) }} aria-hidden="true" />
        <div><b>{name}</b><span>{cls[0].toUpperCase() + cls.slice(1)} road · Chennai</span></div>
      </div>
      <div className={`sv-risk band-${band.id}`}>
        <Icon name="alert" size={22} />
        <div><b>{band.label}</b><span>Closure risk · at +3 hours ({hourLabel(manifest, Math.min(step * 3 + 3, manifest.hours - 1))})</span></div>
        <strong>{p === 255 ? "–" : `${p} %`}</strong>
      </div>
      <h3 className="sv-sub">Input factors <small>simulated</small></h3>
      <dl className="sv-factors">
        <div><dt><Icon name="rain" />Forecast rainfall (3 h)</dt><dd>{fcst.toFixed(1)} mm</dd></div>
        <div><dt><Icon name="drop" />Rain this hour</dt><dd>{rainNow.toFixed(1)} mm</dd></div>
        <div><dt><Icon name="waves" />Current waterlogging</dt><dd>{depth} cm{closed ? " · closed" : ""}</dd></div>
        <div><dt><Icon name="terrain" />Low-lying proxy</dt><dd>{low}</dd></div>
        {(tunnel || bridge) && <div><dt><Icon name="bridge" />Structure</dt><dd>{tunnel ? "Underpass" : "Bridge"}</dd></div>}
      </dl>
      <h3 className="sv-sub"><Icon name="spark" />Why</h3>
      <p className="sv-why">{why.join(" ")}</p>
      {check && (
        <div className="sv-check-model">
          <div><Icon name="check" size={15} /><b>How good is this estimate?</b></div>
          <p>Scored against the simulation in this storm, the +3 h estimate warned of <b>{check.new_closures_warned_pct} %</b> of
            streets before they closed (Brier {check.brier}; assuming nothing changes scores {check.persistence_brier}).</p>
          <p className="sv-micro">It describes the simulator, not real Chennai streets.</p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- keyboard / screen-reader street selection

function StreetFinder({ streets, state, selected, onPick }: {
  streets: Streets; state: NonNullable<ReturnType<StreetScenario["state"]>>; selected: number | null; onPick: (i: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(-1);
  // name → its segments, once per street set
  const byName = useMemo(() => {
    const m = new Map<string, number[]>();
    for (let i = 0; i < streets.meta.count; i++) {
      const n = streetName(streets, i);
      if (n) { const a = m.get(n); if (a) a.push(i); else m.set(n, [i]); }
    }
    return m;
  }, [streets]);
  // streets at this step, riskiest first (closed, then +3 h risk, then water)
  const ranked = useMemo(() => [...state.listed].sort((a, b) =>
    (state.status[b] >= 3 ? 1 : 0) - (state.status[a] >= 3 ? 1 : 0)
    || (state.p[b] === 255 ? -1 : state.p[b]) - (state.p[a] === 255 ? -1 : state.p[a])
    || state.depth[b] - state.depth[a]), [state]);
  const riskiestOf = (segs: number[]) => segs.reduce((best, i) => {
    const p = (j: number) => (state.p[j] === 255 ? -1 : state.p[j]) + (state.status[j] >= 3 ? 1000 : 0);
    return p(i) > p(best) ? i : best;
  }, segs[0]);
  const choose = (v: string) => {
    setQuery(v);
    const segs = byName.get(v.trim());
    if (segs) onPick(riskiestOf(segs));
  };
  const next = () => {
    if (!ranked.length) return;
    const k = (cursor + 1) % ranked.length;
    setCursor(k);
    onPick(ranked[k]);
  };
  const name = selected !== null ? streetName(streets, selected) ?? "an unnamed street" : null;
  return (
    <section className="sv-card sv-finder" aria-label="Find a street">
      <label className="sv-finder-field">
        <span className="sv-sub">Find a street</span>
        <input type="search" list="sv-street-names" value={query} placeholder="Type a street name…" autoComplete="off"
               onChange={(e) => choose(e.target.value)} data-testid="street-search" />
      </label>
      <datalist id="sv-street-names">{[...byName.keys()].map((n) => <option key={n} value={n} />)}</datalist>
      <button type="button" className="sv-finder-next" onClick={next} disabled={!ranked.length} data-testid="next-risky">
        Next riskiest street{cursor >= 0 && ranked.length ? ` (${cursor + 1} of ${ranked.length})` : ""}
      </button>
      <p className="sr-only" aria-live="polite">{name ? `Showing ${name}.` : ""}</p>
    </section>
  );
}

// ---------------------------------------------------------------- route comparison

function RouteCard({ routes, active, setActive, from, to, reopens, onJump, searching, googleUrl, noEndpoint }: {
  routes: Route[]; active: number; setActive: (k: number) => void; from: string; to: string;
  reopens: string | null; onJump?: () => void; searching: boolean; googleUrl: string | null; noEndpoint: string | null;
}) {
  const risks = routes.map((r) => r.meanP);
  const lo = Math.min(...risks), hi = Math.max(...risks);
  const tag = (r: Route) => {
    // no estimate is unknown, not safe: never tag it as low risk
    if (r.unestimatedKm >= r.km - 1e-9) return { text: "No estimate", cls: "tag-none" };
    if (hi - lo < 0.5) return { text: hi < 1 ? "No simulated risk" : "Similar risk", cls: "tag-low" };
    if (r.meanP === lo) return { text: "Lowest risk", cls: "tag-low" };
    if (r.meanP === hi) return { text: "Higher risk", cls: "tag-high" };
    return { text: "Lower risk", cls: "tag-mid" };
  };
  const same = (a: Route, b: Route) => a.streets.length === b.streets.length && a.streets.every((x, k) => x === b.streets[k]);
  return (
    <section className="sv-card" aria-labelledby="routes-h">
      <h2 id="routes-h" className="sv-h"><Icon name="route" />Route comparison</h2>
      <p className="sv-micro">{from} <Icon name="arrow" size={11} /> {to}</p>
      {noEndpoint && <p className="sv-micro" role="status">{noEndpoint}</p>}
      {!routes.length && !noEndpoint && (
        <div className="sv-cut" role="status">
          <Icon name="block" size={18} />
          <p>Every route between these places crosses a closed street at this hour.
            {reopens && <> The simulation reopens one {onJump
              ? <button type="button" className="sv-link" onClick={onJump}>at {reopens}</button>
              : reopens}.</>}
            {searching && <> Looking for when one reopens…</>}</p>
        </div>
      )}
      <div className="sv-routes" role="radiogroup" aria-label="Routes">
        {routes.map((r, k) => {
          const meta = KINDS.find((x) => x.kind === r.kind)!;
          const t = tag(r);
          const dup = routes.findIndex((o) => same(o, r));
          return (
            <button key={r.kind} type="button" role="radio" aria-checked={k === active}
                    className={`sv-route ${k === active ? "on" : ""}`} onClick={() => setActive(k)}
                    data-kind={r.kind} data-minutes={r.minutes.toFixed(1)} data-km={r.km.toFixed(2)} data-meanp={r.meanP.toFixed(2)}>
              <span className="sv-route-main">
                <b>{meta.title}</b>
                <span>{Math.round(r.minutes)} min · {r.km.toFixed(1)} km</span>
                <small>{dup !== k ? `same path as ${KINDS.find((x) => x.kind === routes[dup].kind)!.title.toLowerCase()}` : meta.note}</small>
              </span>
              <span className={`sv-tag ${t.cls}`}>{t.text}</span>
            </button>
          );
        })}
      </div>
      {routes.length > 0 && (
        <p className="sv-micro">
          Active route: {routes[active] && routes[active].unestimatedKm >= routes[active].km - 1e-9
            ? "no +3 h closure estimate exists in the scenario's last 3 hours"
            : <>highest simulated closure risk on any street {routes[active]?.maxP ?? 0} %{routes[active]?.unestimatedKm ? ` (no estimate for ${routes[active].unestimatedKm.toFixed(1)} km of it)` : ""}</>}, deepest water {routes[active]?.deepestCm ?? 0} cm.
          Times use simulated speeds; closed streets are never used.
        </p>
      )}
      {googleUrl && (
        <a className="sv-gmaps" href={googleUrl} target="_blank" rel="noopener noreferrer" data-testid="gmaps">
          <Icon name="arrow" size={16} />Navigate this route in Google Maps
          <small>Route chosen to avoid <b>simulated</b> flooding, not real conditions. Google follows it through waypoints; its own traffic and road data apply there.</small>
        </a>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- location status

function LocationStatus({ status, accuracy, covered, street, kmAway, follow, setFollow }: {
  status: GeoStatus; accuracy: number | null; covered: boolean; street: string | null; kmAway: number | null;
  follow: boolean; setFollow: (f: boolean) => void;
}) {
  let text: string;
  let tone = "info";
  if (status === "asking") text = "Waiting for location permission…";
  else if (status === "denied") { text = "Location permission was denied. Allow it in your browser's site settings, then try again."; tone = "warn"; }
  else if (status === "unavailable") { text = "This device couldn't provide a location."; tone = "warn"; }
  else if (status === "tracking" && covered) text = `Tracking · ±${Math.round(accuracy ?? 0)} m · on ${street}`;
  else if (status === "tracking") {
    text = `You're about ${kmAway?.toFixed(0)} km from central Chennai. The street simulation covers Chennai only, so routes start from a chosen place.`;
    tone = "warn";
  } else text = "Starting location…";
  return (
    <div className={`sv-gps sv-gps-${tone}`} role="status" data-testid="gps" data-status={status} data-covered={covered}>
      <span className={`sv-gps-dot ${status === "tracking" && covered ? "live" : ""}`} aria-hidden="true" />
      <p>{text}</p>
      {status === "tracking" && covered && (
        <label className="sv-follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />Keep map centred on me
        </label>
      )}
    </div>
  );
}
