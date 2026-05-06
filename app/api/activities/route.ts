import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

export async function POST(req: NextRequest) {
  const { destination } = await req.json();

  if (!destination || typeof destination !== "string") {
    return NextResponse.json({ error: "destination required" }, { status: 400 });
  }

  const limit = await checkApiLimit("anthropic");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "API limit exceeded", provider: "anthropic", spentUsd: limit.spentUsd, limitUsd: limit.limitUsd },
      { status: 429 }
    );
  }

  const safeDestination = destination.slice(0, 200);

  const prompt = `Generate exactly 20 unique activity suggestions for travelers visiting ${safeDestination}.

Return ONLY a valid JSON array — no markdown, no explanation, no code fences. Each object must have:
- id: number (1–20)
- name: string (activity name, max 40 chars)
- category: one of "Culture", "Food & Drink", "Nature", "Adventure", "Nightlife", "Shopping", "Art", "History", "Sports", "Relaxation"
- description: string (one sentence, max 90 chars)
- emoji: single emoji that fits the activity

Cover a wide variety of categories. Make suggestions specific to ${safeDestination}.`;

  const startTime = Date.now();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    let activities: unknown;
    try {
      activities = JSON.parse(cleaned);
    } catch {
      // Fallback: pull the array between the first '[' and the last ']'.
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");
      if (start !== -1 && end > start) {
        try { activities = JSON.parse(cleaned.slice(start, end + 1)); } catch {
          console.error("[activities] JSON parse failed. Raw:\n", text);
          return NextResponse.json({ error: "AI returned malformed JSON. Please try again." }, { status: 500 });
        }
      } else {
        console.error("[activities] JSON parse failed. Raw:\n", text);
        return NextResponse.json({ error: "AI returned malformed JSON. Please try again." }, { status: 500 });
      }
    }

    await logAiInteraction({
      feature: "activities",
      model: MODEL,
      prompt,
      input: { destination: safeDestination },
      output: cleaned,
      latency_ms: Date.now() - startTime,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      session_id: req.cookies.get("rise_session_id")?.value ?? null,
    });

    await logApiUsage({
      provider: "anthropic", apiType: "activities", feature: "activities",
      model: MODEL, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
    });

    return NextResponse.json(activities);
  } catch (err) {
    console.error("[activities] Failed:", err);
    return NextResponse.json({ error: "Failed to generate activities." }, { status: 500 });
  }
}
