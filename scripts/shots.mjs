// Screenshots of every mode in both themes (headless Edge), for visual checks.
//   node scripts/shots.mjs [baseUrl] [outDir]
import { chromium } from "playwright-core";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3210";
const OUT = process.argv[3] ?? path.resolve(import.meta.dirname, "../test-results/shots");
const EXE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem("rp-theme", t), theme);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${theme}: ${m.text().slice(0, 200)}`); });
  for (const [name, url, hook, view] of [
    ["simple", "/simple", "__rpSimpleMap", { center: [80.258, 13.058], zoom: 13.6 }],
    ["max", "/max", "__rpStreetMap", { center: [80.258, 13.058], zoom: 13.6 }],
    ["max-3d", "/max", "__rpStreetMap", { center: [80.262, 13.06], zoom: 15.6, pitch: 60, bearing: -17 }],
    ["control", "/control-room", "__rpStreetMap", { center: [80.258, 13.058], zoom: 13.6 }],
  ]) {
    await page.goto(`${BASE}${url}`);
    await page.waitForFunction((h) => window[h], hook, { timeout: 60000 });
    if (name === "max-3d") await page.getByRole("button", { name: "3D" }).first().click().catch(() => {});
    await page.evaluate(([h, v]) => window[h].jumpTo(v), [hook, view]);
    await page.waitForFunction((h) => window[h].loaded(), hook, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `${name}-${theme}.png`) });
  }
  await ctx.close();
}
await browser.close();
console.log(errors.length ? errors.join("\n") : "no console errors");
