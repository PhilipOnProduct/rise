/**
 * Eval script for /api/itinerary/edit — Location constraint
 *
 * Verifies that swap/add suggestions are always in the destination city,
 * even when the day context contains activities from other cities (trap cases).
 *
 * Usage (requires the dev server running on localhost:3000):
 *   npm run eval:location
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

type EditRequest = {
  mode: "swap" | "add";
  destination: string;
  dayNumber: number;
  date: string;
  block: "morning" | "afternoon" | "evening";
  dayItems: { title: string; description: string; time_block: string }[];
  replacingItem?: { title: string; description: string };
  rejectedTitles?: string[];
  travelCompany: string;
  travelerTypes: string[];
  budgetTier: string;
  travelerCount: number;
  childrenAges: string[] | null;
};

type TestCase = {
  label: string;
  request: EditRequest;
  criteria: string[];
};

const TEST_CASES: TestCase[] = [
  {
    label: "Swap: replacing a Paris activity in an Amsterdam itinerary",
    request: {
      mode: "swap",
      destination: "Amsterdam",
      dayNumber: 2,
      date: "2025-06-17",
      block: "morning",
      dayItems: [
        { title: "Canal boat tour", description: "Cruise through Amsterdam's historic canals", time_block: "afternoon" },
        { title: "Dinner at De Kas", description: "Farm-to-table restaurant in a greenhouse", time_block: "evening" },
      ],
      replacingItem: { title: "Eiffel Tower visit", description: "Famous Paris landmark with panoramic city views" },
      travelCompany: "partner",
      travelerTypes: ["Cultural"],
      budgetTier: "mid-range",
      travelerCount: 2,
      childrenAges: null,
    },
    criteria: [
      "The suggested activity is physically located in Amsterdam or its immediate surroundings (not Paris or any other city)",
      "The title does not reference the Eiffel Tower, Paris, or any Paris-specific landmark",
      "The description references Amsterdam-specific places, streets, or neighbourhoods",
    ],
  },
  {
    label: "Swap: replacing a Berlin museum in a Lisbon itinerary",
    request: {
      mode: "swap",
      destination: "Lisbon",
      dayNumber: 3,
      date: "2025-04-18",
      block: "morning",
      dayItems: [
        { title: "Lunch at Zé da Mouraria", description: "No-frills tasca beloved by locals for bacalhau", time_block: "afternoon" },
        { title: "Fado show in Alfama", description: "Traditional Portuguese music in an intimate venue", time_block: "evening" },
      ],
      replacingItem: { title: "Pergamon Museum Visit", description: "Explore the monumental Pergamon Altar and Ishtar Gate on Berlin's Museum Island" },
      travelCompany: "solo",
      travelerTypes: ["History", "Cultural"],
      budgetTier: "mid-range",
      travelerCount: 1,
      childrenAges: null,
    },
    criteria: [
      "The suggested activity is physically located in Lisbon (not Berlin or any other city)",
      "The title does not reference the Pergamon Museum, Berlin, or any Berlin-specific landmark",
      "The description references Lisbon-specific places, landmarks, or neighbourhoods",
    ],
  },
  {
    label: "Add: filling a slot in Barcelona with wrong-city context",
    request: {
      mode: "add",
      destination: "Barcelona",
      dayNumber: 1,
      date: "2025-07-10",
      block: "afternoon",
      dayItems: [
        { title: "Big Ben & Houses of Parliament", description: "Iconic London landmark on the Thames", time_block: "morning" },
        { title: "London Eye ride", description: "Panoramic views of London from the Ferris wheel", time_block: "morning" },
        { title: "Tapas at Bar Mut", description: "Upscale tapas in Diagonal neighbourhood", time_block: "evening" },
      ],
      travelCompany: "friends",
      travelerTypes: ["Food-led", "Adventure"],
      budgetTier: "mid-range",
      travelerCount: 4,
      childrenAges: null,
    },
    criteria: [
      "The suggested activity is physically located in Barcelona (not London or any other city)",
      "The title does not reference Big Ben, London Eye, London, or any London-specific landmark",
      "The suggestion fits a food-led or adventurous group of friends in Barcelona",
    ],
  },
  {
    label: "Swap: replacing a Tokyo activity in a Rome itinerary",
    request: {
      mode: "swap",
      destination: "Rome",
      dayNumber: 4,
      date: "2025-09-20",
      block: "afternoon",
      dayItems: [
        { title: "Colosseum guided tour", description: "Skip-the-line tour of the ancient amphitheatre", time_block: "morning" },
        { title: "Dinner in Trastevere", description: "Trattoria hopping in Rome's most charming neighbourhood", time_block: "evening" },
      ],
      replacingItem: { title: "Tsukiji Outer Market tour", description: "Fresh sushi and street food in Tokyo's famous fish market district" },
      travelCompany: "family",
      travelerTypes: ["Food-led", "Cultural"],
      budgetTier: "mid-range",
      travelerCount: 4,
      childrenAges: ["5–8", "9–12"],
    },
    criteria: [
      "The suggested activity is physically located in Rome (not Tokyo or any other city)",
      "The title does not reference Tsukiji, Tokyo, or any Japan-specific landmark",
      "The suggestion is suitable for a family with children aged 5–12",
      "The description references Rome-specific places or Italian food/culture",
    ],
  },
  {
    label: "Add: empty morning in Prague — no trap context",
    request: {
      mode: "add",
      destination: "Prague",
      dayNumber: 2,
      date: "2025-05-15",
      block: "morning",
      dayItems: [
        { title: "Lunch at Lokál", description: "Classic Czech pub food and tank beer", time_block: "afternoon" },
        { title: "Jazz at Reduta Club", description: "Oldest jazz club in Prague, intimate setting", time_block: "evening" },
      ],
      travelCompany: "partner",
      travelerTypes: ["Cultural", "Food-led"],
      budgetTier: "budget",
      travelerCount: 2,
      childrenAges: null,
    },
    criteria: [
      "The suggested activity is physically located in Prague",
      "The suggestion fits a cultural couple on a budget",
      "The suggestion is appropriate for a morning time slot",
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ApiResponse = {
  item: { id: string; title: string; description: string; type: string; time_block: string };
  rationale: string;
  conflict: string | null;
};

async function callEditApi(request: EditRequest): Promise<ApiResponse> {
  const res = await fetch(`${BASE_URL}/api/itinerary/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!res.ok) throw new Error(`API returned ${res.status}: ${await res.text()}`);
  return res.json() as Promise<ApiResponse>;
}

type ScoreResult = {
  score: number;
  passed: boolean;
  criteriaScores: { criterion: string; met: boolean; comment: string }[];
  summary: string;
};

async function scoreSuggestion(
  testCase: TestCase,
  response: ApiResponse
): Promise<ScoreResult> {
  const criteriaList = testCase.criteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  const result = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are evaluating whether an AI travel planner respected a location constraint.

## Context
The user is planning a trip to **${testCase.request.destination}**.
Mode: ${testCase.request.mode}
${testCase.request.replacingItem ? `Replacing: "${testCase.request.replacingItem.title}" — ${testCase.request.replacingItem.description}` : "Filling an empty slot."}

## AI suggestion returned
Title: ${response.item.title}
Description: ${response.item.description}
Type: ${response.item.type}
Rationale: ${response.rationale}
${response.conflict ? `Conflict note: ${response.conflict}` : ""}

## Evaluation criteria
${criteriaList}

Evaluate each criterion strictly. A suggestion that names a landmark or venue in the wrong city MUST fail the location criterion, even if the description is otherwise good.

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

  const raw = result.content.find((b) => b.type === "text")?.text ?? "";

  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as ScoreResult;
    parsed.passed = parsed.score >= 7;
    return parsed;
  } catch {
    throw new Error(`Failed to parse scorer response:\n${raw}`);
  }
}

function printResult(testCase: TestCase, response: ApiResponse, result: ScoreResult) {
  const badge = result.passed ? "\u2705 PASS" : "\u274c FAIL";
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${badge}  ${testCase.label}  (score: ${result.score}/10)`);
  console.log(`${"─".repeat(60)}`);

  console.log(`\n  Destination: ${testCase.request.destination}`);
  console.log(`  Suggestion:  ${response.item.title}`);
  console.log(`  Description: ${response.item.description}`);
  console.log(`  Rationale:   ${response.rationale}`);
  if (response.conflict) console.log(`  Conflict:    ${response.conflict}`);

  console.log("\n  Criteria:");
  for (const c of result.criteriaScores) {
    const mark = c.met ? "  \u2713" : "  \u2717";
    console.log(`  ${mark} ${c.criterion}`);
    console.log(`        ${c.comment}`);
  }

  console.log(`\n  Summary: ${result.summary}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\u2550".repeat(60));
  console.log("  Itinerary Edit — Location Constraint Eval");
  console.log(`  Targeting: ${BASE_URL}`);
  console.log("\u2550".repeat(60));

  const results: { label: string; passed: boolean; score: number }[] = [];

  for (const testCase of TEST_CASES) {
    process.stdout.write(`\nRunning: ${testCase.label}\u2026 `);

    try {
      const response = await callEditApi(testCase.request);
      process.stdout.write("scoring\u2026 ");
      const result = await scoreSuggestion(testCase, response);
      process.stdout.write("done.\n");

      printResult(testCase, response, result);
      results.push({ label: testCase.label, passed: result.passed, score: result.score });
    } catch (err) {
      process.stdout.write("error.\n");
      console.error(`  \u26a0 ${testCase.label}: ${err instanceof Error ? err.message : err}`);
      results.push({ label: testCase.label, passed: false, score: 0 });
    }
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const passRate = Math.round((passed / results.length) * 100);
  const avgScore = (results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  RESULTS  ${passed}/${results.length} passed  (${passRate}% pass rate)  avg score: ${avgScore}/10`);
  console.log("═".repeat(60));
  for (const r of results) {
    const badge = r.passed ? "\u2705" : "\u274c";
    console.log(`  ${badge} ${r.label.padEnd(55)} ${r.score}/10`);
  }
  console.log();

  process.exit(passed === results.length ? 0 : 1);
}

main();
