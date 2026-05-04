import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";
import { TRIP_INTENT_TOOL, coerceTripIntent } from "@/lib/trip-intent";

/**
 * PHI-34 / RISE-301 — Free-form trip description parser
 *
 * Converts a free-form trip description into a structured TripIntent via
 * Anthropic tool-use. The UI confirmation chip flow (separate ticket)
 * surfaces every parsed field for user verification before activity
 * generation runs.
 *
 * Per the team review + Sarah's PRD:
 * - Conservative parsing: NEVER invent fields. Missing required fields
 *   surface as clarifications.
 * - Cite specific user input ("you flagged kid-friendly"), never vague.
 * - High-stakes constraints (allergies, mobility, accessibility) MUST be
 *   preserved verbatim — they're life-impacting.
 * - When uncertain, say so explicitly in clarifications.
 *
 * Cost optimisation deferred to a follow-up: Anthropic prompt caching
 * (per user sign-off, "optimise — prompt caching first"). Not yet wired
 * because the system prompt is small enough that caching savings start
 * at scale. Revisit once we see real traffic.
 */

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

const SYSTEM = `You are a travel-planning input parser. Your job is to convert a user's free-form trip description into a structured TripIntent JSON object via the parse_trip_intent tool.

Rules (in priority order):

1. NEVER invent fields the user didn't mention. If they said "no hiking" but didn't mention dietary, leave constraintTags empty for diet. Don't infer "couple" from "we" — ask in clarifications instead.

2. Missing required fields surface as clarifications, NEVER as guesses. If the user said "long weekend somewhere warm" without naming a destination, return destinations: [] and add a clarification: "Any region preference, or are you genuinely open?"

3. Cite SPECIFIC user input. If the input mentions "anniversary," set occasion: "anniversary". If it mentions "kids" without ages, push to clarifications.

4. High-stakes constraints (allergies, mobility, accessibility, dietary, religious) MUST be preserved exactly as the user expressed them. Map to constraintTags from this set when applicable: ["Wheelchair accessible only", "No long walks", "Vegetarian", "Halal/Kosher", "Severe allergy", "Stroller-friendly"]. Anything NOT in that set goes verbatim into constraintText.

5. When you're uncertain a constraint is satisfied or whether your interpretation is correct, say so explicitly in clarifications. Better to ask than to assume.

6. Multi-country or multi-city → multiple entries in destinations[]. Preserve the order the user mentioned them.

7. Vague time hints ("next month", "early summer", "during half-term") → set dates.season verbatim and add a clarification asking for specific dates.

8. Always extract occasion if mentioned (anniversary, honeymoon, birthday, bucket_list). It biases downstream tone — this is a key differentiator.

9. Children: if ages are stated, map to ageRange buckets ("Under 2" | "2–4" | "5–8" | "9–12" | "13–17"). If only "the kids" is mentioned, push to clarifications: "What ages are the kids?"

10. styleTags should match the existing chip taxonomy: Cultural, Food-led, Relaxed, Adventure, Off the beaten track, History, Romantic, Wellness, Nightlife, Art & Design, Photography, Kid-friendly, Teen-friendly, Beach, Educational, Budget-savvy, Slow travel, Active, Festivals.

Output: call the parse_trip_intent tool with the structured TripIntent. Do not produce any prose — only the tool call.`;

export async function POST(req: NextRequest) {
  const { text } = (await req.json()) as { text?: string };
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json(
      { error: "text is required (the user's free-form trip description)" },
      { status: 400 }
    );
  }

  const limit = await checkApiLimit("anthropic");
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "API limit exceeded",
        provider: "anthropic",
        spentUsd: limit.spentUsd,
        limitUsd: limit.limitUsd,
      },
      { status: 429 }
    );
  }

  const startTime = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0.1, // low for parser reliability
    tools: [TRIP_INTENT_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "parse_trip_intent" },
    system: [
      {
        type: "text",
        text: SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: text }],
  });

  // Find the tool_use block — with tool_choice forcing it, there's exactly one.
  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return NextResponse.json(
      { error: "model did not return a tool_use block" },
      { status: 502 }
    );
  }
  const intent = coerceTripIntent(toolBlock.input);

  // Log + usage
  try {
    await logAiInteraction({
      feature: "parse-trip",
      model: MODEL,
      prompt: `${SYSTEM}\n\n---\n\n${text}`,
      input: { text },
      output: JSON.stringify(intent),
      latency_ms: Date.now() - startTime,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });
    await logApiUsage({
      provider: "anthropic",
      apiType: "parse-trip",
      feature: "onboarding",
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  } catch (err) {
    console.error("[parse-trip] Logging failed:", err);
  }

  return NextResponse.json(
    {
      intent,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    },
    { status: 200 }
  );
}
