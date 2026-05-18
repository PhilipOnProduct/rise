/**
 * PHI-118 — Activity-gen eval cases.
 *
 * 15 single-leg + 15 multi-leg representative trip profiles. Extracted
 * verbatim from `scripts/eval-activities.ts`. Drives the activity-gen
 * prompt (lib/activity-gen-prompt.ts) and scores parsed cards against
 * per-case `check` functions (variety, constraint preservation, format,
 * multi-leg correctness, hotel anchoring).
 */

import type { TripLeg } from "../../trip-schema";

export type ParsedCard = {
  name: string;
  category: string;
  description: string;
  when: string;
  why?: string;
  legIndex?: number;
};

export type Case = {
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

/** Card parsing — mirrors welcome page `parseActivities`. */
export function parseCards(text: string): ParsedCard[] {
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

export const SINGLE_LEG_CASES: Case[] = [
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
    constraintTags: ["Wheelchair access"],
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
    constraintTags: ["Wheelchair access"],
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

export const MULTI_LEG_CASES: Case[] = [
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

export const ALL_CASES: Case[] = [...SINGLE_LEG_CASES, ...MULTI_LEG_CASES];
