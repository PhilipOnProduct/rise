/**
 * PHI-57 — POST /api/destinations/cities
 *
 * Returns ranked AI city/region recommendations for a country given the
 * traveller's preferences. Single Haiku call internally (see
 * lib/destination-recommender.ts).
 *
 * Request: { country: string, countryCode?: string, preferences: { ... } }
 * Response: { recommendations: [{ name, kind, why, lat?, lng? }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { logAiInteraction } from "@/lib/ai-logger";
import { checkApiLimit } from "@/lib/log-api-usage";
import {
  countryNameToCode,
  getCandidates,
  rankWithHaiku,
  type Preferences,
} from "@/lib/destination-recommender";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { country, countryCode, preferences } = body as {
    country?: string;
    countryCode?: string;
    preferences?: Preferences;
  };

  if (!country || country.trim().length === 0) {
    return NextResponse.json({ error: "country is required" }, { status: 400 });
  }

  // Anthropic limit gate — Haiku call still counts toward the monthly budget.
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

  const startTime = Date.now();
  const sessionId = req.cookies.get("rise_session_id")?.value ?? null;

  try {
    // PHI-85: callers (welcome flow) often pass country *name* only. Derive
    // the ISO code from the curated dictionary so whitelist + affinity nudges
    // work without forcing every caller to plumb a code through.
    const resolvedCountryCode = countryCode ?? countryNameToCode(country);
    const candidates = await getCandidates(country, resolvedCountryCode);
    const ranked = await rankWithHaiku(
      country,
      candidates,
      preferences ?? {},
      resolvedCountryCode,
    );

    void logAiInteraction({
      feature: "country-destination-recommender",
      model: "claude-haiku-4-5-20251001",
      prompt: ranked.rawUserMessage,
      input: {
        country,
        countryCode: resolvedCountryCode,
        preferences,
        candidatesCount: candidates.length,
      },
      output: JSON.stringify(ranked.recommendations),
      latency_ms: Date.now() - startTime,
      input_tokens: ranked.inputTokens,
      output_tokens: ranked.outputTokens,
      session_id: sessionId,
    });

    return NextResponse.json({ recommendations: ranked.recommendations });
  } catch (err) {
    console.error("[destinations/cities]", err);
    return NextResponse.json(
      { error: "failed to recommend cities" },
      { status: 500 },
    );
  }
}
