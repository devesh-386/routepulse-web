// Produces a validated explanation: an LLM answer when one is configured and passes the
// validator, the deterministic template otherwise. Never throws for the caller.

import { MANIFEST } from "./data";
import { buildEvidence, type Evidence, type ExplainRequest } from "./evidence";
import { templateExplanation } from "./template";
import { validate, type CheckedSentence } from "./validate";

export interface ExplainResponse {
  source: "llm" | "template";
  fallbackReason?: string;
  validated: boolean;
  timeLabel: string;
  sentences: (CheckedSentence & { ai: boolean })[];
  evidence: Record<string, Evidence>;
  disclaimer: string;
}

/** An optional LLM step; returns sentences or a reason it couldn't. */
export type LlmStep = (pack: ReturnType<typeof buildEvidence>) => Promise<
  { ok: true; sentences: { text: string; evidence_ids: string[] }[] } | { ok: false; reason: string }
>;

export async function explain(req: ExplainRequest, llm?: LlmStep): Promise<ExplainResponse> {
  const pack = buildEvidence(req);
  let fallbackReason: string | undefined;

  if (llm) {
    const r = await llm(pack);
    if (r.ok) {
      const v = validate(pack, r.sentences);
      if (v.ok) return respond("llm", v.sentences, true);
      const bad = v.sentences.find((s) => !s.ok)!;
      fallbackReason = `The AI answer failed validation ("${bad.errors[0]}"), so the template answer is shown.`;
    } else {
      fallbackReason = r.reason;
    }
  }

  const v = validate(pack, templateExplanation(pack));
  return respond("template", v.sentences, v.ok);

  function respond(source: "llm" | "template", sentences: CheckedSentence[], validated: boolean): ExplainResponse {
    const used = new Set(sentences.flatMap((s) => s.evidence_ids));
    return {
      source, fallbackReason, validated, timeLabel: pack.timeLabel,
      sentences: sentences.map((s) => ({ ...s, ai: source === "llm" })),
      evidence: Object.fromEntries(Object.entries(pack.items).filter(([id]) => used.has(id))),
      disclaimer: MANIFEST.disclaimer,
    };
  }
}
