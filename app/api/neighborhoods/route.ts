import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  NEIGHBORHOOD_GEN_SYSTEM,
  NEIGHBORHOOD_TOOL,
  buildNeighborhoodGenUserMessage,
  neighborhoodCacheKey,
  type NeighborhoodCard,
} from "@/lib/neighborhood-gen-prompt";

const client = new Anthropic();
// PHI-100 — Haiku, not Sonnet. The output is a small structured list of
// known facts about a city; Haiku is enough and the per-call cost matters
// because step 2 is a top-of-funnel screen.
const MODEL = "claude-haiku-4-5-20251001";

function dbErr(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  return [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") || JSON.stringify(err);
}

export async function POST(req: NextRequest) {
  const { destination, childrenAges } = (await req.json()) as {
    destination?: string;
    childrenAges?: string[] | null;
  };
  const trimmed = typeof destination === "string" ? destination.trim() : "";
  if (!trimmed) {
    return NextResponse.json({ error: "destination is required." }, { status: 400 });
  }
  // PHI-107: family-mode shard. Any child triggers it — age-band sub-clauses
  // are out of scope. Non-family path stays byte-identical to pre-PHI-107
  // (system + user message, cache row, all unchanged).
  const hasChildren = Array.isArray(childrenAges) && childrenAges.length > 0;

  const cacheKey = neighborhoodCacheKey(trimmed);
  const supabase = getSupabaseAdminClient();

  // Cache hit — case-insensitive lookup, sharded by has_children. Skip the
  // API entirely. The composite unique index (destination_key, has_children)
  // is what gives us the two-row-per-destination shape.
  const { data: cached, error: cacheErr } = await supabase
    .from("destination_neighborhoods")
    .select("neighborhoods")
    .eq("destination_key", cacheKey)
    .eq("has_children", hasChildren)
    .maybeSingle();
  if (cacheErr) {
    // Non-fatal — fall through to generation. Logged for visibility.
    console.warn("[neighborhoods] cache lookup failed:", dbErr(cacheErr));
  }
  if (cached?.neighborhoods) {
    return NextResponse.json({
      neighborhoods: cached.neighborhoods as NeighborhoodCard[],
      cached: true,
    });
  }

  // Hard limit check before billing.
  const limit = await checkApiLimit("anthropic");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "API limit exceeded", provider: "anthropic", spentUsd: limit.spentUsd, limitUsd: limit.limitUsd },
      { status: 429 },
    );
  }

  const userMessage = buildNeighborhoodGenUserMessage(trimmed, { hasChildren });
  const sessionId = req.cookies.get("rise_session_id")?.value ?? null;

  const startTime = Date.now();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: NEIGHBORHOOD_GEN_SYSTEM,
      tools: [NEIGHBORHOOD_TOOL],
      tool_choice: { type: "tool", name: NEIGHBORHOOD_TOOL.name },
      messages: [{ role: "user", content: userMessage }],
    });

    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      console.error("[neighborhoods] no tool_use in response", response);
      return NextResponse.json({ error: "AI returned no neighbourhoods." }, { status: 500 });
    }
    const input = toolUse.input as { neighborhoods?: NeighborhoodCard[] };
    const neighborhoods = Array.isArray(input.neighborhoods) ? input.neighborhoods : [];
    if (neighborhoods.length < 4) {
      console.error("[neighborhoods] tool returned <4 entries", input);
      return NextResponse.json({ error: "AI returned too few neighbourhoods." }, { status: 500 });
    }

    await logAiInteraction({
      feature: "neighborhoods",
      model: MODEL,
      prompt: `${NEIGHBORHOOD_GEN_SYSTEM}\n\n---\n\n${userMessage}`,
      input: { destination: trimmed, hasChildren },
      output: JSON.stringify(neighborhoods),
      latency_ms: Date.now() - startTime,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      session_id: sessionId,
    });

    await logApiUsage({
      provider: "anthropic",
      apiType: "neighborhoods",
      feature: "onboarding",
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    // Cache the result. Best-effort — a failure here doesn't fail the
    // request; next visitor for this destination + composition will just
    // regenerate. onConflict targets the composite (destination_key,
    // has_children) so the two shards never overwrite each other.
    const { error: upsertErr } = await supabase
      .from("destination_neighborhoods")
      .upsert(
        {
          destination_key: cacheKey,
          destination_display: trimmed,
          has_children: hasChildren,
          neighborhoods,
          model: MODEL,
        },
        { onConflict: "destination_key,has_children" },
      );
    if (upsertErr) {
      console.warn("[neighborhoods] cache write failed:", dbErr(upsertErr));
    }

    return NextResponse.json({ neighborhoods, cached: false });
  } catch (err) {
    console.error("[neighborhoods]", err);
    return NextResponse.json({ error: "Failed to generate neighbourhoods." }, { status: 500 });
  }
}
