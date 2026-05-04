/**
 * PHI-34 / RISE-301 — TripIntent shape
 *
 * The LLM parser produces this from free-form trip descriptions. Once the
 * user confirms the parsed intent on the chip-confirmation screen (UI to
 * follow), it's converted into the canonical Trip shape from trip-schema.ts.
 *
 * Per Sarah's PRD + Elena's input-pattern catalogue:
 * - Conservative parsing: NEVER invent fields the user didn't mention.
 * - Missing required fields surface as `clarifications`, not as guessed values.
 * - High-stakes constraints (allergies, mobility, accessibility) MUST be
 *   preserved exactly as the user expressed them.
 */

export type TripIntentDestination = {
  /** Place name as the user said it ("Lisbon", "the Amalfi Coast", "Portugal"). */
  name: string;
  /** "place" | "region" | "country" | "locality" | "poi" — soft hint. */
  kind?: "place" | "region" | "country" | "locality" | "poi";
};

export type TripIntentChild = {
  /** Age range token from CHILD_AGE_RANGES, or empty if unspecified. */
  ageRange?: "Under 2" | "2–4" | "5–8" | "9–12" | "13–17";
  /** Free-text age the user gave ("11", "teen", "infant") if no bucket fits. */
  ageRaw?: string;
};

export type TripIntent = {
  /** One entry per leg/region/country/POI. May be empty if user is vague. */
  destinations: TripIntentDestination[];
  dates: {
    departure?: string;        // ISO if confidently extractable
    return?: string;           // ISO if confidently extractable
    durationNights?: number;   // present when only duration was stated
    season?: string;           // "May", "early summer", "cherry blossom" — for clarification
  };
  party: {
    adults?: number;
    children?: TripIntentChild[];
  };
  /** Subset of STYLE_OPTIONS_BASE / STYLE_OPTIONS_BY_COMPANY chips. */
  styleTags: string[];
  budgetTier?: "budget" | "comfortable" | "luxury";
  /** Subset of CONSTRAINT_CHIPS from welcome page (PHI-35). */
  constraintTags: string[];
  /** Anything the user said that didn't fit a chip — preserved verbatim. */
  constraintText?: string;
  /** Differentiator vs. ChatGPT — bias downstream tone. */
  occasion?: "anniversary" | "honeymoon" | "birthday" | "bucket_list" | "other";
  /** Questions for the user, one per missing required field. Never guesses. */
  clarifications: string[];
};

/**
 * The Anthropic tool-use schema for `parse_trip_intent`. Passed directly to
 * the messages.create() call so the model returns valid TripIntent JSON.
 */
export const TRIP_INTENT_TOOL = {
  name: "parse_trip_intent",
  description:
    "Convert a free-form trip description into a structured TripIntent. " +
    "Be conservative: NEVER invent fields the user didn't mention. " +
    "When a required field is uncertain or missing, return it as a " +
    "clarification rather than guessing.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      destinations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            kind: { type: "string", enum: ["place", "region", "country", "locality", "poi"] },
          },
          required: ["name"],
        },
      },
      dates: {
        type: "object",
        additionalProperties: false,
        properties: {
          departure: { type: "string", description: "ISO date when extractable with confidence" },
          return: { type: "string", description: "ISO date when extractable with confidence" },
          durationNights: { type: "integer", minimum: 1 },
          season: { type: "string", description: "Vague time hint preserved for clarification" },
        },
      },
      party: {
        type: "object",
        additionalProperties: false,
        properties: {
          adults: { type: "integer", minimum: 1 },
          children: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                ageRange: {
                  type: "string",
                  enum: ["Under 2", "2–4", "5–8", "9–12", "13–17"],
                },
                ageRaw: { type: "string" },
              },
            },
          },
        },
      },
      styleTags: { type: "array", items: { type: "string" } },
      budgetTier: { type: "string", enum: ["budget", "comfortable", "luxury"] },
      constraintTags: { type: "array", items: { type: "string" } },
      constraintText: { type: "string" },
      occasion: {
        type: "string",
        enum: ["anniversary", "honeymoon", "birthday", "bucket_list", "other"],
      },
      clarifications: { type: "array", items: { type: "string" } },
    },
    required: ["destinations", "dates", "party", "styleTags", "constraintTags", "clarifications"],
  },
} as const;

/**
 * Coerce a tool_use input back to TripIntent with safe defaults.
 * Some fields default to [] / undefined if the model omits them.
 */
export function coerceTripIntent(raw: unknown): TripIntent {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    destinations: Array.isArray(r.destinations) ? (r.destinations as TripIntentDestination[]) : [],
    dates: (r.dates && typeof r.dates === "object" ? r.dates : {}) as TripIntent["dates"],
    party: (r.party && typeof r.party === "object" ? r.party : {}) as TripIntent["party"],
    styleTags: Array.isArray(r.styleTags) ? (r.styleTags as string[]) : [],
    budgetTier: r.budgetTier as TripIntent["budgetTier"],
    constraintTags: Array.isArray(r.constraintTags) ? (r.constraintTags as string[]) : [],
    constraintText: typeof r.constraintText === "string" ? r.constraintText : undefined,
    occasion: r.occasion as TripIntent["occasion"],
    clarifications: Array.isArray(r.clarifications) ? (r.clarifications as string[]) : [],
  };
}
