import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { track } from "@vercel/analytics/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";
import { fetchForecast, badDayDates } from "@/lib/weather";
import { geocodeCity } from "@/lib/travel-connectors";
import {
  buildItineraryGenPrompt,
  type ItineraryGenFeedbackEntry,
} from "@/lib/itinerary-gen-prompt";
import type { TripLeg } from "@/lib/trip-schema";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

type TimeBlock = "morning" | "afternoon" | "evening";

type BookingMeta = {
  preferred_platform: "opentable" | "resy" | "thefork";
  confidence: "high" | "medium" | "low";
  search_query: string;
};

type WeatherAlternative = {
  title: string;
  description: string;
  type: "activity" | "restaurant" | "transport" | "note";
};

type ItineraryItem = {
  id: string;
  title: string;
  description: string;
  type: "activity" | "restaurant" | "transport";
  time_block: TimeBlock;
  status: "idea";
  source: "ai_generated";
  booking_meta?: BookingMeta;
  cuisine?: string;
  vibe?: string;
  price_tier?: string;
  // PHI-53: AI-classified outdoor flag and paired wet-weather alternative.
  is_outdoor?: boolean;
  alternative?: WeatherAlternative;
  // PHI-90: true on items the AI placed in response to a user-seeded
  // must-do entry. The /itinerary view renders an inline "You added this"
  // badge on these cards.
  seededByUser?: boolean;
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
  const {
    destination,
    departureDate,
    returnDate,
    hotel,
    travelCompany,
    travelerTypes,
    budgetTier,
    activityFeedback,
    travelerCount,
    childrenAges,
    inspiration,
    legs,
    // PHI-90: optional traveller-provided must-dos passed in as anchors.
    // Backward compatible — when missing/empty, the prompt is byte-identical
    // to the pre-PHI-90 shape and the existing schema (bare array of days)
    // is returned.
    userSeededActivities,
  } = (await req.json()) as {
    destination?: string;
    departureDate?: string;
    returnDate?: string;
    hotel?: string;
    travelCompany?: string;
    travelerTypes?: string[];
    budgetTier?: string;
    activityFeedback?: ItineraryGenFeedbackEntry[];
    travelerCount?: number;
    childrenAges?: string[];
    inspiration?: string;
    legs?: TripLeg[];
    userSeededActivities?: string[];
  };

  if (!destination || !departureDate || !returnDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Hard limit check
  const limit = await checkApiLimit("anthropic");
  if (!limit.allowed) {
    return NextResponse.json({ error: "API limit exceeded", provider: "anthropic", spentUsd: limit.spentUsd, limitUsd: limit.limitUsd }, { status: 429 });
  }

  // PHI-90: only switch the response into "anchors mode" (object shape with
  // placement_notes) when the caller actually supplied non-empty entries.
  const cleanedSeeds = Array.isArray(userSeededActivities)
    ? userSeededActivities
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0)
    : [];
  const hasAnchors = cleanedSeeds.length > 0;

  const prompt = buildItineraryGenPrompt({
    destination,
    departureDate,
    returnDate,
    hotel: hotel ?? null,
    travelCompany: travelCompany ?? null,
    travelerTypes: travelerTypes ?? null,
    budgetTier: budgetTier ?? null,
    activityFeedback: activityFeedback ?? null,
    travelerCount: travelerCount ?? null,
    childrenAges: childrenAges ?? null,
    inspiration: inspiration ?? null,
    legs: legs ?? null,
    userSeededActivities: hasAnchors ? cleanedSeeds : null,
  });

  const isMultiLeg = Array.isArray(legs) && legs.length >= 2;

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
    let placementNotes: string | null = null;
    try {
      const parsed = JSON.parse(jsonStr);
      if (hasAnchors) {
        // Anchors-mode response: object with { days, placement_notes }.
        // We accept the bare-array fallback too — older or confused model
        // outputs shouldn't strand a user mid-flow.
        if (Array.isArray(parsed)) {
          days_data = parsed;
        } else if (parsed && Array.isArray((parsed as { days?: unknown }).days)) {
          days_data = (parsed as { days: ItineraryDay[] }).days;
          const note = (parsed as { placement_notes?: unknown }).placement_notes;
          if (typeof note === "string" && note.trim().length > 0) {
            placementNotes = note.trim();
          }
        } else {
          throw new Error("unexpected shape");
        }
      } else {
        days_data = parsed as ItineraryDay[];
      }
    } catch {
      console.error("[itinerary-generate] JSON parse failed. Raw output:\n", raw);
      return NextResponse.json(
        { error: "AI returned malformed JSON. Please try again." },
        { status: 500 }
      );
    }

    // PHI-88: fire after a clean parse, before logging/response. Awaited
    // because the route holds the response. Payload omits hasChildren —
    // demographic signals stay out per the open-question default.
    await track("itinerary_generated", {
      dayCount: Array.isArray(days_data) ? days_data.length : 0,
    });

    await logAiInteraction({
      feature: "itinerary-generate",
      model: MODEL,
      prompt,
      input: {
        destination,
        departureDate,
        returnDate,
        hotel: hotel ?? null,
        travelCompany,
        travelerTypes,
        budgetTier: budgetTier ?? null,
        travelerCount: travelerCount ?? null,
        childrenAges: childrenAges ?? null,
        inspiration: inspiration ?? null,
        legs: isMultiLeg ? legs : null,
        // PHI-90: surface the anchors in ai_logs so Philip can inspect
        // exactly what the prompt received vs. what the model placed.
        userSeededActivities: hasAnchors ? cleanedSeeds : null,
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

    // PHI-53: forecast fetch is fire-and-forget for client display. Fail
    // open: if Open-Meteo is down or the trip is beyond the 16-day
    // horizon, badDays is null and the client falls back to showing
    // alternatives universally for outdoor activities.
    let badDays: string[] | null = null;
    try {
      const coords = await geocodeCity(destination);
      if (coords) {
        const forecast = await fetchForecast(
          coords.lat,
          coords.lng,
          departureDate,
          returnDate,
        );
        await logApiUsage({
          provider: "open-meteo",
          apiType: "forecast",
          feature: "itinerary-generate",
        });
        badDays = badDayDates(forecast);
      }
    } catch (err) {
      console.warn("[itinerary-generate] forecast failed (fail-open):", err);
    }

    return NextResponse.json({
      days: days_data,
      bad_day_dates: badDays,
      // PHI-90: surfaced inline above Day 1 by the itinerary page when
      // present. Null/omitted when every anchor placed cleanly or no
      // anchors were supplied.
      placement_notes: placementNotes,
    });
  } catch (err) {
    console.error("[itinerary-generate]", err);
    return NextResponse.json({ error: "Failed to generate itinerary" }, { status: 500 });
  }
}
