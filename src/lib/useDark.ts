"use client";

import { useSyncExternalStore } from "react";

// One light/dark choice for every mode. The rail's toggle stores it; until then the OS colour scheme decides.
// An inline script in layout.tsx sets <html data-theme> before first paint, so CSS never flashes the wrong theme.

const QUERY = "(prefers-color-scheme: dark)";
const KEY = "rp-theme";
const EVENT = "rp-theme";

export type Theme = "light" | "dark";

/** Inline-script source: runs before paint, mirrors `current()`. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("${QUERY}").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}`;

function stored(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch { return null; }
}

function current(): Theme {
  return stored() ?? (window.matchMedia(QUERY).matches ? "dark" : "light");
}

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { mq.removeEventListener("change", cb); window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
}

export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* private window: this page only */ }
  document.documentElement.dataset.theme = t;
  window.dispatchEvent(new Event(EVENT));
}

/** True when the app is in dark mode; dark during server rendering (the inline script corrects it before paint). */
export function useDark() {
  return useSyncExternalStore(subscribe, () => current() === "dark", () => true);
}
