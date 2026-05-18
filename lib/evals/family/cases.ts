/**
 * PHI-118 — Family composition eval cases.
 *
 * 7 scenarios + 20 assertions against `buildCompositionSegment` (offline,
 * no API). Extracted verbatim from `scripts/eval-family-prompts.ts`.
 */

export type Assertion = {
  label: string;
  test: (output: string) => boolean;
};

export type Scenario = {
  name: string;
  travelerCount: number;
  childrenAges: string[];
  destination?: string;
  assertions: Assertion[];
};

export const SCENARIOS: Scenario[] = [
  {
    name: "1. Solo adult, no children",
    travelerCount: 1,
    childrenAges: [],
    assertions: [
      { label: "Contains 'Party size: 1 person'", test: (o) => o.includes("1 person") },
      { label: "No child constraints", test: (o) => !o.includes("child") },
    ],
  },
  {
    name: "2. Family with one Under 2 child",
    travelerCount: 3,
    childrenAges: ["Under 2"],
    assertions: [
      { label: "Contains 'pram' or 'nap'", test: (o) => /pram|nap/i.test(o) },
      { label: "Must NOT contain 'kayak'", test: (o) => !o.toLowerCase().includes("kayak") },
      { label: "Must NOT contain 'adrenaline'", test: (o) => !o.toLowerCase().includes("adrenaline") },
      { label: "Mentions loud/crowded avoidance", test: (o) => /loud|crowded/i.test(o) },
    ],
  },
  {
    name: "3. Family with one 9–12 child only",
    travelerCount: 3,
    childrenAges: ["9–12"],
    assertions: [
      { label: "Contains 'near-adult stamina'", test: (o) => o.includes("near-adult stamina") },
      { label: "Does NOT contain 'pram'", test: (o) => !o.toLowerCase().includes("pram") },
      { label: "Does NOT contain 'nap'", test: (o) => !o.toLowerCase().includes("nap") },
      { label: "Lighter constraints than scenario 2 (fewer requirement words)", test: (o) => o.length < 200 },
    ],
  },
  {
    name: "4. Mixed family: Under 2 + 9–12",
    travelerCount: 4,
    childrenAges: ["Under 2", "9–12"],
    assertions: [
      { label: "Contains Under 2 constraints (pram/nap)", test: (o) => /pram|nap/i.test(o) },
      { label: "Contains 9–12 constraints (near-adult stamina)", test: (o) => o.includes("near-adult stamina") },
      { label: "Mentions both age groups", test: (o) => o.includes("Under 2") && o.includes("9–12") },
    ],
  },
  {
    name: "5. Family with 2–4, beach destination",
    travelerCount: 4,
    childrenAges: ["2–4"],
    destination: "Bali",
    assertions: [
      { label: "Contains '45-minute' constraint", test: (o) => o.includes("45-minute") },
      { label: "Contains 'outdoor space'", test: (o) => o.toLowerCase().includes("outdoor space") },
    ],
  },
  {
    name: "6. Family with 5–8, city destination",
    travelerCount: 3,
    childrenAges: ["5–8"],
    destination: "London",
    assertions: [
      { label: "Contains '90-minute' constraint", test: (o) => o.includes("90-minute") },
      { label: "Contains 'interactive'", test: (o) => o.toLowerCase().includes("interactive") },
    ],
  },
  {
    name: "7. Family with Under 2, adventure destination",
    travelerCount: 3,
    childrenAges: ["Under 2"],
    destination: "Queenstown",
    assertions: [
      { label: "Contains pram/nap constraints (redirects away from adventure)", test: (o) => /pram|nap/i.test(o) },
      { label: "Contains loud/crowded avoidance", test: (o) => /loud|crowded/i.test(o) },
      {
        label: "Constraint language is strong enough to redirect (uses 'required' or 'avoid')",
        test: (o) => /required|avoid/i.test(o),
      },
    ],
  },
];
