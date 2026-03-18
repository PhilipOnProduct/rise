import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { model, system, messages, max_tokens } = await req.json();

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

  return NextResponse.json(data);
}
