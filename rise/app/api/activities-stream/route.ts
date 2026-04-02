import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";
import { buildCompositionSegment } from "@/lib/composition";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

// Static instruction — cached on first call, served from cache on subsequent calls
const SYSTEM = `You are a travel activity recommender. Suggest 5–6 must-do activities for the destination and traveller profile provided. For each, provide its name, a one-sentence description, and a brief note on when in the trip it works best.

Format each as:

**[Activity Name]** — [Category]
[One-sentence description]
*When: [timing or day suggestion]*

Be specific to the destination — avoid generic suggestions that any visitor might do. Keep each entry concise. Never reference the traveller's profile, preferences, or travel style in descriptions — write as if recommending to anyone visiting the destination.

Ensure variety: each activity must be from a different category. Spread suggestions across food & dining, cultural/historic, outdoor/adventure, nightlife/entertainment, relaxation/wellness, and shopping/local markets. Do not repeat a category.`;

export async function POST(req: NextRequest) {
  const {
    destination,
    departureDate,
    returnDate,
    travelCompany,
    styleTags,
    budgetTier,
    travelerCount,
    childrenAges,
  } = await req.json();

  // Hard limit check
  const limit = await checkApiLimit("anthropic");
  if (!limit.allowed) {
    return NextResponse.json({ error: "API limit exceeded", provider: "anthropic", spentUsd: limit.spentUsd, limitUsd: limit.limitUsd }, { status: 429 });
  }

  const nights =
    departureDate && returnDate
      ? Math.round(
          (new Date(returnDate).getTime() - new Date(departureDate).getTime()) /
            86_400_000
        )
      : null;
  const duration = nights ? `${nights}-night trip` : "trip";

  const companyLabel: Record<string, string> = {
    solo: "solo traveller",
    partner: "couple",
    friends: "group of friends",
    family: "family with children",
  };
  const budgetLabel: Record<string, string> = {
    budget: "savvy (budget-conscious)",
    comfortable: "comfortable (mid-range spend)",
    luxury: "flexible (willing to spend more for quality)",
  };

  const styleList: string[] =
    Array.isArray(styleTags) && styleTags.length > 0 ? styleTags : ["mixed styles"];

  const profileLines: string[] = [];
  if (travelCompany)
    profileLines.push(`- Travelling as: ${companyLabel[travelCompany] ?? travelCompany}`);
  if (styleTags?.length) profileLines.push(`- Travel style: ${styleTags.join(", ")}`);
  if (budgetTier) profileLines.push(`- Budget: ${budgetLabel[budgetTier] ?? budgetTier}`);

  const composition = buildCompositionSegment(travelerCount, childrenAges);
  if (composition) profileLines.push(`- Composition: ${composition}`);

  const profileBlock =
    profileLines.length > 0
      ? `\n\nTraveller profile (treat these as hard constraints — every suggestion must fit):\n${profileLines.join("\n")}\n`
      : "";

  const userMessage =
    `Destination: ${destination} (${duration}).${profileBlock}\n` +
    `Budget: ${budgetLabel[budgetTier ?? "comfortable"] ?? "comfortable"}. Style: ${styleList.join(", ")}.\n` +
    `Every suggestion must genuinely suit this profile — not generic activities any visitor might do.`;

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
          feature: "activities-stream",
          model: MODEL,
          prompt: `${SYSTEM}\n\n---\n\n${userMessage}`,
          input: {
            destination,
            departureDate,
            returnDate,
            travelCompany,
            styleTags,
            budgetTier,
            travelerCount: travelerCount ?? null,
            childrenAges: childrenAges ?? null,
          },
          output,
          latency_ms: Date.now() - startTime,
          input_tokens: final.usage.input_tokens,
          output_tokens: final.usage.output_tokens,
        });
        await logApiUsage({
          provider: "anthropic", apiType: "activity-stream", feature: "onboarding",
          model: MODEL, inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens,
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
