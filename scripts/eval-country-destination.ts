/**
 * PHI-69 — Country → city ranking quality eval (LLM-judge).
 *
 * Tests lib/destination-recommender.ts (`getCandidates` + `rankWithHaiku`)
 * end-to-end against 10 country + preference combinations covering all 10
 * supported countries (UK, IT, JP, TH, US, FR, ES, GR, MX, AU) plus the
 * Marcus business-extender and Okafors multi-city honeymoon archetypes.
 *
 * For each fixture:
 *   1. Resolve candidates via Google Places (cached across the 3 runs of
 *      the fixture — Places search is deterministic, only Haiku ranking
 *      varies).
 *   2. Run rankWithHaiku 3× — Haiku ranking has variance at production
 *      temperature; PHI-42 documented the same on activities-stream.
 *      Averaging is preferred over a ±0.5 gate tolerance because the
 *      eval is on-demand and the extra signal beats false-pass risk.
 *   3. Hand each ranked output to Sonnet 4.6 as LLM-judge via tool_use
 *      with a 4-criterion rubric: location match, fit-to-profile,
 *      why-quality, no-hallucinations. Judge also produces a holistic
 *      `overall` 1-5 score.
 *   4. Case score = mean of the 3 judge `overall` values.
 *
 * Pass gate (must satisfy BOTH):
 *   - Overall average ≥ 4.0 / 5.
 *   - No single case < 3.0 / 5.
 *
 * The per-case floor exists because uneven failure (8 fives + 2 twos =
 * 4.4 avg but real day-one harm) must not slip through.
 *
 * Per-run cost: ~$0.60 — 10 × 1 Places searchText (~$0.32) +
 * 10 × 3 Haiku rank (~$0.05) + 10 × 3 Sonnet judge (~$0.20).
 * See lib/api-costs.ts for current rates.
 *
 * Run before any prompt edit in lib/destination-recommender.ts or
 * data/country-city-overrides.json.
 *
 * Usage:
 *   npm run eval:country-destination
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  getCandidates,
  rankWithHaiku,
  type CityRecommendation,
  type Preferences,
} from "../lib/destination-recommender";

const JUDGE_MODEL = "claude-sonnet-4-6";
const RUNS_PER_CASE = 3;
const PASS_AVG = 4.0;
const PASS_FLOOR = 3.0;

// ── Fixtures ────────────────────────────────────────────────────────────

type Fixture = {
  id: string;
  country: string;
  countryCode: string;
  preferences: Preferences;
  /** 1-2 sentence story given to the judge — explains what "good" looks like for this profile. */
  context: string;
};

const FIXTURES: Fixture[] = [
  {
    id: "uk-marcus-business-extender",
    country: "United Kingdom",
    countryCode: "GB",
    preferences: {
      travelCompany: "solo",
      styleTags: ["Cultural", "Slow travel"],
      budgetTier: "comfortable",
      travelerCount: 1,
      archetype: "business-extender",
      tripShape: "single-city",
    },
    context:
      "Marcus is in the UK for 3 days of work meetings (London-based) and tacking on 2 days of leisure. " +
      "He's jet-lagged and wants low-effort plans — short transfers, walkable, no rental car. " +
      "Top pick should anchor near where his work was; rural-countryside-only picks (Lake District, " +
      "Cotswolds) are a poor fit for someone with two days and no car.",
  },
  {
    id: "italy-family-toddlers",
    country: "Italy",
    countryCode: "IT",
    preferences: {
      travelCompany: "family",
      styleTags: ["Cultural", "Kid-friendly"],
      budgetTier: "comfortable",
      travelerCount: 4,
      childrenAges: ["Under 2", "2–4"],
      accessibilityNeeds: "stroller",
    },
    context:
      "Family of four — two adults plus a baby and a 3-year-old. They want cultural + kid-friendly. " +
      "Stroller access matters and short hops only. Cinque Terre (clifftop stairs, no stroller " +
      "access) and Amalfi Coast (vertical, narrow roads) are dangerous picks for toddlers; Rome / " +
      "Florence / Tuscany agriturismo work well.",
  },
  {
    id: "japan-family-teens",
    country: "Japan",
    countryCode: "JP",
    preferences: {
      travelCompany: "family",
      styleTags: ["Cultural", "Food-led"],
      budgetTier: "comfortable",
      travelerCount: 4,
      childrenAges: ["9–12", "9–12"],
    },
    context:
      "Family of four with two pre-teen kids. Looking for the classic Japan triangle — modern city " +
      "excitement, deep history, world-class food. Big-name cities (Tokyo / Kyoto / Osaka) should " +
      "anchor the trip; a ranking that opens with Hakone or Sapporo only would miss the brief.",
  },
  {
    id: "thailand-solo-budget-slow",
    country: "Thailand",
    countryCode: "TH",
    preferences: {
      travelCompany: "solo",
      styleTags: ["Slow travel", "Budget-savvy", "Off the beaten track"],
      budgetTier: "budget",
      travelerCount: 1,
    },
    context:
      "Solo traveller, 2-3 weeks, budget. Wants slow travel — long stays, local life, off the resort " +
      "circuit. Chiang Mai, Pai, Ayutthaya all fit. Phuket / Koh Samui (beach-resort, expensive, " +
      "package-tourism) are a poor fit for this profile.",
  },
  {
    id: "usa-friends-nightlife",
    country: "United States",
    countryCode: "US",
    preferences: {
      travelCompany: "friends",
      styleTags: ["Nightlife", "Food-led", "Active"],
      budgetTier: "comfortable",
      travelerCount: 4,
    },
    context:
      "Group of four friends in their late 20s, long weekend or week. They want bars, live music, " +
      "late-night food — energetic, walkable cities only. New Orleans, Austin, NYC, LA, Chicago all " +
      "fit. Quiet picks (Boston-only, DC-only, retiree-coded) would miss.",
  },
  {
    id: "france-couple-mobility",
    country: "France",
    countryCode: "FR",
    preferences: {
      travelCompany: "partner",
      styleTags: ["Cultural", "Relaxed", "Slow travel"],
      budgetTier: "comfortable",
      travelerCount: 2,
      accessibilityNeeds: "mobility",
    },
    context:
      "Couple, one of them has a mobility constraint — no long walks, no steep hills, needs frequent " +
      "seated breaks. The 'Relaxed' style chip is the closest signal the AI gets. Cities with flat " +
      "layouts and good public transport (Paris, Bordeaux, Nice) outrank hilltop villages or " +
      "driving-required regions (Provence, Loire Valley) for this profile.",
  },
  {
    id: "spain-festival-seekers",
    country: "Spain",
    countryCode: "ES",
    preferences: {
      travelCompany: "friends",
      styleTags: ["Festivals", "Cultural", "Food-led"],
      budgetTier: "comfortable",
      travelerCount: 3,
    },
    context:
      "Three friends planning around major Spanish festivals — Las Fallas (Valencia), Feria de Abril " +
      "(Seville), Sant Jordi (Barcelona), San Fermín (Pamplona), La Tomatina (Buñol). Cities with " +
      "iconic festival traditions outrank generic beach destinations (Mallorca, Costa del Sol).",
  },
  {
    id: "greece-food-offbeat",
    country: "Greece",
    countryCode: "GR",
    preferences: {
      travelCompany: "partner",
      styleTags: ["Food-led", "Off the beaten track", "Cultural"],
      budgetTier: "comfortable",
      travelerCount: 2,
    },
    context:
      "Couple drawn to Greek food and lesser-known places. Crete (Cretan diet, mountain villages), " +
      "Naxos (food-strong island), Thessaloniki (street-food capital), Corfu (Venetian + Ionian) " +
      "all fit. Heavy-tourist Mykonos and Santorini are exactly the cliché this profile wants to avoid.",
  },
  {
    id: "mexico-couples-romantic",
    country: "Mexico",
    countryCode: "MX",
    preferences: {
      travelCompany: "partner",
      styleTags: ["Romantic", "Cultural", "Food-led"],
      budgetTier: "comfortable",
      travelerCount: 2,
    },
    context:
      "Couple looking for a romantic, culturally-rich Mexico trip. San Miguel de Allende (cobblestone, " +
      "sunsets), Oaxaca (food/markets/mezcal), Mérida (Yucatán colonial), Puebla all fit. Spring-break " +
      "party towns or generic beach-resort picks miss.",
  },
  {
    id: "australia-okafors-multicity-honeymoon",
    country: "Australia",
    countryCode: "AU",
    preferences: {
      travelCompany: "partner",
      styleTags: ["Cultural", "Romantic", "Food-led", "Beach"],
      budgetTier: "luxury",
      travelerCount: 2,
      archetype: "multi-city-honeymoon",
      tripShape: "multi-city",
    },
    context:
      "The Okafors are on a 2-week honeymoon, planning to hit 3 cities across Australia. " +
      "Big-but-not-unlimited budget ('one splurge meal per city'). They want a multi-city itinerary " +
      "that spans iconic urban (Sydney, Melbourne), unique nature (Cairns / Great Barrier Reef, " +
      "Tasmania), and varied food scenes. Single-city picks or three variants of the same kind of " +
      "city would miss the multi-city ask.",
  },
];

// ── Judge tool ──────────────────────────────────────────────────────────

const JUDGE_TOOL = {
  name: "score_recommendations",
  description:
    "Score the AI's country-to-city recommendations against four rubric criteria (1-5 each, with one-sentence reasoning each) and produce one holistic overall score (1-5).",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      locationMatch: {
        type: "object",
        additionalProperties: false,
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: {
            type: "string",
            description:
              "One sentence: are all recommendations real places actually in the named country?",
          },
        },
        required: ["score", "reasoning"],
      },
      fitToProfile: {
        type: "object",
        additionalProperties: false,
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: {
            type: "string",
            description:
              "One sentence: do the picks AND the ranking serve THIS traveller's profile/archetype?",
          },
        },
        required: ["score", "reasoning"],
      },
      whyQuality: {
        type: "object",
        additionalProperties: false,
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: {
            type: "string",
            description:
              "One sentence: are the per-recommendation 'why' lines specific (cite a real preference + the destination) or generic filler?",
          },
        },
        required: ["score", "reasoning"],
      },
      noHallucinations: {
        type: "object",
        additionalProperties: false,
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: {
            type: "string",
            description:
              "One sentence: any invented landmarks, fake events, claimed partnerships, or non-existent cities?",
          },
        },
        required: ["score", "reasoning"],
      },
      overall: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description:
          "Holistic 1-5 — your overall judgment of whether these top picks would serve this traveller well on day one. Generally tracks the criterion mean, but weight location/fit higher than why-quality on serious mismatches.",
      },
    },
    required: ["locationMatch", "fitToProfile", "whyQuality", "noHallucinations", "overall"],
  },
} as const;

type CriterionResult = { score: number; reasoning: string };
type JudgeResult = {
  locationMatch: CriterionResult;
  fitToProfile: CriterionResult;
  whyQuality: CriterionResult;
  noHallucinations: CriterionResult;
  overall: number;
};

// ── Runner ──────────────────────────────────────────────────────────────

const client = new Anthropic();

function formatProfile(p: Preferences): string {
  const lines: string[] = [];
  if (p.travelCompany) lines.push(`- Travelling as: ${p.travelCompany}`);
  if (p.styleTags?.length) lines.push(`- Travel style: ${p.styleTags.join(", ")}`);
  if (p.budgetTier) lines.push(`- Budget: ${p.budgetTier}`);
  if (p.travelerCount) lines.push(`- Travellers: ${p.travelerCount}`);
  if (p.childrenAges?.length) lines.push(`- Children ages: ${p.childrenAges.join(", ")}`);
  return lines.join("\n") || "(no preferences captured)";
}

async function judgeOnce(
  fixture: Fixture,
  recs: CityRecommendation[],
): Promise<JudgeResult> {
  if (recs.length === 0) {
    return {
      locationMatch: { score: 1, reasoning: "No recommendations returned." },
      fitToProfile: { score: 1, reasoning: "No recommendations returned." },
      whyQuality: { score: 1, reasoning: "No recommendations returned." },
      noHallucinations: { score: 5, reasoning: "Nothing to fabricate." },
      overall: 1,
    };
  }

  const recsLines = recs
    .map((r, i) => `  ${i + 1}. ${r.name} (${r.kind}) — ${r.why}`)
    .join("\n");

  const userMessage = `You are evaluating the quality of an AI's country-to-city recommendations for a real traveller about to plan a trip.

# Country
${fixture.country}

# Traveller context
${fixture.context}

# Profile details
${formatProfile(fixture.preferences)}

# What the AI recommended (best-first ranking)
${recsLines}

# Your task
Score four rubric criteria (1-5 each with a one-sentence reason) and one holistic overall score (1-5). Use the score_recommendations tool — do NOT respond in free text.

Scoring guidance:
- Location match: are ALL recommendations real places actually in ${fixture.country}? 5 = all real and in-country. 1 = invented or wrong-country.
- Fit to profile: do the picks and ranking serve THIS traveller? 5 = top picks delight this profile, ranking is defensible. 3 = mixed (one solid, others marginal). 1 = top pick is actively wrong for the profile.
- Why-quality: each "why" should reference at least one specific preference (style, company, budget, kids, archetype) and be specific to the destination. ≤18 words is the target. 5 = every why ties destination-specific reason to a profile preference. 3 = generic but readable. 1 = filler.
- No hallucinations: no invented landmarks, fake events, claimed partnerships, or non-existent cities. 5 = clean. 1 = obvious fabrication.

Be strict. A beautifully-written "why" does NOT rescue a wrong-city or wrong-profile pick.`;

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    tools: [JUDGE_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "score_recommendations" },
    messages: [{ role: "user", content: userMessage }],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Judge returned no tool_use block");
  }
  // Sonnet occasionally drops fields under tool_choice — validate so a
  // malformed judge output throws into the run-catch path (which scores 1)
  // instead of producing NaN downstream.
  const result = block.input as JudgeResult;
  const criteria = ["locationMatch", "fitToProfile", "whyQuality", "noHallucinations"] as const;
  for (const k of criteria) {
    const c = result[k] as { score?: unknown } | undefined;
    if (!c || typeof c.score !== "number" || !Number.isFinite(c.score)) {
      throw new Error(`Judge output missing or malformed: ${k}`);
    }
  }
  if (typeof result.overall !== "number" || !Number.isFinite(result.overall)) {
    throw new Error("Judge output missing or malformed: overall");
  }
  return result;
}

type RunResult = {
  recs: CityRecommendation[];
  judge: JudgeResult;
};

type CaseResult = {
  fixture: Fixture;
  runs: RunResult[];
  caseScore: number;
};

async function runFixture(fixture: Fixture): Promise<CaseResult> {
  // Candidates are deterministic per (country, code) — fetch once per fixture.
  const candidates = await getCandidates(fixture.country, fixture.countryCode);

  const runs: RunResult[] = [];
  for (let i = 0; i < RUNS_PER_CASE; i++) {
    try {
      const ranked = await rankWithHaiku(
        fixture.country,
        candidates,
        fixture.preferences,
        fixture.countryCode,
      );
      const judge = await judgeOnce(fixture, ranked.recommendations);
      runs.push({ recs: ranked.recommendations, judge });
    } catch (err) {
      console.warn(
        `\n    run ${i + 1} errored: ${err instanceof Error ? err.message : err}`,
      );
      runs.push({
        recs: [],
        judge: {
          locationMatch: { score: 1, reasoning: "Run errored." },
          fitToProfile: { score: 1, reasoning: "Run errored." },
          whyQuality: { score: 1, reasoning: "Run errored." },
          noHallucinations: { score: 1, reasoning: "Run errored." },
          overall: 1,
        },
      });
    }
  }
  const caseScore = runs.reduce((s, r) => s + r.judge.overall, 0) / runs.length;
  return { fixture, runs, caseScore };
}

// ── Pretty printing ─────────────────────────────────────────────────────

function printFailureBlock(c: CaseResult): void {
  const f = c.fixture;
  const sep = "─".repeat(60);
  console.log(`\n${sep}`);
  console.log(`❌ FAIL  ${f.id}  (case score: ${c.caseScore.toFixed(2)}/5)`);
  console.log(sep);
  console.log(`\n  Country:     ${f.country} (${f.countryCode})`);
  console.log(`  Preferences:`);
  for (const line of formatProfile(f.preferences).split("\n")) {
    console.log(`    ${line}`);
  }
  console.log(`  Context:     ${f.context}`);

  c.runs.forEach((r, i) => {
    console.log(`\n  Run ${i + 1}: overall ${r.judge.overall}/5`);
    console.log(`    AI top picks:`);
    if (r.recs.length === 0) {
      console.log(`      (none returned)`);
    } else {
      r.recs.forEach((rec, j) => {
        console.log(`      ${j + 1}. ${rec.name} (${rec.kind}) — ${rec.why}`);
      });
    }
    console.log(`    Judge:`);
    console.log(
      `      location match  (${r.judge.locationMatch.score}/5) — ${r.judge.locationMatch.reasoning}`,
    );
    console.log(
      `      fit to profile  (${r.judge.fitToProfile.score}/5) — ${r.judge.fitToProfile.reasoning}`,
    );
    console.log(
      `      why quality     (${r.judge.whyQuality.score}/5) — ${r.judge.whyQuality.reasoning}`,
    );
    console.log(
      `      no hallucinate  (${r.judge.noHallucinations.score}/5) — ${r.judge.noHallucinations.reasoning}`,
    );
  });
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(60));
  console.log("  PHI-69 — Country → city ranking quality eval");
  console.log(
    `  Cases: ${FIXTURES.length}  |  Runs/case: ${RUNS_PER_CASE}  |  Judge: ${JUDGE_MODEL}`,
  );
  console.log("═".repeat(60));

  const results: CaseResult[] = [];
  for (const fixture of FIXTURES) {
    process.stdout.write(`\n  Running ${fixture.id}…  `);
    try {
      const result = await runFixture(fixture);
      const flag =
        result.caseScore < PASS_FLOOR
          ? " ❌"
          : result.caseScore < PASS_AVG
            ? " ⚠"
            : " ✓";
      process.stdout.write(`done — ${result.caseScore.toFixed(2)}/5${flag}\n`);
      results.push(result);
    } catch (err) {
      process.stdout.write(`error.\n`);
      console.error(
        `  ⚠ ${fixture.id}: ${err instanceof Error ? err.message : err}`,
      );
      results.push({ fixture, runs: [], caseScore: 0 });
    }
  }

  const overallAvg =
    results.reduce((s, r) => s + r.caseScore, 0) / results.length;
  // Use !(>=) so NaN from a degraded run is treated as a failure rather
  // than silently slipping through the per-case floor check.
  const failingCases = results.filter((r) => !(r.caseScore >= PASS_FLOOR));
  const overallPass = overallAvg >= PASS_AVG && failingCases.length === 0;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  PER-CASE SUMMARY`);
  console.log("═".repeat(60));
  for (const r of results) {
    const badge = r.caseScore >= PASS_FLOOR ? "✓" : "✗";
    console.log(
      `  ${badge}  ${r.fixture.id.padEnd(42)}  ${r.caseScore.toFixed(2)}/5`,
    );
  }

  if (failingCases.length > 0) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  FAILURE DETAIL  (cases < ${PASS_FLOOR.toFixed(1)}/5)`);
    console.log("═".repeat(60));
    for (const c of failingCases) printFailureBlock(c);
  }

  // PHI-85: also print detail for warning cases (≥ floor but < pass avg) so
  // it's clear which cases are dragging the gate down without re-running.
  const warningCases = results.filter(
    (r) => r.caseScore >= PASS_FLOOR && r.caseScore < PASS_AVG,
  );
  if (warningCases.length > 0) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(
      `  WARNING DETAIL  (cases ≥ ${PASS_FLOOR.toFixed(1)} but < ${PASS_AVG.toFixed(1)}/5)`,
    );
    console.log("═".repeat(60));
    for (const c of warningCases) printFailureBlock(c);
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(
    `  OVERALL AVG: ${overallAvg.toFixed(2)}/5  |  ` +
      `Failing cases: ${failingCases.length}  |  ` +
      `Gate: ${overallPass ? "✅ PASS" : "❌ FAIL"}`,
  );
  console.log(
    `  Pass criteria: ≥${PASS_AVG.toFixed(1)} avg AND no case < ${PASS_FLOOR.toFixed(1)}`,
  );
  console.log("═".repeat(60));
  console.log();

  process.exit(overallPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
