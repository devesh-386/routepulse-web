"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import type { Manifest, ScenarioData } from "@/lib/bundle";
import { hourLabel } from "@/lib/bundle";

interface Props {
  manifest: Manifest;
  data: ScenarioData | null;
  series?: number[] | null;   // closures per hour, when the caller counts something other than corridors
  seriesLabel?: string;
  hour: number;
  setHour: (h: number | ((h: number) => number)) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  speed: 1 | 4;
  setSpeed: (s: 1 | 4) => void;
}

const HOURS_PER_SEC = 2; // at 1×

export default function Scrubber({ manifest, data, series, seriesLabel = "segments", hour, setHour, playing, setPlaying, speed, setSpeed }: Props) {
  const last = manifest.hours - 1;
  // unique per slider: Max and the control room can both be in the page (Next keeps visited pages hidden)
  const sliderId = useId();

  // playback: advance on a timer; stops at the end rather than looping
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    let prev = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      acc += ((now - prev) / 1000) * HOURS_PER_SEC * speed;
      prev = now;
      if (acc >= 1) {
        const step = Math.floor(acc);
        acc -= step;
        setHour((h) => {
          const n = Math.min(h + step, last);
          if (n === last) setPlaying(false);
          return n;
        });
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, speed, last, setHour, setPlaying]);

  const closed = useMemo(() => {
    if (series) return series;
    if (!data) return null;
    return Array.from({ length: manifest.hours }, (_, h) => data.closedCount(h, manifest.closed_min_code));
  }, [data, manifest, series]);
  const peak = closed ? Math.max(...closed) : 0;
  const max = Math.max(1, peak);
  const W = 1000, H = 36;
  const path = closed
    ? closed.map((v, h) => `${h === 0 ? "M" : "L"}${(h / last) * W},${H - (v / max) * (H - 2)}`).join("")
    : "";
  const peakHour = closed ? closed.indexOf(peak) : -1;

  return (
    <div className="scrubber">
      <div className="scrubber-row">
        <button type="button" className="btn" onClick={() => {
          if (!playing && hour >= last) setHour(0);
          setPlaying(!playing);
        }} aria-pressed={playing}>
          {playing ? "Pause" : "Play"}
        </button>
        <div className="seg" role="group" aria-label="Playback speed">
          {([1, 4] as const).map((s) => (
            <button key={s} type="button" className={`seg-btn ${speed === s ? "on" : ""}`}
                    aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>
          ))}
        </div>
        <output className="time" htmlFor={sliderId} aria-live="off">
          <strong>{hourLabel(manifest, hour)}</strong>
          <span className="muted"> · hour {hour} of {last}</span>
        </output>
        {closed && (
          <span className="muted small">
            {closed[hour]} {closed[hour] === 1 ? seriesLabel.replace(/s$/, "") : seriesLabel} closed now
          </span>
        )}
      </div>
      <div className="track">
        {closed && (
          <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={`${path}L${W},${H}L0,${H}Z`} className="spark-fill" />
            <path d={path} className="spark-line" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        <input id={sliderId} data-testid="hour" type="range" min={0} max={last} step={1} value={hour}
               onChange={(e) => { setPlaying(false); setHour(Number(e.target.value)); }}
               aria-label="Simulated hour"
               aria-valuetext={`${hourLabel(manifest, hour)}${closed ? `, ${closed[hour]} ${seriesLabel} closed` : ""}`} />
      </div>
      {closed && (
        <div className="scrubber-foot muted small">
          {peak > 0 ? (
            <>
              Line above the slider: {seriesLabel} closed each hour (peak {peak} at{" "}
              <button type="button" className="linklike" onClick={() => { setPlaying(false); setHour(peakHour); }}>
                {hourLabel(manifest, peakHour)}
              </button>)
            </>
          ) : `No ${seriesLabel.replace(/s$/, "")} closes at any hour in this scenario.`}
        </div>
      )}
    </div>
  );
}
