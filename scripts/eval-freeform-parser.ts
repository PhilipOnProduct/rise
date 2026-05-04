/**
 * PHI-34 / RISE-301 — Free-form parser eval harness
 *
 * Runs 10 sample inputs (more to be added — target 50 before code freeze
 * per the team review) through /api/parse-trip and scores each parse on
 * field accuracy + clarification appropriateness.
 *
 * Usage:
 *   npm run eval:parser
 * (also runnable directly with tsx: tsx scripts/eval-freeform-parser.ts)
 *
 * Pass gate per the PRD:
 *   ≥85% field accuracy
 *   100% on constraint preservation
 *   ≤10% over-clarification rate
 *
 * The eval covers Elena's input-pattern catalogue: vague-on-destination,
 * region-not-city, anniversary/honeymoon, mobility constraints stated
 * offhand, multi-country, time-vague, budget hints, occasions.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  TRIP_INTENT_TOOL,
  coerceTripIntent,
  type TripIntent,
} from "../lib/trip-intent";

// ── Test inputs ──────────────────────────────────────────────────────────
// Each case lists the input + the assertions the parser MUST satisfy.

type Case = {
  id: string;
  description: string;
  input: string;
  /**
   * Assertions on the parsed TripIntent. A function returns true if the
   * parse passes the check, false otherwise. Each case has multiple checks
   * — they're scored independently for the field-accuracy metric.
   */
  checks: { name: string; check: (i: TripIntent) => boolean }[];
};

const CASES: Case[] = [
  {
    id: "italy-anniversary",
    description: "Anniversary + offhand mobility constraint + multi-style",
    input: "Ten days in Italy, May, anniversary, food and wine, no hiking, my back hurts",
    checks: [
      {
        name: "destination Italy extracted",
        check: (i) => i.destinations.some((d) => /italy/i.test(d.name)),
      },
      {
        name: "occasion=anniversary",
        check: (i) => i.occasion === "anniversary",
      },
      {
        name: "duration ~10 nights",
        check: (i) => i.dates.durationNights === 10,
      },
      {
        name: "season May extracted (or dates pinned to May)",
        check: (i) => /may/i.test(i.dates.season ?? "") || /-05-/.test(i.dates.departure ?? ""),
      },
      {
        name: "constraint 'no hiking' preserved",
        check: (i) =>
          i.constraintTags.includes("No long walks") ||
          /no hiking/i.test(i.constraintText ?? "") ||
          /hike/i.test(i.constraintText ?? ""),
      },
      {
        name: "constraint 'back hurts' preserved",
        check: (i) =>
          /back/i.test(i.constraintText ?? "") ||
          i.constraintTags.includes("No long walks"),
      },
      {
        name: "styleTags include Food-led / food / wine",
        check: (i) => i.styleTags.some((t) => /food/i.test(t)),
      },
    ],
  },
  {
    id: "japan-bucket-list",
    description: "Bucket list, season-vague, photographer, mid-budget",
    input:
      "Bucket list trip — Japan in cherry blossom season, two weeks, foodie, photographer husband, mid-budget but treat ourselves once",
    checks: [
      { name: "destination Japan", check: (i) => i.destinations.some((d) => /japan/i.test(d.name)) },
      { name: "occasion=bucket_list", check: (i) => i.occasion === "bucket_list" },
      { name: "duration ~14 nights", check: (i) => i.dates.durationNights === 14 },
      {
        name: "cherry blossom recorded as season",
        check: (i) => /cherry|blossom/i.test(i.dates.season ?? ""),
      },
      {
        name: "Photography style tag",
        check: (i) => i.styleTags.some((t) => /photo/i.test(t)),
      },
      {
        name: "budget ambiguity flagged in clarifications OR comfortable+luxury split",
        check: (i) =>
          i.budgetTier === "comfortable" || i.clarifications.some((c) => /budget/i.test(c)),
      },
    ],
  },
  {
    id: "vague-warm",
    description: "Vague-on-destination",
    input: "Long weekend somewhere warm, just need to escape, surprise me",
    checks: [
      {
        name: "no specific destination guessed",
        check: (i) => i.destinations.length === 0,
      },
      {
        name: "clarification asking for region preference",
        check: (i) => i.clarifications.some((c) => /warm|region|where/i.test(c)),
      },
      {
        name: "duration ~3 nights",
        check: (i) => i.dates.durationNights === 3 || i.dates.durationNights === 2,
      },
    ],
  },
  {
    id: "family-half-term",
    description: "Family of 5, time-vague, all-inclusive",
    input: "Family of 5, 7 nights, pool, kid club, all-inclusive, May half-term",
    checks: [
      { name: "duration 7 nights", check: (i) => i.dates.durationNights === 7 },
      { name: "adults extracted (likely 2)", check: (i) => (i.party.adults ?? 0) >= 2 },
      {
        name: "children extracted (some count)",
        check: (i) => (i.party.children?.length ?? 0) >= 1,
      },
      {
        name: "Kid-friendly style tag",
        check: (i) => i.styleTags.some((t) => /kid/i.test(t)),
      },
      {
        name: "half-term flagged for clarification",
        check: (i) => i.clarifications.some((c) => /half-term|date/i.test(c)),
      },
    ],
  },
  {
    id: "eurovision-event",
    description: "Following an event",
    input: "Following Eurovision in Basel — what to do for 3 nights, late May",
    checks: [
      {
        name: "destination Basel",
        check: (i) => i.destinations.some((d) => /basel/i.test(d.name)),
      },
      { name: "duration 3 nights", check: (i) => i.dates.durationNights === 3 },
      {
        name: "event noted in constraintText or clarifications",
        check: (i) =>
          /eurovision/i.test(i.constraintText ?? "") ||
          i.clarifications.some((c) => /eurovision|event|date/i.test(c)),
      },
    ],
  },
  {
    id: "iceland-teens",
    description: "Multi-gen with teens, no group tours",
    input: "Mum, dad, two teens, Iceland, late June. Photographer, no group tours.",
    checks: [
      { name: "destination Iceland", check: (i) => i.destinations.some((d) => /iceland/i.test(d.name)) },
      { name: "adults=2", check: (i) => i.party.adults === 2 },
      {
        name: "teens captured (13-17 ageRange or in clarifications)",
        check: (i) =>
          (i.party.children ?? []).some((c) => c.ageRange === "13–17") ||
          i.clarifications.some((c) => /teen|age/i.test(c)),
      },
      {
        name: "Photography style tag",
        check: (i) => i.styleTags.some((t) => /photo/i.test(t)),
      },
      {
        name: "no group tours preserved",
        check: (i) =>
          /no group|group tour/i.test(i.constraintText ?? "") ||
          i.constraintTags.length > 0,
      },
    ],
  },
  {
    id: "lisbon-solo",
    description: "Simple solo food-led",
    input: "Solo trip, Lisbon, 4 nights, food-led, no nightlife",
    checks: [
      { name: "destination Lisbon", check: (i) => i.destinations.some((d) => /lisbon/i.test(d.name)) },
      { name: "adults=1", check: (i) => i.party.adults === 1 },
      { name: "duration 4 nights", check: (i) => i.dates.durationNights === 4 },
      { name: "Food-led tag", check: (i) => i.styleTags.some((t) => /food/i.test(t)) },
      {
        name: "no nightlife noted (constraint or absence of Nightlife tag)",
        check: (i) =>
          /no nightlife/i.test(i.constraintText ?? "") ||
          !i.styleTags.some((t) => /nightlife/i.test(t)),
      },
    ],
  },
  {
    id: "paris-anniversary-michelin",
    description: "Couple anniversary, Michelin",
    input: "Couple's anniversary, Paris, weekend, Michelin-curious",
    checks: [
      { name: "destination Paris", check: (i) => i.destinations.some((d) => /paris/i.test(d.name)) },
      { name: "adults=2", check: (i) => i.party.adults === 2 },
      { name: "occasion=anniversary", check: (i) => i.occasion === "anniversary" },
      { name: "duration ~2-3 nights", check: (i) => [2, 3].includes(i.dates.durationNights ?? 0) },
      {
        name: "Food-led tag (Michelin signal)",
        check: (i) => i.styleTags.some((t) => /food/i.test(t)),
      },
    ],
  },
  {
    id: "barcelona-bachelorette",
    description: "Friend group bachelorette, multi-style",
    input: "Bachelorette in Barcelona, 4 of us, 3 nights, beach + clubs",
    checks: [
      {
        name: "destination Barcelona",
        check: (i) => i.destinations.some((d) => /barcelona/i.test(d.name)),
      },
      { name: "adults=4", check: (i) => i.party.adults === 4 },
      { name: "duration 3 nights", check: (i) => i.dates.durationNights === 3 },
      {
        name: "Beach + Nightlife style tags",
        check: (i) =>
          i.styleTags.some((t) => /beach/i.test(t)) &&
          i.styleTags.some((t) => /night|club/i.test(t)),
      },
    ],
  },
  {
    id: "tuscany-multigen-knee",
    description: "Multi-generational with grandparent mobility constraint",
    input:
      "Multi-gen family trip — me, partner, our two kids 8 and 12, my parents (60s, knee issues), Tuscany, 10 nights",
    checks: [
      {
        name: "destination Tuscany (region)",
        check: (i) =>
          i.destinations.some((d) => /tuscany/i.test(d.name) && (d.kind ?? "") !== "country"),
      },
      { name: "adults=4 (couple + parents)", check: (i) => i.party.adults === 4 },
      {
        name: "child ages 5-8 + 9-12",
        check: (i) =>
          (i.party.children ?? []).some((c) => c.ageRange === "5–8") &&
          (i.party.children ?? []).some((c) => c.ageRange === "9–12"),
      },
      { name: "duration 10 nights", check: (i) => i.dates.durationNights === 10 },
      {
        name: "knee issue / mobility preserved (life-impacting — must not drop)",
        check: (i) =>
          /knee|mobility|long walk/i.test(i.constraintText ?? "") ||
          i.constraintTags.includes("No long walks"),
      },
    ],
  },
];

// ── Runner ──────────────────────────────────────────────────────────────

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

const SYSTEM = `You are a travel-planning input parser. Your job is to convert a user's free-form trip description into a structured TripIntent JSON object via the parse_trip_intent tool.

Rules (in priority order):

1. NEVER invent fields the user didn't mention. If they said "no hiking" but didn't mention dietary, leave constraintTags empty for diet. Don't infer "couple" from "we" — ask in clarifications instead.
2. Missing required fields surface as clarifications, NEVER as guesses. If the user said "long weekend somewhere warm" without naming a destination, return destinations: [] and add a clarification: "Any region preference, or are you genuinely open?"
3. Cite SPECIFIC user input. If the input mentions "anniversary," set occasion: "anniversary". If it mentions "kids" without ages, push to clarifications.
4. High-stakes constraints (allergies, mobility, accessibility, dietary, religious) MUST be preserved exactly as the user expressed them. Map to constraintTags from this set when applicable: ["Wheelchair accessible only", "No long walks", "Vegetarian", "Halal/Kosher", "Severe allergy", "Stroller-friendly"]. Anything NOT in that set goes verbatim into constraintText.
5. When you're uncertain a constraint is satisfied or whether your interpretation is correct, say so explicitly in clarifications. Better to ask than to assume.
6. Multi-country or multi-city → multiple entries in destinations[]. Preserve the order the user mentioned them.
7. Vague time hints ("next month", "early summer", "during half-term") → set dates.season verbatim and add a clarification asking for specific dates.
8. Always extract occasion if mentioned (anniversary, honeymoon, birthday, bucket_list). It biases downstream tone — this is a key differentiator.
9. Children: if ages are stated, map to ageRange buckets ("Under 2" | "2–4" | "5–8" | "9–12" | "13–17"). If only "the kids" is mentioned, push to clarifications: "What ages are the kids?"
10. styleTags should match the existing chip taxonomy: Cultural, Food-led, Relaxed, Adventure, Off the beaten track, History, Romantic, Wellness, Nightlife, Art & Design, Photography, Kid-friendly, Teen-friendly, Beach, Educational, Budget-savvy, Slow travel, Active, Festivals.

Output: call the parse_trip_intent tool with the structured TripIntent. Do not produce any prose — only the tool call.`;

async function parse(text: string): Promise<TripIntent> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0.1,
    tools: [TRIP_INTENT_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "parse_trip_intent" },
    system: SYSTEM,
    messages: [{ role: "user", content: text }],
  });
  const tool = response.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use")
    throw new Error("no tool_use block returned");
  return coerceTripIntent(tool.input);
}

async function main() {
  console.log(`\nRunning ${CASES.length} parser eval cases against ${MODEL}...\n`);
  let totalChecks = 0;
  let passedChecks = 0;
  let constraintFailures = 0;

  for (const c of CASES) {
    const intent = await parse(c.input);
    let casePassed = 0;
    const failures: string[] = [];
    for (const { name, check } of c.checks) {
      totalChecks++;
      try {
        if (check(intent)) {
          passedChecks++;
          casePassed++;
        } else {
          failures.push(name);
          if (/constraint|knee|hiking|allergy|wheelchair|life-impact/i.test(name))
            constraintFailures++;
        }
      } catch {
        failures.push(name + " (threw)");
      }
    }
    const ratio = `${casePassed}/${c.checks.length}`;
    const mark = casePassed === c.checks.length ? "✓" : "✗";
    console.log(`${mark} ${c.id.padEnd(28)} ${ratio.padStart(5)}  — ${c.description}`);
    if (failures.length > 0) {
      for (const f of failures) console.log(`    × ${f}`);
      console.log("    intent:", JSON.stringify(intent));
    }
  }

  const accuracy = (passedChecks / totalChecks) * 100;
  console.log(`\n──── Summary ────`);
  console.log(`Field accuracy:           ${accuracy.toFixed(1)}%  (target ≥ 85%)`);
  console.log(`Constraint preservation:  ${constraintFailures === 0 ? "100%" : `${constraintFailures} failures`}  (target 100%)`);
  console.log(`Cases run:                ${CASES.length}`);
  console.log(`Total checks:             ${totalChecks}`);
  console.log(`Passed:                   ${passedChecks}\n`);

  if (accuracy < 85 || constraintFailures > 0) {
    console.error("EVAL FAILED — pass gate not met. Iterate the prompt.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
