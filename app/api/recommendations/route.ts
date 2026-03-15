import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-20250514";

export async function POST(req: NextRequest) {
  const profile = await req.json();

  const prompt = `You are a knowledgeable restaurant advisor. Based on the following travel profile, recommend 5 restaurants for the traveler. For each restaurant provide: name, cuisine type, price range, a short description, and why it suits this specific traveler.

Travel profile:
- Destination: ${profile.destination || "not specified"}
- Traveler types: ${profile.travelerTypes?.join(", ") || "not specified"}
- Travel company: ${profile.travelCompany}
- Budget: ${profile.budget || "not specified"}
- Travel dates: ${profile.departureDate ? `${profile.departureDate} to ${profile.returnDate}` : "not specified"}
- Dietary wishes: ${profile.dietaryWishes || "none"}

IMPORTANT: strictly respect dietary wishes, do not recommend restaurants that conflict with them.

Format each restaurant as:
**[Restaurant Name]** — [Cuisine] · [Price range €/€€/€€€/€€€€]
[Short description]
*Why it suits you: [reason]*

Keep descriptions concise and practical.`;

  const startTime = Date.now();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
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
          feature: "recommendations",
          model: MODEL,
          input: profile,
          output,
          latency_ms: Date.now() - startTime,
          input_tokens: final.usage.input_tokens,
          output_tokens: final.usage.output_tokens,
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
