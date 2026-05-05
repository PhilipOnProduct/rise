import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";
import { buildCompositionSegment } from "@/lib/composition";
import type { TripLeg } from "@/lib/trip-schema";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

type TimeBlock = "morning" | "afternoon" | "evening";

type ActivityFeedbackEntry = {
  activityName: string;
  feedbackType: "thumbs_up" | "chip_selected" | "thumbs_down_no_chip";
  chip?: { label: string; type: "hard_exclusion" | "soft_signal" };
};

function buildFeedbackSegment(feedback: ActivityFeedbackEntry[]): string {
  if (!feedback?.length) return "";

  // Case 1: hard exclusion — "Done it before" chip selected
  const hardExclusions = feedback
    .filter((f) => f.feedbackType === "chip_selected" && f.chip?.type === "hard_exclusion")
    .map((f) => f.activityName);

  // Case 2: thumbs-down with a soft-signal chip selected
  const softWithReason = feedback
    .filter((f) => f.feedbackType === "chip_selected" && f.chip?.type === "soft_signal")
    .map((f) => `${f.activityName} (${f.chip!.label})`);

  // Case 3: thumbs-down with no chip — treat as weak signal, do not exclude
  const softNoReason = feedback
    .filter((f) => f.feedbackType === "thumbs_down_no_chip")
    .map((f) => f.activityName);

  const parts: string[] = [];

  if (hardExclusions.length) {
    parts.push(
      `IMPORTANT — Never include these activities in any form. The user has explicitly excluded them:\n` +
        hardExclusions.map((n) => `- ${n}`).join("\n")
    );
  }

  if (softWithReason.length) {
    parts.push(
      `The user rejected these activities and stated a reason. Avoid them; you may suggest alternatives in the same category:\n` +
        softWithReason.map((s) => `- ${s}`).join("\n")
    );
  }

  if (softNoReason.length) {
    parts.push(
      `The user rejected these activities without stating a reason. Treat as soft signal only — deprioritise but do not exclude:\n` +
        softNoReason.map((n) => `- ${n}`).join("\n")
    );
  }

  // Case 4: thumbs-up — user expressed interest
  const liked = feedback
    .filter((f) => f.feedbackType === "thumbs_up")
    .map((f) => f.activityName);

  if (liked.length) {
    parts.push(
      `The user expressed interest in these activities — prioritise similar experiences:\n` +
        liked.map((n) => `- ${n}`).join("\n")
    );
  }

  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

type BookingMeta = {
  preferred_platform: "opentable" | "resy" | "thefork";
  confidence: "high" | "medium" | "low";
  search_query: string;
};

type ItineraryItem = {
  id: string;
  title: string;
  description: string;
  type: "activity" | "restaurant" | "transport" | "note";
  time_block: TimeBlock;
  status: "idea";
  source: "ai_generated";
  booking_meta?: BookingMeta;
  cuisine?: string;
  vibe?: string;
  price_tier?: string;
};

type ItineraryDay = {
  date: string;
  day_number: number;
  items: ItineraryItem[];
  // PHI-37: multi-leg trips — index into legs[]. Absent on single-leg
  // trips. `is_transition: true` flags a travel day between legs.
  leg_index?: number;
  is_transition?: boolean;
};

export async function POST(req: NextRequest) {
  const { destination, departureDate, returnDate, travelCompany, travelerTypes, budgetTier, activityFeedback } =
    await req.json();
  const {
    destination,
    departureDate,
    returnDate,
    hotel,
    travelCompany,
    travelerTypes,
    activityFeedback,
    travelerCount,
    childrenAges,
    // PHI-37: multi-leg support. When 2+ legs are provided, the prompt
    // generates a day-by-day plan tagged with leg_index per day, with a
    // single transition day between legs (is_transition: true). When
    // legs is missing/length<=1 the existing single-destination prompt
    // runs unchanged (backward compatible).
    legs,
  } = (await req.json()) as {
    destination?: string;
    departureDate?: string;
    returnDate?: string;
    hotel?: string;
    travelCompany?: string;
    travelerTypes?: string[];
    activityFeedback?: ActivityFeedbackEntry[];
    travelerCount?: number;
    childrenAges?: string[];
    legs?: TripLeg[];
  };

  if (!destination || !departureDate || !returnDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Hard limit check
  const limit = await checkApiLimit("anthropic");
  if (!limit.allowed) {
    return NextResponse.json({ error: "API limit exceeded", provider: "anthropic", spentUsd: limit.spentUsd, limitUsd: limit.limitUsd }, { status: 429 });
  }

  const nights = Math.round(
    (new Date(returnDate).getTime() - new Date(departureDate).getTime()) / 86_400_000
  );

  const days = Math.max(1, nights);
  const styleStr = travelerTypes?.length ? `Travel style: ${travelerTypes.join(", ")}.` : "";
  const companyStr = travelCompany ? `Travelling: ${travelCompany}.` : "";
  const budgetStr = budgetTier ? `Budget tier: ${budgetTier}.` : "";
  const hotelStr = hotel ? `Staying at: ${hotel}.` : "";
  const feedbackSegment = buildFeedbackSegment(activityFeedback ?? []);
  console.log("[itinerary-generate] Feedback segment:", feedbackSegment || "(none)");
  const composition = buildCompositionSegment(travelerCount, childrenAges);
  const compositionStr = composition ? `\nTraveller composition: ${composition}` : "";

  // PHI-37: multi-leg block. When 2+ legs, the prompt generates a plan
  // tagged with leg_index per day plus an explicit transition day between
  // legs. The single-hotel decision (signed off 2026-05-05) means the
  // prompt is told to anchor on the longest stay or skip hotel guidance
  // for moves between cities.
  const isMultiLeg = Array.isArray(legs) && legs.length >= 2;
  const multiLegBlock = isMultiLeg
    ? `

This is a MULTI-LEG trip. Plan day-by-day across all legs in order.

Legs (in order):
${legs!
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
    const nightsStr = legNights ? ` (${legNights} night${legNights === 1 ? "" : "s"})` : "";
    const dateStr =
      leg.startDate && leg.endDate
        ? `, ${leg.startDate} → ${leg.endDate}`
        : "";
    // PHI-39: per-leg hotel — anchor activities and the final-day evening
    // around it when set. When unset, skip hotel-proximity claims.
    const hotelStr = leg.hotel ? `, hotel: ${leg.hotel}` : "";
    return `- LEG ${i}: ${name}${nightsStr}${dateStr}${hotelStr}`;
  })
  .join("\n")}

Multi-leg rules:
- Tag every day with "leg_index": <index>. The first leg is leg_index 0.
- Bias toward fewer activities per day on short legs (≤2 nights). Travellers want lighter plans on later legs.
- Stay in the previous leg's hotel when a leg is ≤2 nights AND day-trip distance is reasonable; suggest day-trip activities from the previous base.
- Never recommend cross-leg activities (e.g. for "Spain + Portugal", no Lisbon-to-Madrid day trips).
- Insert exactly ONE transition day between consecutive legs. A transition day:
    * has "is_transition": true and "leg_index" set to the leg the user is travelling INTO
    * contains a single transport item: { title: "Travel to <next leg name>", description: "<a brief note>", type: "transport", time_block: "morning" or "afternoon" }
    * has NO other activities — travellers lose meals/naps/check-in time on transition days; do not over-plan.
- Hotel guidance: each leg may have its own hotel listed above. When set, anchor that leg's activities (especially day 1 and the final evening) around that hotel. When a leg has no hotel listed, skip hotel-proximity claims for that leg — never invent one.
`
    : "";

  const headline = isMultiLeg
    ? `You are a trip planning AI. Generate a structured day-by-day itinerary for a ${days}-day multi-leg trip across ${legs!.map((l) => l.place?.name ?? "?").join(" → ")}.`
    : `You are a trip planning AI. Generate a structured day-by-day itinerary for a ${days}-day trip to ${destination}.`;

  const prompt = `You are a trip planning AI. Generate a structured day-by-day itinerary for a ${days}-day trip to ${destination}.
Travel dates: ${departureDate} to ${returnDate}.
${companyStr}
${styleStr}
${budgetStr}${feedbackSegment}
  const prompt = `${headline}
${companyStr}
${hotelStr}
${styleStr}${compositionStr}${feedbackSegment}${multiLegBlock}

Return ONLY a valid JSON array — no markdown, no explanation, no code fences. The array must have exactly ${days} elements, one per day.

Each day object:
{
  "date": "YYYY-MM-DD",   // starting from ${departureDate}
  "day_number": 1,         // 1-indexed
  "items": [...]${
    isMultiLeg
      ? `,
  "leg_index": 0,          // 0-indexed pointer into the Legs list above
  "is_transition": false   // true on the day the traveller moves between legs`
      : ""
  }
}

Each item object:
{
  "id": "unique-string-id",
  "title": "Activity name",
  "description": "One sentence. Be specific to ${destination}.",
  "type": "activity" | "restaurant" | "transport",
  "time_block": "morning" | "afternoon" | "evening",
  "status": "idea",
  "source": "ai_generated"
}

For items where type is "restaurant", include these additional fields:
{
  "cuisine": "Italian",           // cuisine category
  "vibe": "romantic",             // one-word vibe descriptor
  "price_tier": "€€€",           // €, €€, €€€, or €€€€
  "booking_meta": {
    "preferred_platform": "opentable" | "resy" | "thefork",  // your best guess for the primary booking platform this restaurant uses
    "confidence": "high" | "medium" | "low",                  // how confident you are this restaurant is on that platform
    "search_query": "exact restaurant name city"               // the exact search string to use in booking platform URLs — optimise for finding the right restaurant, not the raw name
  }
}

Rules:
- Cover morning, afternoon, and evening for each day (one item per slot minimum, max two)${
    isMultiLeg
      ? " — EXCEPT transition days, which contain exactly one transport item"
      : ""
  }
- Mix types: include at least one restaurant per day${
    isMultiLeg ? " (skip on transition days)" : ""
  }
- Day 1 morning: arrival/orientation activity
- Final day evening: something easy near ${hotel ? hotel : "the accommodation"}
- Be specific to ${isMultiLeg ? "each leg" : destination} — no generic suggestions
- Keep descriptions under 20 words
- id must be unique across all days (e.g. "day1-morning-1")
- For booking_meta.search_query: use the restaurant's commonly known name plus the city — this will be used to construct deep links, so accuracy matters more than matching the title field exactly`;
- Within each time block, order items in the sequence they should happen. Place meals at the right time: breakfast before morning activities, lunch before afternoon sightseeing, dinner before evening leisure. The items array order IS the display order.`;

  // PHI-40: tag the log with rise_session_id so the cost-report script
  // can attribute calls to a trip. Cookie set by middleware on first visit.
  const sessionId = req.cookies.get("rise_session_id")?.value ?? null;

  const startTime = Date.now();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    // Strip markdown code fences with any amount of surrounding whitespace
    const jsonStr = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

    let days_data: ItineraryDay[];
    try {
      days_data = JSON.parse(jsonStr);
    } catch {
      console.error("[itinerary-generate] JSON parse failed. Raw output:\n", raw);
      return NextResponse.json(
        { error: "AI returned malformed JSON. Please try again." },
        { status: 500 }
      );
    }

    await logAiInteraction({
      feature: "itinerary-generate",
      model: MODEL,
      prompt,
      input: { destination, departureDate, returnDate, travelCompany, travelerTypes, budgetTier },
      input: {
        destination,
        departureDate,
        returnDate,
        hotel: hotel ?? null,
        travelCompany,
        travelerTypes,
        travelerCount: travelerCount ?? null,
        childrenAges: childrenAges ?? null,
        legs: isMultiLeg ? legs : null,
      },
      output: jsonStr,
      latency_ms: Date.now() - startTime,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      session_id: sessionId,
    });

    await logApiUsage({
      provider: "anthropic", apiType: "itinerary-generate", feature: "itinerary",
      model: MODEL, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
    });

    return NextResponse.json({ days: days_data });
  } catch (err) {
    console.error("[itinerary-generate]", err);
    return NextResponse.json({ error: "Failed to generate itinerary" }, { status: 500 });
  }
}
