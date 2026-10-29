"use client";

// The left rail every mode shares (layout from the RoutePulse v2.0 simple planner): logo home, the three
// modes, then any tools the page adds, and the light/dark switch every mode shares. Below 900 px it becomes a top bar.

import type { ReactNode } from "react";
import { setTheme, useDark } from "@/lib/useDark";
import Icon, { type IconName } from "../street/Icons";
import { TransitionLink as Link } from "./RouteTransition";
import "./shell.css";

export type Mode = "simple" | "max" | "control";

const MODES: { id: Mode; href: string; label: string; icon: IconName; who: string }[] = [
  { id: "simple", href: "/simple", label: "Simple", icon: "map", who: "Plan a trip in a few taps" },
  { id: "max", href: "/max", label: "Max", icon: "cube", who: "Every street, 3D and drive mode" },
  { id: "control", href: "/control-room", label: "Control", icon: "monitor", who: "Control room for operators" },
];

export default function ModeRail({ mode, children }: { mode: Mode; children?: ReactNode }) {
  const dark = useDark();
  return (
    <nav className={`rp-rail rp-rail-${dark ? "dark" : "light"}`} aria-label="Modes and tools">
      <Link href="/" className="rp-logo" title="RoutePulse home" aria-label="RoutePulse home">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12h4l2-5 4 10 2-5h4" />
        </svg>
      </Link>
      <div className="rp-rail-modes" role="list">
        {MODES.map((m) => (
          <Link key={m.id} href={m.href} role="listitem" className={`rp-tool ${m.id === mode ? "on" : ""}`}
                aria-current={m.id === mode ? "page" : undefined} title={`${m.label === "Control" ? "Control room" : m.label} mode: ${m.who}`}>
            <Icon name={m.icon} size={20} /><small>{m.label}</small>
          </Link>
        ))}
      </div>
      <button type="button" className="rp-tool rp-theme" onClick={() => setTheme(dark ? "light" : "dark")}
              title={dark ? "Switch to light mode" : "Switch to dark mode"} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
        <Icon name={dark ? "sun" : "moon"} size={20} /><small>{dark ? "Light" : "Dark"}</small>
      </button>
      {children && <><span className="rp-rail-sep" aria-hidden="true" />{children}</>}
    </nav>
  );
}

export function RailTool({ icon, label, title, pressed, onClick }: {
  icon: IconName; label: string; title: string; pressed?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" className={`rp-tool ${pressed ? "on" : ""}`} aria-pressed={pressed} title={title} onClick={onClick}>
      <Icon name={icon} size={20} /><small>{label}</small>
    </button>
  );
}
