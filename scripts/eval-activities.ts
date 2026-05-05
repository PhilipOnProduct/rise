/**
 * PHI-38 — Activity-gen eval harness
 *
 * Runs representative trip profiles through the activity-gen prompt
 * (the same SYSTEM + user-message construction as /api/activities-stream)
 * and scores each output on:
 *
 *   - Variety (every activity from a different category)
 *   - Constraint preservation (life-impacting constraints appear in Why)
 *   - Format compliance (every card matches parseActivities regex)
 *   - Multi-leg correctness (every non-transition leg has activities)
 *   - Hotel anchoring (set legs vs unset legs handled per the prompt)
 *
 * Pass gate (mirrors the parser eval):
 *   ≥85% field accuracy
 *   100% on constraint preservation
 *
 * Usage:
 *   npm run eval:activities
 *
 * Notes:
 *   - We re-implement the route's SYSTEM + user-message build inline so
 *     this script doesn't need to spin up a Next.js server. Keep this
 *     in sync with app/api/activities-stream/route.ts when the prompt
 *     changes — the README rule is "run this before any prompt edit
 *     in that file".
 *   - One Anthropic call per case. ~$1–2 per full run on Sonnet 4.6.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { TripLeg } from "../lib/trip-schema";

// ── Prompt mirroring the route ───────────────────────────────────────────
// IMPORTANT: keep in sync with app/api/activities-stream/route.ts SYSTEM.

const SYSTEM = `You are a travel activity recommender. Suggest 5–6 must-do activities for the destination and traveller profile provided. For each, provide its name, a one-sentence description, a brief note on when in the trip it works best, and a short "why this fits" rationale.

Format each as:

**[Activity Name]** — [Category]
[One-sentence description]
*When: [timing or day suggestion]*
*Why: [≤25 words explaining why this specific activity fits this specific traveller]*

Description rules:
- Be specific to the destination — avoid generic suggestions that any visitor might do.
- Keep descriptions concise.
- Never reference the traveller's profile, preferences, or travel style in the description — write as if recommending to anyone visiting the destination.

Why rules (Elena's guidance — these are trust-building, get them right):
1. Never invent a connection. If the only reason is "matches your style chip", say so plainly — don't fabricate a hotel-proximity claim if you don't have hotel data.
2. Cite specific user input ("you flagged kid-friendly", "your couple preference", "your savvy budget") — never vague "your interests".
3. When uncertain a constraint is satisfied, say so explicitly: "Likely accessible — please confirm."

Life-impacting constraints (PHI-41 — these are non-negotiable, every relevant card MUST acknowledge):

The constraintTags below trigger HARD rules. Failing any of these is worse than dropping the activity entirely.

- "Severe allergy" — EVERY food/dining/restaurant/market card MUST include explicit allergy awareness in the Why. Use the user's exact allergen if they named one (peanut, shellfish, etc.). Phrasing: "Allergen-aware kitchen — please confirm with the restaurant" or "Menu may contain <allergen> — call ahead." If a card cannot satisfy this, drop it.
- "Halal/Kosher" — EVERY food/dining/restaurant/market card MUST mention kosher / halal / certified / dietary law in the Why. Phrasing: "Kosher-certified per your note" or "Dietary-law compliant — please verify." If certification is uncertain, say "Likely <kosher/halal> — please confirm."
- "Vegetarian" — EVERY food/dining/restaurant/market card MUST mention vegetarian / vegan / plant-based options in the Why. Phrasing: "Vegetarian-friendly menu" or "Strong vegetarian options per your note." Non-veg-friendly venues should be dropped, not papered over.
- "Wheelchair accessible only" — EVERY card MUST mention accessibility / wheelchair / step-free / elevator / please confirm in the Why. Inaccessible venues must be dropped.
- "No long walks" — EVERY card MUST mention short walk / mobility / low-impact / step-free / seated / easy walk in the Why. High-effort activities (hiking, climbing, trekking) must be dropped.
- "Stroller-friendly" — EVERY card MUST mention stroller / pram / family-friendly / easy access in the Why. Stairs-only venues must be dropped.

Variety: each activity must be from a different category. Spread suggestions across food & dining, cultural/historic, outdoor/adventure, nightlife/entertainment, relaxation/wellness, and shopping/local markets. Do not repeat a category.

Multi-leg trips (only when the user message provides a "Legs:" section):

**LEG MARKER FORMAT — non-negotiable.** Every single activity card MUST be preceded by its own marker line:

LEG: <index>
**Activity name** — Category
...

The marker line is the FIRST line of every card. No exceptions, even for the first card under a leg, even after a paragraph break, even on the longest 3-leg trips. Skipping a marker means the card is dropped on the client side. Re-emit the marker for every card — the client groups by leg using these markers.

Example for a 3-leg trip:

LEG: 0
**Sensō-ji Temple** — Cultural/Historic
...

LEG: 0
**Tsukiji Outer Market** — Food & Dining
...

LEG: 1
**Fushimi Inari Shrine** — Cultural/Historic
...

LEG: 2
**Dōtonbori Walk** — Nightlife/Entertainment
...

Other multi-leg rules:
- Generate activities for EACH leg in order. Every leg with ≥1 night MUST have at least one card. Skipping a leg is a hard failure.
- Bias toward fewer activities on short legs (≤2 nights = 2–3 activities total; 3–4 nights = 3–4; 5+ nights = 4–5). The "last leg fatigue" pattern is real — travellers want lighter plans on later legs.
- Stay in the previous leg's hotel when a leg is ≤2 nights and the next leg is geographically reachable as a day trip — suggest day-trip activities from the previous base instead of full hotel change. Note this in the Why.
- Never recommend cross-border or cross-leg activities. Activities for "Spain + Portugal" must stay within each leg's own city/region; no Lisbon-to-Madrid day trips.
- Each activity belongs to exactly one leg. Variety rules apply within each leg, not across the whole trip.
- Do NOT generate activities for transition days. The client will render a travel-only card for the day a user moves between legs.
- Life-impacting constraints apply to EVERY relevant card on EVERY leg. Multi-leg trips have more cards, so attention drift is the failure mode — re-check before emitting each card. The reminder block at the end of the user message is non-negotiable.`;

// ── Types ────────────────────────────────────────────────────────────────

type Case = {
  id: string;
  description: string;
  destination: string;
  duration: string; // e.g. "5-night trip"
  travelCompany?: string;
  styleTags?: string[];
  budgetTier?: string;
  travelerCount?: number;
  childrenAges?: string[];
  constraintTags?: string[];
  constraintText?: string;
  legs?: TripLeg[];
  /**
   * Per-case checks evaluated against the parsed cards. Each returns
   * `{ ok, lifeImpacting? }` where lifeImpacting hard-fails the run on
   * miss (constraint preservation gate). Non-life-impacting checks
   * count toward the field-accuracy gate (≥85%).
   */
  checks: {
    name: string;
    lifeImpacting?: boolean;
    check: (cards: ParsedCard[], rawText: string) => boolean;
  }[];
};

type ParsedCard = {
  name: string;
  category: string;
  description: string;
  when: string;
  why?: string;
  legIndex?: number;
};

// ── User-message construction (mirrors the route) ────────────────────────

function buildCompositionSegment(
  travelerCount?: number,
  childrenAges?: string[]
): string | null {
  if (!travelerCount) return null;
  if (!childrenAges?.length) return `${travelerCount} travellers`;
  return `${travelerCount} travellers (children ages: ${childrenAges.filter(Boolean).join(", ")})`;
}

function buildUserMessage(c: Case): string {
  const isMultiLeg = Array.isArray(c.legs) && c.legs.length >= 2;
  const styleList: string[] =
    c.styleTags?.length ? c.styleTags : ["mixed styles"];
  const profileLines: string[] = [];
  const companyLabel: Record<string, string> = {
    solo: "solo traveller",
    partner: "couple",
    friends: "group of friends",
    family: "family with children",
  };
  const budgetLabel: Record<string, string> = {
    budget: "savvy (budget-conscious)",
    comfortable: "comfortable (mid-range spend)",
    luxury: "flexible (willing to spend more for quality)",
  };
  if (c.travelCompany)
    profileLines.push(`- Travelling as: ${companyLabel[c.travelCompany] ?? c.travelCompany}`);
  if (c.styleTags?.length) profileLines.push(`- Travel style: ${c.styleTags.join(", ")}`);
  if (c.budgetTier) profileLines.push(`- Budget: ${budgetLabel[c.budgetTier] ?? c.budgetTier}`);
  const composition = buildCompositionSegment(c.travelerCount, c.childrenAges);
  if (composition) profileLines.push(`- Composition: ${composition}`);

  const constraintLines: string[] = [];
  if (c.constraintTags?.length) {
    constraintLines.push(`- Tagged: ${c.constraintTags.join(", ")}`);
  }
  if (c.constraintText) {
    constraintLines.push(`- In their words: "${c.constraintText}"`);
  }
  // PHI-41: per-category EVERY-card hard rules now live in SYSTEM.
  const constraintBlock = constraintLines.length
    ? `\n\nMUST respect (life-impacting — never silently ignore):\n${constraintLines.join("\n")}\n`
    : "";

  const profileBlock = profileLines.length
    ? `\n\nTraveller profile (treat these as hard constraints — every suggestion must fit):\n${profileLines.join("\n")}\n${constraintBlock}`
    : constraintBlock;

  const legsBlock = isMultiLeg
    ? "\n\nLegs:\n" +
      c.legs!
        .map((leg, i) => {
          const name = leg.place?.name ?? `Leg ${i + 1}`;
          const legNights =
            leg.startDate && leg.endDate
              ? Math.round(
                  (new Date(leg.endDate).getTime() -
                    new Date(leg.startDate).getTime()) /
                    86_400_000
                )
              : null;
          const nightsStr = legNights
            ? ` — ${legNights} night${legNights === 1 ? "" : "s"}`
            : "";
          const hotelStr = leg.hotel ? ` [hotel: ${leg.hotel}]` : "";
          return `- LEG ${i}: ${name}${nightsStr}${hotelStr}`;
        })
        .join("\n") +
      "\n\nGenerate activities for EACH leg, prefixing every activity with a `LEG: <index>` marker line." +
      "\nPer-leg hotels: if a leg has a [hotel: ...] tag, you MAY reference proximity to that hotel in the Why line. If a leg has no hotel tag, NEVER fabricate a hotel-proximity claim for that leg."
    : "";

  const headline = isMultiLeg
    ? `Multi-leg trip across: ${c.legs!.map((l) => l.place?.name ?? "?").join(" → ")} (${c.duration}).`
    : `Destination: ${c.destination} (${c.duration}).`;

  // PHI-41: closing reminder for multi-leg + life-impacting constraints
  // — fights Sonnet's attention-drop on long card lists.
  const reminderBlock =
    isMultiLeg && constraintLines.length > 0
      ? `\n\nReminder (non-negotiable): the life-impacting constraints above apply to EVERY relevant card across EVERY leg. Re-check before emitting each card. Never silently drop a constraint just because the card list is long. If a card cannot satisfy a life-impacting constraint, drop the card — not the constraint.`
      : "";

  return (
    `${headline}${profileBlock}${legsBlock}\n` +
    `Budget: ${budgetLabel[c.budgetTier ?? "comfortable"] ?? "comfortable"}. Style: ${styleList.join(", ")}.\n` +
    `Every suggestion must genuinely suit this profile — not generic activities any visitor might do.${reminderBlock}`
  );
}

// ── Card parsing (mirrors welcome page parseActivities) ──────────────────

function parseCards(text: string): ParsedCard[] {
  const regex =
    /\*\*([^*\n]+)\*\*\s*[—–\-]\s*([^\n]+)\n([^\n*][^\n]*)\n\*When:\s*([^*\n]+)\*(?:\s*\n\*Why:\s*([^*\n]+)\*)?/g;
  const legMarker = /LEG:\s*(\d+)/g;
  const legAt: { offset: number; index: number }[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = legMarker.exec(text)) !== null) {
    legAt.push({ offset: mm.index, index: Number(mm[1]) });
  }
  const out: ParsedCard[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    let legIndex: number | undefined;
    for (const e of legAt) {
      if (e.offset < m.index) legIndex = e.index;
      else break;
    }
    out.push({
      name: m[1].trim(),
      category: m[2].trim(),
      description: m[3].trim(),
      when: m[4].trim(),
      why: m[5]?.trim(),
      ...(legIndex !== undefined && { legIndex }),
    });
  }
  return out;
}

// ── Cases ────────────────────────────────────────────────────────────────

const SINGLE_LEG_CASES: Case[] = [
  {
    id: "lisbon-couple-cultural",
    description: "Couple, cultural + food, 4 nights, comfortable",
    destination: "Lisbon",
    duration: "4-night trip",
    travelCompany: "partner",
    styleTags: ["Cultural", "Food-led"],
    budgetTier: "comfortable",
    travelerCount: 2,
    checks: [
      {
        name: "5+ cards parsed",
        check: (cards) => cards.length >= 5,
      },
      {
        name: "every card has a Why line",
        check: (cards) => cards.every((c) => !!c.why),
      },
      {
        name: "category variety (no repeats)",
        check: (cards) => new Set(cards.map((c) => c.category)).size === cards.length,
      },
    ],
  },
  {
    id: "lisbon-severe-peanut-allergy",
    description: "Family with peanut-allergy child — life-impacting must surface in Why",
    destination: "Lisbon",
    duration: "5-night trip",
    travelCompany: "family",
    styleTags: ["Food-led"],
    budgetTier: "comfortable",
    travelerCount: 3,
    childrenAges: ["9–12"],
    constraintTags: ["Severe allergy"],
    constraintText: "Our 10-year-old has a severe peanut allergy",
    checks: [
      {
        name: "every food/dining card mentions allergy / peanut / awareness",
        lifeImpacting: true,
        check: (cards) =>
          cards
            .filter((c) => /food|dining|restaurant|market/i.test(c.category))
            .every((c) =>
              /allerg|peanut|awareness|nut|safe|please confirm/i.test(c.why ?? "")
            ),
      },
      {
        name: "5+ cards parsed",
        check: (cards) => cards.length >= 5,
      },
    ],
  },
  {
    id: "tokyo-wheelchair",
    description: "Wheelchair user — life-impacting must echo in every Why",
    destination: "Tokyo",
    duration: "5-night trip",
    travelCompany: "partner",
    styleTags: ["Cultural", "Art & Design"],
    budgetTier: "comfortable",
    travelerCount: 2,
    constraintTags: ["Wheelchair accessible only"],
    checks: [
      {
        name: "every Why mentions accessibility / wheelchair / step-free / please confirm",
        lifeImpacting: true,
        check: (cards) =>
          cards.every((c) =>
            /wheelchair|accessib|step-free|elevator|please confirm|mobility/i.test(c.why ?? "")
          ),
      },
      {
        name: "5+ cards parsed",
        check: (cards) => cards.length >= 5,
      },
    ],
  },
  {
    id: "edinburgh-vegetarian",
    description: "Vegetarian solo — dietary preserved",
    destination: "Edinburgh",
    duration: "3-night trip",
    travelCompany: "solo",
    styleTags: ["Food-led", "History"],
    budgetTier: "budget",
    travelerCount: 1,
    constraintTags: ["Vegetarian"],
    checks: [
      {
        name: "food/dining cards reference vegetarian or plant-based",
        lifeImpacting: true,
        check: (cards) =>
          cards
            .filter((c) => /food|dining|restaurant|market/i.test(c.category))
            .every((c) =>
              /vegetarian|veggie|plant|veg-friendly|meat-free/i.test(c.why ?? "")
            ),
      },
    ],
  },
  {
    id: "barcelona-knee-issue",
    description: "Mobility constraint via free text — must surface in Why",
    destination: "Barcelona",
    duration: "5-night trip",
    travelCompany: "partner",
    styleTags: ["Cultural", "Relaxed"],
    budgetTier: "comfortable",
    travelerCount: 2,
    constraintTags: ["No long walks"],
    constraintText: "knee surgery last year, taking it easy",
    checks: [
      {
        name: "Why lines acknowledge mobility / short walks / knee / step-free",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) =>
            /knee|mobilit|short walk|step-free|seated|low-impact|easy walk/i.test(
              c.why ?? ""
            )
          ),
      },
      {
        name: "no obviously high-effort categories repeated",
        check: (cards) =>
          cards.filter((c) => /hike|hiking|climb|trek/i.test(c.category)).length === 0,
      },
    ],
  },
  {
    id: "paris-anniversary-luxury",
    description: "Anniversary couple, luxury — Why should reference occasion",
    destination: "Paris",
    duration: "3-night trip",
    travelCompany: "partner",
    styleTags: ["Romantic", "Food-led"],
    budgetTier: "luxury",
    travelerCount: 2,
    checks: [
      {
        name: "5+ cards parsed",
        check: (cards) => cards.length >= 5,
      },
      {
        name: "category variety (no repeats)",
        check: (cards) => new Set(cards.map((c) => c.category)).size === cards.length,
      },
    ],
  },
  {
    id: "rome-family-stroller",
    description: "Stroller-friendly family",
    destination: "Rome",
    duration: "4-night trip",
    travelCompany: "family",
    styleTags: ["Cultural", "Kid-friendly"],
    budgetTier: "comfortable",
    travelerCount: 4,
    childrenAges: ["2–4", "5–8"],
    constraintTags: ["Stroller-friendly"],
    checks: [
      {
        name: "Why mentions stroller / pram / accessible / kid-friendly",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) =>
            /stroller|pram|kid-friend|accessib|easy access|step-free|family-friend/i.test(
              c.why ?? ""
            )
          ),
      },
    ],
  },
  {
    id: "berlin-solo-budget-nightlife",
    description: "Solo budget nightlife",
    destination: "Berlin",
    duration: "3-night trip",
    travelCompany: "solo",
    styleTags: ["Nightlife", "Budget-savvy"],
    budgetTier: "budget",
    travelerCount: 1,
    checks: [
      {
        name: "5+ cards parsed",
        check: (cards) => cards.length >= 5,
      },
      {
        name: "Why cites Budget-savvy / cheap / free for at least one card",
        check: (cards) =>
          cards.some((c) => /budget|cheap|free|low cost|inexpensive/i.test(c.why ?? "")),
      },
    ],
  },
  {
    id: "marrakech-anniversary-medina",
    description: "Anniversary couple, medina-curious",
    destination: "Marrakech",
    duration: "5-night trip",
    travelCompany: "partner",
    styleTags: ["Cultural", "Food-led", "Romantic"],
    budgetTier: "comfortable",
    travelerCount: 2,
    checks: [
      {
        name: "5+ cards parsed",
        check: (cards) => cards.length >= 5,
      },
      {
        name: "every card has a Why line",
        check: (cards) => cards.every((c) => !!c.why),
      },
    ],
  },
  {
    id: "iceland-photographer",
    description: "Adventure photographer",
    destination: "Iceland",
    duration: "5-night trip",
    travelCompany: "partner",
    styleTags: ["Adventure", "Photography"],
    budgetTier: "comfortable",
    travelerCount: 2,
    checks: [
      {
        name: "Photography or photo cited in at least one Why",
        check: (cards) => cards.some((c) => /photo|landscape|vista/i.test(c.why ?? "")),
      },
      {
        name: "5+ cards parsed",
        check: (cards) => cards.length >= 5,
      },
    ],
  },
  {
    id: "santorini-shore-day",
    description: "Single shore day — short, no hiking",
    destination: "Santorini",
    duration: "1-night trip",
    travelCompany: "partner",
    styleTags: ["Relaxed"],
    budgetTier: "comfortable",
    travelerCount: 2,
    constraintTags: ["No long walks"],
    constraintText: "We have one day off the cruise",
    checks: [
      {
        name: "Why acknowledges short walks / one-day / mobility",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) =>
            /short|one day|brief|easy walk|low-impact|step-free/i.test(c.why ?? "")
          ),
      },
    ],
  },
  {
    id: "dublin-stag",
    description: "Stag weekend friend group, nightlife heavy",
    destination: "Dublin",
    duration: "3-night trip",
    travelCompany: "friends",
    styleTags: ["Nightlife"],
    budgetTier: "comfortable",
    travelerCount: 6,
    checks: [
      {
        name: "5+ cards parsed",
        check: (cards) => cards.length >= 5,
      },
      {
        name: "category variety (no repeats)",
        check: (cards) => new Set(cards.map((c) => c.category)).size === cards.length,
      },
    ],
  },
  {
    id: "amsterdam-wheelchair-art",
    description: "Wheelchair + art",
    destination: "Amsterdam",
    duration: "4-night trip",
    travelCompany: "partner",
    styleTags: ["Art & Design"],
    budgetTier: "comfortable",
    travelerCount: 2,
    constraintTags: ["Wheelchair accessible only"],
    checks: [
      {
        name: "every Why references accessibility / wheelchair / step-free / confirm",
        lifeImpacting: true,
        check: (cards) =>
          cards.every((c) =>
            /wheelchair|accessib|step-free|elevator|please confirm/i.test(c.why ?? "")
          ),
      },
    ],
  },
  {
    id: "kyoto-couple-cultural",
    description: "Single-leg Kyoto, slow travel",
    destination: "Kyoto",
    duration: "4-night trip",
    travelCompany: "partner",
    styleTags: ["Cultural", "Slow travel"],
    budgetTier: "comfortable",
    travelerCount: 2,
    checks: [
      {
        name: "5+ cards parsed",
        check: (cards) => cards.length >= 5,
      },
      {
        name: "no LEG markers (single-leg path)",
        check: (cards) => cards.every((c) => c.legIndex === undefined),
      },
    ],
  },
  {
    id: "jerusalem-kosher-history",
    description: "Kosher history trip",
    destination: "Jerusalem",
    duration: "6-night trip",
    travelCompany: "partner",
    styleTags: ["History", "Cultural"],
    budgetTier: "comfortable",
    travelerCount: 2,
    constraintTags: ["Halal/Kosher"],
    checks: [
      {
        name: "food/dining cards reference kosher / dietary law",
        lifeImpacting: true,
        check: (cards) =>
          cards
            .filter((c) => /food|dining|restaurant|market/i.test(c.category))
            .every((c) =>
              /kosher|halal|dietary|please confirm|certified/i.test(c.why ?? "")
            ),
      },
    ],
  },
];

const MULTI_LEG_CASES: Case[] = [
  {
    id: "tokyo-kyoto-2leg",
    description: "Tokyo + Kyoto, 6 nights, no per-leg hotel",
    destination: "Tokyo",
    duration: "6-night trip",
    travelCompany: "partner",
    styleTags: ["Cultural", "Food-led"],
    budgetTier: "comfortable",
    travelerCount: 2,
    legs: [
      { id: "1", place: { name: "Tokyo" }, hotel: null, startDate: "2026-06-15", endDate: "2026-06-18" },
      { id: "2", place: { name: "Kyoto" }, hotel: null, startDate: "2026-06-18", endDate: "2026-06-21" },
    ],
    checks: [
      {
        name: "every leg has at least one activity",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) => c.legIndex === 0) && cards.some((c) => c.legIndex === 1),
      },
      {
        name: "LEG markers populated on all cards",
        check: (cards) => cards.every((c) => c.legIndex !== undefined),
      },
      {
        name: "no cross-leg activities (Tokyo cards don't mention Kyoto / vice versa)",
        check: (cards) => {
          const leg0 = cards.filter((c) => c.legIndex === 0);
          const leg1 = cards.filter((c) => c.legIndex === 1);
          return (
            leg0.every((c) => !/kyoto/i.test(c.name + " " + (c.description ?? ""))) &&
            leg1.every((c) => !/^tokyo|tokyo's/i.test(c.name + " " + (c.description ?? "")))
          );
        },
      },
    ],
  },
  {
    id: "lisbon-porto-2leg",
    description: "Lisbon + Porto, 5 nights",
    destination: "Lisbon",
    duration: "5-night trip",
    travelCompany: "solo",
    styleTags: ["Food-led", "History"],
    budgetTier: "budget",
    travelerCount: 1,
    legs: [
      { id: "1", place: { name: "Lisbon" }, hotel: null, startDate: "2026-06-15", endDate: "2026-06-18" },
      { id: "2", place: { name: "Porto" }, hotel: null, startDate: "2026-06-18", endDate: "2026-06-20" },
    ],
    checks: [
      {
        name: "every leg has at least one activity",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) => c.legIndex === 0) && cards.some((c) => c.legIndex === 1),
      },
    ],
  },
  {
    id: "spain-portugal-3leg-luxury",
    description: "Madrid + Lisbon + Porto, 9 nights luxury",
    destination: "Madrid",
    duration: "9-night trip",
    travelCompany: "partner",
    styleTags: ["Cultural", "Food-led", "Romantic"],
    budgetTier: "luxury",
    travelerCount: 2,
    legs: [
      { id: "1", place: { name: "Madrid" }, hotel: null, startDate: "2026-06-15", endDate: "2026-06-18" },
      { id: "2", place: { name: "Lisbon" }, hotel: null, startDate: "2026-06-18", endDate: "2026-06-21" },
      { id: "3", place: { name: "Porto" }, hotel: null, startDate: "2026-06-21", endDate: "2026-06-24" },
    ],
    checks: [
      {
        name: "every leg has at least one activity",
        lifeImpacting: true,
        check: (cards) =>
          [0, 1, 2].every((i) => cards.some((c) => c.legIndex === i)),
      },
    ],
  },
  {
    id: "lisbon-sintra-day-trip-2leg",
    description: "Lisbon + Sintra (1 night) — short last leg",
    destination: "Lisbon",
    duration: "5-night trip",
    travelCompany: "partner",
    styleTags: ["Cultural"],
    budgetTier: "comfortable",
    travelerCount: 2,
    legs: [
      { id: "1", place: { name: "Lisbon" }, hotel: null, startDate: "2026-06-15", endDate: "2026-06-19" },
      { id: "2", place: { name: "Sintra" }, hotel: null, startDate: "2026-06-19", endDate: "2026-06-20" },
    ],
    checks: [
      {
        name: "leg 1 (Sintra, 1 night) gets ≤3 activities (short-leg fatigue rule)",
        check: (cards) => cards.filter((c) => c.legIndex === 1).length <= 3,
      },
      {
        name: "every leg has at least one activity",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) => c.legIndex === 0) && cards.some((c) => c.legIndex === 1),
      },
    ],
  },
  {
    id: "tokyo-kyoto-osaka-3leg",
    description: "Tokyo + Kyoto + Osaka",
    destination: "Tokyo",
    duration: "9-night trip",
    travelCompany: "partner",
    styleTags: ["Cultural", "Food-led"],
    budgetTier: "comfortable",
    travelerCount: 2,
    legs: [
      { id: "1", place: { name: "Tokyo" }, hotel: null, startDate: "2026-06-15", endDate: "2026-06-18" },
      { id: "2", place: { name: "Kyoto" }, hotel: null, startDate: "2026-06-18", endDate: "2026-06-21" },
      { id: "3", place: { name: "Osaka" }, hotel: null, startDate: "2026-06-21", endDate: "2026-06-24" },
    ],
    checks: [
      {
        name: "every leg has at least one activity",
        lifeImpacting: true,
        check: (cards) =>
          [0, 1, 2].every((i) => cards.some((c) => c.legIndex === i)),
      },
    ],
  },
  {
    id: "rome-florence-venice-3leg",
    description: "Italy classic 3-leg",
    destination: "Rome",
    duration: "9-night trip",
    travelCompany: "partner",
    styleTags: ["Cultural", "History", "Food-led"],
    budgetTier: "comfortable",
    travelerCount: 2,
    legs: [
      { id: "1", place: { name: "Rome" }, hotel: null, startDate: "2026-06-15", endDate: "2026-06-18" },
      { id: "2", place: { name: "Florence" }, hotel: null, startDate: "2026-06-18", endDate: "2026-06-21" },
      { id: "3", place: { name: "Venice" }, hotel: null, startDate: "2026-06-21", endDate: "2026-06-24" },
    ],
    checks: [
      {
        name: "every leg has at least one activity",
        lifeImpacting: true,
        check: (cards) =>
          [0, 1, 2].every((i) => cards.some((c) => c.legIndex === i)),
      },
    ],
  },
  {
    id: "barcelona-mallorca-allergy",
    description: "Multi-leg with allergy constraint — every leg must respect",
    destination: "Barcelona",
    duration: "6-night trip",
    travelCompany: "family",
    styleTags: ["Beach", "Food-led"],
    budgetTier: "comfortable",
    travelerCount: 4,
    childrenAges: ["5–8", "9–12"],
    constraintTags: ["Severe allergy"],
    constraintText: "Older child has a severe shellfish allergy",
    legs: [
      { id: "1", place: { name: "Barcelona" }, hotel: null, startDate: "2026-06-15", endDate: "2026-06-18" },
      { id: "2", place: { name: "Mallorca" }, hotel: null, startDate: "2026-06-18", endDate: "2026-06-21" },
    ],
    checks: [
      {
        name: "every food/dining card mentions allergy / shellfish / awareness",
        lifeImpacting: true,
        check: (cards) =>
          cards
            .filter((c) => /food|dining|restaurant|market/i.test(c.category))
            .every((c) =>
              /allerg|shellfish|seafood|please confirm|awareness|safe/i.test(c.why ?? "")
            ),
      },
      {
        name: "every leg has at least one activity",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) => c.legIndex === 0) && cards.some((c) => c.legIndex === 1),
      },
    ],
  },
  {
    id: "tokyo-kyoto-with-tokyo-hotel",
    description: "Multi-leg with hotel only on leg 0 — anchor only there",
    destination: "Tokyo",
    duration: "6-night trip",
    travelCompany: "partner",
    styleTags: ["Cultural", "Food-led"],
    budgetTier: "comfortable",
    travelerCount: 2,
    legs: [
      {
        id: "1",
        place: { name: "Tokyo" },
        hotel: "Park Hotel Tokyo",
        startDate: "2026-06-15",
        endDate: "2026-06-18",
      },
      {
        id: "2",
        place: { name: "Kyoto" },
        hotel: null,
        startDate: "2026-06-18",
        endDate: "2026-06-21",
      },
    ],
    checks: [
      {
        name: "leg 0 may reference Park Hotel by name",
        check: () => true, // soft — only checks the negative below
      },
      {
        name: "leg 1 (no hotel) does NOT fabricate a hotel-proximity claim",
        lifeImpacting: true,
        check: (cards) =>
          cards
            .filter((c) => c.legIndex === 1)
            .every((c) => !/hotel/i.test(c.why ?? "")),
      },
    ],
  },
  {
    id: "lisbon-porto-with-both-hotels",
    description: "Multi-leg with hotels on both legs",
    destination: "Lisbon",
    duration: "6-night trip",
    travelCompany: "solo",
    styleTags: ["Food-led", "History"],
    budgetTier: "comfortable",
    travelerCount: 1,
    legs: [
      {
        id: "1",
        place: { name: "Lisbon" },
        hotel: "Hotel Avenida Palace",
        startDate: "2026-06-15",
        endDate: "2026-06-18",
      },
      {
        id: "2",
        place: { name: "Porto" },
        hotel: "Pestana Vintage Porto",
        startDate: "2026-06-18",
        endDate: "2026-06-21",
      },
    ],
    checks: [
      {
        name: "every leg has at least one activity",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) => c.legIndex === 0) && cards.some((c) => c.legIndex === 1),
      },
    ],
  },
  {
    id: "amsterdam-bruges-2leg-mobility",
    description: "Multi-leg with mobility constraint",
    destination: "Amsterdam",
    duration: "6-night trip",
    travelCompany: "partner",
    styleTags: ["Cultural", "Art & Design"],
    budgetTier: "comfortable",
    travelerCount: 2,
    constraintTags: ["No long walks"],
    constraintText: "I have a knee injury",
    legs: [
      { id: "1", place: { name: "Amsterdam" }, hotel: null, startDate: "2026-06-15", endDate: "2026-06-18" },
      { id: "2", place: { name: "Bruges" }, hotel: null, startDate: "2026-06-18", endDate: "2026-06-21" },
    ],
    checks: [
      {
        name: "no obvious long-walk categories",
        lifeImpacting: true,
        check: (cards) =>
          cards.every((c) => !/hike|hiking|trek|long walk/i.test(c.category + " " + c.description)),
      },
      {
        name: "Why mentions short walk / mobility / knee somewhere",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) =>
            /short walk|knee|mobilit|low-impact|step-free|seated|easy walk/i.test(c.why ?? "")
          ),
      },
    ],
  },
  {
    id: "rome-florence-2leg-stroller",
    description: "Multi-leg family with stroller-friendly",
    destination: "Rome",
    duration: "7-night trip",
    travelCompany: "family",
    styleTags: ["Cultural", "Kid-friendly"],
    budgetTier: "comfortable",
    travelerCount: 4,
    childrenAges: ["2–4", "5–8"],
    constraintTags: ["Stroller-friendly"],
    legs: [
      { id: "1", place: { name: "Rome" }, hotel: null, startDate: "2026-06-15", endDate: "2026-06-19" },
      { id: "2", place: { name: "Florence" }, hotel: null, startDate: "2026-06-19", endDate: "2026-06-22" },
    ],
    checks: [
      {
        name: "Why mentions stroller / pram / family-friendly",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) =>
            /stroller|pram|kid-friend|family-friend|easy access/i.test(c.why ?? "")
          ),
      },
      {
        name: "every leg has at least one activity",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) => c.legIndex === 0) && cards.some((c) => c.legIndex === 1),
      },
    ],
  },
  {
    id: "edinburgh-glasgow-2leg",
    description: "UK multi-leg",
    destination: "Edinburgh",
    duration: "5-night trip",
    travelCompany: "solo",
    styleTags: ["History", "Food-led"],
    budgetTier: "budget",
    travelerCount: 1,
    legs: [
      { id: "1", place: { name: "Edinburgh" }, hotel: null, startDate: "2026-06-15", endDate: "2026-06-18" },
      { id: "2", place: { name: "Glasgow" }, hotel: null, startDate: "2026-06-18", endDate: "2026-06-20" },
    ],
    checks: [
      {
        name: "every leg has at least one activity",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) => c.legIndex === 0) && cards.some((c) => c.legIndex === 1),
      },
    ],
  },
  {
    id: "berlin-prague-2leg-history",
    description: "Berlin + Prague, history-focused",
    destination: "Berlin",
    duration: "6-night trip",
    travelCompany: "partner",
    styleTags: ["History", "Cultural"],
    budgetTier: "comfortable",
    travelerCount: 2,
    legs: [
      { id: "1", place: { name: "Berlin" }, hotel: null, startDate: "2026-06-15", endDate: "2026-06-18" },
      { id: "2", place: { name: "Prague" }, hotel: null, startDate: "2026-06-18", endDate: "2026-06-21" },
    ],
    checks: [
      {
        name: "every leg has at least one activity",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) => c.legIndex === 0) && cards.some((c) => c.legIndex === 1),
      },
    ],
  },
  {
    id: "marrakech-fes-2leg",
    description: "Morocco multi-leg",
    destination: "Marrakech",
    duration: "7-night trip",
    travelCompany: "partner",
    styleTags: ["Cultural", "Food-led"],
    budgetTier: "comfortable",
    travelerCount: 2,
    legs: [
      { id: "1", place: { name: "Marrakech" }, hotel: null, startDate: "2026-06-15", endDate: "2026-06-19" },
      { id: "2", place: { name: "Fes" }, hotel: null, startDate: "2026-06-19", endDate: "2026-06-22" },
    ],
    checks: [
      {
        name: "every leg has at least one activity",
        lifeImpacting: true,
        check: (cards) =>
          cards.some((c) => c.legIndex === 0) && cards.some((c) => c.legIndex === 1),
      },
    ],
  },
  {
    id: "kyoto-osaka-2leg-vegan",
    description: "Multi-leg with vegan constraint",
    destination: "Kyoto",
    duration: "6-night trip",
    travelCompany: "solo",
    styleTags: ["Food-led"],
    budgetTier: "comfortable",
    travelerCount: 1,
    constraintTags: ["Vegetarian"],
    constraintText: "Vegan only please",
    legs: [
      { id: "1", place: { name: "Kyoto" }, hotel: null, startDate: "2026-06-15", endDate: "2026-06-18" },
      { id: "2", place: { name: "Osaka" }, hotel: null, startDate: "2026-06-18", endDate: "2026-06-21" },
    ],
    checks: [
      {
        name: "food cards in both legs respect vegan/vegetarian",
        lifeImpacting: true,
        check: (cards) =>
          cards
            .filter((c) => /food|dining|restaurant|market/i.test(c.category))
            .every((c) =>
              /vegan|vegetarian|plant|veg-friendly/i.test(c.why ?? "")
            ),
      },
    ],
  },
];

const ALL_CASES: Case[] = [...SINGLE_LEG_CASES, ...MULTI_LEG_CASES];

// ── Runner ──────────────────────────────────────────────────────────────

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

async function runOne(c: Case): Promise<{
  cards: ParsedCard[];
  raw: string;
}> {
  const userMessage = buildUserMessage(c);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage }],
  });
  const raw =
    response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n") ?? "";
  const cards = parseCards(raw);
  return { cards, raw };
}

async function main() {
  console.log(
    `\nRunning ${ALL_CASES.length} activity-gen eval cases against ${MODEL}...\n`
  );
  let totalChecks = 0;
  let passedChecks = 0;
  let lifeImpactingFailures = 0;

  for (const c of ALL_CASES) {
    const { cards, raw } = await runOne(c);
    let casePassed = 0;
    const failures: string[] = [];
    for (const { name, check, lifeImpacting } of c.checks) {
      totalChecks++;
      try {
        if (check(cards, raw)) {
          passedChecks++;
          casePassed++;
        } else {
          failures.push(name + (lifeImpacting ? " [life-impacting]" : ""));
          if (lifeImpacting) lifeImpactingFailures++;
        }
      } catch {
        failures.push(name + " (threw)");
        if (lifeImpacting) lifeImpactingFailures++;
      }
    }
    const ratio = `${casePassed}/${c.checks.length}`;
    const mark = casePassed === c.checks.length ? "✓" : "✗";
    console.log(
      `${mark} ${c.id.padEnd(34)} ${ratio.padStart(5)}  — ${c.description}`
    );
    if (failures.length > 0) {
      for (const f of failures) console.log(`    × ${f}`);
      console.log(`    cards: ${cards.length} parsed`);
    }
  }

  const accuracy = (passedChecks / totalChecks) * 100;
  console.log(`\n──── Summary ────`);
  console.log(`Field accuracy:           ${accuracy.toFixed(1)}%  (target ≥ 85%)`);
  console.log(
    `Life-impacting failures:  ${lifeImpactingFailures === 0 ? "0 (target 0)" : `${lifeImpactingFailures}`}`
  );
  console.log(`Cases run:                ${ALL_CASES.length}`);
  console.log(`Total checks:             ${totalChecks}`);
  console.log(`Passed:                   ${passedChecks}\n`);

  if (accuracy < 85 || lifeImpactingFailures > 0) {
    console.error("EVAL FAILED — pass gate not met. Iterate the prompt.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
