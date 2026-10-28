import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildGraph, nearestNode, PLACES, route, StreetScenario, streetMinutes,
  type Graph, type Streets, type StreetsMeta,
} from "./streets";

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

describe("street data", () => {
  it("decodes every street with geometry inside Chennai", () => {
    expect(s.offsets.length).toBe(s.meta.count + 1);
    expect(s.offsets[s.meta.count] * 2).toBe(s.verts.length);
  });
  it("finds closures at the cyclone peak and none before the storm", () => {
    const series = sc.closedSeries(336);
    expect(series[0]).toBe(0);
    expect(Math.max(...series)).toBeGreaterThan(10000);
  });
  it("marks only the last step as having no forecast", () => {
    expect(sc.state(111).p[0]).toBe(255);
    expect(sc.state(110).p.every((x) => x === 255)).toBe(false);
  });
});

describe("routing", () => {
  const place = (id: string) => PLACES.find((p) => p.id === id)!;
  const peakStep = () => { const ser = sc.closedSeries(336); return sc.stepOf(ser.indexOf(Math.max(...ser))); };

  it("routes Anna Nagar → Marina Beach in all three ways on a dry hour, sensibly ordered", () => {
    const st = sc.state(0);
    const a = nearestNode(g, place("anna-nagar").lon, place("anna-nagar").lat);
    const b = nearestNode(g, place("marina").lon, place("marina").lat);
    const fast = route("fastest", s, g, st, a, b)!, short = route("shortest", s, g, st, a, b)!, safe = route("safer", s, g, st, a, b)!;
    expect(fast && short && safe).toBeTruthy();
    expect(fast.minutes).toBeLessThanOrEqual(safe.minutes + 1e-9);
    expect(short.km).toBeLessThanOrEqual(fast.km + 1e-9);
    // about 8-9 km apart as the crow flies; a road route should be longer but not absurd
    expect(fast.km).toBeGreaterThan(8);
    expect(fast.km).toBeLessThan(20);
  });

  it("never routes through a closed street, and the safer route carries less risk at the storm peak", () => {
    const st = sc.state(Math.max(0, peakStep() - 1));
    const a = nearestNode(g, place("guindy").lon, place("guindy").lat);
    const b = nearestNode(g, place("central").lon, place("central").lat);
    const fast = route("fastest", s, g, st, a, b), safe = route("safer", s, g, st, a, b);
    for (const r of [fast, safe]) if (r) expect(r.streets.every((i) => Number.isFinite(streetMinutes(s, st, i)))).toBe(true);
    if (fast && safe) expect(safe.meanP).toBeLessThanOrEqual(fast.meanP + 1e-9);
  });

  it("returns a connected path from origin to destination", () => {
    const st = sc.state(0);
    const a = nearestNode(g, place("t-nagar").lon, place("t-nagar").lat);
    const b = nearestNode(g, place("adyar").lon, place("adyar").lat);
    const r = route("fastest", s, g, st, a, b)!;
    let at = a;
    for (const i of r.streets) {
      const [u, v] = [g.nodeOfEnd[2 * i], g.nodeOfEnd[2 * i + 1]];
      expect(at === u || at === v).toBe(true);
      at = at === u ? v : u;
    }
    expect(at).toBe(b);
  });
});
