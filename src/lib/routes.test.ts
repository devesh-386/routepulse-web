import { describe, expect, it } from "vitest";
import { hm, recommendationReason, type RouteRow } from "./routes";

const row = (id: string, eta: number | null, risk: number, extra: Partial<RouteRow> = {}): RouteRow => ({
  routeId: id, rank: 1, lengthKm: 10, status: eta === null ? "blocked" : "passable", segmentsClosed: 0, etaMin: eta,
  freeFlowEtaMin: 50, delayMin: 0, maxDepthCm: 0, meanVc: 0.5, rain24Mm: 0, riskScore: risk, riskBand: "low",
  recommended: false, ...extra,
});

describe("hm", () => {
  it("never prints 60 minutes", () => {
    expect(hm(119.6)).toBe("2 h 0 min");
    expect(hm(59.6)).toBe("1 h 0 min");
    expect(hm(45.2)).toBe("45 min");
  });
});

describe("recommendationReason", () => {
  it("claims a lower risk score only when it is lower", () => {
    const lower = [row("R001-A1", 60, 10, { recommended: true }), row("R001-A2", 60, 20)];
    expect(recommendationReason(lower)).toMatch(/lower simulated risk score/);
    const equal = [row("R001-A1", 60, 10, { recommended: true }), row("R001-A2", 60, 10)];
    expect(recommendationReason(equal)).not.toMatch(/lower simulated risk score/);
  });
});
