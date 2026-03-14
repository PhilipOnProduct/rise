import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const profile = await req.json();

  const prompt = `You are a knowledgeable restaurant advisor. Based on the following travel profile, recommend 5 restaurants for the traveler. For each restaurant provide: name, cuisine type, price range, a short description, and why it suits this specific traveler.

Travel profile:
- Destination: ${profile.destination || "not specified"}
- Traveler types: ${profile.travelerTypes?.join(", ") || "not specified"}
- Travel company: ${profile.travelCompany}
- Budget: ${profile.budget || "not specified"}
- Travel dates: ${profile.departureDate ? `${profile.departureDate} to ${profile.returnDate}` : "not specified"}

Format each restaurant as:
**[Restaurant Name]** — [Cuisine] · [Price range €/€€/€€€/€€€€]
[Short description]
*Why it suits you: [reason]*

Keep descriptions concise and practical.`;

  const stream = await client.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          controller.enqueue(encoder.encode(event.delta.text));
        }
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
