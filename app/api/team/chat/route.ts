import { NextRequest, NextResponse } from "next/server";
import { logApiUsage, enforceApiLimit } from "@/lib/log-api-usage";
import { logAiInteraction } from "@/lib/ai-logger";
import { ALLOWED_CHAT_MODELS, SONNET } from "@/lib/models";

// PRD generation legitimately asks for 8000; clamp anything above to a sane
// ceiling so a crafted request can't run up the bill on a single call.
const MAX_OUTPUT_TOKENS = 8192;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[team/chat] ANTHROPIC_API_KEY is not set.");
    return NextResponse.json({ error: "Server is not configured for AI." }, { status: 500 });
  }

  const { model, system, messages, max_tokens } = await req.json();

  if (typeof model !== "string" || !ALLOWED_CHAT_MODELS.has(model)) {
    return NextResponse.json({ error: "Unsupported model" }, { status: 400 });
  }
  if (!Array.isArray(messages)) {
    return NextResponse.json({ error: "messages must be an array" }, { status: 400 });
  }

  // Hard limit check
  const limitResponse = await enforceApiLimit("anthropic");
  if (limitResponse) return limitResponse;

  // Clamp max_tokens so a crafted request can't run up the bill on one call.
  const maxTokens = Math.min(
    Math.max(1, typeof max_tokens === "number" ? max_tokens : 1024),
    MAX_OUTPUT_TOKENS
  );

  // Cache the (large, repeated) system prompt — agents re-send the same
  // ~2k-token persona across turns, and synthesis/PRD reuse Sarah's prompt.
  const systemStr = typeof system === "string" ? system : system ? JSON.stringify(system) : "";
  const systemForApi =
    typeof system === "string" && system.trim().length > 0
      ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
      : system;

  const startTime = Date.now();
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemForApi,
      messages,
    }),
  });

  const data = await upstream.json();

  if (!upstream.ok) {
    // Don't leak Anthropic's error envelope to the browser — log it server-side
    // and return a generic message. The client just needs to know it failed.
    console.error("[team/chat] Anthropic error", upstream.status, data);
    return NextResponse.json({ error: "Upstream model error" }, { status: 502 });
  }

  // Log to ai_logs (per CLAUDE.md: always wrap Claude calls with
  // logAiInteraction) and to api_usage for cost tracking.
  const outputText =
    Array.isArray(data.content) && data.content[0]?.type === "text"
      ? data.content[0].text
      : "";
  await logAiInteraction({
    feature: "team-chat",
    model,
    prompt: systemStr,
    input: { messages, max_tokens: maxTokens },
    output: outputText,
    latency_ms: Date.now() - startTime,
    input_tokens: data.usage?.input_tokens ?? 0,
    output_tokens: data.usage?.output_tokens ?? 0,
    session_id: req.cookies.get("rise_session_id")?.value ?? null,
  });

  if (data.usage) {
    await logApiUsage({
      provider: "anthropic", apiType: "team-chat", feature: "team",
      model: model ?? SONNET,
      inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens,
    });
  }

  return NextResponse.json(data);
}
