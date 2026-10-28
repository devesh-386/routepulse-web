// Headless UI verification against the data bundle. Uses the Edge that ships with Windows
// (or BROWSER_PATH), so no browser download is needed.
//
//   node scripts/verify-ui.mjs [baseUrl]          default http://localhost:3210
//
// Exits non-zero on any failure; screenshots go to test-results/.

import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3210";
const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "public", "data");
const OUT = path.join(ROOT, "test-results");
fs.mkdirSync(OUT, { recursive: true });

const EXE = process.env.BROWSER_PATH
  ?? ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));

const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails.push(name);
};

// ---- expected values, decoded independently of the app
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, "manifest.json")));
const H = manifest.hours, S = manifest.segments, C = manifest.grid_cells;
const cube = (sc) => fs.readFileSync(path.join(DATA, `${sc.toLowerCase()}.bin`));
const rain = (sc) => fs.readFileSync(path.join(DATA, `${sc.toLowerCase()}_rain.bin`));
const styleSrc = fs.readFileSync(path.join(ROOT, "src", "lib", "style.ts"), "utf8");
// the fidelity pass runs in a light-scheme browser, so it expects the light palette
const STATUS_COLOR = JSON.parse(styleSrc.match(/STATUS_COLOR_LIGHT = (\[[^\]]+\])/)[1].replace(/,\s*\]/, "]"));
const rnd = (() => { let s = 42; return (n) => (s = (s * 1103515245 + 12345) % 2 ** 31) % n; })();

// basemap tiles are optional and may be unreachable; anything else in the console is a failure
const ignorable = (msg) => /cartocdn|basemap tiles unavailable/i.test(msg.text() + (msg.location()?.url ?? ""));

async function waitForMap(page) {
  await page.waitForFunction(() => window.__rpMap && window.__rpMap.getFeatureState({ source: "segments", id: 0 }).color,
                             null, { timeout: 20000 });
}

async function setHour(page, h) {
  await page.locator("#hour").fill(String(h));
  await page.waitForFunction((h) => document.querySelector("#hour").value === String(h), h);
  await page.waitForTimeout(60);
}

// ---- route cards against the source CSV (not the bundle), as P2's exit condition requires
const CSV = path.resolve(ROOT, "..", "routepulse-dataset", "data", "route_assessments.csv");

function loadAssessments() {
  const [head, ...lines] = fs.readFileSync(CSV, "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  const t0 = Date.parse(manifest.start + "Z");
  const map = new Map();
  for (const line of lines) {
    const v = line.split(",");
    const r = Object.fromEntries(cols.map((c, i) => [c, v[i]]));
    const hour = Math.round((Date.parse(r.timestamp + "Z") - t0) / 3600_000);
    map.set(`${r.scenario_id}|${hour}|${r.route_id}`, r);
  }
  return map;
}

async function verifyRouteCards(page) {
  console.log("route cards match route_assessments.csv");
  const rows = loadAssessments();
  const routes = JSON.parse(fs.readFileSync(path.join(DATA, "routes.json")));
  const num = (s) => (s === "" || s === undefined ? "" : String(Number(s)));
  let cases = 0, bad = [];
  const scs = ["SC01", "SC02", "SC03", "SC04", "SC05"];
  for (const sc of scs) {
    await page.selectOption("select >> nth=0", sc);
    await page.waitForTimeout(300);
    for (let k = 0; k < 10; k++) {
      const h = rnd(H), od = routes.od_pairs[rnd(routes.od_pairs.length)];
      await page.getByLabel("Origin to destination").selectOption(od.id);
      await setHour(page, h);
      const at = Math.floor(h / 3) * 3;   // latest 3-hourly assessment not after h
      const cards = await page.$$eval(".card", (els) => els.map((e) => ({ ...e.dataset })));
      cases++;
      if (cards.length !== od.routes.length) { bad.push(`${sc} h${h} ${od.id}: ${cards.length} cards`); continue; }
      for (const c of cards) {
        const r = rows.get(`${sc}|${at}|${c.route}`);
        const want = { status: r.route_status, eta: num(r.eta_min), delay: num(r.delay_min),
                       risk: num(r.climate_risk_score), band: r.risk_band, closed: num(r.segments_closed),
                       recommended: String(r.recommended === "True") };
        const got = { status: c.status, eta: num(c.eta), delay: num(c.delay), risk: num(c.risk),
                      band: c.band, closed: num(c.closed), recommended: c.recommended };
        for (const key of Object.keys(want)) {
          if (want[key] !== got[key]) bad.push(`${sc} h${h} ${c.route} ${key}: ${got[key]} vs ${want[key]}`);
        }
      }
    }
  }
  check(`${cases} random (scenario, hour, OD) cases: every card equals the CSV row`, bad.length === 0,
        bad.slice(0, 3).join(" | "));

  // the reason never contradicts the flag, and focusing a card highlights its route
  const reason = await page.getByTestId("reason").innerText();
  const best = await page.$eval(".card[data-recommended='true']", (e) => e.dataset.route).catch(() => null);
  check("recommendation reason names the flagged route", best ? reason.includes(best) : /No route/.test(reason),
        reason.slice(0, 90));
  const first = page.locator(".card").first();
  const rid = await first.getAttribute("data-route");
  await first.focus();
  await page.waitForTimeout(100);
  const segIds = routes.routes[rid].segments;
  const net = JSON.parse(fs.readFileSync(path.join(DATA, "network.json")));
  const ixs = segIds.map((s) => net.segments.find((x) => x.id === s).ix);
  const hl = await page.evaluate((ixs) => ixs.map((i) => window.__rpMap.getFeatureState({ source: "segments", id: i }).hl), ixs);
  check("keyboard focus on a card highlights its route on the map", hl.every(Boolean), `${rid}: ${hl}`);
}

async function verifyExplain(page) {
  console.log("explanations");
  for (const [id, label] of [["commuter", "Commuter"], ["bus_operator", "Bus operator"], ["transport_planner", "Planner"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("button", { name: /^Explain/ }).click();
    const ex = page.getByTestId("explanation");
    await ex.waitFor({ timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector(".explain")?.getAttribute("aria-busy")?.includes("true"));
    const info = await ex.evaluate((e) => ({
      validated: e.dataset.validated, source: e.dataset.source,
      sentences: e.querySelectorAll(".sentences li").length,
      chips: e.querySelectorAll(".chip").length,
      evidence: e.querySelectorAll(".evidence").length,
      failed: e.querySelectorAll(".sentences .error").length,
    }));
    check(`${id}: explanation is validated, every sentence carries chips and evidence`,
          info.validated === "true" && info.sentences > 1 && info.evidence === info.sentences
          && info.chips >= info.sentences && info.failed === 0,
          JSON.stringify(info));
  }
  const h = Number(await page.locator("#hour").inputValue());
  await setHour(page, (h + 7) % H);
  const stale = await page.getByText("changed since this explanation").count();
  check("changing the hour marks the explanation as out of date", stale === 1);
}

// ---- P5: lenses, story, contrast, reduced motion
const DATASET = path.resolve(ROOT, "..", "routepulse-dataset", "data");
const audienceBtn = (page, label) => page.locator(".audience").getByRole("button", { name: label, exact: true });

async function goto(page, sc, od, h) {
  await page.selectOption("select >> nth=0", sc);
  await page.waitForTimeout(300);
  await page.getByLabel("Origin to destination").selectOption(od);
  await setHour(page, h);
}

async function verifyLenses(page) {
  console.log("audience lenses");
  const story = JSON.parse(fs.readFileSync(path.join(DATA, "story.json")));
  const sw = story.steps[2];

  // commuter: go at the story's switch, no-go when every route is blocked
  await audienceBtn(page, "Commuter").click();
  await goto(page, story.scenario, story.od_pair, sw.hour);
  const go = await page.getByTestId("lens").evaluate((e) => ({ v: e.dataset.verdict, t: e.innerText }));
  check("commuter: Go with the recommended route at the story switch", go.v === "go" && go.t.includes(sw.route), go.t.split("\n")[0]);
  const rows = loadAssessments();
  let blocked = null;
  for (const [k, r] of rows) {
    const [sc, h, rid] = k.split("|");
    if (r.od_pair_id !== story.od_pair || sc !== "SC04") continue;
    const all = JSON.parse(fs.readFileSync(path.join(DATA, "routes.json"))).od_pairs.find((o) => o.id === story.od_pair).routes;
    if (all.every((x) => rows.get(`${sc}|${h}|${x}`).route_status === "blocked")) { blocked = Number(h); break; }
    void rid;
  }
  if (blocked !== null) {
    await goto(page, "SC04", story.od_pair, blocked);
    const ng = await page.getByTestId("lens").evaluate((e) => e.dataset.verdict);
    check("commuter: No-go when every route for the pair is blocked", ng === "no-go", `SC04 h${blocked}`);
  }

  // operator: tallies equal bus_trips.csv for the same windows
  await audienceBtn(page, "Bus operator").click();
  await goto(page, "SC04", "OD001", 207);
  const [head, ...lines] = fs.readFileSync(path.join(DATASET, "bus_trips.csv"), "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  const t0 = Date.parse(manifest.start + "Z");
  const trips = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])))
    .filter((t) => t.scenario_id === "SC04")
    .map((t) => ({ ...t, hour: Math.round((Date.parse(t.scheduled_departure + "Z") - t0) / 3600_000) }));
  const shown = await page.$$eval("tr[data-service]", (els) => els.map((e) => ({ ...e.dataset })));
  let badBus = 0;
  for (const s of shown) {
    const inWin = trips.filter((t) => t.bus_route_id === s.service && t.hour >= Number(s.from) && t.hour < Number(s.to));
    if (inWin.length !== Number(s.departures) || inWin.filter((t) => t.outcome === "cancelled").length !== Number(s.cancelled)) badBus++;
  }
  check("bus operator: departures and cancellations equal bus_trips.csv", shown.length > 0 && badBus === 0,
        `${shown.length} rows, ${badBus} wrong`);

  // planner: scenario stats equal the README calibration values for SC04
  await audienceBtn(page, "Planner").click();
  const peak = await page.getByTestId("peak").innerText();
  const share = await page.getByTestId("share").innerText();
  check("planner: SC04 peak closures and closed share match the dataset README (46, 7.28 %)",
        peak.startsWith("46 ") && share === "7.28 %", `${peak} | ${share}`);
  const vuln = JSON.parse(fs.readFileSync(path.join(DATA, "vulnerability.json")));
  const top = vuln.segments[0];
  await page.locator(".vuln-row").first().click();
  const net = JSON.parse(fs.readFileSync(path.join(DATA, "network.json")));
  const ix = net.segments.find((x) => x.id === top.segment_id).ix;
  const hl = await page.evaluate((i) => window.__rpMap.getFeatureState({ source: "segments", id: i }).hl, ix);
  check("planner: clicking the top vulnerable segment highlights it on the map", hl === true, top.segment_id);
  await page.locator(".vuln-row").first().click();
  await audienceBtn(page, "Commuter").click();
}

async function verifyStory(page) {
  console.log("guided story");
  const story = JSON.parse(fs.readFileSync(path.join(DATA, "story.json")));
  await page.getByRole("button", { name: "Guided story" }).click();
  const card = page.getByTestId("story");
  await card.waitFor();
  const state = async () => ({
    sc: await page.locator("select >> nth=0").inputValue(),
    od: await page.getByLabel("Origin to destination").inputValue(),
    hour: Number(await page.locator("#hour").inputValue()),
    text: await card.innerText(),
  });
  for (let i = 0; i < story.steps.length; i++) {
    const st = story.steps[i];
    await page.waitForFunction((n) => document.querySelector("[data-testid=story]")?.dataset.step === String(n), i);
    await page.waitForFunction(() => !document.querySelector("[data-testid=story]")?.innerText.includes("Loading"));
    const s = await state();
    check(`story step ${i + 1} "${st.title}" sets ${story.scenario}, ${story.od_pair}, hour ${st.hour}`,
          s.sc === story.scenario && s.od === story.od_pair && s.hour === st.hour);
    if (st.focus === "switch") {
      check("story switch step names the blocked and the new route", s.text.includes(st.previous_route) && s.text.includes("blocked")
            && s.text.includes(st.route), s.text.split("\n")[2]?.slice(0, 120));
    }
    if (st.focus === "explain") {
      const ex = page.getByTestId("explanation");
      await ex.waitFor({ timeout: 15000 });
      const v = await ex.evaluate((e) => e.dataset.validated);
      check("story's last step produces a validated explanation automatically", v === "true");
    }
    await card.getByRole("button", { name: i === story.steps.length - 1 ? "Finish" : "Next" }).click();
  }
  check("Finish closes the story", (await page.getByTestId("story").count()) === 0);
}

function contrastChecks() {
  console.log("contrast");
  const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const pal = (name) => JSON.parse(styleSrc.match(new RegExp(`${name} = (\\[[^\\]]+\\])`))[1].replace(/,\s*\]/, "]"));
  const bg = Object.fromEntries([...styleSrc.matchAll(/(light|dark): "(#[0-9a-f]{6})"/gi)].map((m) => [m[1], m[2]]));
  for (const [scheme, name] of [["light", "STATUS_COLOR_LIGHT"], ["dark", "STATUS_COLOR_DARK"]]) {
    const ratios = pal(name).map((c) => cr(c, bg[scheme]));
    check(`${scheme}: every road status colour has ≥ 3:1 contrast with the map background`, Math.min(...ratios) >= 3,
          `min ${Math.min(...ratios).toFixed(2)}`);
  }
}

// ---- Chennai street view
async function verifyStreets(browser) {
  console.log("chennai street view");
  const S = path.join(DATA, "streets");
  const meta = JSON.parse(fs.readFileSync(path.join(S, "streets_meta.json")));
  const raw = fs.readFileSync(path.join(S, "sc04_streets.bin"));
  const u32 = (o, n) => new Uint32Array(raw.buffer.slice(raw.byteOffset + o, raw.byteOffset + o + 4 * n));
  const steps = u32(0, 1)[0], offs = u32(4, steps + 1), rows = offs[steps], base = 4 * (steps + 2);
  const idx = u32(base, rows), pr = raw.subarray(base + 6 * rows, base + 7 * rows);
  const band = (p) => (p === 255 ? 0 : p >= 70 ? 4 : p >= 40 ? 3 : p >= 10 ? 2 : 1);

  const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !ignorable(m)) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(BASE);
  await page.waitForFunction(() => window.__rpStreetMap?.queryRenderedFeatures({ layers: ["streets"] }).length > 5000, null, { timeout: 60000 });
  const loadMs = Date.now() - t0;
  check("street map shows thousands of streets within 6 s (dev server)", loadMs < 6000, `${loadMs} ms`);

  // the opening hour's colours equal the decoded sparse file
  const hour = Number(await page.locator("#hour").inputValue());
  const k = Math.floor(hour / 3);
  const listed = Array.from(idx.subarray(offs[k], offs[k + 1]));
  const sample = Array.from({ length: 300 }, () => listed[rnd(listed.length)]);
  const got = await page.evaluate((ids) => ids.map((i) => window.__rpStreetMap.getFeatureState({ source: "streets", sourceLayer: "streets", id: i }).b), sample);
  const bad = sample.filter((i, j) => got[j] !== band(pr[offs[k] + listed.indexOf(i)])).length;
  check(`300 streets at hour ${hour}: map risk band equals the decoded data`, bad === 0, `${bad} wrong of ${listed.length} listed`);

  // routes: three options, safer carries no more risk than fastest
  const routes = await page.$$eval(".sv-route", (els) => els.map((e) => ({ ...e.dataset })));
  const f = routes.find((r) => r.kind === "fastest"), sf = routes.find((r) => r.kind === "safer");
  check("route comparison lists three routes with safer risk ≤ fastest", routes.length === 3 && Number(sf.meanp) <= Number(f.meanp),
        routes.map((r) => `${r.kind} ${r.minutes} min p̄ ${r.meanp}`).join(" | "));

  // clicking a street selects it
  const before = await page.getByTestId("street").getAttribute("data-street");
  const box = await page.locator(".sv-map").boundingBox();
  // click a street the map actually rendered, at the screen position of one of its vertices
  const target = await page.evaluate((cur) => {
    const m = window.__rpStreetMap;
    const f = m.queryRenderedFeatures({ layers: ["streets"] }).find((x) => String(x.id) !== cur && x.geometry.type === "LineString");
    if (!f) return null;
    const pt = m.project(f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)]);
    const hit = m.queryRenderedFeatures([pt.x, pt.y], { layers: ["streets"] });
    return { x: pt.x, y: pt.y, ids: hit.map((h) => String(h.id)) };
  }, before);
  check("found a rendered street to click", target !== null);
  if (target) {
    await page.mouse.click(box.x + target.x, box.y + target.y);
    await page.waitForTimeout(300);
    const after = await page.getByTestId("street").getAttribute("data-street");
    check("clicking a street opens that street in the side panel", target.ids.includes(after) && after !== before,
          `${before} → ${after}`);
  }

  // scrub to the storm peak: the cut-route notice offers the reopening hour
  await setHour(page, 210);
  await page.waitForTimeout(400);
  const cut = await page.locator(".sv-cut").count();
  check("at the cyclone peak the route card explains when a route reopens", cut === 1);

  check("street view: no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();

  const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: "dark", isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await mp.goto(BASE);
  await mp.waitForSelector("[data-testid=street]", { timeout: 60000 });
  await mp.waitForTimeout(1500);
  const o = await mp.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth,
    mapH: document.querySelector(".sv-mapframe").getBoundingClientRect().height }));
  check("street view at 375 px: no horizontal scroll, map visible", o.overflow <= 0 && o.mapH > 300, JSON.stringify(o));
  await mp.screenshot({ path: path.join(OUT, "sv-mobile.png"), fullPage: true });
  await m.close();
}

// ---- device location (simulated GPS)
async function verifyLocation(browser) {
  console.log("device location");
  const open = async (opts) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 }, colorScheme: "dark", ...opts });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(BASE);
    await page.waitForSelector("[data-testid=street]", { timeout: 60000 });
    return { ctx, page, errors };
  };
  const status = (page) => page.getByTestId("gps").evaluate((e) => ({ s: e.dataset.status, covered: e.dataset.covered, text: e.innerText }));

  // inside Chennai: tracking, origin becomes "My location", the street under you opens, map follows
  const tNagar = { latitude: 13.0418, longitude: 80.2341, accuracy: 12 };
  const a = await open({ permissions: ["geolocation"], geolocation: tNagar });
  await a.page.getByRole("button", { name: "Use my location" }).click();
  await a.page.waitForFunction(() => document.querySelector("[data-testid=gps]")?.dataset.status === "tracking", null, { timeout: 15000 });
  const st = await status(a.page);
  check("GPS inside Chennai: tracking and covered", st.s === "tracking" && st.covered === "true", st.text);
  const origin = await a.page.locator(".sv-journey select").first().inputValue();
  check("origin switches to My location", origin === "me");
  const routesFromMe = await a.page.locator(".sv-route").count();
  check("routes are computed from the device position", routesFromMe === 3, `${routesFromMe} routes`);
  const street1 = await a.page.getByTestId("street").getAttribute("data-street");
  // distance from the fix to that street, measured on the decoded street file, not the UI
  const smeta = JSON.parse(fs.readFileSync(path.join(DATA, "streets", "streets_meta.json")));
  const sraw = fs.readFileSync(path.join(DATA, "streets", "streets.bin"));
  const lay = Object.fromEntries(smeta.layout.map((l) => [l.name, l]));
  const offs = new Uint32Array(sraw.buffer.slice(sraw.byteOffset + lay.offsets.offset, sraw.byteOffset + lay.offsets.offset + 4 * lay.offsets.length));
  const verts = new Uint16Array(sraw.buffer.slice(sraw.byteOffset + lay.verts.offset, sraw.byteOffset + lay.verts.offset + 2 * lay.verts.length));
  const distTo = (i, lon, lat) => {
    const k = Math.cos(lat * Math.PI / 180) * 111320; let best = Infinity;
    for (let v = offs[i]; v < offs[i + 1]; v++) {
      const x = smeta.coord_origin[0] + verts[2 * v] * smeta.coord_quantum_deg, y = smeta.coord_origin[1] + verts[2 * v + 1] * smeta.coord_quantum_deg;
      best = Math.min(best, Math.hypot((x - lon) * k, (y - lat) * 110540));
    }
    return best;
  };
  const nearM = distTo(Number(street1), tNagar.longitude, tNagar.latitude);
  check("the street you're standing on opens in the panel (within 60 m)", nearM < 60, `${nearM.toFixed(1)} m`);
  const dot = await a.page.evaluate(() => window.__rpStreetMap.getSource("me").serialize().data.features.length);
  check("blue dot and accuracy circle are drawn", dot === 2);

  // moving: the panel and the map follow the new fix
  await a.ctx.setGeolocation({ latitude: 13.0012, longitude: 80.2565, accuracy: 15 });
  await a.page.waitForFunction((prev) => document.querySelector("[data-testid=street]")?.dataset.street !== prev, street1, { timeout: 15000 });
  await a.page.waitForTimeout(900);
  const c = await a.page.evaluate(() => window.__rpStreetMap.getCenter());
  check("after moving to Adyar the map recentres on the new position", Math.abs(c.lat - 13.0012) < 0.003 && Math.abs(c.lng - 80.2565) < 0.003,
        `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`);

  // the Google Maps hand-off carries origin, destination and waypoints along the chosen route
  const href = await a.page.getByTestId("gmaps").getAttribute("href");
  const u = new URL(href);
  const wps = (u.searchParams.get("waypoints") ?? "").split("|").filter(Boolean);
  check("Google Maps link starts at the device and ends at the destination",
        u.origin + u.pathname === "https://www.google.com/maps/dir/" && u.searchParams.get("api") === "1"
        && u.searchParams.get("origin").startsWith("13.0012") && u.searchParams.get("destination").startsWith("13.05"),
        `${u.searchParams.get("origin")} → ${u.searchParams.get("destination")}`);
  check("desktop link carries 1–8 waypoints on the route", wps.length >= 1 && wps.length <= 8, `${wps.length}`);
  check("location: no page errors", a.errors.length === 0, a.errors.join(" | "));
  await a.ctx.close();

  // outside Chennai (SRM Kattankulathur): honest message, no route from there
  const b = await open({ permissions: ["geolocation"], geolocation: { latitude: 12.8231, longitude: 80.0442, accuracy: 20 } });
  await b.page.getByRole("button", { name: "Use my location" }).click();
  await b.page.waitForFunction(() => document.querySelector("[data-testid=gps]")?.dataset.status === "tracking", null, { timeout: 15000 });
  const out = await status(b.page);
  check("GPS outside Chennai: says so instead of pretending", out.covered === "false" && /km from central Chennai/.test(out.text), out.text);
  const msg = await b.page.locator(".sv-right").innerText();
  check("route card explains why there is no route from outside", /outside the simulated Chennai streets/.test(msg) && !/crosses a closed street/.test(msg));
  await b.ctx.close();

  // permission denied
  const d = await open({ permissions: [] });
  await d.page.getByRole("button", { name: "Use my location" }).click();
  await d.page.waitForFunction(() => ["denied", "unavailable"].includes(document.querySelector("[data-testid=gps]")?.dataset.status), null, { timeout: 15000 });
  const den = await status(d.page);
  check("permission denied is explained", /denied|couldn't provide/.test(den.text), den.text);
  await d.ctx.close();

  // phones get at most 3 waypoints (Google's limit in mobile browsers)
  const m = await open({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const mh = await m.page.getByTestId("gmaps").getAttribute("href");
  const mw = (new URL(mh).searchParams.get("waypoints") ?? "").split("|").filter(Boolean).length;
  check("phone link carries at most 3 waypoints", mw <= 3, `${mw}`);
  await m.ctx.close();
}

async function main() {
  if (!EXE) throw new Error("No Edge/Chrome found; set BROWSER_PATH");
  const browser = await chromium.launch({ executablePath: EXE, headless: true });

  // ---------------------------------------------------------------- data fidelity
  console.log("map shows the bundle");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !ignorable(m)) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/corridors`);
  await waitForMap(page);

  for (const sc of ["SC01", "SC02", "SC03", "SC04", "SC05"]) {
    await page.selectOption("select", sc);
    await page.waitForTimeout(400);
    const c = cube(sc), r = rain(sc);
    let bad = 0, checked = 0, badRain = 0, badFc = 0;
    for (let k = 0; k < 4; k++) {
      const h = rnd(H);
      await setHour(page, h);
      const segs = Array.from({ length: 15 }, () => rnd(S));
      const cells = Array.from({ length: 8 }, () => rnd(C));
      const got = await page.evaluate(({ segs, cells }) => ({
        seg: segs.map((s) => window.__rpMap.getFeatureState({ source: "segments", id: s }).color),
        rain: cells.map((c) => window.__rpMap.getFeatureState({ source: "rain", id: c }).rain),
      }), { segs, cells });
      segs.forEach((s, i) => { checked++; if (got.seg[i] !== STATUS_COLOR[c[(0 * H + h) * S + s]]) bad++; });
      cells.forEach((cc, i) => { if (got.rain[i] !== r[h * C + cc]) badRain++; });
    }
    check(`${sc}: ${checked} segment colours match the status in the bundle`, bad === 0, `${bad} wrong`);
    check(`${sc}: rain cells match the raster`, badRain === 0, `${badRain} wrong`);

    // forecast layer: grey exactly where the bundle has no forecast
    await page.getByRole("button", { name: "Forecast +3 h" }).click();
    for (const h of [10, 100, 334]) {
      await setHour(page, h);
      const cols = await page.evaluate((n) => Array.from({ length: n },
        (_, s) => window.__rpMap.getFeatureState({ source: "segments", id: s }).color), S);
      cols.forEach((col, s) => {
        const none = c[(4 * H + h) * S + s] === manifest.no_forecast_value;
        if (none !== (col === "#8a8f98")) badFc++;
      });
    }
    check(`${sc}: forecast layer is grey exactly where no forecast exists`, badFc === 0, `${badFc} wrong`);
    await page.getByRole("button", { name: "Now" }).click();
  }

  // the closed-count readout matches the bundle
  await page.selectOption("select", "SC04");
  await page.waitForTimeout(400);
  const c4 = cube("SC04");
  let peakH = 0, peak = -1;
  for (let h = 0; h < H; h++) {
    let n = 0;
    for (let s = 0; s < S; s++) if (c4[h * S + s] >= manifest.closed_min_code) n++;
    if (n > peak) { peak = n; peakH = h; }
  }
  await setHour(page, peakH);
  const readout = await page.locator(".scrubber-row .small").innerText();
  check("closed-segment readout matches the bundle at SC04's peak", readout.startsWith(`${peak} segment`),
        `"${readout}" vs ${peak}`);

  // keyboard: arrow keys move the slider
  await page.locator("#hour").focus();
  await page.keyboard.press("ArrowRight");
  const v = await page.locator("#hour").inputValue();
  check("arrow key moves the slider one hour", v === String(peakH + 1), `value ${v}`);

  // play advances time
  await setHour(page, 0);
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Pause" }).click();
  const after = Number(await page.locator("#hour").inputValue());
  check("Play advances the hour", after > 0, `hour ${after} after 1.5 s`);

  await verifyRouteCards(page);
  await verifyExplain(page);
  await verifyLenses(page);
  await verifyStory(page);

  check("no console errors (basemap tile failures excluded)", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();

  contrastChecks();
  await verifyStreets(browser);
  await verifyLocation(browser);

  // reduced motion: playback must still work
  console.log("reduced motion");
  {
    const cx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const p = await cx.newPage();
    await p.goto(`${BASE}/corridors`);
    await waitForMap(p);
    await p.getByRole("button", { name: "Play" }).click();
    await p.waitForTimeout(1200);
    const hr = Number(await p.locator("#hour").inputValue());
    check("with prefers-reduced-motion, Play still advances the hour", hr > 0, `hour ${hr}`);
    await cx.close();
  }

  // ---------------------------------------------------------------- layouts
  console.log("layouts");
  for (const [name, vp] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
    for (const scheme of ["light", "dark"]) {
      const cx = await browser.newContext({ viewport: vp, colorScheme: scheme, isMobile: name === "mobile",
                                            hasTouch: name === "mobile" });
      const p = await cx.newPage();
      await p.goto(`${BASE}/corridors`);
      await waitForMap(p);
      await setHour(p, peakH);
      await p.waitForTimeout(500);
      const m = await p.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        mapH: document.querySelector(".map").getBoundingClientRect().height,
      }));
      check(`${name}/${scheme}: no horizontal scroll`, m.overflow <= 0, `${m.overflow}px`);
      check(`${name}/${scheme}: map is visible`, m.mapH >= 300, `${Math.round(m.mapH)}px tall`);
      if (name === "mobile") {
        // real interaction on the small viewport: tap a segment area, drag the slider
        const box = await p.locator("#hour").boundingBox();
        await p.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
        const val = Number(await p.locator("#hour").inputValue());
        check(`${name}/${scheme}: tapping the slider moves time`, Math.abs(val - 0.25 * (H - 1)) < 25, `hour ${val}`);
        await p.locator(".map").scrollIntoViewIfNeeded();
      }
      await p.screenshot({ path: path.join(OUT, `p1-${name}-${scheme}.png`), fullPage: name === "mobile" });
      await cx.close();
    }
  }

  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL UI CHECKS PASSED");
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
