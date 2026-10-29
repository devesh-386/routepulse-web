import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { best, explain, planTrip, PRIORITIES } from "./planner";
import { buildGraph, PLACES, StreetScenario, VEHICLES, type Graph, type Streets, type StreetsMeta } from "./streets";

const DIR = path.resolve(__dirname, "../../public/data/streets");
const ab = (f: string) => { const b = fs.readFileSync(path.join(DIR, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
let s: Streets, g: Graph, sc: StreetScenario;

beforeAll(() => {
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, "streets_meta.json"), "utf8")) as StreetsMeta;
  const buf = ab("streets.bin");
  const v = (n: string) => {
    const l = meta.layout.find((x) => x.name === n)!;
    return l.dtype === "uint32" ? new Uint32Array(buf, l.offset, l.length)
      : l.dtype === "uint16" ? new Uint16Array(buf, l.offset, l.length) : new Uint8Array(buf, l.offset, l.length);
  };
  s = {
    meta, forecastInfo: JSON.parse(fs.readFileSync(path.join(DIR, "street_forecast.json"), "utf8")),
    offsets: v("offsets") as Uint32Array, verts: v("verts") as Uint16Array, name: v("name") as Uint16Array,
    lengthDm: v("length_dm") as Uint16Array, cls: v("class") as Uint8Array, flags: v("flags") as Uint8Array,
    low: v("low_q") as Uint8Array, mult: v("mult_q") as Uint8Array, u: v("u_q") as Uint8Array, v: v("v_q") as Uint8Array,
  };
  g = buildGraph(s);
  sc = new StreetScenario("SC04", ab("sc04_streets.bin"), meta.count,
                          JSON.parse(fs.readFileSync(path.join(DIR, "sc04_fcst.json"), "utf8")).block_corners_mm);
});

const at = (id: string): [number, number] => { const p = PLACES.find((x) => x.id === id)!; return [p.lon, p.lat]; };

describe("simple-mode planner", () => {
  it("labels distinct routes A.. and gives each priority exactly one winner", () => {
    const plan = planTrip(s, g, sc.state(60), at("anna-nagar"), at("marina"), VEHICLES[0]);
    expect(plan.error).toBeNull();
    expect(plan.routes.length).toBeGreaterThan(0);
    expect(plan.routes.map((r) => r.letter)).toEqual(["A", "B", "C"].slice(0, plan.routes.length));
    expect(new Set(plan.routes.map((r) => r.key)).size).toBe(plan.routes.length);
    for (const p of PRIORITIES) expect(plan.routes.filter((r) => r.rank[p.id] === 1)).toHaveLength(1);
    const fast = best(plan, "fastest")!;
    expect(plan.routes.every((r) => r.route.minutes >= fast.route.minutes - 1e-9)).toBe(true);
  });

  it("reports no route rather than inventing one, and a same-point trip as such", () => {
    expect(planTrip(s, g, sc.state(0), at("marina"), at("marina"), VEHICLES[0]).error).toBe("same_point");
    const ser = sc.closedSeries(336), peak = sc.stepOf(ser.indexOf(Math.max(...ser)));
    for (const v of VEHICLES) {
      const plan = planTrip(s, g, sc.state(peak), at("guindy"), at("central"), v);
      if (plan.error) expect(plan.routes).toHaveLength(0);
      else for (const r of plan.routes) expect(r.route.streets.every((i) => sc.state(peak).depth[i] < v.maxDepthCm)).toBe(true);
    }
  });

  it("explains with numbers from the plan and always carries the simulation disclaimer", () => {
    const plan = planTrip(s, g, sc.state(60), at("t-nagar"), at("adyar"), VEHICLES[0]);
    const text = explain(plan, "balanced", "Car");
    const b = best(plan, "balanced")!;
    expect(text).toContain(`Route ${b.letter}`);
    expect(text).toContain(b.route.km.toFixed(1));
    expect(text).toContain("synthetic scenario");
  });
});
