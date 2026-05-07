/**
 * PHI-58 — Detection cases for `isFreeFormTripDescription`.
 *
 * Synchronous, no API calls. Verifies the homepage routing rule: city
 * names fall through to the structured wizard, free-form trip descriptions
 * route to the parser. Run as part of pre-flight before deploying changes
 * to the homepage submit handler.
 *
 * Run: npm run eval:free-form-detect
 */

import { isFreeFormTripDescription } from "../lib/free-form-detect";

type Case = { input: string; expected: boolean; note: string };

const CASES: Case[] = [
  // Single / multi-word destinations — must NOT trigger parser routing.
  { input: "Lisbon", expected: false, note: "single-word city" },
  { input: "Tokyo", expected: false, note: "single-word city" },
  { input: "Marrakech", expected: false, note: "single-word city" },
  { input: "Buenos Aires", expected: false, note: "two-word city" },
  { input: "New York", expected: false, note: "two-word city" },
  { input: "Cape Town", expected: false, note: "two-word city" },
  { input: "New York City", expected: false, note: "three-word city" },
  { input: "San Francisco, CA", expected: false, note: "city + region, one comma" },
  { input: "Lisbon, Portugal", expected: false, note: "city + country, one comma" },

  // Free-form trip descriptions — must trigger parser routing.
  {
    input: "Harry Potter inspired family trip throughout the UK, starting in London",
    expected: true,
    note: "the original PHI-58 example — anchor + commas + word count all hit",
  },
  {
    input: "Harry Potter inspired family trip throughout the UK",
    expected: true,
    note: "anchor 'inspired' + 'family trip', no comma",
  },
  {
    input: "Two weeks Italy honeymoon, anniversary, no hiking",
    expected: true,
    note: "2+ commas",
  },
  {
    input: "Family trip with our kids to Spain",
    expected: true,
    note: "anchor 'family trip' + 'with our'",
  },
  {
    input: "Ten days in Japan with my partner",
    expected: true,
    note: "anchor 'with my'",
  },
  {
    input: "In the footsteps of Hemingway",
    expected: true,
    note: "anchor 'in the footsteps'",
  },
  {
    input: "We want a relaxed beach week",
    expected: true,
    note: "anchor 'we want'",
  },
  { input: "4 nights solo in Lisbon", expected: true, note: "5 words, food-led" },
  { input: "Romantic getaway to Paris", expected: true, note: "exactly 4 words" },

  // Edge: 3-word non-city phrasing that's still a destination shorthand —
  // 3 words doesn't trip the floor, no anchor, no commas → false.
  { input: "south of france", expected: false, note: "3-word region shorthand" },
];

let pass = 0;
let fail = 0;

console.log("═══════════════════════════════════════════════════════════════");
console.log("  PHI-58 — Free-form detection cases");
console.log("═══════════════════════════════════════════════════════════════\n");

for (const c of CASES) {
  const got = isFreeFormTripDescription(c.input);
  const ok = got === c.expected;
  if (ok) pass++;
  else fail++;
  const icon = ok ? "✓ PASS" : "✗ FAIL";
  console.log(`${icon}  ${JSON.stringify(c.input)}`);
  console.log(`        expected ${c.expected} · got ${got} · ${c.note}`);
}

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(`  ${pass} passed, ${fail} failed out of ${pass + fail}`);
console.log("═══════════════════════════════════════════════════════════════");

if (fail > 0) process.exit(1);
