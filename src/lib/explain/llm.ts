// Free LLM providers through one OpenAI-compatible /chat/completions call (Groq, Gemini's
// OpenAI endpoint, OpenRouter :free models, local Ollama). Configured by env:
//   LLM_BASE_URL   e.g. https://api.groq.com/openai/v1   (unset → template answers only)
//   LLM_MODEL      the provider's model name
//   LLM_API_KEY    optional (Ollama needs none)
// Any failure returns a reason instead of throwing; the caller falls back to the template.

import { buildEvidence, type Evidence, type EvidencePack } from "./evidence";
import type { LlmStep } from "./explain";
import { templateExplanation } from "./template";

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const baseUrl = env.LLM_BASE_URL?.trim();
  const model = env.LLM_MODEL?.trim();
  if (!baseUrl || !model) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), model, apiKey: env.LLM_API_KEY?.trim() || undefined, timeoutMs: 8000 };
}

const AUDIENCE_STYLE = {
  commuter: "a commuter deciding whether and which way to travel",
  bus_operator: "a bus operator managing services on this corridor",
  transport_planner: "a transport planner looking at why the route is at risk",
};

const RULES = `You explain a SYNTHETIC traffic and weather simulation. You only restate the evidence you are given.
Reply with JSON only: {"sentences":[{"text":"...","evidence_ids":["..."]}]}, 3 to 6 sentences.
Rules, all enforced by an automatic checker that rejects the whole answer if any sentence breaks one:
- Every sentence lists the ids of the evidence items it uses in "evidence_ids".
- Every number you write must be copied exactly from the "value" of an item you cite, followed by its unit
  (min, cm, mm, km or %); counts, ratios and scores take no unit. Never round, add, subtract or convert.
- Write every number in digits (4, not four). Never write numbers as words or use twice, double or half.
- When you use a route's or bus service's values, write its id (for example R016-A3 or TNSTC-104) in that sentence.
- Mention a time only as the exact text of time.label; mention the scenario only by the exact scenario.name.
- Only these causes are allowed, each only when you cite its item: rain (max_rainfall_24h_mm), standing water
  (max_water_depth_cm), traffic (mean_vc_ratio), closures (segments_closed or status), the scenario's storm (scenario.name).
  Never mention wind, trees, landslides, accidents or anything else.
- Words like best or recommended need the route's .recommended item; probability or forecast need a model-output item;
  risk needs .risk_score or .risk_band.
- Any sentence that cites a minutes, % or model-output value must contain the word "simulated".
  Never claim certainty or real-world status ("will", "won't", "guaranteed", "real-world").`;

function evidenceList(pack: EvidencePack) {
  return Object.values(pack.items).map((e: Evidence) => ({ id: e.id, label: e.label, value: e.value, unit: e.unit, kind: e.kind }));
}

function userMessage(pack: EvidencePack) {
  return `Audience: ${AUDIENCE_STYLE[pack.audience]}.\nExplain the situation for ${pack.od.label} using only this evidence:\n${JSON.stringify(evidenceList(pack))}`;
}

/** One worked example in the reader's lens, built from a fixed request by the template, so it is always valid. */
function example(pack: EvidencePack) {
  const ex = buildEvidence({ scenario: "SC04", hour: 207, od: "OD001", audience: pack.audience });
  return [
    { role: "user", content: userMessage(ex) },
    { role: "assistant", content: JSON.stringify({ sentences: templateExplanation(ex) }) },
  ];
}

export function parseSentences(content: string): { text: string; evidence_ids: string[] }[] | null {
  const raw = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  const s = (obj as { sentences?: unknown })?.sentences;
  if (!Array.isArray(s) || !s.length || s.length > 10) return null;
  if (!s.every((x) => x && typeof x.text === "string" && Array.isArray(x.evidence_ids)
                      && x.evidence_ids.every((i: unknown) => typeof i === "string"))) return null;
  return s.map((x) => ({ text: x.text, evidence_ids: x.evidence_ids }));
}

export function createLlmStep(cfg: LlmConfig, fetchImpl: typeof fetch = fetch): LlmStep {
  return async (pack) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
      const r = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.2,
          max_tokens: 700,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: RULES }, ...example(pack), { role: "user", content: userMessage(pack) }],
        }),
      });
      if (r.status === 429) return { ok: false, reason: "The free AI provider's rate limit was reached, so the template answer is shown." };
      if (!r.ok) return { ok: false, reason: `The AI provider returned an error (HTTP ${r.status}), so the template answer is shown.` };
      const body = await r.json().catch(() => null);
      const content = body?.choices?.[0]?.message?.content;
      const sentences = typeof content === "string" ? parseSentences(content) : null;
      if (!sentences) return { ok: false, reason: "The AI answer was not in the required format, so the template answer is shown." };
      return { ok: true, sentences };
    } catch (e) {
      const aborted = (e as { name?: string })?.name === "AbortError";
      return { ok: false, reason: aborted
        ? `The AI provider did not answer within ${cfg.timeoutMs / 1000} s, so the template answer is shown.`
        : "The AI provider could not be reached, so the template answer is shown." };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Best-effort demo protection for the free quota: an in-memory sliding window per caller, plus a cap on
 * all callers together so fresh keys can't buy unlimited calls. `key` is null when the caller can't be
 * identified (see clientKey); then only the global cap applies. Serverless instances don't share it.
 */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now,
                                  { globalLimit = limit * 4, maxKeys = 10_000 }: { globalLimit?: number; maxKeys?: number } = {}) {
  const hits = new Map<string, number[]>();
  let all: number[] = [];
  return (key: string | null) => {
    const t = now();
    all = all.filter((x) => t - x < windowMs);
    if (all.length >= globalLimit) return false;
    if (key !== null) {
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      hits.delete(key);               // re-insert so the Map stays ordered by last use
      hits.set(key, recent);
      if (recent.length >= limit) return false;
      recent.push(t);
      // bound memory: drop the least recently seen callers one at a time, never everyone at once
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value!);
    }
    all.push(t);
    return true;
  };
}
