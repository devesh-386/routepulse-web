# RoutePulse — UI image-generation prompt

Combines **epic-design** (cinematic 2.5D depth, scroll storytelling) with **design-taste**
(`imagegen-web`: one image per section, composition variety, anti-slop, implementation clarity).
Paste the **Master prompt** into any image model (ChatGPT/GPT-image, Gemini, Midjourney, Ideogram, Flux).
If the model makes one image per message, send the master prompt once, then each **Section prompt** in turn.

---

## Master prompt

You are an elite web art director. Generate **6 separate horizontal website design comps (16:9, 1920×1080), one per section** of a landing page for **RoutePulse**. Never combine sections into one image and never return one tall full-page image. Label each image "Section N of 6: <name>".

**Product.** RoutePulse is a climate-aware mobility tool for Tamil Nadu, India. It simulates how storms and rainfall flood and close roads, then shows commuters, bus operators and transport planners which route still works and why. Every number is simulated, and the design must feel honest and evidence-based, never sci-fi.

**Direction: cinematic editorial data.** A premium climate-intelligence publication crossed with an Apple product page. It should feel calm, precise and serious; it is a decision tool, not a game.

**Design dials:** design variance 7/10 · visual density 4/10 · art direction 8/10 · implementation clarity 9/10 · spacing generosity 8/10.

**Palette (identical in all 6 images):**
- Background: deep monsoon ink `#0D1117` with a subtle charcoal-to-slate tonal gradient
- Surface panels: `#151B23`, 1px hairline borders `#2A3441`
- Text: `#E6EAF0` primary, `#9AA5B1` secondary
- Road status, used only as data, never decoration: open `#6FBF6D`, wet/slow `#F2C94C`, flooded `#FF9A4A`, closed `#FF5A68`
- Rain: translucent blue-violet `#4F8FE0` → `#5B2FD0` washes
- One accent for buttons and links: `#7AA2FF`
- Warning band: amber `#F5D77A` text on dark olive `#33290A`

**Typography:** a refined grotesk (Neue Montreal / Satoshi feel) for UI and body, plus a compressed display grotesk for big statements. Tabular numerals for every figure. Strong hierarchy: one giant line, then quiet supporting text.

**Depth system (epic-design).** Build every section from at least 3 visible depth layers:
- depth 0: blurred atmospheric background (rain haze, dark satellite-like terrain of the Tamil Nadu coast)
- depth 1: soft glow (rain-cell washes, storm-eye halo)
- depth 2: mid layer (thin road-network lines, grid of 0.25° rain cells)
- depth 3: the hero object (the glowing road-network map of Tamil Nadu, or a floating UI panel)
- depth 4: crisp text and UI
- depth 5: foreground particles (fine diagonal rain streaks, very subtle)

Use slight blur and scale on the far layers so the page reads as 2.5D space, as if it will parallax on scroll.

**Recurring motif.** A stylised road network of Tamil Nadu: about 60 town nodes joined by straight segments, Chennai top-right, Kanyakumari at the southern tip, the Western Ghats on the left edge. Segments are coloured by status, and storms are dashed tracks with a glowing centre. The same map appears in several sections at different scales and crops, like a narrative spine.

**Honesty rule.** Wherever numbers or maps appear, include a small persistent tag reading **"Simulated scenario: not a real-world forecast"**. Probabilities are labelled "simulated". No fake logos of real agencies, no government seals, no real people.

**Do NOT:** purple-blue "AI glow" blobs, generic dashboard-card spam, glassmorphism everywhere, neon cyberpunk, stock photos of traffic jams, 3D isometric cities, robot or brain icons, emoji, lorem ipsum, text-left/image-right in every section, cramped layouts, more than one accent colour.

**Make it codeable:** clear grid, real readable copy, consistent 8px spacing, visible states for buttons and toggles. Every element should be easy to rebuild in HTML/CSS with MapLibre and SVG.

---

## Section prompts

**Section 1 of 6: Hero, "the storm arrives"**
Composition: bottom-left text over a full-bleed image-as-canvas. Depth 0 is the dark Tamil Nadu coastline under heavy rain haze. Depth 3 is the road network floating large across the right two-thirds, most segments green, with a cyclone eye (soft glowing ring, dashed track) approaching from the Bay of Bengal near Cuddalore. Its leading edge has turned a few coastal roads amber and red. Depth 5 is fine rain streaks. Headline (giant, compressed): **"When the rain comes, which road still works?"** Subline: "RoutePulse simulates how storms close Tamil Nadu's roads, and explains the best way through, number by number." Two buttons: solid accent "Open the live simulation", ghost "Watch the 60-second story". Small amber tag "Simulated scenario: not a real-world forecast".

**Section 2 of 6: The time scrubber, "scroll through the storm" (pinned scene)**
Composition: centred, image-as-canvas. A wide cinematic strip showing the same map at 3 moments side by side, fading from left to right (calm all green → storm building, rain grid washing violet → peak, 46 segments red). Beneath it, a full-width time slider UI with a play button, "1× / 4×" toggle, the label "Tue, 28 Oct, 14:00 · hour 206 of 335", and a thin red sparkline of "segments closed" above the track, peaking at 46. Caption: "336 simulated hours. 5 storm scenarios. Every road, every hour."

**Section 3 of 6: The decision moment, "the best route changes"**
Composition: right-text / left-image (inverted). Left: a cropped map close-up of Cuddalore–Thanjavur. Route R016-A1 is drawn red with "Blocked · 2 closed segments", and R016-A3 glows green and thicker as the chosen path. Right: three stacked route cards (dark surface, hairline borders). The R016-A3 card carries a green "Best in this scenario" pill, "Simulated ETA 416.4 min", "Simulated delay 180 min vs free-flow" and risk "low (22.3)". The other two cards show red "Blocked" pills. Above them, a large verdict: **"Go · R016-A3"**. Headline over the section: "Not a prediction. A comparison you can check."

**Section 4 of 6: Three lenses, "same storm, three decisions"**
Composition: off-grid editorial triptych with staggered heights and generous gaps. Three tall panels, each with a small label:
- **Commuter:** "Go / No-go" verdict card and route ETA.
- **Bus operator:** a crisp table titled "Simulated service disruption" (rows: departures, completed, diverted, cancelled, turned back), with cancelled counts highlighted red.
- **Planner:** a ranked list "Relative vulnerability under the sampled scenario mix", with segment IDs and bars (S009 ECR / SH-49 26.2 %, S006 Inner Ring Rd 23.6 %, S016 SH-58 22.9 %) and a "How this is computed" link.
The background map sits faint at depth 0 behind all three.

**Section 5 of 6: Explanations with evidence, "every number shows its source"**
Composition: stacked centre, mini-minimalist, lots of negative space. One wide explanation panel. A green pill "Validated ✓" and a quiet line "Template answer written directly from the evidence". Four numbered sentences, each followed by small chips: grey "Simulation state", amber "Derived from simulation", violet "Model output", and an expandable "Evidence (3)" that reveals a mini list (`route.R016-A3.eta_min = 416.4 min`). Side annotation in small caps: "If a sentence uses a number that isn't in the evidence, it's rejected." Below: "Tested on 33,600 explanations · 0 ungrounded numbers".

**Section 6 of 6: The engine and the call to action**
Composition: top-left lead plus a full-bleed lower half. The top-left headline is "10,000 simulated storm worlds behind every forecast". Beneath sit three understated stat blocks with tabular numerals: "83 road segments", "3,320,000 training rows", "Brier score 0.0038 on held-out worlds". The lower half is a dense field of 10,000 tiny faint dots (one per simulated world) that resolve into the shape of the Tamil Nadu road network at the centre. CTA strip: "Explore the simulation" (solid accent), and a fine-print disclaimer "All data is synthetic. Built to demonstrate climate-aware routing, not to forecast real roads." Footer: minimal wordmark "RoutePulse", no social icons.

---

## Optional: dashboard screenshot prompt (single image)

Generate one 16:9 desktop app screenshot of the **RoutePulse dashboard** in dark mode, using the palette, type and honesty rules above. Layout: top bar with the wordmark "RoutePulse", scenario dropdown "SC03 · Cauvery Delta Depression", an accent button "Guided story", and a segmented toggle "Now | Forecast +3 h". Under it, a full-width amber banner "Simulated scenario: not a real-world forecast." The left 70% holds the road-network map of Tamil Nadu (green/amber/red segments, a translucent violet rain grid over the delta, a storm marker near Thanjavur) with a compact legend top-left and a floating "Step 3 of 4 · The best route changes" story card bottom-right. Below the map is a time slider with play, 1×/4× and a red closures sparkline. The right 30% is a side panel: a segmented control "Commuter | Bus operator | Planner", a green verdict card "Go · R016-A3", three route cards and an "Explain the evidence" panel with chips. The UI must be crisp and pixel-aligned, like a real product screenshot, not a concept render.
