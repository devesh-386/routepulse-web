import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STORY } from "./data";
import { buildEvidence, display } from "./evidence";
import { explain } from "./explain";
import { configFromEnv, createLlmStep, createRateLimiter, parseSentences, type LlmConfig } from "./llm";
import { clientKey } from "./request";
import type { ExplainRequest } from "./evidence";

// a local stand-in for an OpenAI-compatible provider; each test sets how it behaves
type Behaviour = { status?: number; content?: string; delayMs?: number };
let behaviour: Behaviour = {};
let lastRequest: { auth?: string; body?: { model: string; messages: { role: string; content: string }[] } } = {};
let server: http.Server;
let cfg: LlmConfig;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastRequest = { auth: req.headers.authorization, body: JSON.parse(raw) };
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(behaviour.status ?? 200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: behaviour.content ?? "" } }] }));
      }, behaviour.delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  cfg = { baseUrl: `http://127.0.0.1:${port}/v1`, model: "stub-model", apiKey: "test-key", timeoutMs: 400 };
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const step = STORY.steps[2];
const req: ExplainRequest = { scenario: STORY.scenario as ExplainRequest["scenario"], hour: step.hour, od: STORY.od_pair, audience: "commuter" };
const pack = buildEvidence(req);
const NEW = step.route;
const eta = display(pack.items[`route.${NEW}.eta_min`]);

const reply = (sentences: unknown) => JSON.stringify({ sentences });

describe("LLM path", () => {
  it("uses a grounded AI answer and labels it as AI", async () => {
    behaviour = { content: reply([
      { text: `${NEW} is the best-performing route in this scenario, with a simulated ETA of ${eta} min.`,
        evidence_ids: [`route.${NEW}.recommended`, `route.${NEW}.eta_min`] },
      { text: `${step.previous_route} is blocked.`, evidence_ids: [`route.${step.previous_route}.status`] },
    ]) };
    const r = await explain(req, createLlmStep(cfg));
    expect(r.source).toBe("llm");
    expect(r.validated).toBe(true);
    expect(r.sentences.every((s) => s.ai)).toBe(true);
    expect(r.fallbackReason).toBeUndefined();
  });

  it("sends the key, the model and only evidence from the server", async () => {
    expect(lastRequest.auth).toBe("Bearer test-key");
    expect(lastRequest.body!.model).toBe("stub-model");
    const user = lastRequest.body!.messages.at(-1)!.content;
    expect(user).toContain(`route.${NEW}.eta_min`);
    expect(lastRequest.body!.messages[0].role).toBe("system");
  });

  it("falls back to the template when the AI answer invents a number", async () => {
    behaviour = { content: reply([{ text: `${NEW} takes 999.9 min.`, evidence_ids: [`route.${NEW}.eta_min`] }]) };
    const r = await explain(req, createLlmStep(cfg));
    expect(r.source).toBe("template");
    expect(r.validated).toBe(true);
    expect(r.fallbackReason).toMatch(/failed validation.*999.9 is not in the evidence/);
  });

  it("falls back when the AI answer names an unsupported cause", async () => {
    behaviour = { content: reply([{ text: `${NEW} is slower because of fallen trees.`, evidence_ids: [`route.${NEW}.eta_min`] }]) };
    const r = await explain(req, createLlmStep(cfg));
    expect(r.source).toBe("template");
    expect(r.fallbackReason).toMatch(/not a cause the evidence supports/);
  });

  it("falls back on output that is not the required JSON", async () => {
    behaviour = { content: "Sure! Route R016-A3 looks good." };
    const r = await explain(req, createLlmStep(cfg));
    expect(r.source).toBe("template");
    expect(r.fallbackReason).toMatch(/required format/);
  });

  it("falls back on a free-tier rate limit (429)", async () => {
    behaviour = { status: 429 };
    const r = await explain(req, createLlmStep(cfg));
    expect(r.source).toBe("template");
    expect(r.fallbackReason).toMatch(/rate limit/);
  });

  it("falls back on a provider error", async () => {
    behaviour = { status: 500 };
    const r = await explain(req, createLlmStep(cfg));
    expect(r.fallbackReason).toMatch(/HTTP 500/);
  });

  it("falls back when the provider is too slow", async () => {
    behaviour = { delayMs: 1500, content: reply([]) };
    const t = Date.now();
    const r = await explain(req, createLlmStep(cfg));
    expect(Date.now() - t).toBeLessThan(1200);
    expect(r.source).toBe("template");
    expect(r.fallbackReason).toMatch(/did not answer within 0.4 s/);
  });

  it("falls back when the provider is unreachable", async () => {
    const r = await explain(req, createLlmStep({ ...cfg, baseUrl: "http://127.0.0.1:1/v1" }));
    expect(r.source).toBe("template");
    expect(r.fallbackReason).toMatch(/could not be reached/);
  });
});

describe("helpers", () => {
  it("reads config from env and treats a missing URL or model as no provider", () => {
    expect(configFromEnv({})).toBeNull();
    expect(configFromEnv({ LLM_BASE_URL: "https://x/v1" })).toBeNull();
    expect(configFromEnv({ LLM_BASE_URL: "http://localhost:11434/v1/", LLM_MODEL: "qwen" }))
      .toEqual({ baseUrl: "http://localhost:11434/v1", model: "qwen", apiKey: undefined, timeoutMs: 8000 });
  });
  it("parses fenced JSON and rejects malformed sentence lists", () => {
    expect(parseSentences('```json\n{"sentences":[{"text":"a","evidence_ids":["x"]}]}\n```')).toHaveLength(1);
    expect(parseSentences('{"sentences":[{"text":"a"}]}')).toBeNull();
    expect(parseSentences('{"sentences":[]}')).toBeNull();
    expect(parseSentences("not json")).toBeNull();
  });
  it("rate limiter allows the limit per window, per key", () => {
    let t = 0;
    const allow = createRateLimiter(2, 1000, () => t);
    expect([allow("a"), allow("a"), allow("a"), allow("b")]).toEqual([true, true, false, true]);
    t = 1001;
    expect(allow("a")).toBe(true);
  });
});

// the brutal review (#4): the limiter trusted a spoofable header and cleared every window at 5,000 keys
describe("rate limiter hardening", () => {
  it("evicts the oldest keys instead of clearing everyone", () => {
    let t = 0;
    const allow = createRateLimiter(1, 60_000, () => t, { globalLimit: Infinity });
    expect(allow("victim")).toBe(true);
    expect(allow("victim")).toBe(false);
    for (let k = 0; k < 5001; k++) allow(`k${k}`);   // the old code cleared every window here
    t = 1;
    expect(allow("victim")).toBe(false);   // still limited after other keys arrive
  });
  it("caps all callers together, so fresh keys cannot buy unlimited calls", () => {
    const allow = createRateLimiter(8, 60_000, () => 0, { globalLimit: 3 });
    expect(["k1", "k2", "k3", "k4"].map((k) => allow(k))).toEqual([true, true, true, false]);
  });
  it("applies only the global cap when the caller can't be identified", () => {
    const allow = createRateLimiter(1, 60_000, () => 0, { globalLimit: 2 });
    expect([allow(null), allow(null), allow(null)]).toEqual([true, true, false]);
  });
});

describe("clientKey", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("ignores client-supplied forwarding headers off Vercel", () => {
    expect(clientKey(h({ "x-forwarded-for": "1.2.3.4" }), {})).toBeNull();
  });
  it("trusts x-forwarded-for on Vercel, which overwrites it", () => {
    expect(clientKey(h({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }), { VERCEL: "1" })).toBe("1.2.3.4");
  });
  it("uses the configured header behind a trusted proxy", () => {
    expect(clientKey(h({ "x-real-ip": "9.9.9.9" }), { RATE_LIMIT_IP_HEADER: "x-real-ip" })).toBe("9.9.9.9");
  });
});
