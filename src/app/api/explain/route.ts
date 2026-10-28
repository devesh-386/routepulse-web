import { explain } from "@/lib/explain/explain";
import { configFromEnv, createLlmStep, createRateLimiter } from "@/lib/explain/llm";
import { parseExplainRequest } from "@/lib/explain/request";

const config = configFromEnv();
const llm = config ? createLlmStep(config) : undefined;
// best effort only: per serverless instance, not shared (see createRateLimiter)
const allow = createRateLimiter(8, 60_000);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
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
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const step = allow(ip)
    ? llm
    : async () => ({ ok: false as const, reason: "Too many AI requests from this address in the last minute, so the template answer is shown." });
  return Response.json(await explain(parsed.req, step));
}
