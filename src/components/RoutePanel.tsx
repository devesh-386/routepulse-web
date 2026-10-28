"use client";

import type { Manifest, RoutesFile, ScenarioData } from "@/lib/bundle";
import { hourLabel } from "@/lib/bundle";
import { compareRoutes, hm, type RouteRow } from "@/lib/routes";
import { RISK_COLOR } from "@/lib/style";

interface Props {
  manifest: Manifest;
  routes: RoutesFile;
  data: ScenarioData | null;
  hour: number;
  odId: string;
  setOdId: (id: string) => void;
  focused: string | null;
  setFocused: (id: string | null) => void;
}

const RISK_FORMULA = "34 × closed segments/3 + 28 × max water depth/55 cm + 22 × mean volume-to-capacity/1.4 + 16 × 24 h rain/140 mm, each capped, 0–100";

export default function RoutePanel({ manifest, routes, data, hour, odId, setOdId, focused, setFocused }: Props) {
  const cmp = data ? compareRoutes(routes, data, odId, hour) : null;
  return (
    <section className="routes" aria-labelledby="routes-h">
      <div className="routes-head">
        <h3 id="routes-h">Compare routes</h3>
        <label className="field">
          <span className="small muted">Origin to destination</span>
          <select value={odId} onChange={(e) => { setOdId(e.target.value); setFocused(null); }}>
            {routes.od_pairs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      </div>
      {!cmp ? <p className="muted small">Loading…</p> : (
        <>
          <p className="muted small">
            Simulated conditions as assessed at {hourLabel(manifest, cmp.assessedHour)} (routes are assessed every 3 h).
          </p>
          <p className="reason" data-testid="reason">
            {cmp.rows.some((r) => r.recommended)
              ? <><strong>Best-performing route in this scenario:</strong> {cmp.reason}</>
              : <strong>{cmp.reason}</strong>}
          </p>
          <ul className="cards">
            {cmp.rows.map((r) => (
              <li key={r.routeId}>
                <RouteCard row={r} focused={focused === r.routeId}
                           onFocus={() => setFocused(r.routeId)}
                           onToggle={() => setFocused(focused === r.routeId ? null : r.routeId)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function RouteCard({ row: r, focused, onFocus, onToggle }: {
  row: RouteRow; focused: boolean; onFocus: () => void; onToggle: () => void;
}) {
  return (
    <button type="button" className={`card ${focused ? "focused" : ""} ${r.recommended ? "best" : ""}`}
            aria-pressed={focused} onMouseEnter={onFocus} onFocus={onFocus} onClick={onToggle}
            data-route={r.routeId} data-status={r.status} data-eta={r.etaMin ?? ""} data-delay={r.delayMin ?? ""}
            data-risk={r.riskScore} data-band={r.riskBand} data-closed={r.segmentsClosed}
            data-recommended={r.recommended}>
      <div className="card-top">
        <span className="route-id">{r.routeId}</span>
        <span className="muted small">{r.rank === 1 ? "Shortest" : `Alternative ${r.rank}`} · {r.lengthKm} km</span>
        {r.recommended && <span className="pill best-pill">Best in this scenario</span>}
        <span className={`pill ${r.status === "blocked" ? "pill-bad" : "pill-ok"}`}>
          {r.status === "blocked" ? `Blocked · ${r.segmentsClosed} closed` : "Passable"}
        </span>
      </div>
      <dl className="metrics">
        <div><dt>Simulated ETA</dt>
          <dd>{r.etaMin === null ? "—" : <>{r.etaMin} min <span className="muted small">({hm(r.etaMin)})</span></>}</dd></div>
        <div><dt>Simulated delay vs free-flow</dt>
          <dd>{r.delayMin === null ? "—" : `${r.delayMin} min`} <span className="muted small">(free-flow {r.freeFlowEtaMin} min)</span></dd></div>
        <div><dt>Simulated route-risk category <abbr title={RISK_FORMULA} aria-label={`Formula: ${RISK_FORMULA}`}>ⓘ</abbr></dt>
          <dd><span className="risk-dot" style={{ background: RISK_COLOR[r.riskBand] }} />{r.riskBand} ({r.riskScore})</dd></div>
        <div><dt>Worst standing water</dt><dd>{r.maxDepthCm} cm</dd></div>
      </dl>
    </button>
  );
}
