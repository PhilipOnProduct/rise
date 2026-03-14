/**
 * Eval script for /api/recommendations
 *
 * Usage (requires the dev server running on localhost:3000):
 *   npm run eval:recommendations
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

type Profile = {
  name: string;
  travelerTypes: string[];
  destination: string;
  travelCompany: string;
  budget: string;
  departureDate: string;
  returnDate: string;
  dietaryWishes: string;
};

type TestCase = {
  label: string;
  profile: Profile;
  criteria: string[];
};

const TEST_CASES: TestCase[] = [
  {
    label: "Vegetarian foodie",
    profile: {
      name: "Maya",
      travelerTypes: ["Foodie — food comes first"],
      destination: "Barcelona",
      travelCompany: "Couple",
      budget: "mid-range",
      departureDate: "2025-06-01",
      returnDate: "2025-06-08",
      dietaryWishes: "vegetarian, no meat or fish",
    },
    criteria: [
      "All or most recommended restaurants offer vegetarian options",
      "No restaurant is recommended primarily for meat or seafood",
      "At least one recommendation highlights local vegetarian or plant-based cuisine",
      "Price range matches mid-range budget (€€ or €€€)",
      "Recommendations are relevant to Barcelona",
    ],
  },
  {
    label: "Luxury business traveler",
    profile: {
      name: "James",
      travelerTypes: ["Comfort traveler — good hotels and restaurants"],
      destination: "Tokyo",
      travelCompany: "Business trip",
      budget: "luxury",
      departureDate: "2025-09-10",
      returnDate: "2025-09-14",
      dietaryWishes: "",
    },
    criteria: [
      "Recommendations are upscale or fine-dining restaurants (€€€€ or €€€)",
      "At least one recommendation is suitable for a business dinner",
      "Restaurants reflect the high-end, comfort-focused traveler profile",
      "Recommendations are relevant to Tokyo",
      "Descriptions mention quality of service or ambiance",
    ],
  },
  {
    label: "Budget backpacker",
    profile: {
      name: "Sam",
      travelerTypes: ["Adventurer — off the beaten track"],
      destination: "Lisbon",
      travelCompany: "Solo",
      budget: "budget",
      departureDate: "2025-07-15",
      returnDate: "2025-07-29",
      dietaryWishes: "",
    },
    criteria: [
      "Recommendations are affordable (€ or €€ price range)",
      "At least one recommendation is a local, non-touristy spot",
      "No recommendations are luxury or fine-dining restaurants",
      "Recommendations suit a solo traveler exploring independently",
      "Recommendations are relevant to Lisbon",
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getRecommendations(profile: Profile): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/recommendations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });

  if (!res.ok) throw new Error(`API returned ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }

  return text.trim();
}

type ScoreResult = {
  score: number;        // 0–10
  passed: boolean;      // score >= 7
  criteriaScores: { criterion: string; met: boolean; comment: string }[];
  summary: string;
};

async function scoreRecommendations(
  testCase: TestCase,
  recommendations: string
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
        content: `You are evaluating the quality of AI-generated restaurant recommendations.

## Traveler profile
- Label: ${testCase.label}
- Destination: ${testCase.profile.destination}
- Traveler types: ${testCase.profile.travelerTypes.join(", ")}
- Travel company: ${testCase.profile.travelCompany}
- Budget: ${testCase.profile.budget}
- Dietary wishes: ${testCase.profile.dietaryWishes || "none"}

## Recommendations to evaluate
${recommendations}

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

function printResult(testCase: TestCase, recommendations: string, result: ScoreResult) {
  const badge = result.passed ? "✅ PASS" : "❌ FAIL";
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${badge}  ${testCase.label}  (score: ${result.score}/10)`);
  console.log(`${"─".repeat(60)}`);

  console.log("\nRecommendations received:");
  console.log(recommendations.slice(0, 300) + (recommendations.length > 300 ? "…" : ""));

  console.log("\nCriteria:");
  for (const c of result.criteriaScores) {
    const mark = c.met ? "  ✓" : "  ✗";
    console.log(`${mark} ${c.criterion}`);
    console.log(`      ${c.comment}`);
  }

  console.log(`\nSummary: ${result.summary}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🔍 Rise — Restaurant Recommendations Eval");
  console.log(`   Targeting: ${BASE_URL}\n`);

  const results: { label: string; passed: boolean; score: number }[] = [];

  for (const testCase of TEST_CASES) {
    process.stdout.write(`Running: ${testCase.label}… `);

    try {
      const recommendations = await getRecommendations(testCase.profile);
      process.stdout.write("scoring… ");
      const result = await scoreRecommendations(testCase, recommendations);
      process.stdout.write("done.\n");

      printResult(testCase, recommendations, result);
      results.push({ label: testCase.label, passed: result.passed, score: result.score });
    } catch (err) {
      process.stdout.write("error.\n");
      console.error(`  ⚠ ${testCase.label}: ${err instanceof Error ? err.message : err}`);
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
    const badge = r.passed ? "✅" : "❌";
    console.log(`  ${badge} ${r.label.padEnd(35)} ${r.score}/10`);
  }
  console.log();

  process.exit(passed === results.length ? 0 : 1);
}

main();
