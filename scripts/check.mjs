// One gate for a release: typecheck, lint, unit tests, then the headless UI suite against a running server.
//
//   node scripts/check.mjs [baseUrl] [--dataset]     default http://localhost:3210
//
// --dataset also runs ../routepulse-dataset/verify_bundle.py (read-only checks of public/data).
// Exits non-zero on the first failing step; nothing counts as ready just because the page renders.

import { spawnSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith("--")) ?? "http://localhost:3210";
const ROOT = path.resolve(import.meta.dirname, "..");
const DATASET = path.resolve(ROOT, "..", "routepulse-dataset");

const steps = [
  ["typecheck", "npx", ["tsc", "--noEmit"]],
  ["lint", "npx", ["eslint", "src"]],
  ["unit tests", "npx", ["vitest", "run"]],
];
if (args.includes("--dataset")) steps.push(["bundle verification", "python", ["-I", path.join(DATASET, "verify_bundle.py")], DATASET]);

for (const [name, cmd, argv, cwd = ROOT] of steps) {
  console.log(`\n== ${name}`);
  const r = spawnSync(cmd, argv, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error(`\nCHECK FAILED at ${name}`); process.exit(1); }
}

console.log(`\n== UI suite against ${BASE}`);
const up = await fetch(BASE).then((r) => r.ok).catch(() => false);
if (!up) {
  console.error(`No server at ${BASE}. Start one (npx next dev -p 3210) and rerun; the UI suite is part of the gate.`);
  process.exit(1);
}
const ui = spawnSync("node", [path.join(ROOT, "scripts", "verify-ui.mjs"), BASE], { cwd: ROOT, stdio: "inherit" });
if (ui.status !== 0) { console.error("\nCHECK FAILED at UI suite"); process.exit(1); }
console.log("\nALL CHECKS PASSED");
