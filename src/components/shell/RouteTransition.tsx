"use client";

// Adapted from Animmaster: Page Transitions/5 (SVG Stroke Page Transition)
// Moving between modes, two thick road strokes draw across the screen, widen until they cover it, then draw
// off the far side once the next page is in. The second stroke runs the risk scale (low → severe). Ported from
// GSAP to the Web Animations API; reduced motion skips it.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import "./transition.css";

const PATHS = [
  "M227.549 1818.76C227.549 1818.76 406.016 2207.75 569.049 2130.26C843.431 1999.85 -264.104 1002.3 227.549 876.262C552.918 792.849 773.647 2456.11 1342.05 2130.26C1885.43 1818.76 14.9644 455.772 760.548 137.262C1342.05 -111.152 1663.5 2266.35 2209.55 1972.76C2755.6 1679.18 1536.63 384.467 1826.55 137.262C2013.5 -22.1463 2209.55 381.262 2209.55 381.262",
  "M1661.28 2255.51C1661.28 2255.51 2311.09 1960.37 2111.78 1817.01C1944.47 1696.67 718.456 2870.17 499.781 2255.51C308.969 1719.17 2457.51 1613.83 2111.78 963.512C1766.05 313.198 427.949 2195.17 132.281 1455.51C-155.219 736.292 2014.78 891.514 1708.78 252.012C1437.81 -314.29 369.471 909.169 132.281 566.512C18.1772 401.672 244.781 193.012 244.781 193.012",
];
const RISK_COLOR = { low: "#5b8c5a", moderate: "#e0b100", high: "#f07c1d", severe: "#d6293b" };
const TIMING = { duration: 700, easing: "cubic-bezier(0.45, 0, 0.55, 1)", fill: "forwards" } as const;
const NAV_TIMEOUT_MS = 6000;
/** Off for now (2026-10-28, at Devesh's request): links navigate instantly and loading screens vanish without the lift. */
export const MOTION_ON = false;

type Go = (href: string) => boolean;
const Ctx = createContext<Go>(() => false);

export function RouteTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const svg = useRef<SVGSVGElement>(null);
  const busy = useRef(false);
  const covered = useRef(false);
  const timer = useRef<number>(0);

  const strokes = () => [...(svg.current?.querySelectorAll("path") ?? [])];

  const enter = useCallback(() => {
    if (!covered.current) return;
    covered.current = false;
    window.clearTimeout(timer.current);
    const runs = strokes().map((p) => {
      const len = p.getTotalLength();
      return p.animate([{ strokeDashoffset: 0, strokeWidth: 700 }, { strokeDashoffset: -len, strokeWidth: 200 }], TIMING).finished;
    });
    void Promise.all(runs).then(() => {
      for (const p of strokes()) p.getAnimations().forEach((a) => a.cancel());
      svg.current?.parentElement?.removeAttribute("data-on");
      busy.current = false;
    });
  }, []);

  const go = useCallback<Go>((href) => {
    if (!MOTION_ON || busy.current || href === window.location.pathname) return false;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    busy.current = true;
    svg.current?.parentElement?.setAttribute("data-on", "");
    const runs = strokes().map((p) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len}`;
      return p.animate([{ strokeDashoffset: len, strokeWidth: 200 }, { strokeDashoffset: 0, strokeWidth: 700 }], TIMING).finished;
    });
    void Promise.all(runs).then(() => {
      covered.current = true;
      router.push(href);
      // If the route never changes (failed navigation), uncover anyway rather than leave the screen painted over.
      timer.current = window.setTimeout(enter, NAV_TIMEOUT_MS);
    });
    return true;
  }, [router, enter]);

  useEffect(() => { enter(); }, [pathname, enter]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <Ctx.Provider value={go}>
      {children}
      <div className="rp-transition" aria-hidden="true">
        <svg ref={svg} viewBox="0 0 2453 2535" fill="none" preserveAspectRatio="none">
          <defs>
            <linearGradient id="rp-transition-risk" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={RISK_COLOR.low} />
              <stop offset="0.4" stopColor={RISK_COLOR.moderate} />
              <stop offset="0.7" stopColor={RISK_COLOR.high} />
              <stop offset="1" stopColor={RISK_COLOR.severe} />
            </linearGradient>
          </defs>
          <path d={PATHS[0]} stroke="#091420" strokeWidth={200} strokeLinecap="round" />
          <path d={PATHS[1]} stroke="url(#rp-transition-risk)" strokeWidth={200} strokeLinecap="round" />
        </svg>
      </div>
    </Ctx.Provider>
  );
}

/** A next/link that plays the stroke transition before a client-side navigation. */
export function TransitionLink({ href, onNavigate, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const go = useContext(Ctx);
  return (
    <Link href={href} {...rest} onNavigate={(e) => {
      onNavigate?.(e);
      if (go(href)) e.preventDefault();
    }} />
  );
}
