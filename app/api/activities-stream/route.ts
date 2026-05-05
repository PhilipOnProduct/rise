import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";
import { buildCompositionSegment } from "@/lib/composition";
import type { TripLeg } from "@/lib/trip-schema";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

// Static instruction — cached on first call, served from cache on subsequent calls.
// PHI-32: rationale field added per Elena's input — see the four "Why rules"
// at the bottom of the prompt. The rationale is a trust signal; bad rationales
// are worse than no rationales.
//
// PHI-37: multi-leg block at the bottom is conditional on the user message
// providing a Legs section. For single-leg trips the model ignores it. For
// multi-leg trips the model emits a LEG: <index> marker on its own line
// before each activity so the client can group cards by leg.
//
// PHI-41: tightened life-impacting constraint rules — the previous "EVERY
// food activity MUST include allergy awareness" hard rule was gated only
// on the "Severe allergy" tag, so Halal/Kosher and Vegetarian were dropping
// cards. The PHI-38 baseline run on 2026-05-05 caught two failures
// (jerusalem-kosher-history, barcelona-mallorca-allergy). The hard rule is
// now per-category, and a closing reminder is appended for multi-leg trips
// to fight Sonnet's attention-drop on long prompts.
const SYSTEM = `You are a travel activity recommender. Suggest 5–6 must-do activities for the destination and traveller profile provided. For each, provide its name, a one-sentence description, a brief note on when in the trip it works best, and a short "why this fits" rationale.

Format each as:

**[Activity Name]** — [Category]
[One-sentence description]
*When: [timing or day suggestion]*
*Why: [≤25 words explaining why this specific activity fits this specific traveller]*

Description rules:
- Be specific to the destination — avoid generic suggestions that any visitor might do.
- Keep descriptions concise.
- Never reference the traveller's profile, preferences, or travel style in the description — write as if recommending to anyone visiting the destination.

Why rules (Elena's guidance — these are trust-building, get them right):
1. Never invent a connection. If the only reason is "matches your style chip", say so plainly — don't fabricate a hotel-proximity claim if you don't have hotel data.
2. Cite specific user input ("you flagged kid-friendly", "your couple preference", "your savvy budget") — never vague "your interests".
3. When uncertain a constraint is satisfied, say so explicitly: "Likely accessible — please confirm."

Life-impacting constraints (PHI-41 — these are non-negotiable, every relevant card MUST acknowledge):

The constraintTags below trigger HARD rules. Failing any of these is worse than dropping the activity entirely.

- "Severe allergy" — EVERY food/dining/restaurant/market card MUST include explicit allergy awareness in the Why. Use the user's exact allergen if they named one (peanut, shellfish, etc.). Phrasing: "Allergen-aware kitchen — please confirm with the restaurant" or "Menu may contain <allergen> — call ahead." If a card cannot satisfy this, drop it.
- "Halal/Kosher" — EVERY food/dining/restaurant/market card MUST mention kosher / halal / certified / dietary law in the Why. Phrasing: "Kosher-certified per your note" or "Dietary-law compliant — please verify." If certification is uncertain, say "Likely <kosher/halal> — please confirm."
- "Vegetarian" — EVERY food/dining/restaurant/market card MUST mention vegetarian / vegan / plant-based options in the Why. Phrasing: "Vegetarian-friendly menu" or "Strong vegetarian options per your note." Non-veg-friendly venues should be dropped, not papered over.
- "Wheelchair accessible only" — EVERY card MUST mention accessibility / wheelchair / step-free / elevator / please confirm in the Why. Inaccessible venues must be dropped.
- "No long walks" — EVERY card MUST mention short walk / mobility / low-impact / step-free / seated / easy walk in the Why. High-effort activities (hiking, climbing, trekking) must be dropped.
- "Stroller-friendly" — EVERY card MUST mention stroller / pram / family-friendly / easy access in the Why. Stairs-only venues must be dropped.

Variety: each activity must be from a different category. Spread suggestions across food & dining, cultural/historic, outdoor/adventure, nightlife/entertainment, relaxation/wellness, and shopping/local markets. Do not repeat a category.

Multi-leg trips (only when the user message provides a "Legs:" section):

**LEG MARKER FORMAT — non-negotiable.** Every single activity card MUST be preceded by its own marker line:

LEG: <index>
**Activity name** — Category
...

The marker line is the FIRST line of every card. No exceptions, even for the first card under a leg, even after a paragraph break, even on the longest 3-leg trips. Skipping a marker means the card is dropped on the client side. Re-emit the marker for every card — the client groups by leg using these markers.

Example for a 3-leg trip:

LEG: 0
**Sensō-ji Temple** — Cultural/Historic
...

LEG: 0
**Tsukiji Outer Market** — Food & Dining
...

LEG: 1
**Fushimi Inari Shrine** — Cultural/Historic
...

LEG: 2
**Dōtonbori Walk** — Nightlife/Entertainment
...

Other multi-leg rules:
- Generate activities for EACH leg in order. Every leg with ≥1 night MUST have at least one card. Skipping a leg is a hard failure.
- Bias toward fewer activities on short legs (≤2 nights = 2–3 activities total; 3–4 nights = 3–4; 5+ nights = 4–5). The "last leg fatigue" pattern is real — travellers want lighter plans on later legs.
- Stay in the previous leg's hotel when a leg is ≤2 nights and the next leg is geographically reachable as a day trip — suggest day-trip activities from the previous base instead of full hotel change. Note this in the Why.
- Never recommend cross-border or cross-leg activities. Activities for "Spain + Portugal" must stay within each leg's own city/region; no Lisbon-to-Madrid day trips.
- Each activity belongs to exactly one leg. Variety rules apply within each leg, not across the whole trip.
- Do NOT generate activities for transition days. The client will render a travel-only card for the day a user moves between legs.
- Life-impacting constraints apply to EVERY relevant card on EVERY leg. Multi-leg trips have more cards, so attention drift is the failure mode — re-check before emitting each card. The reminder block at the end of the user message is non-negotiable.`;

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
    // PHI-35: high-stakes constraints — mobility, dietary, religious,
    // allergies. Treated as MUST respect in the prompt below.
    constraintTags,
    constraintText,
    // PHI-37: multi-leg trip support. When 2+ legs are provided, the
    // prompt switches to multi-leg mode and the streamed output carries
    // LEG: <index> markers so the client can group cards by leg. When
    // legs is missing or has length <=1, the existing single-leg path
    // runs unchanged (backward compatible).
    legs,
  } = (await req.json()) as {
    destination?: string;
    departureDate?: string;
    returnDate?: string;
    travelCompany?: string;
    styleTags?: string[];
    budgetTier?: string;
    travelerCount?: number;
    childrenAges?: string[];
    constraintTags?: string[];
    constraintText?: string;
    legs?: TripLeg[];
  };

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

  // PHI-35: assemble the MUST-respect constraints block. We separate this
  // from the general profile because the model is instructed to treat it
  // with extra weight, and to flag uncertainty when a constraint can't be
  // confidently satisfied (Elena's "uncertain → say so" rule from PHI-32).
  const constraintLines: string[] = [];
  if (Array.isArray(constraintTags) && constraintTags.length > 0) {
    constraintLines.push(`- Tagged: ${constraintTags.join(", ")}`);
  }
  if (typeof constraintText === "string" && constraintText.trim().length > 0) {
    constraintLines.push(`- In their words: "${constraintText.trim()}"`);
  }

  // PHI-41: the SYSTEM prompt now carries the per-category EVERY-card hard
  // rules; this block just lists the user's constraints so the model can
  // bind to them. The previous inline "if 'Severe allergy'..." text is
  // redundant with the SYSTEM and removed.
  const constraintBlock =
    constraintLines.length > 0
      ? `\n\nMUST respect (life-impacting — never silently ignore):\n${constraintLines.join("\n")}\n`
      : "";

  const profileBlock =
    profileLines.length > 0
      ? `\n\nTraveller profile (treat these as hard constraints — every suggestion must fit):\n${profileLines.join("\n")}\n${constraintBlock}`
      : constraintBlock;

  // PHI-37: build the multi-leg block when legs[] has 2+ entries. Single-leg
  // (or missing legs) falls through to the existing single-destination path.
  const isMultiLeg = Array.isArray(legs) && legs.length >= 2;
  const legsBlock = isMultiLeg
    ? "\n\nLegs:\n" +
      legs!
        .map((leg, i) => {
          const name = leg.place?.name ?? `Leg ${i + 1}`;
          const legNights =
            leg.startDate && leg.endDate
              ? Math.round(
                  (new Date(leg.endDate).getTime() -
                    new Date(leg.startDate).getTime()) /
                    86_400_000
                )
              : null;
          const nightsStr = legNights ? ` — ${legNights} night${legNights === 1 ? "" : "s"}` : "";
          const dateStr =
            leg.startDate && leg.endDate
              ? ` (${leg.startDate} → ${leg.endDate})`
              : "";
          // PHI-39: per-leg hotel. When set, the model should anchor that
          // leg's activities around it. When unset, no hotel-proximity
          // claims for that leg.
          const hotelStr = leg.hotel ? ` [hotel: ${leg.hotel}]` : "";
          return `- LEG ${i}: ${name}${nightsStr}${dateStr}${hotelStr}`;
        })
        .join("\n") +
      "\n\nGenerate activities for EACH leg, prefixing every activity with a `LEG: <index>` marker line." +
      "\nPer-leg hotels: if a leg has a [hotel: ...] tag, you MAY reference proximity to that hotel in the Why line. If a leg has no hotel tag, NEVER fabricate a hotel-proximity claim for that leg."
    : "";

  const headline = isMultiLeg
    ? `Multi-leg trip across: ${legs!.map((l) => l.place?.name ?? "?").join(" → ")} (${duration}).`
    : `Destination: ${destination} (${duration}).`;

  // PHI-41: closing reminder block. Multi-leg trips with life-impacting
  // constraints had a measurable attention-drop on the long card list
  // (PHI-38 baseline: barcelona-mallorca-allergy missed the constraint
  // on at least one of 9 cards). Restating the contract at the end of
  // the user message — closer to the model's generation point — fights
  // the drift. Single-leg trips and multi-leg trips without constraints
  // get nothing extra (the SYSTEM rules suffice).
  const reminderBlock =
    isMultiLeg && constraintLines.length > 0
      ? `\n\nReminder (non-negotiable): the life-impacting constraints above apply to EVERY relevant card across EVERY leg. Re-check before emitting each card. Never silently drop a constraint just because the card list is long. If a card cannot satisfy a life-impacting constraint, drop the card — not the constraint.`
      : "";

  const userMessage =
    `${headline}${profileBlock}${legsBlock}\n` +
    `Budget: ${budgetLabel[budgetTier ?? "comfortable"] ?? "comfortable"}. Style: ${styleList.join(", ")}.\n` +
    `Every suggestion must genuinely suit this profile — not generic activities any visitor might do.${reminderBlock}`;

  // PHI-40: tag the log with rise_session_id so the cost-report script
  // can attribute calls to a trip. Cookie set by middleware on first visit.
  const sessionId = req.cookies.get("rise_session_id")?.value ?? null;

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
            legs: isMultiLeg ? legs : null,
          },
          output,
          latency_ms: Date.now() - startTime,
          input_tokens: final.usage.input_tokens,
          output_tokens: final.usage.output_tokens,
          session_id: sessionId,
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
