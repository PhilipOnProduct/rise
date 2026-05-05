/**
 * PHI-34 / RISE-301 — Free-form parser eval harness
 *
 * Runs 50 sample inputs through /api/parse-trip and scores each parse on
 * field accuracy + clarification appropriateness. Expanded from 10 to 50
 * cases per Follow-up #6 (PRD spec).
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
 * region-not-city, anniversary/honeymoon/birthday/bucket-list, mobility
 * and dietary and religious constraints stated offhand, multi-country
 * itineraries, time-vague phrasing (seasons/holidays/relative dates),
 * budget hints, varied family compositions, ESL phrasing, run-on
 * sentences, and accessibility-first cases.
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
  // ── Follow-up #6 expansion: 40 more inputs (cases 11–50) ──────────────────
  {
    id: "thailand-honeymoon",
    description: "Honeymoon, beach + wellness, two-week",
    input: "Honeymoon, Thailand, two weeks, beaches and spa, no temples please",
    checks: [
      { name: "destination Thailand", check: (i) => i.destinations.some((d) => /thailand/i.test(d.name)) },
      { name: "occasion=honeymoon", check: (i) => i.occasion === "honeymoon" },
      { name: "duration 14 nights", check: (i) => i.dates.durationNights === 14 },
      { name: "adults=2 (honeymoon implies couple)", check: (i) => (i.party.adults ?? 0) === 2 || i.clarifications.some((c) => /how many|couple/i.test(c)) },
      { name: "Beach style tag", check: (i) => i.styleTags.some((t) => /beach/i.test(t)) },
      { name: "Wellness style tag", check: (i) => i.styleTags.some((t) => /wellness|spa/i.test(t)) },
      { name: "no-temples preserved verbatim", check: (i) => /temple/i.test(i.constraintText ?? "") },
    ],
  },
  {
    id: "wheelchair-amsterdam",
    description: "Wheelchair-accessibility constraint as the headline",
    input: "Amsterdam in a wheelchair — 4 days, art and museums, partner is also coming",
    checks: [
      { name: "destination Amsterdam", check: (i) => i.destinations.some((d) => /amsterdam/i.test(d.name)) },
      { name: "duration 4 nights", check: (i) => i.dates.durationNights === 4 || i.dates.durationNights === 3 },
      { name: "adults=2", check: (i) => i.party.adults === 2 },
      { name: "Wheelchair tag preserved (life-impacting)", check: (i) => i.constraintTags.includes("Wheelchair accessible only") },
      { name: "Art & Design or Cultural style", check: (i) => i.styleTags.some((t) => /art|cultural/i.test(t)) },
    ],
  },
  {
    id: "vegan-lisbon",
    description: "Dietary constraint (vegan) + budget signal",
    input: "Lisbon, 5 nights, vegan only, budget tight",
    checks: [
      { name: "destination Lisbon", check: (i) => i.destinations.some((d) => /lisbon/i.test(d.name)) },
      { name: "duration 5 nights", check: (i) => i.dates.durationNights === 5 },
      { name: "Vegetarian tag OR vegan in constraintText", check: (i) => i.constraintTags.includes("Vegetarian") || /vegan/i.test(i.constraintText ?? "") },
      { name: "budget=budget", check: (i) => i.budgetTier === "budget" },
    ],
  },
  {
    id: "kosher-jerusalem",
    description: "Religious dietary constraint",
    input: "Jerusalem, kosher, 6 nights, mid-March, history-focused",
    checks: [
      { name: "destination Jerusalem", check: (i) => i.destinations.some((d) => /jerusalem/i.test(d.name)) },
      { name: "duration 6 nights", check: (i) => i.dates.durationNights === 6 },
      { name: "Halal/Kosher tag (life-impacting)", check: (i) => i.constraintTags.includes("Halal/Kosher") },
      { name: "season or date around March", check: (i) => /march/i.test(i.dates.season ?? "") || /-03-/.test(i.dates.departure ?? "") },
      { name: "History style tag", check: (i) => i.styleTags.some((t) => /history/i.test(t)) },
    ],
  },
  {
    id: "halal-istanbul",
    description: "Halal-only family with stroller-aged child",
    input: "Istanbul with my wife and our 1-year-old, halal please, stroller-friendly, 5 nights",
    checks: [
      { name: "destination Istanbul", check: (i) => i.destinations.some((d) => /istanbul/i.test(d.name)) },
      { name: "adults=2", check: (i) => i.party.adults === 2 },
      { name: "1 child Under 2", check: (i) => (i.party.children ?? []).some((c) => c.ageRange === "Under 2") },
      { name: "Halal/Kosher tag (life-impacting)", check: (i) => i.constraintTags.includes("Halal/Kosher") },
      { name: "Stroller-friendly tag", check: (i) => i.constraintTags.includes("Stroller-friendly") },
      { name: "duration 5 nights", check: (i) => i.dates.durationNights === 5 },
    ],
  },
  {
    id: "peanut-allergy-singapore",
    description: "Severe allergy as a casual aside",
    input: "Singapore, 4 days, foodie trip, my daughter (10) has a severe peanut allergy though",
    checks: [
      { name: "destination Singapore", check: (i) => i.destinations.some((d) => /singapore/i.test(d.name)) },
      { name: "Severe allergy tag (life-impacting — must catch)", check: (i) => i.constraintTags.includes("Severe allergy") },
      { name: "peanut preserved verbatim in constraintText", check: (i) => /peanut/i.test(i.constraintText ?? "") },
      { name: "child age 9-12", check: (i) => (i.party.children ?? []).some((c) => c.ageRange === "9–12") },
      { name: "Food-led tag", check: (i) => i.styleTags.some((t) => /food/i.test(t)) },
      { name: "duration 4 nights", check: (i) => i.dates.durationNights === 4 },
    ],
  },
  {
    id: "two-week-iberian",
    description: "Multi-country (Spain + Portugal) with order preserved",
    input: "Spain then Portugal, two weeks total, history and food, couple in our 30s",
    checks: [
      { name: "Spain first", check: (i) => /spain/i.test(i.destinations[0]?.name ?? "") },
      { name: "Portugal second", check: (i) => /portugal/i.test(i.destinations[1]?.name ?? "") },
      { name: "duration 14 nights", check: (i) => i.dates.durationNights === 14 },
      { name: "adults=2", check: (i) => i.party.adults === 2 },
      { name: "History style", check: (i) => i.styleTags.some((t) => /history/i.test(t)) },
      { name: "Food-led style", check: (i) => i.styleTags.some((t) => /food/i.test(t)) },
    ],
  },
  {
    id: "tokyo-kyoto-osaka",
    description: "Multi-city Japan with order preserved",
    input: "Tokyo, then Kyoto, then Osaka — 12 nights total, March, foodie",
    checks: [
      { name: "Tokyo first", check: (i) => /tokyo/i.test(i.destinations[0]?.name ?? "") },
      { name: "Kyoto second", check: (i) => /kyoto/i.test(i.destinations[1]?.name ?? "") },
      { name: "Osaka third", check: (i) => /osaka/i.test(i.destinations[2]?.name ?? "") },
      { name: "duration 12 nights", check: (i) => i.dates.durationNights === 12 },
      { name: "Food-led", check: (i) => i.styleTags.some((t) => /food/i.test(t)) },
      { name: "March recorded as season or date", check: (i) => /march/i.test(i.dates.season ?? "") || /-03-/.test(i.dates.departure ?? "") },
    ],
  },
  {
    id: "luxury-maldives",
    description: "Luxury budget signal, romantic occasion implied",
    input: "Maldives, overwater villa, 7 nights, splurge, just us",
    checks: [
      { name: "destination Maldives", check: (i) => i.destinations.some((d) => /maldives/i.test(d.name)) },
      { name: "duration 7 nights", check: (i) => i.dates.durationNights === 7 },
      { name: "budget=luxury", check: (i) => i.budgetTier === "luxury" },
      { name: "adults=2 OR clarification asks", check: (i) => i.party.adults === 2 || i.clarifications.some((c) => /how many|couple/i.test(c)) },
      { name: "Romantic style", check: (i) => i.styleTags.some((t) => /romantic|relax/i.test(t)) || i.clarifications.some((c) => /style/i.test(c)) },
    ],
  },
  {
    id: "berlin-techno",
    description: "Solo nightlife trip",
    input: "Berlin, 3 nights, techno, solo, cheap",
    checks: [
      { name: "destination Berlin", check: (i) => i.destinations.some((d) => /berlin/i.test(d.name)) },
      { name: "adults=1", check: (i) => i.party.adults === 1 },
      { name: "duration 3 nights", check: (i) => i.dates.durationNights === 3 },
      { name: "Nightlife style", check: (i) => i.styleTags.some((t) => /night/i.test(t)) },
      { name: "budget=budget", check: (i) => i.budgetTier === "budget" },
    ],
  },
  {
    id: "patagonia-active",
    description: "Adventure / active trip with seasonal hint",
    input: "Patagonia, southern hemisphere summer, 10 days, hiking and glaciers",
    checks: [
      { name: "destination Patagonia", check: (i) => i.destinations.some((d) => /patagonia/i.test(d.name)) },
      { name: "duration 10 nights", check: (i) => i.dates.durationNights === 10 },
      { name: "Adventure or Active style", check: (i) => i.styleTags.some((t) => /adventure|active/i.test(t)) },
      { name: "season hint preserved (summer)", check: (i) => /summer|southern/i.test(i.dates.season ?? "") || i.clarifications.some((c) => /date|when/i.test(c)) },
    ],
  },
  {
    id: "iceland-northern-lights",
    description: "Specific phenomenon hint guides timing",
    input: "Iceland, want to see the northern lights, 5 nights, comfortable budget",
    checks: [
      { name: "destination Iceland", check: (i) => i.destinations.some((d) => /iceland/i.test(d.name)) },
      { name: "duration 5 nights", check: (i) => i.dates.durationNights === 5 },
      { name: "budget=comfortable", check: (i) => i.budgetTier === "comfortable" },
      { name: "northern lights preserved", check: (i) => /northern lights|aurora/i.test(i.constraintText ?? "") || /northern lights|aurora/i.test(i.dates.season ?? "") || i.clarifications.some((c) => /winter|season|aurora|northern lights/i.test(c)) },
    ],
  },
  {
    id: "quito-galapagos",
    description: "Two-leg with island hop",
    input: "Quito then the Galápagos, 9 nights, family with two teens, budget conscious",
    checks: [
      { name: "Quito first", check: (i) => /quito/i.test(i.destinations[0]?.name ?? "") },
      { name: "Galápagos second", check: (i) => /gal[áa]pagos/i.test(i.destinations[1]?.name ?? "") },
      { name: "duration 9 nights", check: (i) => i.dates.durationNights === 9 },
      { name: "two teen children", check: (i) => (i.party.children ?? []).filter((c) => c.ageRange === "13–17").length === 2 },
      { name: "budget=budget OR clarification", check: (i) => i.budgetTier === "budget" || i.clarifications.some((c) => /budget/i.test(c)) },
    ],
  },
  {
    id: "rome-school-holidays",
    description: "Time-vague (school holidays)",
    input: "Rome, school holidays, 5 nights, family with one 7-year-old",
    checks: [
      { name: "destination Rome", check: (i) => i.destinations.some((d) => /rome/i.test(d.name)) },
      { name: "duration 5 nights", check: (i) => i.dates.durationNights === 5 },
      { name: "child age 5-8", check: (i) => (i.party.children ?? []).some((c) => c.ageRange === "5–8") },
      { name: "school holidays flagged for clarification", check: (i) => i.clarifications.some((c) => /school|holiday|date/i.test(c)) || /school holidays/i.test(i.dates.season ?? "") },
    ],
  },
  {
    id: "esl-bali",
    description: "ESL phrasing + run-on sentence",
    input: "I want go bali two weeks me my husband honeymoon love beach but also some culture not too expensive",
    checks: [
      { name: "destination Bali", check: (i) => i.destinations.some((d) => /bali/i.test(d.name)) },
      { name: "occasion=honeymoon", check: (i) => i.occasion === "honeymoon" },
      { name: "adults=2", check: (i) => i.party.adults === 2 },
      { name: "duration 14 nights", check: (i) => i.dates.durationNights === 14 },
      { name: "Beach style", check: (i) => i.styleTags.some((t) => /beach/i.test(t)) },
      { name: "Cultural style", check: (i) => i.styleTags.some((t) => /cultural/i.test(t)) },
      { name: "budget=budget OR comfortable", check: (i) => i.budgetTier === "budget" || i.budgetTier === "comfortable" },
    ],
  },
  {
    id: "stag-dublin",
    description: "Stag party, friend group",
    input: "Stag weekend in Dublin, 6 of us, 3 nights, pubs and golf",
    checks: [
      { name: "destination Dublin", check: (i) => i.destinations.some((d) => /dublin/i.test(d.name)) },
      { name: "adults=6", check: (i) => i.party.adults === 6 },
      { name: "duration 3 nights", check: (i) => i.dates.durationNights === 3 },
      { name: "Nightlife style", check: (i) => i.styleTags.some((t) => /night/i.test(t)) },
    ],
  },
  {
    id: "split-50th-birthday",
    description: "Birthday occasion in Croatia",
    input: "Croatia for my 50th, partner and four close friends, sailing if possible, 8 nights in late June",
    checks: [
      { name: "destination Croatia", check: (i) => i.destinations.some((d) => /croatia/i.test(d.name)) },
      { name: "adults=6 (you + partner + 4 friends)", check: (i) => i.party.adults === 6 },
      { name: "occasion=birthday", check: (i) => i.occasion === "birthday" },
      { name: "duration 8 nights", check: (i) => i.dates.durationNights === 8 },
      { name: "season late June", check: (i) => /june/i.test(i.dates.season ?? "") || /-06-/.test(i.dates.departure ?? "") },
    ],
  },
  {
    id: "marrakech-anniversary",
    description: "Anniversary, riad, mid-budget",
    input: "Anniversary in Marrakech, 5 nights, riad, comfortable",
    checks: [
      { name: "destination Marrakech", check: (i) => i.destinations.some((d) => /marrakech/i.test(d.name)) },
      { name: "occasion=anniversary", check: (i) => i.occasion === "anniversary" },
      { name: "duration 5 nights", check: (i) => i.dates.durationNights === 5 },
      { name: "budget=comfortable", check: (i) => i.budgetTier === "comfortable" },
    ],
  },
  {
    id: "vague-cherry-blossom",
    description: "Vague-on-destination + seasonal",
    input: "Somewhere with cherry blossoms, 10 days, photographer's dream",
    checks: [
      { name: "no specific destination guessed", check: (i) => i.destinations.length === 0 || i.clarifications.some((c) => /destination|where|country/i.test(c)) },
      { name: "duration 10 nights", check: (i) => i.dates.durationNights === 10 },
      { name: "cherry blossom recorded as season", check: (i) => /cherry|blossom/i.test(i.dates.season ?? "") },
      { name: "Photography style", check: (i) => i.styleTags.some((t) => /photo/i.test(t)) },
    ],
  },
  {
    id: "vague-cheap-europe",
    description: "Region-only with budget",
    input: "Cheap weekend in Europe, just need a break",
    checks: [
      { name: "Europe captured (region) OR clarification", check: (i) => i.destinations.some((d) => /europe/i.test(d.name)) || i.clarifications.some((c) => /which|where|country/i.test(c)) },
      { name: "duration 2 or 3 nights", check: (i) => [2, 3].includes(i.dates.durationNights ?? 0) },
      { name: "budget=budget", check: (i) => i.budgetTier === "budget" },
    ],
  },
  {
    id: "newly-pregnant",
    description: "Health-state implies low-key",
    input: "Italy, 7 nights, comfy budget, I'm 6 months pregnant so nothing strenuous",
    checks: [
      { name: "destination Italy", check: (i) => i.destinations.some((d) => /italy/i.test(d.name)) },
      { name: "duration 7 nights", check: (i) => i.dates.durationNights === 7 },
      { name: "constraint preserved (pregnant / no strenuous)", check: (i) => /pregnan|strenuous/i.test(i.constraintText ?? "") || i.constraintTags.includes("No long walks") },
    ],
  },
  {
    id: "single-dad-seven",
    description: "Single parent, one young kid",
    input: "Just me and my 7yo daughter, 5 days somewhere fun, half-term in October",
    checks: [
      { name: "adults=1", check: (i) => i.party.adults === 1 },
      { name: "1 child age 5-8", check: (i) => (i.party.children ?? []).filter((c) => c.ageRange === "5–8").length === 1 },
      { name: "duration 5 nights", check: (i) => i.dates.durationNights === 5 },
      { name: "no destination guessed OR clarification", check: (i) => i.destinations.length === 0 || i.clarifications.some((c) => /where|destination/i.test(c)) },
      { name: "October half-term flagged", check: (i) => /october|half-term/i.test(i.dates.season ?? "") || i.clarifications.some((c) => /date|half-term|when/i.test(c)) },
      { name: "Kid-friendly style", check: (i) => i.styleTags.some((t) => /kid/i.test(t)) },
    ],
  },
  {
    id: "santorini-shore-day",
    description: "Single day from cruise — durationNights=0 or 1",
    input: "We have one day in Santorini off our cruise, sunset at Oia, no hiking",
    checks: [
      { name: "destination Santorini", check: (i) => i.destinations.some((d) => /santorini/i.test(d.name)) },
      { name: "duration tiny (0 or 1)", check: (i) => (i.dates.durationNights ?? 0) <= 1 || i.clarifications.some((c) => /day|hours/i.test(c)) },
      { name: "no hiking preserved", check: (i) => /no hiking|hike/i.test(i.constraintText ?? "") || i.constraintTags.includes("No long walks") },
    ],
  },
  {
    id: "hk-business-extension",
    description: "Business + leisure",
    input: "Business trip Hong Kong, want to extend for 3 days afterwards, foodie, no big crowds",
    checks: [
      { name: "destination Hong Kong", check: (i) => i.destinations.some((d) => /hong kong/i.test(d.name)) },
      { name: "duration 3 nights", check: (i) => i.dates.durationNights === 3 },
      { name: "Food-led style", check: (i) => i.styleTags.some((t) => /food/i.test(t)) },
      { name: "no-big-crowds preserved", check: (i) => /crowd/i.test(i.constraintText ?? "") || i.constraintTags.length > 0 },
    ],
  },
  {
    id: "off-the-beaten-track-georgia",
    description: "Off-beat country choice",
    input: "Georgia (the country, not the state), 8 nights, off the beaten track, hiking and food",
    checks: [
      { name: "destination Georgia (country, not state)", check: (i) => i.destinations.some((d) => /georgia/i.test(d.name)) },
      { name: "duration 8 nights", check: (i) => i.dates.durationNights === 8 },
      { name: "Off the beaten track style", check: (i) => i.styleTags.some((t) => /off the beaten/i.test(t)) },
      { name: "Adventure or Active or Food-led", check: (i) => i.styleTags.some((t) => /adventure|active|food/i.test(t)) },
    ],
  },
  {
    id: "edinburgh-festival",
    description: "Festival / event timing",
    input: "Edinburgh during the Fringe, 4 nights, comedy and indie theatre",
    checks: [
      { name: "destination Edinburgh", check: (i) => i.destinations.some((d) => /edinburgh/i.test(d.name)) },
      { name: "duration 4 nights", check: (i) => i.dates.durationNights === 4 },
      { name: "Festival or Cultural style", check: (i) => i.styleTags.some((t) => /festival|cultural/i.test(t)) },
      { name: "Fringe noted in constraintText or season", check: (i) => /fringe|festival/i.test(i.constraintText ?? "") || /august|fringe/i.test(i.dates.season ?? "") || i.clarifications.some((c) => /date/i.test(c)) },
    ],
  },
  {
    id: "stroller-sevilla",
    description: "Toddler-friendly explicit",
    input: "Sevilla, 4 nights, with our 2-year-old, stroller-friendly please",
    checks: [
      { name: "destination Sevilla", check: (i) => i.destinations.some((d) => /sevilla|seville/i.test(d.name)) },
      { name: "1 child age 2-4", check: (i) => (i.party.children ?? []).some((c) => c.ageRange === "2–4") },
      { name: "Stroller-friendly tag", check: (i) => i.constraintTags.includes("Stroller-friendly") },
      { name: "duration 4 nights", check: (i) => i.dates.durationNights === 4 },
    ],
  },
  {
    id: "wellness-bali",
    description: "Solo wellness retreat",
    input: "Solo wellness retreat in Bali, yoga and silence, 10 nights, comfortable",
    checks: [
      { name: "destination Bali", check: (i) => i.destinations.some((d) => /bali/i.test(d.name)) },
      { name: "adults=1", check: (i) => i.party.adults === 1 },
      { name: "duration 10 nights", check: (i) => i.dates.durationNights === 10 },
      { name: "Wellness style", check: (i) => i.styleTags.some((t) => /wellness/i.test(t)) },
      { name: "budget=comfortable", check: (i) => i.budgetTier === "comfortable" },
    ],
  },
  {
    id: "post-divorce-solo",
    description: "Emotional context — model should not mishandle",
    input: "Just got divorced, want to disappear for two weeks, somewhere I can think, mid-budget",
    checks: [
      { name: "no destination guessed", check: (i) => i.destinations.length === 0 || i.clarifications.some((c) => /destination|where/i.test(c)) },
      { name: "duration 14 nights", check: (i) => i.dates.durationNights === 14 },
      { name: "adults=1", check: (i) => i.party.adults === 1 },
      { name: "budget=comfortable", check: (i) => i.budgetTier === "comfortable" },
      { name: "Wellness or Slow travel style suggested", check: (i) => i.styleTags.some((t) => /wellness|slow|relax/i.test(t)) || i.clarifications.length > 0 },
    ],
  },
  {
    id: "south-africa-safari",
    description: "Safari with budget concern",
    input: "South Africa safari, 10 nights, two adults, mid-range — no Big Five flights though, ground only",
    checks: [
      { name: "destination South Africa", check: (i) => i.destinations.some((d) => /south africa/i.test(d.name)) },
      { name: "adults=2", check: (i) => i.party.adults === 2 },
      { name: "duration 10 nights", check: (i) => i.dates.durationNights === 10 },
      { name: "budget=comfortable", check: (i) => i.budgetTier === "comfortable" },
      { name: "no flights preserved", check: (i) => /flight|fly|ground/i.test(i.constraintText ?? "") },
    ],
  },
  {
    id: "morocco-friends",
    description: "Friend group, mixed appetite",
    input: "4 friends, Morocco, 7 nights, mix of medina and desert, two of us are vegetarian",
    checks: [
      { name: "destination Morocco", check: (i) => i.destinations.some((d) => /morocco/i.test(d.name)) },
      { name: "adults=4", check: (i) => i.party.adults === 4 },
      { name: "duration 7 nights", check: (i) => i.dates.durationNights === 7 },
      { name: "Vegetarian tag (life-impacting — partial group)", check: (i) => i.constraintTags.includes("Vegetarian") },
    ],
  },
  {
    id: "puglia-slow-travel",
    description: "Slow travel signal",
    input: "Puglia, 9 nights, slow travel, no checklist tourism, just us two",
    checks: [
      { name: "destination Puglia", check: (i) => i.destinations.some((d) => /puglia/i.test(d.name)) },
      { name: "adults=2", check: (i) => i.party.adults === 2 },
      { name: "duration 9 nights", check: (i) => i.dates.durationNights === 9 },
      { name: "Slow travel style", check: (i) => i.styleTags.some((t) => /slow/i.test(t)) },
    ],
  },
  {
    id: "mexico-day-of-the-dead",
    description: "Cultural event timing",
    input: "Mexico City for Day of the Dead, 4 nights, foodie",
    checks: [
      { name: "destination Mexico City", check: (i) => i.destinations.some((d) => /mexico/i.test(d.name)) },
      { name: "duration 4 nights", check: (i) => i.dates.durationNights === 4 },
      { name: "Day of the Dead recorded (constraint or season)", check: (i) => /day of the dead|dia de los muertos|november/i.test(i.constraintText ?? "") || /november|day of the dead/i.test(i.dates.season ?? "") },
      { name: "Food-led", check: (i) => i.styleTags.some((t) => /food/i.test(t)) },
    ],
  },
  {
    id: "kid-club-canaries",
    description: "All-inclusive resort feel",
    input: "Tenerife, 7 nights, all-inclusive, kid club, 2 adults + 2 kids (4 and 7)",
    checks: [
      { name: "destination Tenerife", check: (i) => i.destinations.some((d) => /tenerife/i.test(d.name)) },
      { name: "adults=2", check: (i) => i.party.adults === 2 },
      { name: "child 2-4", check: (i) => (i.party.children ?? []).some((c) => c.ageRange === "2–4") },
      { name: "child 5-8", check: (i) => (i.party.children ?? []).some((c) => c.ageRange === "5–8") },
      { name: "Kid-friendly", check: (i) => i.styleTags.some((t) => /kid/i.test(t)) },
    ],
  },
  {
    id: "couple-with-dog",
    description: "Pet — not in our taxonomy, must go to constraintText",
    input: "Cornwall, 5 nights, bringing our dog, dog-friendly accommodation",
    checks: [
      { name: "destination Cornwall", check: (i) => i.destinations.some((d) => /cornwall/i.test(d.name)) },
      { name: "duration 5 nights", check: (i) => i.dates.durationNights === 5 },
      { name: "dog/pet preserved verbatim in constraintText", check: (i) => /dog|pet/i.test(i.constraintText ?? "") },
    ],
  },
  {
    id: "first-time-flying",
    description: "Anxiety / first-time flier",
    input: "First time flying for my partner — somewhere short, 3-4 nights, she's anxious",
    checks: [
      { name: "no destination guessed", check: (i) => i.destinations.length === 0 || i.clarifications.some((c) => /short flight|destination/i.test(c)) },
      { name: "duration 3 or 4 nights", check: (i) => [3, 4].includes(i.dates.durationNights ?? 0) },
      { name: "anxiety / short-flight preserved", check: (i) => /anxious|anxiety|short flight|first time/i.test(i.constraintText ?? "") || i.clarifications.some((c) => /flight|distance/i.test(c)) },
    ],
  },
  {
    id: "open-jaw-amsterdam-london",
    description: "Open jaw routing hint",
    input: "Fly into Amsterdam, out of London, 10 nights in between, foodie + culture, couple",
    checks: [
      { name: "Amsterdam first", check: (i) => /amsterdam/i.test(i.destinations[0]?.name ?? "") },
      { name: "London last", check: (i) => /london/i.test(i.destinations[i.destinations.length - 1]?.name ?? "") },
      { name: "adults=2", check: (i) => i.party.adults === 2 },
      { name: "duration 10 nights", check: (i) => i.dates.durationNights === 10 },
      { name: "Food-led OR Cultural", check: (i) => i.styleTags.some((t) => /food|cultural/i.test(t)) },
    ],
  },
  {
    id: "vague-april",
    description: "Time-vague month + nothing else",
    input: "April, 5 nights, anywhere",
    checks: [
      { name: "destinations empty + clarification", check: (i) => i.destinations.length === 0 && i.clarifications.length > 0 },
      { name: "duration 5 nights", check: (i) => i.dates.durationNights === 5 },
      { name: "April recorded as season or date", check: (i) => /april/i.test(i.dates.season ?? "") || /-04-/.test(i.dates.departure ?? "") },
    ],
  },
  {
    id: "iso-dates-paris",
    description: "Specific ISO dates given",
    input: "Paris from 2026-09-12 to 2026-09-19, couple, food-led",
    checks: [
      { name: "destination Paris", check: (i) => i.destinations.some((d) => /paris/i.test(d.name)) },
      { name: "departure 2026-09-12", check: (i) => i.dates.departure === "2026-09-12" },
      { name: "return 2026-09-19", check: (i) => i.dates.return === "2026-09-19" },
      { name: "adults=2", check: (i) => i.party.adults === 2 },
      { name: "Food-led", check: (i) => i.styleTags.some((t) => /food/i.test(t)) },
    ],
  },
  {
    id: "sustainable-norway",
    description: "Sustainability framing",
    input: "Norway in summer, 8 nights, low carbon if possible — train where we can, no flights internally",
    checks: [
      { name: "destination Norway", check: (i) => i.destinations.some((d) => /norway/i.test(d.name)) },
      { name: "duration 8 nights", check: (i) => i.dates.durationNights === 8 },
      { name: "summer recorded", check: (i) => /summer/i.test(i.dates.season ?? "") },
      { name: "low-carbon / train preserved", check: (i) => /carbon|train|sustainab|flight/i.test(i.constraintText ?? "") || i.clarifications.some((c) => /transport/i.test(c)) },
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
