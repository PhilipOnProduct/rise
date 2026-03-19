import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

export async function POST(req: NextRequest) {
  const { destination, departureDate, returnDate, travelCompany, styleTags, budgetTier } =
    await req.json();

  const nights =
    departureDate && returnDate
      ? Math.round(
          (new Date(returnDate).getTime() - new Date(departureDate).getTime()) /
            86_400_000
        )
      : null;
  const duration = nights ? `${nights}-night trip` : "trip";

  const company = travelCompany || "solo";
  const budget = budgetTier || "mid";
  const styleList: string[] = Array.isArray(styleTags) && styleTags.length > 0
    ? styleTags
    : ["mixed styles"];

  const prompt = `You are recommending activities for a ${company} ${duration} to ${destination}.
Budget tier: ${budget}. Style preferences: ${styleList.join(", ")}.
Prioritise suggestions that match this profile specifically.
Do not recommend options that contradict the budget tier.

Suggest 5–6 must-do activities. For each provide its name, a one-sentence description, and a brief note on when in the trip it works best.

Format each as:

**[Activity Name]** — [Category]
[One-sentence description]
*When: [timing or day suggestion]*

Be specific to ${destination} — avoid generic suggestions. Keep each entry concise.`;

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
          feature: "activities-stream",
          model: MODEL,
          prompt,
          input: { destination, departureDate, returnDate, travelCompany, styleTags, budgetTier },
          output,
          latency_ms: Date.now() - startTime,
          input_tokens: final.usage.input_tokens,
          output_tokens: final.usage.output_tokens,
        });
      } catch (err) {
        console.error("[activities-stream] Logging failed:", err);
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
