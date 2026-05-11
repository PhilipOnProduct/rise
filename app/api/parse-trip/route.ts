import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";
import { TRIP_INTENT_TOOL, coerceTripIntent } from "@/lib/trip-intent";
import { matchFranchise, suggestLegs } from "@/lib/themed-atlas";

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

3. Cite SPECIFIC user input. If the input mentions "anniversary," set occasion: "anniversary". For children counts/ages, follow rule 9 — never push these to clarifications, they're editable on the confirmation screen.

4. High-stakes constraints (allergies, mobility, accessibility, dietary, religious) MUST be preserved exactly as the user expressed them. Map to constraintTags from this set when applicable: ["Wheelchair access", "No long walks", "Vegetarian", "Halal/Kosher", "Severe allergy", "Stroller-friendly"]. Anything NOT in that set goes verbatim into constraintText.

5. When you're uncertain a constraint is satisfied or whether your interpretation is correct, say so explicitly in clarifications. Better to ask than to assume.

6. Multi-country or multi-city → multiple entries in destinations[]. Preserve the order the user mentioned them.

7. Vague time hints ("next month", "early summer", "during half-term") → set dates.season verbatim and add a clarification asking for specific dates.

8. Always extract occasion if mentioned (anniversary, honeymoon, birthday, bucket_list). It biases downstream tone — this is a key differentiator.

9. Children: if ages are stated, map to ageRange buckets ("Under 2" | "2–4" | "5–8" | "9–12" | "13–17"). If the user uses family language ("family trip", "with the kids", "with our children", "kid-friendly", etc.) but doesn't state a count, infer 2 children with empty ageRange — the user will pick ages on the confirmation screen. If a creative inspiration strongly suggests an age band (Harry Potter → 9–12, Disney princess trip → 5–8, dinosaur fanatics → 5–8 or 9–12), you may pre-fill the ageRange; otherwise leave ageRange unset. NEVER add a "What ages are the kids?" clarification — children count and ages are editable on the confirmation screen.

10. styleTags should match the existing chip taxonomy: Cultural, Food-led, Relaxed, Adventure, Off the beaten track, History, Romantic, Wellness, Nightlife, Art & Design, Photography, Kid-friendly, Teen-friendly, Beach, Educational, Budget-savvy, Slow travel, Active, Festivals.

11. Inspiration (PHI-51): set the optional inspiration field ONLY when the user names a creative theme using an anchor phrase. Anchor phrases include: "X-inspired", "inspired by X", "in the footsteps of X", "like in [film/book/show]", "themed around X", "we want to do some X stuff", "a [genre] trip", "in honour of X". The value is a short noun phrase (e.g. "Harry Potter", "Amélie", "World War II", "my grandmother who was born in Krakow"), not a full sentence.
   - NEVER infer inspiration from destination alone. Paris does NOT imply Amélie. Tokyo does NOT imply anime. Edinburgh does NOT imply Harry Potter.
   - NEVER extract from negation patterns. "Not too touristy", "avoid the Eat-Pray-Love itinerary", "don't make it a Disney trip" are constraints, not inspirations — leave inspiration unset and put the negation into constraintText.
   - Personal-history inspirations are valid ("in honour of my grandmother who was born in Krakow", "my dad served in Vietnam"). Set inspiration to the noun phrase the user named.
   - Inspiration NEVER overrides constraint preservation. If the user says "Harry Potter inspired family trip, no peanuts, the youngest is allergic", set inspiration: "Harry Potter" AND preserve the peanut allergy in constraintTags + constraintText. Both fields are independent.
   - When the user mentions a theme without a clear anchor phrase, prefer leaving inspiration unset over guessing. Add a clarification if you think they meant a theme but can't tell.

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

  // PHI-40: tag the log with rise_session_id so the cost-report script
  // can attribute calls to a trip.
  const sessionId = req.cookies.get("rise_session_id")?.value ?? null;

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
      session_id: sessionId,
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

  // PHI-54: when the parser extracted an inspiration that matches the
  // curated atlas, surface the franchise's default leg structure so the
  // chip-confirm screen can render editable destination chips. The user
  // can remove or add legs — atlas legs are NEVER auto-applied.
  let suggestedLegs: { city: string; country: string; nights: number; source: "atlas" }[] = [];
  if (intent.inspiration) {
    const franchise = matchFranchise(intent.inspiration);
    if (franchise) {
      suggestedLegs = suggestLegs(franchise).map((l) => ({
        city: l.city,
        country: l.country,
        nights: l.nights,
        source: "atlas" as const,
      }));
    }
  }

  return NextResponse.json(
    {
      intent,
      suggestedLegs: suggestedLegs.length > 0 ? suggestedLegs : undefined,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    },
    { status: 200 }
  );
}
