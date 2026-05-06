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
    legs,
  });
  const isMultiLeg = Array.isArray(legs) && legs.length >= 2;

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
