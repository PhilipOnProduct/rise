import { NextRequest, NextResponse } from "next/server";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";

export async function POST(req: NextRequest) {
  const { model, system, messages, max_tokens } = await req.json();

  // Hard limit check
  const limit = await checkApiLimit("anthropic");
  if (!limit.allowed) {
    return NextResponse.json({ error: "API limit exceeded", provider: "anthropic", spentUsd: limit.spentUsd, limitUsd: limit.limitUsd }, { status: 429 });
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: max_tokens ?? 1024,
      system,
      messages,
    }),
  });

  const data = await upstream.json();
  console.log("[team/chat] Anthropic response", upstream.status, JSON.stringify(data).slice(0, 500));

  if (!upstream.ok) {
    console.error("[team/chat] Anthropic error", upstream.status, data);
    return NextResponse.json(data, { status: upstream.status });
  }

  // Log usage from response
  if (data.usage) {
    await logApiUsage({
      provider: "anthropic", apiType: "team-chat", feature: "team",
      model: model ?? "claude-sonnet-4-6",
      inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens,
    });
  }

  return NextResponse.json(data);
}
