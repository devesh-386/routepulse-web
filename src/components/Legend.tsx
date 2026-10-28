"use client";

import type { Manifest } from "@/lib/bundle";
import { hourLabel } from "@/lib/bundle";
import { FORECAST_STOPS, STATUS_LABEL, statusColors } from "@/lib/style";
import { useDark } from "@/lib/useDark";
import type { MapMode } from "./MapView";

export default function Legend({ manifest, mode, hour }: { manifest: Manifest; mode: MapMode; hour: number }) {
  const palette = statusColors(useDark());
  if (mode === "now") {
    return (
      <div className="legend" aria-label="Map legend">
        <div className="legend-title">Simulated road status</div>
        <ul>
          {STATUS_LABEL.map((l, i) => (
            <li key={l}><span className="swatch" style={{ background: palette[i] }} />{l}</li>
          ))}
          <li><span className="swatch rain" />Simulated rain (darker = heavier)</li>
          <li><span className="swatch storm" />Simulated storm centre and track</li>
        </ul>
      </div>
    );
  }
  const f = manifest.forecast;
  const target = Math.min(hour + 3, manifest.hours - 1);
  return (
    <div className="legend" aria-label="Map legend">
      <div className="legend-title">Simulated closure probability · at +3 h</div>
      <div className="small">
        From <strong>{hourLabel(manifest, hour)}</strong> to <strong>{hourLabel(manifest, target)}</strong>
      </div>
      <div className="ramp" style={{
        background: `linear-gradient(to right, ${FORECAST_STOPS.map(([p, c]) => `${c} ${p}%`).join(", ")}, ${FORECAST_STOPS.at(-1)![1]} 100%)`,
      }} />
      <div className="ramp-labels small"><span>0 %</span><span>50 %</span><span>100 %</span></div>
      <ul><li><span className="swatch" style={{ background: "#8a8f98" }} />No forecast (first 24 h, last 3 h)</li></ul>
      <details className="explain-forecast">
        <summary>What this number means</summary>
        <p>{f.meaning}.</p>
        <p>Inputs: {f.inputs}.</p>
        <p>
          Checked on {f.evaluated_on}: Brier score {f.held_out_brier} (assuming nothing changes scores{" "}
          {f.held_out_persistence_brier}), predicted probabilities within {f.max_calibration_gap_pct} points
          of the observed share in every bin.
        </p>
        <p><strong>It describes the simulator, not real roads.</strong> It is not a real-world closure probability.</p>
      </details>
    </div>
  );
}
