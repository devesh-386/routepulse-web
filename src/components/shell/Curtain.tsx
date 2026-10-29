"use client";

// Adapted from Animmaster: Hero Animations/5 (Awesome Preloader)
// A full-screen curtain over a mode while its street data loads. When the data is ready it lifts, its curved
// bottom edge flattening as it goes. It lifts on the real load, never on a timer, and skips the motion (a short
// fade) when the system asks for reduced motion. Already-loaded data never shows it.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MOTION_ON } from "./RouteTransition";
import "./transition.css";

const LIFT = { duration: 800, easing: "cubic-bezier(0.76, 0, 0.24, 1)" };
const SAG = 300;

export default function Curtain({ ready, bg, fg, children }: { ready: boolean; bg: string; fg: string; children: ReactNode }) {
  const [gone, setGone] = useState(ready);
  const el = useRef<HTMLDivElement>(null);
  const edge = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!MOTION_ON || !ready || gone || !el.current) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.current.setAttribute("data-lift", "");
    const anim = still
      ? el.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" })
      : el.current.animate([{ transform: "translateY(0)" }, { transform: "translateY(-100vh)" }], { ...LIFT, delay: 200, fill: "forwards" });
    let raf = 0;
    const t0 = performance.now() + 300;
    const flatten = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - t0) / 700));
      const e = k < 0.5 ? 8 * k ** 4 : 1 - (-2 * k + 2) ** 4 / 2; // power4.inOut
      edge.current?.setAttribute("d", `M0 0 L100 0 Q50 ${SAG * (1 - e)} 0 0 Z`);
      if (k < 1) raf = requestAnimationFrame(flatten);
    };
    if (!still) raf = requestAnimationFrame(flatten);
    void anim.finished.then(() => setGone(true), () => {});
    return () => { cancelAnimationFrame(raf); anim.cancel(); };
  }, [ready, gone]);

  if (gone || (ready && !MOTION_ON)) return null;
  return (
    <div ref={el} className="rp-curtain" style={{ "--curtain-bg": bg, "--curtain-fg": fg } as CSSProperties}
         aria-busy={!ready} role="status">
      <div className="rp-curtain-body">{children}</div>
      <svg className="rp-curtain-edge" viewBox={`0 0 100 ${SAG}`} preserveAspectRatio="none" aria-hidden="true">
        <path ref={edge} d={`M0 0 L100 0 Q50 ${SAG} 0 0 Z`} />
      </svg>
    </div>
  );
}
