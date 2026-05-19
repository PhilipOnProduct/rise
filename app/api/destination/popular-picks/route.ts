/**
 * PHI-102 — Popular Picks route.
 *
 * Welcome step 4's "Need ideas? See popular picks" panel calls this. The
 * pattern mirrors `app/api/neighborhoods/route.ts` (PHI-100): cache lookup
 * by (city, company, sorted age bands, sorted style tags) → Haiku tool_use
 * fallback → cache write → return `{ picks, cached }`.
 *
 * Hard constraints from the PRD enforced here:
 *   - Every pick carries a context_note (cleanPopularPicks drops noteless).
 *   - Context note ≤80 chars (cleanPopularPicks truncates).
 *   - Sub-minimum: <5 picks acceptable down to 3; <3 returns an empty list
 *     and the client renders the "No popular picks yet — type your own"
 *     fallback.
 *   - checkApiLimit("anthropic") gates billing.
 *   - logApiUsage runs after every successful Haiku call.
 *   - Style tags sorted before being part of the cache key.
 */

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { logApiUsage, checkApiLimit } from "@/lib/log-api-usage";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  POPULAR_PICKS_SYSTEM,
  POPULAR_PICKS_TOOL,
  buildPopularPicksUserMessage,
  cleanPopularPicks,
  popularPicksCityKey,
  popularPicksSortedAgeBands,
  popularPicksSortedStyleTags,
  type PopularPick,
} from "@/lib/popular-picks-prompt";

const client = new Anthropic();
// PHI-102 — first ship targeted Haiku for cost (`$~0.001`/call) per PRD,
// but the eval failed at 3.72/4.0 because Haiku hallucinated ~25% of
// venue names ("Tsukiji" on Kyoto, "Mizuki Shikibu Museum", "Pastel de
// Nata de Belém"). Switched to Sonnet 4.6 at ~5× the per-call cost — the
// cache covers >70% of expected traffic per the PRD's own cost posture,
// so net production-cost impact is small. Documented in CLAUDE.md and the
// PHI-102 closing comment as a deliberate spec deviation from the PRD's
// Haiku starting point.
const MODEL = "claude-sonnet-4-6";

function dbErr(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  return [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") || JSON.stringify(err);
}

export async function POST(req: NextRequest) {
  const { destination, travelCompany, childrenAges, styleTags } =
    (await req.json()) as {
      destination?: string;
      travelCompany?: string | null;
      childrenAges?: string[] | null;
      styleTags?: string[] | null;
    };
  const trimmed = typeof destination === "string" ? destination.trim() : "";
  if (!trimmed) {
    return NextResponse.json({ error: "destination is required." }, { status: 400 });
  }

  const cityKey = popularPicksCityKey(trimmed);
  const company =
    typeof travelCompany === "string" && travelCompany.trim().length > 0
      ? travelCompany.trim().toLowerCase()
      : null;
  const sortedAges = popularPicksSortedAgeBands(childrenAges);
  const sortedTags = popularPicksSortedStyleTags(styleTags);

  const supabase = getSupabaseAdminClient();

  // Cache lookup — keyed on the FULL profile shape so a different
  // composition / company / tags returns its own row. The unique index
  // uses coalesce'd defaults to make the comparison total — Postgres
  // treats NULL = NULL as "unknown" otherwise, which breaks lookup.
  const { data: cached, error: cacheErr } = await supabase
    .from("popular_picks_cache")
    .select("picks")
    .eq("city_key", cityKey)
    .eq("travel_company", company)
    .eq("children_age_bands", sortedAges)
    .eq("top_style_tags_sorted", sortedTags)
    .maybeSingle();
  if (cacheErr) {
    console.warn("[popular-picks] cache lookup failed:", dbErr(cacheErr));
  }
  if (cached?.picks) {
    return NextResponse.json({
      picks: cached.picks as PopularPick[],
      cached: true,
    });
  }

  // Hard limit check before billing. On limit-exceeded with no cache hit,
  // 429 — the panel renders an empty/error state and the user can type
  // their own picks instead (textarea remains the source of truth).
  const limit = await checkApiLimit("anthropic");
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "API limit exceeded",
        provider: "anthropic",
        spentUsd: limit.spentUsd,
        limitUsd: limit.limitUsd,
      },
      { status: 429 },
    );
  }

  const userMessage = buildPopularPicksUserMessage({
    destination: trimmed,
    travelCompany: company,
    childrenAges: sortedAges,
    styleTags: sortedTags,
  });
  const sessionId = req.cookies.get("rise_session_id")?.value ?? null;

  const startTime = Date.now();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: POPULAR_PICKS_SYSTEM,
      tools: [POPULAR_PICKS_TOOL],
      tool_choice: { type: "tool", name: POPULAR_PICKS_TOOL.name },
      messages: [{ role: "user", content: userMessage }],
    });

    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      console.error("[popular-picks] no tool_use in response", response);
      return NextResponse.json({ error: "AI returned no picks." }, { status: 500 });
    }
    const input = toolUse.input as { picks?: unknown };
    const picks = cleanPopularPicks(input.picks);

    await logAiInteraction({
      feature: "popular-picks",
      model: MODEL,
      prompt: `${POPULAR_PICKS_SYSTEM}\n\n---\n\n${userMessage}`,
      input: { destination: trimmed, travelCompany: company, childrenAges: sortedAges, styleTags: sortedTags },
      output: JSON.stringify(picks),
      latency_ms: Date.now() - startTime,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      session_id: sessionId,
    });

    await logApiUsage({
      provider: "anthropic",
      apiType: "popular-picks",
      feature: "onboarding",
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      // PHI-121: when called by the evals GUI runner (eval:popular-picks
      // suite), link this row back to its eval_suite_runs id so realised
      // cost can be rolled up at run finish. Production callers never set
      // the header — defaults to null.
      suiteRunId: req.headers.get("x-suite-run-id"),
    });

    // Sub-minimum: if Haiku returned <3 well-formed picks (post-clean),
    // return an empty array so the client falls back to the "type your
    // own" hint and hides the panel for the rest of the session. Don't
    // cache an empty list — give Haiku a chance to do better next time.
    if (picks.length < 3) {
      return NextResponse.json({ picks: [], cached: false });
    }

    // Cache the cleaned picks. Best-effort — a write failure doesn't
    // fail the request. Next visitor regenerates.
    const { error: upsertErr } = await supabase
      .from("popular_picks_cache")
      .insert({
        city_key: cityKey,
        city_display: trimmed,
        travel_company: company,
        children_age_bands: sortedAges,
        top_style_tags_sorted: sortedTags,
        picks,
        model: MODEL,
      });
    if (upsertErr) {
      console.warn("[popular-picks] cache write failed:", dbErr(upsertErr));
    }

    return NextResponse.json({ picks, cached: false });
  } catch (err) {
    console.error("[popular-picks]", err);
    return NextResponse.json({ error: "Failed to generate picks." }, { status: 500 });
  }
}
