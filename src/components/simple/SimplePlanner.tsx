"use client";

// Simple mode: plan one trip in a few taps. Layout and wording follow the RoutePulse v2.0 simple planner
// (left panel, route cards A/B/C, amber glow on the best route, floating summary, street inspector, data panel);
// the numbers come from the same street simulation as Max mode and the Control room.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hourLabel } from "@/lib/bundle";
import { useStreetSim } from "@/lib/useStreetSim";
import { useDark } from "@/lib/useDark";
import {
  bandOf, coordsOf, lowLyingLabel, PLACES, streetName, VEHICLES, type Streets,
} from "@/lib/streets";
import { best, explain, fmtDelay, fmtKm, fmtMin, planTrip, PRIORITIES, type Plan, type Priority } from "@/lib/planner";
import Curtain from "../shell/Curtain";
import MapMenu, { type MenuClasses } from "../shell/MapMenu";
import ModeRail, { RailTool } from "../shell/ModeRail";
import Icon from "../street/Icons";
import SimpleMap, { type Pt, type SimpleLayers } from "./SimpleMap";
import "./simple.css";

const STATUS = ["Open", "Wet, slow", "Partly flooded", "Closed: waterlogging", "Closed: still draining"];
const MENU: MenuClasses = { wrap: "rps-menu", btn: "rps-tool", panel: "rps-menu-panel", chev: "rps-chev" };
const LAYERS: [keyof SimpleLayers, string][] = [["roads", "Roads"], ["rain", "Rainfall"], ["depth", "Water depth"], ["closures", "Closures"]];
const place = (id: string): Pt => { const p = PLACES.find((x) => x.id === id)!; return { lon: p.lon, lat: p.lat, name: p.name }; };
const mapPoint = (lon: number, lat: number): Pt => ({ lon, lat, name: `Map point ${lat.toFixed(5)}, ${lon.toFixed(5)}` });

interface Sug { label: string; sub: string; pt: Pt }

export default function SimplePlanner() {
  const dark = useDark();
  const [scenario, setScenario] = useState("SC04");
  const { bundle, streets, graph, error, live, rainData, hour, setHour } = useStreetSim(scenario);
  const [from, setFrom] = useState<Pt | null>(() => place("anna-nagar"));
  const [to, setTo] = useState<Pt | null>(() => place("marina"));
  const [veh, setVeh] = useState(VEHICLES[0].id);
  const [priority, setPriority] = useState<Priority>("balanced");
  const [layers, setLayers] = useState<SimpleLayers>({ roads: true, rain: true, depth: true, closures: true });
  const [sel, setSel] = useState<string | null>(null);
  const [pick, setPick] = useState<"from" | "to" | null>(null);
  const [nextClick, setNextClick] = useState<"from" | "to">("from");
  const [inspect, setInspect] = useState(false);
  const [inspected, setInspected] = useState<number | null>(null);
  const [menu, setMenu] = useState<"layers" | "legend" | "info" | null>(null);
  const [status, setStatus] = useState<{ kind: "error" | "loading"; msg: string } | null>(null);

  const vehicle = VEHICLES.find((v) => v.id === veh)!;
  const h = hour ?? 0;
  const state = live ? live.state(live.stepOf(h)) : null;

  const plan: Plan | null = useMemo(() => (streets && graph && state && from && to
    ? planTrip(streets, graph, state, [from.lon, from.lat], [to.lon, to.lat], vehicle) : null), [streets, graph, state, from, to, vehicle]);
  const win = plan ? best(plan, priority) : null;
  const selRoute = plan?.routes.find((r) => r.key === sel) ?? null;

  const setPoint = useCallback((k: "from" | "to", p: Pt) => {
    if (k === "from") setFrom(p); else setTo(p);
    setNextClick(k === "from" ? "to" : "from"); setSel(null);
  }, []);

  if (error) return <Shell tools={null}><div className="rps"><main className="rps-panel"><div className="rps-status error" role="alert">Could not load the street simulation: {error}</div></main></div></Shell>;
  const curtain = (ready: boolean) => (
    <Curtain ready={ready} bg={dark ? "#0b1520" : "#eef0f7"} fg={dark ? "#e5edf6" : "#0f1115"}>
      <span className="rp-curtain-row"><Icon name="logo" size={28} /><span>Loading 80,905 Chennai streets…</span></span>
    </Curtain>
  );
  if (!bundle || !streets || !graph) return <>{curtain(false)}</>;

  const m = bundle.manifest;
  const cityRain = rainData ? [0, 1, 2, 3].reduce((a, k) => a + rainData.cellRain(h, streets.meta.rain_block.cells[k]), 0) / 4 : 0;
  const pr = PRIORITIES.find((p) => p.id === priority)!;
  const order = plan ? [...plan.routes].sort((a, b) => a.rank[priority] - b.rank[priority]) : [];

  const tools = (
    <>
      <RailTool icon="layers" label="Layers" title="Map layers" pressed={menu === "layers"} onClick={() => setMenu("layers")} />
      <RailTool icon="pin" label="Inspect" title="Inspect a street: tap any street on the map" pressed={inspect}
                onClick={() => { setInspect((v) => !v); setPick(null); setInspected(null); }} />
      <RailTool icon="network" label="Info" title="Data source, coverage and limits" pressed={menu === "info"} onClick={() => setMenu("info")} />
    </>
  );

  return (
    <>{curtain(true)}<Shell tools={tools}>
      <div className="rps">
        <aside className="rps-panel" aria-label="Plan a journey">
          <div className="rps-ph"><h1>Plan a journey</h1><span className="rps-sim">SIMULATED · NOT A FORECAST</span></div>
          {status && <div className={`rps-status ${status.kind}`} role="status">{status.msg}</div>}

          <PlaceField k="from" label="From" value={from} streets={streets} picking={pick === "from"} onPick={() => { setInspect(false); setPick((c) => (c === "from" ? null : "from")); }}
                      onSet={(p) => setPoint("from", p)} setStatus={setStatus} />
          <div className="rps-swap">
            <button type="button" className="rps-ib" aria-label="Swap start and destination" title="Swap start and destination"
                    onClick={() => { setFrom(to); setTo(from); setSel(null); }}><Icon name="swap" size={16} /></button>
          </div>
          <PlaceField k="to" label="To" value={to} streets={streets} picking={pick === "to"} onPick={() => { setInspect(false); setPick((c) => (c === "to" ? null : "to")); }}
                      onSet={(p) => setPoint("to", p)} setStatus={setStatus} />

          <div className="rps-two">
            <label className="rps-ctl"><span>Vehicle</span>
              <select value={veh} onChange={(e) => { setVeh(e.target.value); setSel(null); }}>
                {VEHICLES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </label>
            <label className="rps-ctl"><span>Weather scenario</span>
              <select value={scenario} onChange={(e) => { setScenario(e.target.value); setSel(null); }}>
                {bundle.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <div className="rps-ctl">
            <label htmlFor="rps-hour"><span>Leaving at <b>{hourLabel(m, h)}</b></span></label>
            <input id="rps-hour" type="range" min={0} max={m.hours - 1} step={1} value={h}
                   aria-valuetext={hourLabel(m, h)} onChange={(e) => { setHour(Number(e.target.value)); setSel(null); }} />
            <div className="rps-ticks" aria-hidden="true">
              {[0, Math.floor((m.hours - 1) / 2), m.hours - 1].map((x) => <span key={x}>{hourLabel(m, x).split(",")[0]}</span>)}
            </div>
          </div>

          <div className="rps-seg" role="group" aria-label="Route priority">
            {PRIORITIES.map((p) => (
              <button key={p.id} type="button" className={p.id === priority ? "on" : ""} aria-pressed={p.id === priority} title={p.desc}
                      onClick={() => setPriority(p.id)}>{p.label}</button>
            ))}
          </div>

          <h4>Routes</h4>
          <div aria-live="polite" data-testid="simple-cards" data-winner={win?.letter ?? "none"}>
            {!from || !to ? <div className="rps-empty">Type a start and destination, or tap the map.</div>
              : !plan ? <div className="rps-empty">Calculating routes…</div>
              : plan.error === "same_point" ? <div className="rps-empty warn">Start and destination are at the same junction. Move one of them.</div>
              : plan.error === "no_route" ? <div className="rps-empty warn">No route for a {vehicle.label.toLowerCase()} at this time: simulated closures or water deeper than {vehicle.maxDepthCm} cm cut every way. Try another time or vehicle.</div>
              : order.map((r) => {
                const isBest = r === win;
                const dt = win ? r.route.minutes - win.route.minutes : 0, dk = win ? r.route.km - win.route.km : 0;
                return (
                  <button key={r.key} type="button" className={`rps-card ${isBest ? "best" : ""} ${sel === r.key ? "sel" : ""}`}
                          aria-pressed={sel === r.key} data-route={r.letter} onClick={() => setSel((s) => (s === r.key ? null : r.key))}>
                    <div className="row">
                      <span className="rps-chip" style={{ background: r.color }}>{r.letter}</span><b>Route {r.letter}</b>
                      {isBest && <span className="rps-badge">Best for {pr.label}</span>}
                      <span className="grow" />
                      <span className={`rps-risk ${r.risk}`}>{r.risk === "unknown" ? "no estimate" : `${r.risk} risk`}</span>
                    </div>
                    <div className="rps-big">{fmtMin(r.route.minutes)} <small>· {fmtMin(r.route.baseMinutes)} on dry roads · {fmtDelay(r.delay)}</small></div>
                    <div className="rps-meta"><span>{fmtKm(r.route.km)}</span><span>{r.affectedPct.toFixed(0)} % waterlogged</span><span>{r.worst}</span></div>
                    {r.via.length > 0 && <div className="rps-via">Via {r.via.join(" · ")}</div>}
                    {!isBest && win && <div className="rps-adv">{dt >= 0 ? "+" : "−"}{Math.abs(dt).toFixed(1)} min vs. the highlighted route, {dk >= 0 ? "+" : "−"}{Math.abs(dk).toFixed(1)} km.</div>}
                  </button>
                );
              })}
          </div>

          {selRoute && <RouteSteps streets={streets} ids={selRoute.route.streets} letter={selRoute.letter} color={selRoute.color} onClose={() => setSel(null)} />}

          <details className="more">
            <summary>Why this route? (explanation)</summary>
            <div className="rps-explain">
              <p>{plan ? explain(plan, priority, vehicle.label) : "Choose a start and destination to see an explanation."}</p>
              <small>Template explanation built from the simulation result. No AI service is used.</small>
            </div>
          </details>
          <p className="rps-foot">Streets © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>. Place search by OpenStreetMap Nominatim. Every water level, closure and travel time here is simulated.</p>
        </aside>

        <main className="rps-stage" aria-label="Map">
          <SimpleMap streets={streets} state={state} layers={layers} routes={plan?.routes ?? []} winner={win?.key ?? null} sel={sel}
                     from={from} to={to} crosshair={pick !== null || inspect} inspect={inspect}
                     dark={dark} onMapClick={(lon, lat, street) => {
                       if (inspect) { setInspected(street); return; }
                       setPoint(pick ?? nextClick, mapPoint(lon, lat)); setPick(null);
                     }}
                     onDrag={(k, lon, lat) => setPoint(k, mapPoint(lon, lat))}
                     onRoute={(k) => setSel(k)} />
          {layers.rain && <div className="rps-veil" aria-hidden="true" style={{ opacity: Math.min(0.32, cityRain / 70) }} />}
          {layers.rain && <div className="rps-rainchip" role="status">{cityRain >= 0.5 ? `Simulated rain ${cityRain.toFixed(1)} mm/h over Chennai` : "No simulated rain at this time"}</div>}
          <div className="rps-tools">
            <MapMenu id="rps-menu-layers" label="Layers" icon="layers" cls={MENU} open={menu === "layers"} setOpen={(o) => setMenu(o ? "layers" : null)}>
              <div className="rps-layers">
                {LAYERS.map(([k, label]) => (
                  <button key={k} type="button" className="rps-toggle" aria-pressed={layers[k]}
                          onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}>{label}</button>
                ))}
              </div>
              <p className="rps-note">Street names show with Roads. Water and closures are simulated.</p>
            </MapMenu>
            <MapMenu id="rps-menu-legend" label="Legend" icon="legend" cls={MENU} open={menu === "legend"} setOpen={(o) => setMenu(o ? "legend" : null)}>
              <Legend plan={plan} win={win?.key ?? null} pr={pr.label} layers={layers} state={state} />
            </MapMenu>
            <MapMenu id="rps-menu-info" label="Info" icon="network" cls={MENU} open={menu === "info"} setOpen={(o) => setMenu(o ? "info" : null)}>
              <About streets={streets} />
            </MapMenu>
          </div>
          {win && (
            <div className="rps-summary" data-testid="simple-summary">
              <div className="row"><span className="rps-chip" style={{ background: win.color }}>{win.letter}</span><b>Route {win.letter}</b><span className="rps-badge">Best for {pr.label}</span></div>
              <div className="rps-stats">
                <Stat k="Vehicle" v={vehicle.label} /><Stat k="Travel time" v={fmtMin(win.route.minutes)} /><Stat k="Delay" v={fmtDelay(win.delay)} />
                <Stat k="Distance" v={fmtKm(win.route.km)} /><Stat k="Waterlogged" v={`${win.affectedPct.toFixed(0)} %`} />
                <Stat k="Risk" v={win.risk === "unknown" ? "No estimate" : win.risk[0].toUpperCase() + win.risk.slice(1)} />
              </div>
            </div>
          )}
          {inspect && <Inspect streets={streets} i={inspected} state={state} onClose={() => { setInspect(false); setInspected(null); }} />}
        </main>
      </div>
    </Shell></>
  );
}

function Shell({ tools, children }: { tools: React.ReactNode; children: React.ReactNode }) {
  return <div className="rp-shell"><ModeRail mode="simple">{tools}</ModeRail><div className="rp-main">{children}</div></div>;
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="rps-stat"><small>{k}</small><b>{v}</b></div>;
}

// ---------------------------------------------------------------- From / To with local street search + Nominatim

const geoCache = new Map<string, Sug[]>();

function PlaceField({ k, label, value, streets, picking, onPick, onSet, setStatus }: {
  k: "from" | "to"; label: string; value: Pt | null; streets: Streets; picking: boolean; onPick: () => void;
  onSet: (p: Pt) => void; setStatus: (s: { kind: "error" | "loading"; msg: string } | null) => void;
}) {
  const [text, setText] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<Sug[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [shownFor, setShownFor] = useState(value);
  if (shownFor !== value) { setShownFor(value); setText(value?.name ?? ""); }

  // every named street: the midpoint of its longest segment
  const named = useMemo(() => {
    const best = new Map<string, number>();
    for (let i = 0; i < streets.meta.count; i++) {
      const n = streetName(streets, i);
      if (n && (best.get(n) === undefined || streets.lengthDm[i] > streets.lengthDm[best.get(n)!])) best.set(n, i);
    }
    return best;
  }, [streets]);

  const q = text.trim().toLowerCase();
  const local: Sug[] = q.length < 2 || q === value?.name.toLowerCase() ? [] : [
    ...PLACES.filter((p) => p.name.toLowerCase().includes(q)).map((p) => ({ label: p.name, sub: "Place", pt: place(p.id) })),
    ...[...named.keys()].filter((n) => n.toLowerCase().startsWith(q)).concat([...named.keys()].filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q)))
      .slice(0, 6).map((n) => {
        const c = coordsOf(streets, named.get(n)!), mid = c[Math.floor(c.length / 2)];
        return { label: n, sub: "Street", pt: { lon: mid[0], lat: mid[1], name: n } };
      }),
  ].slice(0, 7);
  const list = [...local, ...(remote ?? [])];

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);

  const searchWeb = async () => {
    if (q.length < 3) { setStatus({ kind: "error", msg: "Type at least 3 characters, then press Enter." }); return; }
    const hit = geoCache.get(q);
    if (hit) { setRemote(hit); setOpen(true); return; }
    setStatus({ kind: "loading", msg: "Searching places…" });
    const [x0, y0, x1, y1] = streets.meta.bbox;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=in&bounded=1&viewbox=${[x0, y1, x1, y0].join(",")}&q=${encodeURIComponent(text.trim())}`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const res = (await r.json()) as { display_name: string; lat: string; lon: string }[];
      const out = res.map((x) => ({ label: x.display_name.split(",").slice(0, 2).join(",").trim(), sub: x.display_name, pt: { lon: +x.lon, lat: +x.lat, name: x.display_name.split(",").slice(0, 2).join(",").trim() } }));
      geoCache.set(q, out); setRemote(out); setOpen(true); setStatus(null);
    } catch (e) {
      setStatus({ kind: "error", msg: `Place search is unavailable (${(e as Error).message}). Pick a street from the list, or tap the pin and then the map.` });
    }
  };
  const choose = (s: Sug) => { setOpen(false); setRemote(null); onSet(s.pt); };

  return (
    <div className="rps-field" ref={box}>
      <span className={`rps-dot ${k === "from" ? "s" : "e"}`} aria-hidden="true" />
      <input value={text} placeholder={label} aria-label={`${label}: type a place or street, press Enter to search`} autoComplete="off"
             role="combobox" aria-expanded={open && (list.length > 0 || remote !== null)} aria-controls={`rps-sug-${k}`}
             onChange={(e) => { setText(e.target.value); setRemote(null); setOpen(true); }}
             onFocus={() => setOpen(true)}
             onKeyDown={(e) => {
               if (e.key === "Enter") { e.preventDefault(); if (local.length && !remote) choose(local[0]); else void searchWeb(); }
               if (e.key === "Escape") setOpen(false);
             }} data-testid={`simple-${k}`} />
      <button type="button" className={`rps-ib ${picking ? "on" : ""}`} aria-pressed={picking} aria-label={`Pick ${label} on the map`}
              title={`Set ${label} by tapping the map`} onClick={onPick}><Icon name="pin" size={18} /></button>
      {open && (list.length > 0 || remote !== null) && (
        <div className="rps-suggest" id={`rps-sug-${k}`} role="listbox" aria-label={`${label} suggestions`}>
          {list.map((s, n) => (
            <button key={`${s.sub}-${s.label}-${n}`} type="button" role="option" aria-selected={false} className="rps-sug" title={s.sub} onClick={() => choose(s)}>
              {s.label}<small>{s.sub}</small>
            </button>
          ))}
          {remote !== null && !remote.length && <div className="rps-sug none">No matching places inside the simulated area.</div>}
          {remote === null && q.length >= 3 && <button type="button" className="rps-sug" onClick={() => void searchWeb()}><b>Search the web for “{text.trim()}”</b><small>OpenStreetMap Nominatim</small></button>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- selected route, street by street

function RouteSteps({ streets, ids, letter, color, onClose }: { streets: Streets; ids: number[]; letter: string; color: string; onClose: () => void }) {
  const runs: { name: string; km: number }[] = [];
  for (const i of ids) {
    const name = streetName(streets, i) ?? "Unnamed street", km = streets.lengthDm[i] / 10000;
    const last = runs[runs.length - 1];
    if (last && last.name === name) last.km += km; else runs.push({ name, km });
  }
  const shown = runs.filter((r) => r.km >= 0.05);
  return (
    <section aria-label={`Route ${letter}, street by street`}>
      <div className="row" style={{ marginTop: 12 }}>
        <span className="rps-chip" style={{ background: color }}>{letter}</span><b>Route {letter}, street by street</b><span className="grow" />
        <button type="button" className="rps-x" aria-label="Close route details" onClick={onClose}>×</button>
      </div>
      <ol className="rps-steps">
        {shown.slice(0, 30).map((r, k) => <li key={k}>{r.name}<small>{r.km.toFixed(1)} km</small></li>)}
        {shown.length > 30 && <li>… {shown.length - 30} more streets<small>to the destination</small></li>}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- legend, inspector, data panel

function Legend({ plan, win, pr, layers, state }: { plan: Plan | null; win: string | null; pr: string; layers: SimpleLayers; state: ReturnType<NonNullable<ReturnType<typeof useStreetSim>["live"]>["state"]> | null }) {
  let wet = 0, closed = 0, deepest = 0;
  if (state) for (const i of state.listed) { if (state.depth[i] >= 8) wet++; if (state.status[i] >= 3) closed++; deepest = Math.max(deepest, state.depth[i]); }
  return (
    <>
      {plan && plan.routes.length > 0 && (
        <div className="rps-lg"><div className="rps-lg-t">Routes</div>
          {plan.routes.map((r) => <div key={r.key} className="rps-lg-i"><i style={{ background: r.color }} />Route {r.letter}{r.key === win ? ` — best for ${pr}` : ""}</div>)}
          {win && <div className="rps-lg-i"><i style={{ background: "#ffc933", boxShadow: "0 0 8px 1px #ffc933" }} />Best route: warm glow</div>}
        </div>
      )}
      <div className="rps-lg"><div className="rps-lg-t">Markers</div>
        <div className="rps-lg-i"><i className="pt" style={{ background: "#ff8a3d" }} />Start (A)</div>
        <div className="rps-lg-i"><i className="pt" style={{ background: "#ff4f7b" }} />Destination (B)</div>
      </div>
      <div className="rps-lg"><div className="rps-lg-t">Simulated conditions</div>
        {layers.depth && <div className="rps-lg-i"><i style={{ background: "linear-gradient(90deg,rgb(34,211,238),rgb(37,99,235))" }} />{wet ? `Water over 8 cm on ${wet.toLocaleString("en-IN")} streets, deepest ${deepest} cm` : "No street has water over 8 cm"}</div>}
        {layers.closures && <div className="rps-lg-i"><i style={{ background: "repeating-linear-gradient(90deg,#ef4444 0 5px,transparent 5px 8px)" }} />{closed ? `Closed: ${closed.toLocaleString("en-IN")} streets` : "No street closed"}</div>}
        {layers.roads && <div className="rps-lg-i"><i style={{ background: "#9aa3b2" }} />Streets (OpenStreetMap)</div>}
      </div>
    </>
  );
}

function Inspect({ streets, i, state, onClose }: { streets: Streets; i: number | null; state: { status: Uint8Array; depth: Uint8Array; p: Uint8Array } | null; onClose: () => void }) {
  const body = i === null ? <p>Tap any street on the map to see its details.</p>
    : i < 0 ? <p>No street within a few metres of that point. Zoom in and tap closer to a street line.</p>
    : (() => {
      const p = state?.p[i] ?? 255, cls = streets.meta.classes[streets.cls[i]];
      const rows: [string, string][] = [
        ["Street", streetName(streets, i) ?? "Unnamed street"], ["Road type", cls[0].toUpperCase() + cls.slice(1)],
        ["Length", `${(streets.lengthDm[i] / 10).toFixed(0)} m`],
        ["Condition now", state ? STATUS[Math.min(state.status[i], 4)] : "–"], ["Standing water", state ? `${state.depth[i]} cm` : "–"],
        ["Closure chance +3 h", p === 255 ? "No estimate" : `${p} % (${bandOf(p).replace("_", " ")})`],
        ["Low-lying proxy", lowLyingLabel(streets.low[i])],
      ];
      return <><div className="rps-kvs">{rows.map(([k, v]) => <div key={k} className="rps-kv"><small>{k}</small><span>{v}</span></div>)}</div>
        <p className="rps-note">Street name and shape are real (OpenStreetMap). Water, condition and closure chance are simulated.</p></>;
    })();
  return (
    <section className="rps-float rps-inspect" aria-label="Street inspector" data-testid="simple-inspect">
      <div className="row"><b>Inspect a street</b><span className="grow" /><button type="button" className="rps-x" aria-label="Close inspector" onClick={onClose}>×</button></div>
      {body}
    </section>
  );
}

function About({ streets }: { streets: Streets }) {
  return (
    <div className="rps-about">
      <h4>Real</h4>
      <ul><li>{streets.meta.count.toLocaleString("en-IN")} Chennai street lines and names ({streets.meta.attribution}).</li><li>Place search: OpenStreetMap Nominatim, only when you press Enter.</li></ul>
      <h4>Simulated</h4>
      <ul><li>Rain, standing water, closures and the 3-hour closure chance come from a synthetic storm simulation. Not observed, not a forecast, not safety guidance.</li>
        <li>Vehicle limits are illustrative: car avoids water ≥ 20 cm, motorcycle ≥ 12 cm, bus ≥ 30 cm and keeps to main roads.</li>
        <li>Travel times use typical free-flow speeds slowed by simulated water. No live traffic.</li></ul>
      <h4>Limits</h4>
      <ul><li>Coverage: central Chennai only.</li><li>Points snap to the nearest connected street; some small lanes are not routable.</li></ul>
    </div>
  );
}
