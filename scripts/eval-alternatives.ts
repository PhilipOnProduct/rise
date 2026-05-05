/**
 * Eval script for /api/itinerary/alternative
 *
 * Tests the restaurant alternative prompt across 5 different replacement scenarios:
 * different cuisines, budget tiers, destinations, vibes, and travel company types.
 *
 * Usage (requires the dev server running on localhost:3000):
 *   npx tsx scripts/eval-alternatives.ts
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Test cases — 5 diverse replacement scenarios
// ---------------------------------------------------------------------------

type AlternativeRequest = {
  destination: string;
  departureDate: string;
  returnDate: string;
  travelCompany: string;
  travelerTypes: string[];
  budgetTier: string;
  replacingRestaurant: string;
  cuisine: string;
  vibe: string;
  timeBlock: string;
  date: string;
  dayNumber: number;
};

type TestCase = {
  label: string;
  request: AlternativeRequest;
  criteria: string[];
};

const TEST_CASES: TestCase[] = [
  {
    label: "Italian dinner swap in Rome (mid-range couple)",
    request: {
      destination: "Rome",
      departureDate: "2025-06-10",
      returnDate: "2025-06-15",
      travelCompany: "Couple",
      travelerTypes: ["Foodie — food comes first", "Cultural"],
      budgetTier: "comfortable",
      replacingRestaurant: "Trattoria Da Enzo al 29",
      cuisine: "Italian",
      vibe: "romantic",
      timeBlock: "evening",
      date: "2025-06-12",
      dayNumber: 3,
    },
    criteria: [
      "The alternative is a real, specific restaurant in Rome (not generic)",
      "It is different from Trattoria Da Enzo al 29 — different name and ideally different cuisine or vibe",
      "It fits an evening dining slot",
      "Price tier is appropriate for mid-range/comfortable budget (€€ or €€€)",
      "The response includes valid booking_meta with a search_query field",
      "The description is specific to Rome, not generic",
    ],
  },
  {
    label: "Budget sushi swap in Tokyo (solo backpacker)",
    request: {
      destination: "Tokyo",
      departureDate: "2025-08-01",
      returnDate: "2025-08-14",
      travelCompany: "Solo",
      travelerTypes: ["Adventurer — off the beaten track"],
      budgetTier: "budget",
      replacingRestaurant: "Sushi Dai",
      cuisine: "Japanese",
      vibe: "authentic",
      timeBlock: "afternoon",
      date: "2025-08-05",
      dayNumber: 5,
    },
    criteria: [
      "The alternative is a real, specific restaurant in Tokyo",
      "It is different from Sushi Dai — genuinely different option",
      "It fits a budget tier (€ or €€ pricing)",
      "It suits a solo traveler",
      "The response includes valid booking_meta with search_query",
      "It is appropriate for an afternoon meal slot",
    ],
  },
  {
    label: "Luxury seafood swap in Barcelona (family)",
    request: {
      destination: "Barcelona",
      departureDate: "2025-07-20",
      returnDate: "2025-07-27",
      travelCompany: "Family",
      travelerTypes: ["Relaxed", "Foodie — food comes first"],
      budgetTier: "luxury",
      replacingRestaurant: "Can Solé",
      cuisine: "Seafood",
      vibe: "lively",
      timeBlock: "evening",
      date: "2025-07-23",
      dayNumber: 4,
    },
    criteria: [
      "The alternative is a real, specific restaurant in Barcelona",
      "It is different from Can Solé",
      "Price tier matches luxury budget (€€€ or €€€€)",
      "It is family-friendly or at least not explicitly adults-only",
      "The response includes valid booking_meta with all three fields",
      "The description references Barcelona specifically",
    ],
  },
  {
    label: "Brunch swap in Lisbon (friends, weekend)",
    request: {
      destination: "Lisbon",
      departureDate: "2025-09-05",
      returnDate: "2025-09-09",
      travelCompany: "Friends",
      travelerTypes: ["Nightlife", "Art & Design"],
      budgetTier: "comfortable",
      replacingRestaurant: "Café A Brasileira",
      cuisine: "Café",
      vibe: "trendy",
      timeBlock: "morning",
      date: "2025-09-06",
      dayNumber: 2,
    },
    criteria: [
      "The alternative is a real, specific restaurant/café in Lisbon",
      "It is different from Café A Brasileira",
      "It fits a morning time slot (brunch, breakfast, or café)",
      "It suits a group of friends with artsy/nightlife interests",
      "The response includes valid booking_meta with search_query",
      "Price tier is appropriate for comfortable budget",
    ],
  },
  {
    label: "High-demand New Year's Eve dinner swap in Paris (couple, luxury)",
    request: {
      destination: "Paris",
      departureDate: "2025-12-29",
      returnDate: "2026-01-03",
      travelCompany: "Couple",
      travelerTypes: ["Comfort traveler — good hotels and restaurants"],
      budgetTier: "luxury",
      replacingRestaurant: "Le Cinq",
      cuisine: "French fine dining",
      vibe: "elegant",
      timeBlock: "evening",
      date: "2025-12-31",
      dayNumber: 3,
    },
    criteria: [
      "The alternative is a real, specific restaurant in Paris",
      "It is different from Le Cinq",
      "It matches luxury budget tier (€€€ or €€€€)",
      "It is suitable for a special New Year's Eve dinner (the model should recognise the date significance)",
      "The response includes valid booking_meta with all three fields",
      "The description or vibe reflects the romantic/celebratory occasion",
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAlternative(request: AlternativeRequest): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/api/itinerary/alternative`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!res.ok) throw new Error(`API returned ${res.status}`);
  const data = await res.json();
  if (!data.alternative) throw new Error("No alternative in response");
  return data.alternative;
}

type ScoreResult = {
  score: number;
  passed: boolean;
  criteriaScores: { criterion: string; met: boolean; comment: string }[];
  summary: string;
};

async function scoreAlternative(
  testCase: TestCase,
  alternative: Record<string, unknown>
): Promise<ScoreResult> {
  const criteriaList = testCase.criteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are evaluating the quality of an AI-generated restaurant alternative.

## Scenario
- Label: ${testCase.label}
- Destination: ${testCase.request.destination}
- Replacing: ${testCase.request.replacingRestaurant} (${testCase.request.cuisine}, ${testCase.request.vibe})
- Travel dates: ${testCase.request.departureDate} to ${testCase.request.returnDate}
- Meal date: ${testCase.request.date} (Day ${testCase.request.dayNumber}, ${testCase.request.timeBlock})
- Travel company: ${testCase.request.travelCompany}
- Travel style: ${testCase.request.travelerTypes.join(", ")}
- Budget: ${testCase.request.budgetTier}

## Generated alternative
${JSON.stringify(alternative, null, 2)}

## Evaluation criteria
${criteriaList}

Evaluate whether each criterion is met. Then give an overall score from 0 to 10.

Respond with valid JSON only, no markdown, in this exact shape:
{
  "criteriaScores": [
    { "criterion": "<criterion text>", "met": true|false, "comment": "<one sentence>" }
  ],
  "score": <0-10>,
  "summary": "<two sentences overall assessment>"
}`,
      },
    ],
  });

  const raw = response.content.find((b) => b.type === "text")?.text ?? "";

  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as ScoreResult;
    parsed.passed = parsed.score >= 7;
    return parsed;
  } catch {
    throw new Error(`Failed to parse scorer response:\n${raw}`);
  }
}

function printResult(testCase: TestCase, alternative: Record<string, unknown>, result: ScoreResult) {
  const badge = result.passed ? "\u2705 PASS" : "\u274C FAIL";
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${badge}  ${testCase.label}  (score: ${result.score}/10)`);
  console.log(`${"─".repeat(60)}`);

  console.log("\nGenerated alternative:");
  console.log(`  Title: ${alternative.title}`);
  console.log(`  Cuisine: ${alternative.cuisine} · Vibe: ${alternative.vibe} · Price: ${alternative.price_tier}`);
  console.log(`  Description: ${alternative.description}`);
  const meta = alternative.booking_meta as Record<string, unknown> | undefined;
  if (meta) {
    console.log(`  Booking: ${meta.preferred_platform} (${meta.confidence}) — "${meta.search_query}"`);
  }

  console.log("\nCriteria:");
  for (const c of result.criteriaScores) {
    const mark = c.met ? "  \u2713" : "  \u2717";
    console.log(`${mark} ${c.criterion}`);
    console.log(`      ${c.comment}`);
  }

  console.log(`\nSummary: ${result.summary}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\uD83D\uDD0D Rise — Restaurant Alternative Eval");
  console.log(`   Targeting: ${BASE_URL}`);
  console.log(`   Testing ${TEST_CASES.length} replacement scenarios\n`);

  const results: { label: string; passed: boolean; score: number }[] = [];

  for (const testCase of TEST_CASES) {
    process.stdout.write(`Running: ${testCase.label}... `);

    try {
      const alternative = await getAlternative(testCase.request);
      process.stdout.write("scoring... ");
      const result = await scoreAlternative(testCase, alternative);
      process.stdout.write("done.\n");

      printResult(testCase, alternative, result);
      results.push({ label: testCase.label, passed: result.passed, score: result.score });
    } catch (err) {
      process.stdout.write("error.\n");
      console.error(`  \u26A0 ${testCase.label}: ${err instanceof Error ? err.message : err}`);
      results.push({ label: testCase.label, passed: false, score: 0 });
    }
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const passRate = Math.round((passed / results.length) * 100);
  const avgScore = (results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`RESULTS  ${passed}/${results.length} passed  (${passRate}% pass rate)  avg score: ${avgScore}/10`);
  console.log("═".repeat(60));
  for (const r of results) {
    const badge = r.passed ? "\u2705" : "\u274C";
    console.log(`  ${badge} ${r.label.padEnd(55)} ${r.score}/10`);
  }
  console.log();

  process.exit(passed === results.length ? 0 : 1);
}

main();
