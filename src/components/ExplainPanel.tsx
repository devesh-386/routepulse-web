"use client";

import { useEffect, useRef, useState } from "react";
import type { ExplainResponse } from "@/lib/explain/explain";
import type { Audience, Evidence, Kind } from "@/lib/explain/evidence";

const KIND_CHIP: Record<Kind, { label: string; cls: string }> = {
  observed_sim: { label: "Simulation state", cls: "chip-sim" },
  derived: { label: "Derived from simulation", cls: "chip-derived" },
  model_output: { label: "Model output", cls: "chip-model" },
};

interface Props {
  scenario: string;
  hour: number;
  od: string;
  audience: Audience;
  runToken?: number;   // changes when something (the story) asks for a fresh explanation
}

type Key = string;
const keyOf = (p: Props): Key => `${p.scenario}|${p.hour}|${p.od}|${p.audience}`;

export default function ExplainPanel(props: Props) {
  const [res, setRes] = useState<{ key: Key; body: ExplainResponse } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stale = res && res.key !== keyOf(props);

  async function run() {
    setBusy(true);
    setError(null);
    const key = keyOf(props);
    try {
      const r = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario: props.scenario, hour: props.hour, od: props.od, audience: props.audience }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setRes({ key, body });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // run on request from outside; deferred so no state is set synchronously inside the effect
  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; });
  useEffect(() => {
    if (!props.runToken) return;
    const t = setTimeout(() => runRef.current(), 0);
    return () => clearTimeout(t);
  }, [props.runToken]);

  const b = res?.body;
  return (
    <section className="explain" aria-labelledby="explain-h" aria-busy={busy}>
      <div className="explain-head">
        <h3 id="explain-h">Explain the evidence</h3>
        <button type="button" className="btn" onClick={run} disabled={busy}>
          {busy ? "Explaining…" : b && !stale ? "Explain again" : "Explain"}
        </button>
      </div>
      {error && <p className="error small" role="alert">Could not get an explanation: {error}</p>}
      {stale && <p className="muted small">The hour, route pair or view changed since this explanation. Press Explain to update it.</p>}
      {b && (
        <div className={stale ? "is-stale" : ""} data-testid="explanation" data-source={b.source} data-validated={b.validated}>
          <div className="explain-meta small">
            {b.validated
              ? <span className="pill pill-ok">Validated ✓</span>
              : <span className="pill pill-bad">Not validated</span>}
            <span className="muted">
              {b.source === "llm" ? "Written by an AI model, checked against the evidence" : "Template answer written directly from the evidence"}
              {" "}· assessed at {b.timeLabel}
            </span>
          </div>
          {b.fallbackReason && <p className="muted small">{b.fallbackReason}</p>}
          <ol className="sentences">
            {b.sentences.map((s, i) => (
              <li key={i}>
                <p>{s.text}</p>
                <div className="chips">
                  <span className={`chip ${KIND_CHIP[s.kind].cls}`}>{KIND_CHIP[s.kind].label}</span>
                  {s.ai && <span className="chip chip-ai">AI interpretation</span>}
                  <EvidenceList ids={s.evidence_ids} evidence={b.evidence} />
                </div>
                {!s.ok && <p className="error small">Failed checks: {s.errors.join("; ")}</p>}
              </li>
            ))}
          </ol>
          <p className="muted small">{b.disclaimer}</p>
        </div>
      )}
    </section>
  );
}

function EvidenceList({ ids, evidence }: { ids: string[]; evidence: Record<string, Evidence> }) {
  return (
    <details className="evidence">
      <summary>Evidence ({ids.length})</summary>
      <dl>
        {ids.map((id) => {
          const e = evidence[id];
          if (!e) return null;
          const unit = ["min", "cm", "mm", "km", "%"].includes(e.unit) ? ` ${e.unit}` : "";
          return (
            <div key={id}>
              <dt>{e.label}</dt>
              <dd>{e.value === null ? "none" : `${e.value}${unit}`} <code className="muted">{id}</code></dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}
