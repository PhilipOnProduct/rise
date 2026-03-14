import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const { airport, hotel, city } = await req.json();

  const prompt = `You are a practical travel advisor. A traveler needs to get from the airport to their hotel. Compare public transport vs taxi/rideshare for this specific journey.

Journey details:
- Departure airport: ${airport}
- Destination city: ${city}
- Hotel / area: ${hotel}

For each option provide a clear comparison covering:
1. Estimated cost (in local currency)
2. Estimated travel time
3. Comfort level (1–5 stars)
4. Step-by-step instructions
5. Any tips or things to watch out for

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
