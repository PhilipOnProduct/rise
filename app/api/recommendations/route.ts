import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";
import { buildCompositionSegment } from "@/lib/composition";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-20250514";

const SYSTEM = `You are a knowledgeable restaurant advisor. Based on the travel profile provided, recommend 5 restaurants. For each provide: name, cuisine type, price range, a short description, and why it suits this specific traveler.

Format each restaurant as:
**[Restaurant Name]** — [Cuisine] · [Price range €/€€/€€€/€€€€]
[Short description]
*Why it suits you: [reason]*

Keep descriptions concise and practical. Strictly respect any dietary restrictions.`;

export async function POST(req: NextRequest) {
  const profile = await req.json();

  // Hard limit check
  const limit = await checkApiLimit("anthropic");
  if (!limit.allowed) {
    return NextResponse.json({ error: "API limit exceeded", provider: "anthropic", spentUsd: limit.spentUsd, limitUsd: limit.limitUsd }, { status: 429 });
  }

  const composition = buildCompositionSegment(profile.travelerCount, profile.childrenAges);

  const userMessage = `Travel profile:
- Destination: ${profile.destination || "not specified"}
- Traveler types: ${profile.travelerTypes?.join(", ") || "not specified"}
- Travel company: ${profile.travelCompany}
- Budget: ${profile.budget || "not specified"}
- Travel dates: ${profile.departureDate ? `${profile.departureDate} to ${profile.returnDate}` : "not specified"}
- Dietary wishes: ${profile.dietaryWishes || "none"}${composition ? `\n- Composition: ${composition}` : ""}`;

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
  const onAbort = () => stream.abort();
  req.signal.addEventListener("abort", onAbort);

  const readable = new ReadableStream({
    async start(controller) {
      let output = "";
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
            output += event.delta.text;
          }
        }
      } catch (err) {
        console.error("[recommendations] stream error:", err);
      } finally {
        req.signal.removeEventListener("abort", onAbort);
      }
      controller.close();

      try {
        const final = await stream.finalMessage();
        await logAiInteraction({
          feature: "recommendations",
          model: MODEL,
          prompt: `${SYSTEM}\n\n---\n\n${userMessage}`,
          input: {
            ...profile,
            travelerCount: profile.travelerCount ?? null,
            childrenAges: profile.childrenAges ?? null,
          },
          output,
          latency_ms: Date.now() - startTime,
          input_tokens: final.usage.input_tokens,
          output_tokens: final.usage.output_tokens,
        });
        await logApiUsage({
          provider: "anthropic", apiType: "recommendations", feature: "profile",
          model: MODEL, inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens,
        });
      } catch (err) {
        console.error("[recommendations] Logging failed:", err);
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
