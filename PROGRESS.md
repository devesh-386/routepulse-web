# RoutePulse web — progress

Plan: `C:\Users\dev\.claude\plans\giggly-weaving-kahan.md`

| Step | Status | Evidence |
|---|---|---|
| P0 bundle + data contract | done | `build_bundle.py` → 27 files, 3.80 MB raw / 0.51 MB gzipped. `verify_bundle.py`: manifest length+sha256+shape OK, 1,000 random cells × 5 scenarios decode exactly, rain raster exact, 50 route assessments × 5 exact, forecast AUC ≥ 0.9995, story switch verified (SC03 OD016 h195). `check_dataset.py` still passes. |
| P1 map + scrubber | done | `scripts/verify-ui.mjs` (headless Edge): 300 segment colours, 200 rain cells and the forecast/no-forecast layer match the bundle across all 5 scenarios; closed-count readout = 46 at SC04 peak; arrow keys, Play and slider tap work; no console errors; no horizontal scroll and visible map at 1440 and 375 px, light + dark. Map works with no basemap (Carto tiles are unreachable from this machine) via a local style. P5 polish: Chennai label clips at 375 px. |
| P2 route cards | done | 50 random (scenario, hour, OD) cases: every card's status, ETA, delay, risk, band, closed count and recommended flag equal `route_assessments.csv` (read from the dataset, not the bundle); reason names the flagged route; keyboard focus highlights the route. |
| P3 template explanations + validator | done | `src/lib/explain/`: evidence pack (ids, values, units, kinds) built server-side from the bundle; validator checks citations, entities/times, number↔value↔unit↔entity, causes, overclaims. vitest: templates validate for all 33,600 (scenario × 3-h step × OD × audience); 17 adversarial cases rejected (wrong unit, missing unit, mismatched hour, right number on the wrong route, foreign route, unknown segment, other scenario, unsupported cause, cause without evidence, uncited, invented number, arithmetic, uncited source, overclaim, unknown id, one bad sentence fails the answer). API rejects bad input and client-supplied context (400). UI: validated badge, kind chips, evidence per sentence, stale marker — checked headless for all 3 audiences. |
| P4 free LLM provider | done | `src/lib/explain/llm.ts`: one OpenAI-compatible call (Groq / Gemini / OpenRouter / Ollama) via `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`; JSON sentences with evidence ids → P3 validator. vitest against a local stub provider (12 tests): grounded answer shown as AI; invented number, unsupported cause, malformed output, 429, HTTP 500, timeout (aborted at 0.4 s in test, 8 s live) and unreachable all fall back to the validated template with the reason shown; per-IP rate limiter (best effort, per instance). Not yet tested against a real provider: needs your free key (see `.env.example`). |
| P5 lenses + story + polish | done | Lenses: commuter Go/No-go (checked at the story switch and an all-blocked hour), bus-operator tallies equal `bus_trips.csv`, planner SC04 stats equal the README (46 peak, 7.28 %), vulnerability rows highlight on the map. Story: 4 steps computed from `story.json` + data, each sets SC03/OD016/hour correctly, last step auto-produces a validated explanation. Contrast ≥ 3.66:1 (light) / 4.82:1 (dark) for all road colours; reduced-motion playback works; 375 px + desktop, light + dark, no horizontal scroll. `npm run build` clean, 31 unit tests, all UI checks pass. |
| P6 deploy | gated on your Vercel login + yes | |

## Street-level redesign (2026-10-26)

`/` is now the Chennai street view (mockup layout); the state-wide dashboard moved to `/corridors`, unchanged.

| Piece | Evidence |
|---|---|
| Streets | `build_streets.py`: 80,905 OSM segments (7,402 km, 46 underpasses, 899 bridges) from OpenFreeMap z14 tiles; distance to major rivers/canals, drains, coast. |
| Street physics | `build_street_sim.py`: coefficients tuned to stated targets (cyclone peak 17 % of streets closed, cloudburst 4 %, baseline 0); corridor coefficients would have closed 72 %. |
| +3 h estimate | Physics + known forecast error, no training. Against the simulation: warns of 78.7 % of new closures in SC04 (Brier 0.006 vs 0.022 persistence), 71.7 % in SC02 (0.0145 vs 0.0157). Beat logistic and boosted-tree alternatives on held-out storms. |
| Delivery | Pre-cut vector tiles (162 files) + sparse per-step state; north Chennai visible in ~2-3 s instead of ~11 s. |
| Routing | Fastest / safer / shortest on the street graph, never through closed streets; 6 unit tests. Known limit: zoom-14 tiles drop some T-junctions, so places snap to the main connected network (72 % of segments, 96 % of major roads). |
| UI checks | 300 streets' map colours equal the decoded data; real click selects the clicked street; cut-route notice at the peak; no console errors; 375 px OK. |
| Awwwards pack | Surveyed: sliders are image carousels, hovers are text/team/WebGL effects, SVG #1 is a page-transition overlay. Nothing fits a map dashboard, so controls are hand-rolled. |

## Device location + Google Maps hand-off (2026-10-26)

| Piece | Evidence |
|---|---|
| GPS | `src/lib/geo.ts`: `watchPosition` (high accuracy), opt-in button, never on load; position stays in the browser. Simulated-GPS checks: tracking ±12 m inside Chennai, street under you opens (4.9 m away), dot + accuracy halo, map follows a move to Adyar. |
| Coverage | Outside the street data (e.g. SRM Kattankulathur, 38 km out) the app says so and offers places instead; denied permission explained. |
| Google Maps | "Navigate this route in Google Maps": `google.com/maps/dir/?api=1` with origin, destination and waypoints sampled along the chosen route (8 on desktop, 3 on phones, Google's URL limits). No key, no cost. Embedding Google's own basemap would need a billed Maps Platform key and can't mix with MapLibre tiles under Google's terms. |

## Control room `/ops` (2026-10-28)

| Piece | Evidence |
|---|---|
| Console | `src/components/ops/`: operations-console layout over the same street simulation. Condition level 1–5 from share of streets closed; KPI strip (closed, very-high +3 h, deep water, city rain, closure peak, risk mix); threat board (riskiest named roads, grouped by name); 13 sector tiles (1.5 km around each place); target telemetry; route options; event log built from closures/reopenings between consecutive 3-h steps. Hotkeys: Space, ←/→ (±3 h), Esc. |
| Labelling | Hazard banner "simulated exercise · synthetic data" on every screen, plus footer. |
| Checks | Headless Edge: threat click retargets (76919 → 77696), → advances 201 → 204, no console errors, no horizontal scroll at 1600 px and 375 px. `verify-ui.mjs` all pass (its street-click check is layout-sensitive and failed once in 4 runs, unrelated to this change). tsc + eslint clean, 37 unit tests. |
| Animmaster | Pack drive (E:) not mounted; motion is hand-rolled and minimal (status pulses, panel fade-in), off under prefers-reduced-motion. |
