/**
 * PHI-100 — Neighbourhood-gen prompt: single source of truth.
 *
 * The "Help me pick a neighbourhood" affordance on welcome step 2 calls
 * /api/neighborhoods, which falls back to Claude Haiku when the destination
 * isn't in the cache. The output is 4–6 cards: each names a real
 * neighbourhood and gives an HONEST trade-off blurb a local would actually
 * say — not generic "charming and walkable" filler.
 *
 * Mirrors the PHI-43 / PHI-90 discipline: the prompt-building logic lives
 * here so any future eval harness can import the exact bytes the route uses.
 */

export type NeighborhoodCard = {
  /** Real neighbourhood name as a local would say it (e.g. "Alfama"). */
  name: string;
  /**
   * One-sentence honest trade-off blurb. Must name a real upside AND a real
   * tradeoff — never just "charming and walkable". The trade-off is the
   * whole point: travellers picking blind need to understand what they're
   * actually choosing between.
   */
  blurb: string;
  /** Best-fit traveller in 4–8 words (e.g. "Walk-everywhere couples"). */
  best_for: string;
};

export const NEIGHBORHOOD_GEN_SYSTEM = `You are a local guide who lives in the destination and is helping a visitor decide which neighbourhood to base themselves in. The visitor hasn't booked a hotel yet — they're picking a neighbourhood first, then a room.

Your one job: name 4–6 real neighbourhoods and tell the visitor honestly what each is like to stay in. The trade-offs are the whole point. A traveller who reads "charming and walkable" five times learns nothing and books blind.

Hard rules:
- Pick REAL neighbourhood names a local would use. Never invent. If you're not sure, omit.
- Cover a meaningful spread: a central tourist-heavy option, at least one quieter or more residential option, and at least one with a strong specific identity (nightlife, food, design, water, hills, parks). Don't ship 5 variations of "central historic centre".
- Every blurb MUST name a real upside AND a real tradeoff in one sentence. The tradeoff is what locals would warn a friend about — noise, hills, taxi-dependency, rough at night, dead at night, tourist-trap restaurants, distance from sights, parking, summer crowds.
- BANNED phrases: "charming and walkable", "vibrant and lively", "perfect for everyone", "trendy hotspot", "best of both worlds", "something for everyone". If you find yourself reaching for any of these, you have not done the trade-off work — start over.
- "best_for" is 4–8 words naming a concrete traveller fit, not a personality test ("Couples who like to walk", "Nightlife-first solo travellers", "Families wanting calm streets"). No "everyone".
- Every blurb is one sentence. Don't pad.

Return ONLY a tool_use call to the emit_neighborhoods tool. No prose, no markdown, no preamble.`;

export function buildNeighborhoodGenUserMessage(destination: string): string {
  return `Destination: ${destination}.

Pick 4–6 real neighbourhoods in ${destination} that a visitor might base themselves in. For each, give the honest trade-off a local would tell a friend who asked "should I stay there?".

Spread the picks: don't return five variations of the historic centre. Mix central tourist-heavy, quieter/residential, and at least one with a strong specific identity (food, nightlife, water, design, hills, parks).`;
}

export const NEIGHBORHOOD_TOOL = {
  name: "emit_neighborhoods",
  description:
    "Emit 4–6 neighbourhood cards for the destination, each with an honest one-sentence trade-off blurb and a concrete best-fit line.",
  input_schema: {
    type: "object" as const,
    properties: {
      neighborhoods: {
        type: "array",
        minItems: 4,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            blurb: { type: "string" },
            best_for: { type: "string" },
          },
          required: ["name", "blurb", "best_for"],
        },
      },
    },
    required: ["neighborhoods"],
  },
};

/** Normalise a destination string to the case-insensitive cache key. */
export function neighborhoodCacheKey(destination: string): string {
  return destination.trim().toLowerCase();
}
