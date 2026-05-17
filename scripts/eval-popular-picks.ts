/**
 * PHI-102 — Popular Picks quality eval (LLM-judge).
 *
 * Verifies the prompt + cache pipeline behind /api/destination/popular-picks:
 *
 *   1. 6 destination cities × 3 traveller profiles = 18 fixtures, each
 *      driven through the live Haiku route. Cache is per-fixture, so a
 *      fresh row is generated per fixture (and persisted — re-running the
 *      eval pulls from cache for unchanged fixtures, keeping iteration
 *      cost down).
 *   2. Each fixture's returned picks are scored by Sonnet 4.6 via
 *      tool_use against three criteria — factual accuracy (no hallucinated
 *      venues), profile-fit (notes / picks match THIS traveller), useful-
 *      friction (Elena's fail rule: brochure prose does not count).
 *   3. Pass gate: average overall ≥ 4.0 AND no fixture overall < 3.0.
 *      The per-fixture floor catches uneven failure ("8 fives + 2 twos =
 *      4.4 avg but real day-one harm") — same shape as eval:country-destination.
 *
 * Cost ~ $1.20/run uncached (18 Haiku calls + 18 Sonnet judges).
 *
 * Run before any prompt edit in lib/popular-picks-prompt.ts or the route.
 *
 * Usage (requires the dev server running on localhost:3000):
 *   npm run eval:popular-picks
 */

import Anthropic from "@anthropic-ai/sdk";
import type { PopularPick } from "../lib/popular-picks-prompt";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
const SITE_PASSWORD = process.env.SITE_PASSWORD;

const JUDGE_MODEL = "claude-sonnet-4-6";
const PASS_AVG = 4.0;
const PASS_FLOOR = 3.0;

// ── Auth bootstrap (mirrors scripts/eval-itinerary-anchors.ts) ──────────
async function bootstrapAuth(): Promise<string | null> {
  if (!SITE_PASSWORD) return null;
  const body = new URLSearchParams();
  body.set("password", SITE_PASSWORD);
  body.set("redirect_to", "/");
  const res = await fetch(`${BASE_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });
  if (res.status !== 303) {
    throw new Error(`Auth bootstrap got unexpected status ${res.status} from /api/auth`);
  }
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") ?? "").split(/,(?=\s*[a-zA-Z0-9_-]+=)/);
  const siteAuth = setCookies.find((c) => c.trim().startsWith("site_auth="));
  if (!siteAuth) {
    throw new Error("Auth bootstrap: no site_auth cookie — SITE_PASSWORD likely incorrect.");
  }
  return siteAuth.split(";")[0].trim();
}

// ── Fixtures: 6 cities × 3 profiles = 18 ─────────────────────────────────

type Profile = {
  id: "solo-female" | "family-under-5" | "business-extender";
  travelCompany: string;
  childrenAges: string[] | null;
  styleTags: string[];
  context: string;
};

const PROFILES: Profile[] = [
  {
    id: "solo-female",
    travelCompany: "solo",
    childrenAges: null,
    styleTags: ["Food-led", "Cultural"],
    context:
      "Solo female traveller. Time-of-day / safety notes welcome where relevant. Bias picks that are pleasant for one person — counter seating at restaurants, daytime markets, single-friendly spots.",
  },
  {
    id: "family-under-5",
    travelCompany: "family",
    childrenAges: ["Under 2", "2–4"],
    styleTags: ["Kid-friendly", "Cultural"],
    context:
      "Family with a baby + toddler. Stroller access matters; nap windows mid-morning and mid-afternoon. Hot midday outdoor sites and steep cobbles flag a fail. Pram-friendly + green-space proximity bias.",
  },
  {
    id: "business-extender",
    travelCompany: "solo",
    childrenAges: null,
    styleTags: ["Cultural", "Food-led"],
    context:
      "Jet-lagged business extender, 2 evenings + 1 day of leisure. Wants high-quality picks they can tap through in 60 seconds. Late-night nightlife matters less than 'open before 9pm and 5 minutes from the hotel district'.",
  },
];

const CITIES = ["Lisbon", "Tokyo", "Kyoto", "Bangkok", "Málaga", "New York"];

type Fixture = {
  id: string;
  city: string;
  profile: Profile;
};

const FIXTURES: Fixture[] = CITIES.flatMap((city) =>
  PROFILES.map((profile) => ({ id: `${city.toLowerCase()}-${profile.id}`, city, profile })),
);

// ── Judge ────────────────────────────────────────────────────────────────

const JUDGE_TOOL = {
  name: "score_popular_picks",
  description: "Score a set of popular picks against three criteria + an overall holistic score.",
  input_schema: {
    type: "object" as const,
    properties: {
      factualAccuracy: {
        type: "object",
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: { type: "string" },
        },
        required: ["score", "reasoning"],
      },
      profileFit: {
        type: "object",
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: { type: "string" },
        },
        required: ["score", "reasoning"],
      },
      usefulFriction: {
        type: "object",
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: { type: "string" },
        },
        required: ["score", "reasoning"],
      },
      overall: { type: "integer", minimum: 1, maximum: 5 },
    },
    required: ["factualAccuracy", "profileFit", "usefulFriction", "overall"],
  },
} as const;

type CriterionResult = { score: number; reasoning: string };
type JudgeResult = {
  factualAccuracy: CriterionResult;
  profileFit: CriterionResult;
  usefulFriction: CriterionResult;
  overall: number;
};

async function judge(fixture: Fixture, picks: PopularPick[]): Promise<JudgeResult> {
  if (picks.length === 0) {
    return {
      factualAccuracy: { score: 1, reasoning: "Route returned no picks." },
      profileFit: { score: 1, reasoning: "Route returned no picks." },
      usefulFriction: { score: 1, reasoning: "Route returned no picks." },
      overall: 1,
    };
  }

  const picksList = picks
    .map((p, i) => `  ${i + 1}. ${p.name} — [${p.category}] ${p.context_note}`)
    .join("\n");

  const profileLines = [
    `- Travelling as: ${fixture.profile.travelCompany}`,
    fixture.profile.childrenAges ? `- Children ages: ${fixture.profile.childrenAges.join(", ")}` : null,
    `- Travel style: ${fixture.profile.styleTags.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const userMessage = `You are evaluating the quality of "popular picks" surfaced to a traveller about to plan a trip. The picks are an assist — they live next to a textarea where the traveller types must-dos themselves. A bad pick (fabricated venue, wrong-profile, brochure prose) is a day-one trust kill.

# Destination
${fixture.city}

# Traveller profile
${profileLines}

# Profile context
${fixture.profile.context}

# What the AI surfaced
${picksList}

# Your task
Score three criteria (1-5 each with a one-sentence reason) and one holistic overall score (1-5). Use the score_popular_picks tool — do NOT respond in free text.

## Scoring guidance

**factualAccuracy.** Are ALL picks real places in ${fixture.city}? 5 = every pick is a real venue / experience a resident would recognise. 3 = one borderline / niche pick that's hard to verify. 1 = any fabricated or wrong-city venue.

**profileFit.** Do the picks AND the context notes serve THIS traveller's profile? 5 = top picks delight this profile; notes are tied to profile specifics (pram-friendly for the family, counter seating for the solo, near-hotel for the extender). 3 = mixed — generic-but-readable, profile not actively respected. 1 = top pick is actively wrong for the profile (late-night nightlife pushed to a family with a toddler; "great for couples" for a solo traveller; rural day-trip-only for a 2-evening extender).

**usefulFriction.** Elena's hard rule: **a context note that could appear verbatim on the venue's own marketing page does not count as useful.** "Beautiful azulejo tiles, dating from 1837" — fails. "Closes at 7pm, get there before 6" — passes. "Quietest on weekday mornings" — passes. "Skip if travelling with a stroller — steep cobbles" — passes. 5 = every note carries real friction / fit / pro-tip signal a resident would say. 3 = mixed — some useful, some brochure. 1 = mostly brochure prose / generic platitudes.

**overall.** Holistic 1-5. Be strict — beautifully-written brochure copy does NOT rescue an inaccurate fact or a wrong-profile pick.`;

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    tools: [JUDGE_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "score_popular_picks" },
    messages: [{ role: "user", content: userMessage }],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error(`Judge returned no tool_use block for fixture ${fixture.id}`);
  }
  const result = block.input as JudgeResult;
  for (const k of ["factualAccuracy", "profileFit", "usefulFriction"] as const) {
    const c = result[k] as { score?: unknown } | undefined;
    if (!c || typeof c.score !== "number" || !Number.isFinite(c.score)) {
      throw new Error(`Judge output malformed: ${k} for fixture ${fixture.id}`);
    }
  }
  if (typeof result.overall !== "number" || !Number.isFinite(result.overall)) {
    throw new Error(`Judge output malformed: overall for fixture ${fixture.id}`);
  }
  return result;
}

// ── Runner ───────────────────────────────────────────────────────────────

type FixtureResult = {
  fixture: Fixture;
  picks: PopularPick[];
  judge: JudgeResult;
  cached: boolean;
};

async function runFixture(fixture: Fixture, authCookie: string | null): Promise<FixtureResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authCookie) headers["Cookie"] = authCookie;
  const res = await fetch(`${BASE_URL}/api/destination/popular-picks`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      destination: fixture.city,
      travelCompany: fixture.profile.travelCompany,
      childrenAges: fixture.profile.childrenAges,
      styleTags: fixture.profile.styleTags,
    }),
  });
  if (!res.ok) {
    throw new Error(`Route returned ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { picks?: PopularPick[]; cached?: boolean };
  const picks = Array.isArray(data.picks) ? data.picks : [];
  const judged = await judge(fixture, picks);
  return { fixture, picks, judge: judged, cached: data.cached === true };
}

function printFixture(r: FixtureResult) {
  const cacheTag = r.cached ? " (cached)" : "";
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${r.fixture.id}${cacheTag}`);
  console.log(
    `  factual=${r.judge.factualAccuracy.score} · fit=${r.judge.profileFit.score} · friction=${r.judge.usefulFriction.score} · overall=${r.judge.overall}`,
  );
  console.log(`  picks (${r.picks.length}):`);
  for (const p of r.picks) {
    console.log(`    - ${p.name} [${p.category}] — ${p.context_note}`);
  }
  console.log(`  why-factual: ${r.judge.factualAccuracy.reasoning}`);
  console.log(`  why-fit:     ${r.judge.profileFit.reasoning}`);
  console.log(`  why-friction: ${r.judge.usefulFriction.reasoning}`);
}

async function main() {
  const authCookie = await bootstrapAuth();

  console.log(`\nPHI-102 popular-picks eval — ${FIXTURES.length} fixtures (${CITIES.length} cities × ${PROFILES.length} profiles).`);
  console.log(`Pass gate: average overall ≥ ${PASS_AVG} AND no fixture < ${PASS_FLOOR}.\n`);

  const results: FixtureResult[] = [];
  for (const fixture of FIXTURES) {
    try {
      const r = await runFixture(fixture, authCookie);
      printFixture(r);
      results.push(r);
    } catch (err) {
      console.error(`\n${fixture.id} — CRASHED: ${err instanceof Error ? err.message : String(err)}`);
      results.push({
        fixture,
        picks: [],
        judge: {
          factualAccuracy: { score: 1, reasoning: `crashed: ${err instanceof Error ? err.message : "unknown"}` },
          profileFit: { score: 1, reasoning: "crashed" },
          usefulFriction: { score: 1, reasoning: "crashed" },
          overall: 1,
        },
        cached: false,
      });
    }
  }

  const overallScores = results.map((r) => r.judge.overall);
  const avg = overallScores.reduce((s, n) => s + n, 0) / overallScores.length;
  const min = Math.min(...overallScores);
  const failedFixtures = results.filter((r) => r.judge.overall < PASS_FLOOR);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`SUMMARY — ${results.length} fixtures`);
  console.log(`  average overall: ${avg.toFixed(2)} / 5  (gate: ≥${PASS_AVG})`);
  console.log(`  minimum overall: ${min} / 5  (floor: ≥${PASS_FLOOR})`);
  console.log(`  failed fixtures (<${PASS_FLOOR}): ${failedFixtures.length}`);
  for (const f of failedFixtures) {
    console.log(`    × ${f.fixture.id} — overall=${f.judge.overall}`);
  }

  const passed = avg >= PASS_AVG && min >= PASS_FLOOR;
  console.log(`\nResult: ${passed ? "✅ PASS" : "❌ FAIL"}\n`);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error("Eval crashed:", err);
  process.exit(2);
});
