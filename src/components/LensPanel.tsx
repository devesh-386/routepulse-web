"use client";

import type { Manifest, Network, RoutesFile, ScenarioData, Vulnerability } from "@/lib/bundle";
import { hourLabel } from "@/lib/bundle";
import type { Audience } from "@/lib/explain/evidence";
import { compareRoutes, hm } from "@/lib/routes";

interface Props {
  audience: Audience;
  manifest: Manifest;
  network: Network;
  routes: RoutesFile;
  vulnerability: Vulnerability;
  data: ScenarioData | null;
  hour: number;
  odId: string;
  focusedSegment: string | null;
  setFocusedSegment: (id: string | null) => void;
}

export default function LensPanel(p: Props) {
  if (!p.data) return null;
  if (p.audience === "commuter") return <CommuterLens {...p} data={p.data} />;
  if (p.audience === "bus_operator") return <OperatorLens {...p} data={p.data} />;
  return <PlannerLens {...p} data={p.data} />;
}

type WithData = Props & { data: ScenarioData };

function CommuterLens({ manifest, routes, data, hour, odId }: WithData) {
  const cmp = compareRoutes(routes, data, odId, hour);
  const best = cmp.rows.find((r) => r.recommended);
  if (best) {
    return (
      <section className="lens go" aria-label="Commuter summary" data-testid="lens" data-verdict="go">
        <div className="verdict">Go · {best.routeId}</div>
        <p className="small">
          Simulated ETA {best.etaMin} min ({hm(best.etaMin!)}), simulated delay {best.delayMin} min vs free-flow.
          Best-performing route in this scenario at {hourLabel(manifest, cmp.assessedHour)}.
        </p>
      </section>
    );
  }
  // when does any route for this pair next become passable?
  const a = data.assessments;
  const from = data.assessmentIndex(hour);
  const od = routes.od_pairs.find((o) => o.id === odId)!;
  const next = a.hours.findIndex((_, i) => i > from && od.routes.some((r) => a.routes[r].recommended[i]));
  return (
    <section className="lens nogo" aria-label="Commuter summary" data-testid="lens" data-verdict="no-go">
      <div className="verdict">No-go · every route blocked</div>
      <p className="small">
        {next >= 0
          ? <>In this simulation the first route reopens by {hourLabel(manifest, a.hours[next])} (next 3-hourly assessment with a passable route).</>
          : "In this simulation no route for this pair reopens before the end of the scenario."}
      </p>
    </section>
  );
}

const OUTCOME_LABEL: Record<string, string> = {
  completed: "completed", diverted: "diverted", cancelled: "cancelled", terminated_short: "turned back",
};

function OperatorLens({ manifest, routes, data, hour, odId }: WithData) {
  const od = routes.od_pairs.find((o) => o.id === odId)!;
  const services = routes.bus_services.map((s, ix) => ({ ...s, ix })).filter((s) => od.routes.includes(s.road_route));
  const assessed = data.assessments.hours[data.assessmentIndex(hour)];
  const windows: [string, number, number][] = [
    [`${hourLabel(manifest, assessed)} + 3 h`, assessed, assessed + 3],
    ["Next 12 h", hour, hour + 12],
  ];
  const tally = (ix: number, from: number, to: number) => {
    const t: Record<string, number> = { departures: 0, completed: 0, diverted: 0, cancelled: 0, terminated_short: 0 };
    for (const trip of data.bus.trips) {
      if (trip[0] !== ix || trip[1] < from || trip[1] >= to) continue;
      t.departures++;
      t[data.bus.outcomes[trip[2]]]++;
    }
    return t;
  };
  return (
    <section className="lens" aria-label="Simulated service disruption" data-testid="lens">
      <h3>Simulated service disruption</h3>
      {!services.length && <p className="small muted">No simulated bus service runs on {od.label}.</p>}
      {services.map((s) => (
        <div key={s.id} className="service">
          <div className="small"><strong>{s.id}</strong> · {s.operator} · {s.class.replace("_", " ")} · runs on {s.road_route}</div>
          <table className="tally small">
            <thead><tr><th scope="col">Window</th><th scope="col">Departures</th>
              {Object.values(OUTCOME_LABEL).map((l) => <th key={l} scope="col">{l}</th>)}</tr></thead>
            <tbody>
              {windows.map(([label, from, to]) => {
                const t = tally(s.ix, from, to);
                return (
                  <tr key={label} data-service={s.id} data-from={from} data-to={to}
                      data-departures={t.departures} data-cancelled={t.cancelled}>
                    <th scope="row">{label}</th><td>{t.departures}</td>
                    {Object.keys(OUTCOME_LABEL).map((o) => <td key={o} className={t[o] && o !== "completed" ? "bad" : ""}>{t[o]}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <p className="muted small">Trips from the shared simulated timetable; outcomes are simulated for this scenario.</p>
    </section>
  );
}

function PlannerLens({ manifest, network, vulnerability, data, hour, focusedSegment, setFocusedSegment }: WithData) {
  const closedMin = manifest.closed_min_code;
  let peak = 0, peakH = 0, total = 0;
  for (let h = 0; h < manifest.hours; h++) {
    const n = data.closedCount(h, closedMin);
    total += n;
    if (n > peak) { peak = n; peakH = h; }
  }
  const share = (100 * total) / (manifest.hours * manifest.segments);
  const name = (id: string) => {
    const s = network.segments.find((x) => x.id === id)!;
    const n = (nid: string) => network.nodes.find((x) => x.id === nid)!.name;
    return `${n(s.from)} – ${n(s.to)}`;
  };
  const m = vulnerability.method;
  return (
    <section className="lens" aria-label="Planner view" data-testid="lens">
      <h3>This scenario</h3>
      <dl className="stats small">
        <div><dt>Closed now</dt><dd data-testid="closed-now">{data.closedCount(hour, closedMin)} of {manifest.segments}</dd></div>
        <div><dt>Peak closures</dt><dd data-testid="peak">{peak} at {hourLabel(manifest, peakH)}</dd></div>
        <div><dt>Segment-hours closed</dt><dd data-testid="share">{share.toFixed(2)} %</dd></div>
      </dl>
      <h3>Relative vulnerability under the sampled scenario mix</h3>
      <ol className="vuln small">
        {vulnerability.segments.slice(0, 8).map((v) => (
          <li key={v.segment_id}>
            <button type="button" className={`vuln-row ${focusedSegment === v.segment_id ? "on" : ""}`}
                    aria-pressed={focusedSegment === v.segment_id}
                    onClick={() => setFocusedSegment(focusedSegment === v.segment_id ? null : v.segment_id)}>
              <span>{v.segment_id} · {v.ref} · {name(v.segment_id)}{v.underpass ? " · underpass" : ""}</span>
              <span className="num">{v.worlds_with_closure_pct.toFixed(1)} %</span>
            </button>
          </li>
        ))}
      </ol>
      <details className="method small">
        <summary>How this is computed</summary>
        <p>Score: {m.score}, across {m.worlds.toLocaleString("en-IN")} simulated worlds of {m.hours_per_world} h each.</p>
        <p>Varied in each world:</p>
        <ul>{m.varied_per_world.map((x) => <li key={x}>{x}</li>)}</ul>
        <p><strong>{m.caveat}</strong></p>
      </details>
    </section>
  );
}
