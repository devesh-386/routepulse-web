// One small icon set, one stroke weight, so nothing looks borrowed from three libraries.
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const icons = {
  logo: <><path d="M3 15c3 0 3.5-7 7-7s3.5 9 7 9c2 0 3-3 4-4.5" /><path d="M3 20c3 0 4-6 7-6s4 6 7 6c1.4 0 2.6-1.5 3.6-3" opacity=".55" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  drop: <path d="M12 3.5c3 4 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 3-6.5 6-10.5Z" />,
  rain: <><path d="M7 15a4 4 0 1 1 .8-7.9A5.5 5.5 0 0 1 18.5 9 3.5 3.5 0 0 1 17.5 16H7" /><path d="m9 19-1 2M13 19l-1 2M17 19l-1 2" /></>,
  waves: <><path d="M3 9c2 0 2-2 4.5-2S10 9 12 9s2-2 4.5-2S19 9 21 9" /><path d="M3 15c2 0 2-2 4.5-2S10 15 12 15s2-2 4.5-2S19 15 21 15" /></>,
  block: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12h7" /></>,
  route: <><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="6" r="2.2" /><path d="M8 18h6a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h6" /></>,
  swap: <><path d="M7 4v16M7 4 4 7M7 4l3 3" /><path d="M17 20V4M17 20l-3-3M17 20l3-3" /></>,
  pin: <><path d="M12 21s7-6 7-11.5A7 7 0 0 0 5 9.5C5 15 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.4" /></>,
  alert: <><path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" /><path d="M12 10v4M12 17.5v.01" /></>,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  flask: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" /><path d="M7.5 15h9" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  terrain: <path d="m3 19 6-9 4 6 3-4 5 7H3Z" />,
  locate: <><circle cx="12" cy="12" r="3.2" /><circle cx="12" cy="12" r="7.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22" /></>,
  bridge: <><path d="M3 9h18M5 9v9M19 9v9M3 18h18" /><path d="M5 9c2 4 5 5 7 5s5-1 7-5" /></>,
};

export type IconName = keyof typeof icons;

export default function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true" {...P}>
      {icons[name]}
    </svg>
  );
}
