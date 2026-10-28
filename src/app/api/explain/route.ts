import { explain } from "@/lib/explain/explain";
import { configFromEnv, createLlmStep, createRateLimiter } from "@/lib/explain/llm";
import { clientKey, parseExplainRequest } from "@/lib/explain/request";

const config = configFromEnv();
const llm = config ? createLlmStep(config) : undefined;
// best effort only: per serverless instance, not shared (see createRateLimiter)
const allow = createRateLimiter(8, 60_000, Date.now, { globalLimit: 30 });
// a valid request is a few ids and enums, well under this
const MAX_BODY = 2048;

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "body too large" }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "body too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = parseExplainRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  if (!llm) {
    return Response.json({
      ...(await explain(parsed.req)),
      fallbackReason: "No AI provider is configured, so the answer is written directly from the evidence.",
    });
  }
  const step = allow(clientKey(request.headers, process.env))
    ? llm
    : async () => ({ ok: false as const, reason: "Too many AI requests in the last minute, so the template answer is shown." });
  return Response.json(await explain(parsed.req, step));
}
