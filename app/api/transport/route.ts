import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";
import { buildCompositionSegment } from "@/lib/composition";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-20250514";

const SYSTEM = `You are a practical travel advisor specialising in airport-to-hotel transport. Compare public transport vs taxi/rideshare for the journey provided. Cover: estimated cost (local currency), travel time, comfort, step-by-step instructions, and practical tips.

Format your response as:

## 🚌 Public Transport
**Cost:** [amount]
**Time:** [duration]
**Comfort:** [★ rating]

[Step-by-step instructions]

**Tips:** [practical advice]

---

## 🚕 Taxi / Rideshare
**Cost:** [amount]
**Time:** [duration]
**Comfort:** [★ rating]

[Step-by-step instructions]

**Tips:** [practical advice]

---

## Verdict
[One or two sentences on which option you recommend and why, based on the specific journey]`;

export async function POST(req: NextRequest) {
  const { airport, hotel, city, travelerCount, childrenAges } = await req.json();

  // Hard limit check
  const limit = await checkApiLimit("anthropic");
  if (!limit.allowed) {
    return NextResponse.json({ error: "API limit exceeded", provider: "anthropic", spentUsd: limit.spentUsd, limitUsd: limit.limitUsd }, { status: 429 });
  }

  const composition = buildCompositionSegment(travelerCount, childrenAges);

  const userMessage =
    `Journey: ${airport} → ${hotel}, ${city}.` +
    (composition ? `\nTraveller composition: ${composition}` : "");

  const startTime = Date.now();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let output = "";
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          controller.enqueue(encoder.encode(event.delta.text));
          output += event.delta.text;
        }
      }
      controller.close();

      try {
        const final = await stream.finalMessage();
        await logAiInteraction({
          feature: "transport",
          model: MODEL,
          prompt: `${SYSTEM}\n\n---\n\n${userMessage}`,
          input: {
            airport,
            hotel,
            city,
            travelerCount: travelerCount ?? null,
            childrenAges: childrenAges ?? null,
          },
          output,
          latency_ms: Date.now() - startTime,
          input_tokens: final.usage.input_tokens,
          output_tokens: final.usage.output_tokens,
        });
        await logApiUsage({
          provider: "anthropic", apiType: "transport", feature: "transport",
          model: MODEL, inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens,
        });
      } catch (err) {
        console.error("[transport] Logging failed:", err);
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
