/**
 * PHI-118 — Country → city ranking eval cases.
 *
 * 10 country + preference combinations covering all 10 supported
 * countries (UK, IT, JP, TH, US, FR, ES, GR, MX, AU) plus the Marcus
 * business-extender and Okafors multi-city honeymoon archetypes.
 * Extracted verbatim from `scripts/eval-country-destination.ts`.
 */

import type { Preferences } from "../../destination-recommender";

export const RUNS_PER_CASE = 3;
export const PASS_AVG = 4.0;
export const PASS_FLOOR = 3.0;

export type Fixture = {
  id: string;
  country: string;
  countryCode: string;
  preferences: Preferences;
  /** 1-2 sentence story given to the judge — explains what "good" looks like for this profile. */
  context: string;
};

export const FIXTURES: Fixture[] = [
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

export function formatProfile(p: Preferences): string {
  const lines: string[] = [];
  if (p.travelCompany) lines.push(`- Travelling as: ${p.travelCompany}`);
  if (p.styleTags?.length) lines.push(`- Travel style: ${p.styleTags.join(", ")}`);
  if (p.budgetTier) lines.push(`- Budget: ${p.budgetTier}`);
  if (p.travelerCount) lines.push(`- Travellers: ${p.travelerCount}`);
  if (p.childrenAges?.length) lines.push(`- Children ages: ${p.childrenAges.join(", ")}`);
  return lines.join("\n") || "(no preferences captured)";
}
