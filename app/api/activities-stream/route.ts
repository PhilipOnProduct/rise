import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";
import type { TripLeg } from "@/lib/trip-schema";
// PHI-43: prompt + user-message builder live in lib/ as the single
// source of truth. Edit there, not here. The eval harness imports the
// same module so they stay in sync.
import {
  ACTIVITY_GEN_SYSTEM,
  buildActivityGenUserMessage,
} from "@/lib/activity-gen-prompt";
// PHI-53: forecast helpers — wired in here so the welcome step-4
// preview can surface a "some days look wet" hint before the user
// has saved a trip. The saved-itinerary path runs its own forecast
// in /api/itinerary/generate; this is the same data on the preview
// side. Fail-open: any error → no header → client shows no banner.
import { fetchForecast, badDayDates } from "@/lib/weather";
import { geocodeCity } from "@/lib/travel-connectors";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

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
    // PHI-51: optional creative-inspiration soft bias from the free-form parser.
    inspiration,
    // PHI-37: multi-leg trip support. When 2+ legs are provided, the
    // prompt switches to multi-leg mode and the streamed output carries
    // LEG: <index> markers so the client can group cards by leg. When
    // legs is missing or has length <=1, the existing single-leg path
    // runs unchanged (backward compatible).
    legs,
    // PHI-100: optional soft area anchor from welcome step 2. Surfaced
    // only on single-leg trips. Backward compatible — null/missing keeps
    // the prompt byte-identical to pre-PHI-100.
    anchorNeighborhood,
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
    inspiration?: string;
    legs?: TripLeg[];
    anchorNeighborhood?: string | null;
  };

  // Hard limit check
  const limit = await checkApiLimit("anthropic");
  if (!limit.allowed) {
    return NextResponse.json({ error: "API limit exceeded", provider: "anthropic", spentUsd: limit.spentUsd, limitUsd: limit.limitUsd }, { status: 429 });
  }

  // PHI-43: SYSTEM and the user-message construction live in
  // lib/activity-gen-prompt.ts so the eval harness uses identical text.
  const userMessage = buildActivityGenUserMessage({
    destination,
    departureDate,
    returnDate,
    travelCompany,
    styleTags,
    budgetTier,
    travelerCount,
    childrenAges,
    constraintTags,
    constraintText,
    inspiration,
    legs,
    anchorNeighborhood:
      typeof anchorNeighborhood === "string" && anchorNeighborhood.trim().length > 0
        ? anchorNeighborhood.trim()
        : null,
  });
  const isMultiLeg = Array.isArray(legs) && legs.length >= 2;

  // PHI-40: tag the log with rise_session_id so the cost-report script
  // can attribute calls to a trip. Cookie set by middleware on first visit.
  const sessionId = req.cookies.get("rise_session_id")?.value ?? null;

  // PHI-53: kick off the Open-Meteo forecast in parallel with the
  // Anthropic stream. Result is attached to the response as an
  // X-Bad-Day-Dates header so the welcome page can surface a "some
  // days look wet" hint above the preview cards. We bound the await
  // below so a slow geocode/forecast can't delay the stream.
  const forecastCity =
    destination ??
    (Array.isArray(legs) && legs[0]?.place?.name) ??
    null;
  const forecastPromise: Promise<string[] | null> = (async () => {
    if (!forecastCity || !departureDate || !returnDate) return null;
    try {
      const coords = await geocodeCity(forecastCity);
      if (!coords) return null;
      const forecast = await fetchForecast(
        coords.lat,
        coords.lng,
        departureDate,
        returnDate,
      );
      void logApiUsage({
        provider: "open-meteo",
        apiType: "forecast",
        feature: "activities-stream",
      });
      return badDayDates(forecast);
    } catch (err) {
      console.warn("[activities-stream] forecast failed:", err);
      return null;
    }
  })();

  const startTime = Date.now();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: ACTIVITY_GEN_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
  });

  const encoder = new TextEncoder();
  // Abort the upstream Anthropic stream when the client disconnects so we
  // stop billing for tokens nobody is reading.
  const onAbort = () => stream.abort();
  req.signal.addEventListener("abort", onAbort);

  const readable = new ReadableStream({
    async start(controller) {
      let output = "";
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
            output += event.delta.text;
          }
        }
      } catch (err) {
        console.error("[activities-stream] stream error:", err);
      } finally {
        req.signal.removeEventListener("abort", onAbort);
      }
      controller.close();

      try {
        const final = await stream.finalMessage();
        await logAiInteraction({
          feature: "activities-stream",
          model: MODEL,
          prompt: `${ACTIVITY_GEN_SYSTEM}\n\n---\n\n${userMessage}`,
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
            // PHI-100: log the anchor when set so ai_logs reflects whether
            // the call was hotel-anchored (none here today), neighbourhood-
            // anchored, or anchor-less.
            anchorNeighborhood:
              typeof anchorNeighborhood === "string" && anchorNeighborhood.trim().length > 0
                ? anchorNeighborhood.trim()
                : null,
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

  // PHI-53: bound the wait so a slow forecast can't block the stream.
  // 1.5s is well above Open-Meteo's typical ~200ms; if we don't have the
  // result by then we ship without the header (client treats absence as
  // "no banner" — fail-open for the preview).
  const badDays = await Promise.race<string[] | null>([
    forecastPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
  ]);

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...(badDays && badDays.length > 0
        ? { "X-Bad-Day-Dates": JSON.stringify(badDays) }
        : {}),
    },
  });
}
