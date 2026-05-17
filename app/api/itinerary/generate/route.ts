import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { track } from "@vercel/analytics/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";
import { fetchForecast, badDayDates } from "@/lib/weather";
import { geocodeCity } from "@/lib/travel-connectors";
import {
  buildItineraryGenPrompt,
  cleanUserSeededActivities,
  type ItineraryGenFeedbackEntry,
} from "@/lib/itinerary-gen-prompt";
import type { TripLeg } from "@/lib/trip-schema";
import { resolveTripDuration } from "@/lib/trip-duration";

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
  // PHI-90 / PHI-104: true on items the AI placed in response to a
  // user-seeded must-do entry. The /itinerary view renders an inline
  // "from your list" badge on these cards (canonical copy in lib/copy.ts).
  seededByUser?: boolean;
  // PHI-104: the verbatim must-do entry the user typed. Stamped here by the
  // post-processing pass below from `seeded_anchor_resolutions`. Only set
  // when the model resolved a vague entry to a specific venue (the title
  // differs from the verbatim, case-insensitive) — otherwise omitted so
  // the renderer falls back to the verbatim-as-title flavour (badge only).
  seededVerbatim?: string;
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

// PHI-103: per-anchor resolution record returned by the model. `mode`
// reflects which titling path the prompt's 3-mode rule took for that
// anchor. `placed_title` is present for verbatim/resolved (the title
// landed on a day item) and omitted for flagged (no item placed).
type SeededAnchorResolution = {
  verbatim: string;
  mode: "verbatim" | "resolved" | "flagged";
  placed_title?: string;
  reason?: string;
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
    // PHI-100: optional soft area anchor from the welcome step-2 picker.
    // Only consulted by the prompt when `hotel` is null and the trip is
    // single-leg. Backward compatible — null/missing = pre-PHI-100 shape.
    anchorNeighborhood,
    // PHI-99: flex-mode inputs. When the traveller picked the "Not sure
    // yet — I'm just exploring" path on welcome step 1, the wizard sends
    // these instead of departure/return dates. Both must arrive together;
    // resolveTripDuration enforces and the route returns 400 otherwise.
    flexMonth,
    flexNights,
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
    anchorNeighborhood?: string | null;
    flexMonth?: string | null;
    flexNights?: number | null;
  };

  // PHI-99: trip-duration resolution funnels through the shared helper so
  // the exact-date and flex-mode paths share a single arithmetic. The
  // route accepts either dates OR flex columns; missing both = 400.
  if (!destination) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  let duration;
  try {
    duration = resolveTripDuration({
      legs:
        Array.isArray(legs) && legs.length > 0
          ? legs
          : departureDate && returnDate
            ? [
                {
                  id: "synthetic",
                  place: { name: destination },
                  startDate: departureDate,
                  endDate: returnDate,
                },
              ]
            : null,
      flexMonth: flexMonth ?? null,
      flexNights: flexNights ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: "Missing trip duration: provide either departureDate+returnDate or flexMonth+flexNights." },
      { status: 400 },
    );
  }

  // Hard limit check
  const limit = await checkApiLimit("anthropic");
  if (!limit.allowed) {
    return NextResponse.json({ error: "API limit exceeded", provider: "anthropic", spentUsd: limit.spentUsd, limitUsd: limit.limitUsd }, { status: 429 });
  }

  // PHI-90: only switch the response into "anchors mode" (object shape with
  // placement_notes) when the caller actually supplied non-empty entries.
  // PHI-97: canonical cleaner enforces the 20 × 200-char cap for direct API
  // callers so a runaway payload can't poison the prompt.
  const cleanedSeeds = cleanUserSeededActivities(userSeededActivities);
  const hasAnchors = cleanedSeeds.length > 0;

  const prompt = buildItineraryGenPrompt({
    destination,
    // PHI-99: empty strings on the flex path so the builder skips the
    // "Travel dates: X to Y" line and emits "Day N" headers. The duration
    // helper already produced the canonical nights count.
    departureDate: duration.mode === "flex" ? "" : (departureDate ?? ""),
    returnDate: duration.mode === "flex" ? "" : (returnDate ?? ""),
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
    anchorNeighborhood:
      typeof anchorNeighborhood === "string" && anchorNeighborhood.trim().length > 0
        ? anchorNeighborhood.trim()
        : null,
    nights: duration.nights,
    seasonHint: duration.seasonHint,
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
    // PHI-103: per-anchor debug record. One entry per supplied anchor in
    // the order they were given; mode is "verbatim" | "resolved" | "flagged".
    // Surfaced in the API response so the eval can assert on the model's
    // resolution choices and ai_logs has a paper trail when a real walk
    // turns up a weird substitution.
    let seededAnchorResolutions: SeededAnchorResolution[] | null = null;
    try {
      const parsed = JSON.parse(jsonStr);
      if (hasAnchors) {
        // Anchors-mode response: object with { days, placement_notes,
        // seeded_anchor_resolutions }. Bare-array fallback retained — older
        // or confused model outputs shouldn't strand a user mid-flow.
        if (Array.isArray(parsed)) {
          days_data = parsed;
        } else if (parsed && Array.isArray((parsed as { days?: unknown }).days)) {
          days_data = (parsed as { days: ItineraryDay[] }).days;
          const note = (parsed as { placement_notes?: unknown }).placement_notes;
          if (typeof note === "string" && note.trim().length > 0) {
            placementNotes = note.trim();
          }
          const resolutions = (parsed as { seeded_anchor_resolutions?: unknown })
            .seeded_anchor_resolutions;
          if (Array.isArray(resolutions)) {
            seededAnchorResolutions = resolutions as SeededAnchorResolution[];
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

    // PHI-104: stamp `seededVerbatim` on each item the model placed for a
    // user-seeded anchor. We look up the resolution by the placed_title
    // (case-insensitive) so the badge on /itinerary can render the
    // verbatim subtitle when the resolved title differs from what the user
    // typed. Skipped entirely when there are no anchors / resolutions, so
    // the non-PHI-104 path is byte-identical for callers that don't pass
    // userSeededActivities.
    if (
      hasAnchors &&
      seededAnchorResolutions &&
      Array.isArray(days_data)
    ) {
      const titleToVerbatim = new Map<string, string>();
      for (const r of seededAnchorResolutions) {
        if (
          (r.mode === "verbatim" || r.mode === "resolved") &&
          typeof r.placed_title === "string" &&
          r.placed_title.trim().length > 0 &&
          typeof r.verbatim === "string" &&
          r.verbatim.trim().length > 0
        ) {
          titleToVerbatim.set(r.placed_title.trim().toLowerCase(), r.verbatim);
        }
      }
      if (titleToVerbatim.size > 0) {
        for (const day of days_data) {
          if (!Array.isArray(day.items)) continue;
          for (const item of day.items) {
            if (item.seededByUser !== true) continue;
            const verbatim = titleToVerbatim.get(item.title.trim().toLowerCase());
            if (verbatim) {
              item.seededVerbatim = verbatim;
            }
          }
        }
      }
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
        // PHI-100: surface the soft area anchor when supplied so ai_logs
        // shows whether the prompt was hotel-anchored or neighbourhood-
        // anchored on a per-call basis.
        anchorNeighborhood:
          typeof anchorNeighborhood === "string" && anchorNeighborhood.trim().length > 0
            ? anchorNeighborhood.trim()
            : null,
        // PHI-99: surface flex inputs so ai_logs can be filtered by mode.
        flexMonth: duration.mode === "flex" ? (flexMonth ?? null) : null,
        flexNights: duration.mode === "flex" ? (flexNights ?? null) : null,
        seasonHint: duration.seasonHint,
        durationMode: duration.mode,
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
    // PHI-99: flex-mode trips have no concrete dates — skip the forecast
    // entirely. The client treats absent badDays the same as fail-open,
    // so outdoor items will surface their AI alternative universally.
    let badDays: string[] | null = null;
    if (duration.mode === "exact" && departureDate && returnDate) {
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
    }

    return NextResponse.json({
      days: days_data,
      bad_day_dates: badDays,
      // PHI-90: surfaced inline above Day 1 by the itinerary page when
      // present. Null/omitted when every anchor placed cleanly or no
      // anchors were supplied.
      placement_notes: placementNotes,
      // PHI-103: per-anchor debug record. Eval asserts on this; the
      // /itinerary UI doesn't render it yet (tracked separately).
      seeded_anchor_resolutions: seededAnchorResolutions,
    });
  } catch (err) {
    console.error("[itinerary-generate]", err);
    return NextResponse.json({ error: "Failed to generate itinerary" }, { status: 500 });
  }
}
