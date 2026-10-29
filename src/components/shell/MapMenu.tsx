"use client";

// Map dropdown shared by Max and Simple: one open at a time (the page owns which), Escape or a click outside
// closes it and returns focus to its button. Each mode passes its own class names for its look.

import { useEffect, useRef, type ReactNode } from "react";
import Icon, { type IconName } from "../street/Icons";

export interface MenuClasses { wrap: string; btn: string; panel: string; chev: string }
const MAX: MenuClasses = { wrap: "sv-menu", btn: "sv-tool", panel: "sv-menu-panel", chev: "sv-chev" };

export default function MapMenu({ id, label, icon, open, setOpen, children, cls = MAX }: {
  id: string; label: string; icon: IconName; open: boolean; setOpen: (o: boolean) => void; children: ReactNode; cls?: MenuClasses;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); box.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open, setOpen]);
  return (
    <div className={cls.wrap} ref={box}>
      <button type="button" className={`${cls.btn} ${open ? "on" : ""}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Icon name={icon} size={15} />{label}<Icon name="chevron" size={13} className={cls.chev} />
      </button>
      <div id={id} className={cls.panel} role="group" aria-label={label} hidden={!open}>{children}</div>
    </div>
  );
}
