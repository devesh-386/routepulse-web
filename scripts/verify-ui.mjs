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
const MAX = `${BASE}/max`;
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
const streetsSrc = fs.readFileSync(path.join(ROOT, "src", "lib", "streets.ts"), "utf8");
const basemapSrc = fs.readFileSync(path.join(ROOT, "src", "lib", "basemap", "index.ts"), "utf8");
const liberty = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "lib", "basemap", "liberty.json"), "utf8"));
const rnd = (() => { let s = 42; return (n) => (s = (s * 1103515245 + 12345) % 2 ** 31) % n; })();

// basemap tiles are optional and may be unreachable; anything else in the console is a failure
const ignorable = (msg) => /cartocdn|basemap tiles unavailable/i.test(msg.text() + (msg.location()?.url ?? ""));

async function waitForStreets(page) {
  await page.waitForFunction(() => window.__rpStreetMap?.queryRenderedFeatures({ layers: ["streets"] }).length > 1000, null, { timeout: 60000 });
}

async function setHour(page, h) {
  await page.locator("[data-testid=hour]:visible").fill(String(h));
  await page.waitForFunction((h) => [...document.querySelectorAll("[data-testid=hour]")].some((e) => e.offsetParent && e.value === String(h)), h);
  await page.waitForTimeout(60);
}

function contrastChecks() {
  console.log("contrast");
  const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // the risk-band colours the street map draws (BANDS in dark, BAND_LIGHT in light) against each basemap's land colour
  const hexes = (src) => [...src.matchAll(/"(#[0-9a-f]{6})"/gi)].map((m) => m[1]);
  const bandsAt = streetsSrc.indexOf("export const BANDS");
  const pal = {
    dark: hexes(streetsSrc.slice(bandsAt, streetsSrc.indexOf("];", bandsAt))),
    light: hexes(streetsSrc.match(/const BAND_LIGHT[^\n]+/)[0]),
  };
  const bg = { light: liberty.layers[0].paint["background-color"], dark: basemapSrc.match(/\^background\$\/, \{ "background-color": "(#[0-9a-f]{6})"/)[1] };
  for (const scheme of ["light", "dark"]) {
    const ratios = pal[scheme].map((c) => cr(c, bg[scheme]));
    check(`${scheme}: every risk-band road colour has ≥ 3:1 contrast with the map background`, ratios.length === 5 && Math.min(...ratios) >= 3,
          `${ratios.length} colours on ${bg[scheme]}, min ${Math.min(...ratios).toFixed(2)}`);
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
  await page.goto(MAX);
  await page.waitForFunction(() => window.__rpStreetMap?.queryRenderedFeatures({ layers: ["streets"] }).length > 5000, null, { timeout: 60000 });
  const loadMs = Date.now() - t0;
  // 6 s on an idle machine; UI_LOAD_BUDGET_MS raises it explicitly when another job holds the CPU
  const budget = Number(process.env.UI_LOAD_BUDGET_MS ?? 6000);
  check(`street map shows thousands of streets within ${budget / 1000} s (dev server)`, loadMs < budget, `${loadMs} ms`);

  // the opening hour's colours equal the decoded sparse file
  const hour = Number(await page.locator("[data-testid=hour]:visible").inputValue());
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
    // the point must land on the map canvas itself, not under the legend, badge, labels or controls
    const canvas = m.getCanvas(), rect = canvas.getBoundingClientRect();
    let f, pt;
    for (const x of m.queryRenderedFeatures({ layers: ["streets"] })) {
      if (String(x.id) === cur || x.geometry.type !== "LineString") continue;
      const p = m.project(x.geometry.coordinates[Math.floor(x.geometry.coordinates.length / 2)]);
      if (p.x < 20 || p.y < 20 || p.x > rect.width - 20 || p.y > rect.height - 20) continue;
      if (document.elementFromPoint(rect.left + p.x, rect.top + p.y) !== canvas) continue;
      const near = m.queryRenderedFeatures([[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]], { layers: ["streets"] });
      if (near.length !== 1) continue;          // one street within the 6 px click radius, so the click is unambiguous
      f = x; pt = p; break;
    }
    if (!f) return null;
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

  // keyboard / screen reader: find a street by name, and step to the riskiest streets without a mouse
  const smeta = JSON.parse(fs.readFileSync(path.join(DATA, "streets", "streets_meta.json")));
  const want = smeta.names.includes("Anna Salai") ? "Anna Salai" : smeta.names[0];
  await page.getByTestId("street-search").fill(want);
  await page.waitForTimeout(200);
  const shownName = await page.locator(".sv-street-name b").textContent();
  check("typing a street name inspects that street", shownName === want, `${want} → ${shownName}`);
  const prevStreet = await page.getByTestId("street").getAttribute("data-street");
  await page.getByTestId("next-risky").focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const nx = await page.getByTestId("street").evaluate((e) => ({ id: e.dataset.street, p: Number(e.dataset.p) }));
  check("'Next riskiest street' works from the keyboard and picks a high-risk street", nx.id !== prevStreet && nx.p >= 40, `${nx.id} at ${nx.p} %`);

  // scrub to the storm peak: the cut-route notice offers the reopening hour
  await setHour(page, 210);
  // the reopening hour is searched after paint, in slices; wait for the answer itself, not just the notice
  const reopenAt = await page.locator(".sv-cut .sv-link").textContent({ timeout: 8000 }).catch(() => null);
  check("at the cyclone peak the route card explains when a route reopens", reopenAt !== null, reopenAt ?? "no reopening hour shown");

  check("street view: no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();

  const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: "dark", isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await mp.goto(MAX);
  await mp.waitForSelector("[data-testid=street]", { timeout: 60000 });
  await mp.waitForTimeout(1500);
  const o = await mp.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth,
    mapH: document.querySelector(".sv-mapframe").getBoundingClientRect().height }));
  check("street view at 375 px: no horizontal scroll, map visible", o.overflow <= 0 && o.mapH > 300, JSON.stringify(o));
  await mp.screenshot({ path: path.join(OUT, "sv-mobile.png"), fullPage: true });
  await m.close();
}

// ---- control room (/control-room)
async function verifyOps(browser) {
  console.log("control room");
  const cx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await cx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !ignorable(m)) errors.push(m.text()); });
  await page.goto(`${BASE}/control-room`);
  await page.waitForSelector("[data-testid=ops-target]", { timeout: 60000 });
  await setHour(page, 210);
  await page.waitForTimeout(400);
  const rows = await page.$$eval("[data-testid=threat]", (els) => els.map((e) => [Number(e.dataset.closedKm), Number(e.dataset.riskKm)]));
  const sorted = rows.every((r, k) => k === 0 || rows[k - 1][0] > r[0] || (rows[k - 1][0] === r[0] && rows[k - 1][1] >= r[1]));
  check("threat board is ranked by km closed, then km at risk", rows.length > 0 && sorted, rows.slice(0, 3).map((r) => r[0].toFixed(1)).join(" ≥ "));
  check("threat board separates roads at the storm peak", new Set(rows.map((r) => r[0].toFixed(2))).size > 1);
  const pick = page.locator("[data-testid=threat]").nth(1);
  const want = await pick.getAttribute("data-street");
  await pick.click();
  check("clicking a threat locks it as the target", (await page.getByTestId("ops-target").getAttribute("data-street")) === want, want);
  await page.keyboard.press("ArrowRight");   // focus is still on the clicked threat button
  check("arrow key steps the console clock by 3 h", (await page.locator("[data-testid=hour]:visible").inputValue()) === "213");
  const fit = await page.evaluate(() => {
    const col = document.querySelector(".ops-col"), tiles = document.querySelectorAll(".ops-sector");
    return { scrolls: col.scrollHeight > col.clientHeight + 1, lastBottom: tiles[tiles.length - 1].getBoundingClientRect().bottom, h: innerHeight };
  });
  check("1440×900: threats and all 13 sectors fit without scrolling", !fit.scrolls && fit.lastBottom <= fit.h, `last sector at ${Math.round(fit.lastBottom)} px`);
  await page.locator("[data-testid=hour]:visible").fill("335");
  await page.waitForTimeout(400);
  const last = await page.$$eval(".ops-route-main small", (els) => els.map((e) => e.textContent));
  check("on the last step routes say there is no risk estimate", last.length > 0 && last.every((t) => t.includes("no estimate")), last[0] ?? "no routes");
  check("control room: no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.screenshot({ path: path.join(OUT, "ops-desktop.png") });
  await cx.close();

  const m = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: "dark", isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/control-room`);
  await mp.waitForSelector("[data-testid=ops-target]", { timeout: 60000 });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check("control room at 375 px: no horizontal scroll", overflow <= 0, `${overflow}px`);
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
    await page.goto(MAX);
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

// ---- Simple mode (/simple): the v2.0 planner layout on the shared street simulation
async function verifySimple(browser) {
  console.log("simple mode");
  const cx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await cx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !ignorable(m)) errors.push(m.text()); });
  await page.goto(`${BASE}/simple`);
  await page.waitForFunction(() => document.querySelectorAll(".rps-card").length > 0, null, { timeout: 60000 });
  const cards = await page.$$eval(".rps-card", (els) => els.map((e) => e.dataset.route));
  check("simple: Anna Nagar → Marina Beach gives lettered route cards", cards.length >= 1 && cards.every((c) => /^[A-C]$/.test(c)), cards.join(","));
  check("simple: exactly one card is marked best", (await page.locator(".rps-card.best").count()) === 1);
  const winBalanced = await page.getByTestId("simple-cards").getAttribute("data-winner");
  await page.getByRole("button", { name: "Fastest", exact: true }).click();
  const times = await page.$$eval(".rps-card .rps-big", (els) => els.map((e) => parseFloat(e.textContent)));
  const bestTime = parseFloat(await page.locator(".rps-card.best .rps-big").textContent());
  check("simple: Fastest picks the lowest travel time", bestTime <= Math.min(...times) + 1e-9, `${bestTime} of ${times.join(", ")}`);
  check("simple: summary bar names the best route", (await page.getByTestId("simple-summary").innerText()).includes("Best for Fastest"));
  await page.getByRole("button", { name: "Balanced", exact: true }).click();
  check("simple: switching priority back restores the same winner", (await page.getByTestId("simple-cards").getAttribute("data-winner")) === winBalanced, winBalanced);
  // local street search: the planner knows every named street
  await page.getByTestId("simple-to").fill("Kamarajar Prom");
  const sug = await page.locator(".rps-sug").first().innerText();
  check("simple: typing a street name suggests it from the street data", sug.startsWith("Kamarajar Promenade"), sug.split("\n")[0]);
  await page.locator(".rps-sug").first().click();
  await page.waitForFunction(() => document.querySelectorAll(".rps-card, .rps-empty").length > 0);
  check("simple: choosing the street sets the destination", (await page.getByTestId("simple-to").inputValue()) === "Kamarajar Promenade");
  // vehicle limits: a bus never uses a minor street, a bike never crosses water deeper than 12 cm
  await page.locator("select").first().selectOption("bus");
  await page.waitForTimeout(300);
  check("simple: bus routes or says why not", (await page.locator(".rps-card, .rps-empty.warn").count()) > 0);
  // layers, legend and info live in map dropdowns, like Max mode; one open at a time, Escape closes
  const stage = page.locator(".rps-tools");
  check("simple: dropdowns start closed", (await page.locator(".rps-menu-panel:visible").count()) === 0);
  await stage.getByRole("button", { name: "Layers" }).click();
  const water = page.locator("#rps-menu-layers").getByRole("button", { name: "Water depth" });
  await water.click();
  check("simple: Layers dropdown toggles a layer", (await water.getAttribute("aria-pressed")) === "false");
  await water.click();
  await stage.getByRole("button", { name: "Legend" }).click();
  check("simple: opening Legend closes Layers", await page.locator("#rps-menu-legend").isVisible() && !(await page.locator("#rps-menu-layers").isVisible()));
  await page.keyboard.press("Escape");
  check("simple: Escape closes the dropdown", (await page.locator(".rps-menu-panel:visible").count()) === 0);
  await page.locator(".rp-rail").getByRole("button", { name: "Info" }).click();
  check("simple: the rail's Info button opens the Info dropdown", await page.locator("#rps-menu-info").isVisible());
  await page.keyboard.press("Escape");
  // inspector
  await page.locator(".rp-rail").getByRole("button", { name: /Inspect/ }).click();
  check("simple: Inspect opens the street inspector", await page.getByTestId("simple-inspect").isVisible());
  check("simple: no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.screenshot({ path: path.join(OUT, "simple-desktop.png") });
  await cx.close();

  const m = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/simple`);
  await mp.waitForFunction(() => document.querySelectorAll(".rps-card").length > 0, null, { timeout: 60000 });
  const o = await mp.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, mapH: document.querySelector(".rps-stage").getBoundingClientRect().height }));
  check("simple at 375 px: no horizontal scroll, map visible", o.overflow <= 0 && o.mapH >= 300, JSON.stringify(o));
  await mp.screenshot({ path: path.join(OUT, "simple-mobile.png"), fullPage: true });
  await m.close();
}

// ---- hero (/) and switching between modes
async function verifyHeroAndModes(browser) {
  console.log("hero and modes");
  const cx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await cx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !ignorable(m)) errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__rpHeroMap, null, { timeout: 60000 });
  await page.waitForTimeout(6000);   // street data loads, then the drive starts
  const c0 = await page.evaluate(() => window.__rpHeroMap.getCenter().toArray());
  await page.waitForTimeout(1500);
  const c1 = await page.evaluate(() => window.__rpHeroMap.getCenter().toArray());
  check("hero: the car drives (camera moves along the beach road)", Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) > 1e-5, `${c0} → ${c1}`);
  check("hero: three mode cards", (await page.locator(".hero-card").count()) === 3);
  check("hero: credits name OpenStreetMap, Overture, OpenFreeMap and say it is not Google", /OpenStreetMap[\s\S]*Overture[\s\S]*OpenFreeMap[\s\S]*not affiliated with Google/.test(await page.locator(".hero-credits").innerText()));
  await page.getByRole("button", { name: "Pause drive" }).click();
  const p0 = await page.evaluate(() => window.__rpHeroMap.getCenter().toArray());
  await page.waitForTimeout(800);
  const p1 = await page.evaluate(() => window.__rpHeroMap.getCenter().toArray());
  check("hero: Pause stops the drive", Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1e-7);
  await page.screenshot({ path: path.join(OUT, "hero.png") });
  // mode switching through the shared rail, there and back, twice
  await page.locator(".hero-card", { hasText: "Simple mode" }).click();
  await page.waitForSelector(".rps-card", { timeout: 60000 });
  // in-app navigation can load maplibre-gl.css after a mode's own CSS; every map must still fill its frame
  const mapH = () => page.evaluate(() => Math.min(...[...document.querySelectorAll(".maplibregl-map")].map((e) => e.getBoundingClientRect().height)));
  const heights = [];
  for (let k = 0; k < 2; k++) {
    await page.locator(".rp-rail").getByRole("listitem").filter({ hasText: "Max" }).click();
    await page.waitForSelector("[data-testid=street]", { timeout: 60000 });
    heights.push(["max", await mapH()]);
    await page.locator(".rp-rail").getByRole("listitem").filter({ hasText: "Control" }).click();
    await page.waitForSelector("[data-testid=ops-target]", { timeout: 60000 });
    heights.push(["control", await mapH()]);
    await page.locator(".rp-rail").getByRole("listitem").filter({ hasText: "Simple" }).click();
    await page.waitForSelector(".rps-card", { timeout: 60000 });
    heights.push(["simple", await mapH()]);
  }
  check("modes: after every switch the map fills its frame (≥ 300 px tall)", heights.every(([, h]) => h >= 300), heights.map(([m, h]) => `${m} ${Math.round(h)}`).join(", "));
  check("modes: Simple → Max → Control room → Simple, twice, without errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  // same as the rail's theme button (src/lib/useDark.ts setTheme), but usable while a page is still loading
  const flipTheme = () => page.evaluate(() => {
    const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("rp-theme", t); document.documentElement.dataset.theme = t; window.dispatchEvent(new Event("rp-theme"));
  });
  // regression: leaving Max while driving, and switching or flipping the theme before a map has drawn, used to crash
  await page.locator(".rp-rail").getByRole("listitem").filter({ hasText: "Max" }).click();
  await page.waitForSelector("[data-testid=street]", { timeout: 60000 });
  await page.getByRole("button", { name: /Drive route/ }).first().click();
  await page.waitForTimeout(800);
  const ready = { Control: "[data-testid=ops-target]", Simple: ".rps-card", Max: "[data-testid=street]" };
  for (const mode of ["Control", "Simple", "Max", "Control", "Max", "Simple"]) {
    await page.locator(".rp-rail").getByRole("listitem").filter({ hasText: mode }).click();
    await flipTheme();   // lands while the new map is still loading
    await page.locator(`${ready[mode]}:visible`).first().waitFor({ timeout: 60000 });
  }
  check("modes: leave Max mid-drive, then fast switches with theme flips, without errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  // a revisited mode is rebuilt from a hidden page: its streets must be coloured again and its basemap in the current theme
  await flipTheme();
  await page.locator(".rp-rail").getByRole("listitem").filter({ hasText: "Max" }).click();
  // Max comes back still driving (zoomed in), so wait for any drawn streets, not the city-wide count
  await page.waitForFunction(() => window.__rpStreetMap?.loaded() && window.__rpStreetMap.queryRenderedFeatures({ layers: ["streets"] }).length > 0, null, { timeout: 60000 });
  await page.getByRole("button", { name: "Exit" }).click().catch(() => {});
  await page.evaluate(() => window.__rpStreetMap.jumpTo({ center: [80.25, 13.05], zoom: 12.5, pitch: 0, bearing: 0 }));
  await page.waitForFunction(() => window.__rpStreetMap.loaded(), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => {
    const m = window.__rpStreetMap, dark = document.documentElement.dataset.theme === "dark";
    const coloured = m.queryRenderedFeatures({ layers: ["streets"] }).some((f) => m.getFeatureState({ source: "streets", sourceLayer: "streets", id: f.id }).b != null);
    return { dark, coloured, bg: m.getPaintProperty("bm-background", "background-color") };
  });
  check("modes: back in Max, streets are coloured and the basemap follows the theme", back.coloured && (back.bg === "#0b1520") === back.dark, JSON.stringify(back));
  await page.goto(`${BASE}/ops`);
  check("old /ops address opens the control room", page.url().endsWith("/control-room"), page.url());
  await cx.close();
}

async function main() {
  if (!EXE) throw new Error("No Edge/Chrome found; set BROWSER_PATH");
  const browser = await chromium.launch({ executablePath: EXE, headless: true });

  contrastChecks();
  await verifyStreets(browser);
  await verifyLocation(browser);
  await verifyOps(browser);
  await verifySimple(browser);
  await verifyHeroAndModes(browser);

  // reduced motion: playback must still work
  console.log("reduced motion");
  {
    const cx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const p = await cx.newPage();
    await p.goto(MAX);
    await waitForStreets(p);
    await p.locator(".scrubber").getByRole("button", { name: "Play" }).click();
    await p.waitForTimeout(1200);
    const hr = Number(await p.locator("[data-testid=hour]:visible").inputValue());
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
      await p.goto(MAX);
      await waitForStreets(p);
      await setHour(p, 200);
      await p.waitForTimeout(500);
      const m = await p.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        mapH: document.querySelector(".sv-map").getBoundingClientRect().height,
      }));
      check(`${name}/${scheme}: no horizontal scroll`, m.overflow <= 0, `${m.overflow}px`);
      check(`${name}/${scheme}: map is visible`, m.mapH >= 300, `${Math.round(m.mapH)}px tall`);
      if (name === "mobile") {
        // real interaction on the small viewport: tap a segment area, drag the slider
        const box = await p.locator("[data-testid=hour]:visible").boundingBox();
        await p.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
        const val = Number(await p.locator("[data-testid=hour]:visible").inputValue());
        check(`${name}/${scheme}: tapping the slider moves time`, Math.abs(val - 0.25 * (H - 1)) < 25, `hour ${val}`);
        await p.locator(".sv-map").scrollIntoViewIfNeeded();
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
