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

  // Build constraint block from preferences
  const companyLabel: Record<string, string> = {
    solo: "solo traveller",
    partner: "partner",
    couple: "couple",
    friends: "group of friends",
    family: "family with children",
  };

  const budgetLabel: Record<string, string> = {
    budget: "savvy (budget-conscious)",
    comfortable: "comfortable (mid-range spend)",
    luxury: "flexible (willing to spend more for quality)",
  };

  const company = travelCompany || "solo";
  const budget = budgetTier || "comfortable";
  const styleList: string[] = Array.isArray(styleTags) && styleTags.length > 0
    ? styleTags
    : ["mixed styles"];

  const constraintLines: string[] = [];
  if (travelCompany) {
    constraintLines.push(
      `- Travelling as: ${companyLabel[travelCompany] ?? travelCompany}`,
    );
  }
  if (styleTags && styleTags.length > 0) constraintLines.push(`- Travel style: ${styleTags.join(", ")}`);
  if (budgetTier) constraintLines.push(`- Budget: ${budgetLabel[budgetTier] ?? budgetTier}`);

  const constraintBlock =
    constraintLines.length > 0
      ? `\n\nTraveller profile (treat these as hard constraints — every suggestion must fit):\n${constraintLines.join("\n")}\n`
      : "";

  const companyForPrompt = companyLabel[company] ?? company;
  const budgetForPrompt = budgetLabel[budget] ?? budget;

  const prompt = `You are recommending activities for a ${companyForPrompt} ${duration} to ${destination}.${constraintBlock}
Budget tier: ${budgetForPrompt}. Style preferences: ${styleList.join(", ")}.
Prioritise suggestions that match this profile specifically.
Do not recommend options that contradict the budget tier.
Every suggestion must genuinely suit the traveller profile above — not generic activities that any visitor might do.

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
