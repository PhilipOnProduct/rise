/**
 * PHI-57 — Country → ranked city recommendations.
 *
 * One Haiku call, one Places searchText call. The Haiku call returns a
 * ranked list with the per-recommendation "why" baked in via tool_use
 * (no second call). Candidates come from Places `searchText` plus the
 * curated whitelist nudge in data/country-city-overrides.json.
 */

import Anthropic from "@anthropic-ai/sdk";
import overridesData from "@/data/country-city-overrides.json";
import { logApiUsage } from "@/lib/log-api-usage";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

type CountryOverrides = {
  countries: Record<
    string,
    {
      surface: string[];
      deprioritize: string[];
      styleAffinities?: Record<string, string[]>;
    }
  >;
};
const overrides = overridesData as unknown as CountryOverrides;

/**
 * Map common country names → ISO 3166-1 alpha-2 for the 10 curated countries.
 * The welcome flow only sends a country *name* string; this lets the API and
 * the recommender opt-in to whitelist + affinity nudges without forcing the
 * caller to plumb a code through. PHI-85.
 */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "united kingdom": "GB",
  uk: "GB",
  britain: "GB",
  "great britain": "GB",
  england: "GB",
  italy: "IT",
  japan: "JP",
  thailand: "TH",
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  america: "US",
  france: "FR",
  spain: "ES",
  greece: "GR",
  mexico: "MX",
  australia: "AU",
};

export function countryNameToCode(name: string): string | undefined {
  return COUNTRY_NAME_TO_CODE[name.trim().toLowerCase()];
}

export type CityCandidate = {
  name: string;
  lat?: number;
  lng?: number;
  source: "places" | "whitelist";
};

export type Preferences = {
  travelCompany?: string;
  styleTags?: string[];
  budgetTier?: string;
  travelerCount?: number;
  childrenAges?: string[];
  // PHI-85: optional structured signals. Welcome flow doesn't capture these
  // yet — they're populated by callers that have richer context (eval
  // fixtures today; future free-text inference or explicit chips later).
  archetype?: "business-extender" | "multi-city-honeymoon";
  accessibilityNeeds?: "none" | "mobility" | "stroller";
  tripShape?: "single-city" | "multi-city";
};

export type CityRecommendation = {
  name: string;
  kind: "city" | "region";
  why: string;
  lat?: number;
  lng?: number;
};

const RANKING_TOOL = {
  name: "rank_cities",
  description:
    "Rank up to 4 cities or regions in the country for the traveller's profile and write a one-sentence personalised 'why' for each.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      recommendations: {
        type: "array",
        minItems: 3,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            kind: { type: "string", enum: ["city", "region"] },
            why: {
              type: "string",
              description:
                "One sentence, ≤18 words, references at least one preference (style, company, budget, kids' ages) explicitly.",
            },
          },
          required: ["name", "kind", "why"],
        },
      },
    },
    required: ["recommendations"],
  },
} as const;

/**
 * Pull candidate cities for a country from Places searchText restricted to
 * the country, then merge in the curated whitelist (deduped on name).
 *
 * PHI-121 — optional `suiteRunId` is forwarded to `logApiUsage` so the
 * eval suite runs can roll up realised Google cost by suite_run_id. The
 * welcome-flow caller passes nothing (defaults to undefined) and the
 * log row is written with `suite_run_id = null` — production behaviour
 * is unchanged.
 */
export async function getCandidates(
  country: string,
  countryCode?: string,
  opts: { suiteRunId?: string } = {},
): Promise<CityCandidate[]> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY;
  const seen = new Set<string>();
  const out: CityCandidate[] = [];

  if (apiKey) {
    try {
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.displayName,places.location,places.types",
        },
        body: JSON.stringify({
          textQuery: `cities to visit in ${country}`,
          languageCode: "en",
          maxResultCount: 10,
          ...(countryCode && { includedRegionCodes: [countryCode] }),
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          places?: {
            displayName?: { text?: string };
            location?: { latitude?: number; longitude?: number };
            types?: string[];
          }[];
        };
        for (const p of data.places ?? []) {
          const name = p.displayName?.text;
          if (!name) continue;
          const k = name.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({
            name,
            lat: p.location?.latitude,
            lng: p.location?.longitude,
            source: "places",
          });
        }
        void logApiUsage({
          provider: "google",
          apiType: "places-text-search",
          feature: "country-recommender",
          suiteRunId: opts.suiteRunId,
        });
      }
    } catch (err) {
      console.warn("[recommender] places searchText failed:", err);
    }
  }

  if (countryCode) {
    const list = overrides.countries[countryCode]?.surface ?? [];
    for (const name of list) {
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ name, source: "whitelist" });
    }
  }

  return out;
}

/**
 * Single Haiku call. Returns ranked recommendations with whys. Coordinates
 * (when the candidate had them from Places) are merged back onto the result
 * by name match.
 */
export type RankResult = {
  recommendations: CityRecommendation[];
  inputTokens: number;
  outputTokens: number;
  rawUserMessage: string;
};

const ARCHETYPE_GUIDANCE: Record<NonNullable<Preferences["archetype"]>, string> = {
  "business-extender":
    "anchor near where the work meetings were (no rental car, short transfers), prioritise the work-anchor city and at most one easy day-trip; rural-only regions are a poor fit for a jet-lagged traveller with a few extra days",
  "multi-city-honeymoon":
    "pick 3 cities that are genuinely different in flavour (urban + nature + food, not three of the same kind); at least one pick must be a non-urban / nature / coastal destination — three bustling capital cities is not a varied multi-city mix",
};

const ACCESSIBILITY_GUIDANCE: Record<
  NonNullable<Preferences["accessibilityNeeds"]>,
  string
> = {
  none: "",
  mobility:
    "no long walks, no steep hills, frequent seated breaks — strongly favour flat cities with good public transport (e.g. Paris, Bordeaux, Nice over Provence/Loire), avoid hilltop villages and driving-required regions",
  stroller:
    "stroller access is required and short transfers only — strongly avoid stair-heavy / clifftop / vertical regions (e.g. Cinque Terre, Amalfi Coast) and favour flat, walkable cities with paved historic centres",
};

const TRIP_SHAPE_GUIDANCE: Record<NonNullable<Preferences["tripShape"]>, string> = {
  "single-city":
    "the ranking should treat the top pick as the trip anchor; later picks are optional day-trips, not standalone destinations",
  "multi-city":
    "the ranking is a multi-stop itinerary — each pick should bring something the others don't (urban / nature / food / coast), not three variants of the same kind of place",
};

export async function rankWithHaiku(
  country: string,
  candidates: CityCandidate[],
  preferences: Preferences,
  countryCode?: string,
  opts: { suiteRunId?: string } = {},
): Promise<RankResult> {
  if (candidates.length === 0) {
    return { recommendations: [], inputTokens: 0, outputTokens: 0, rawUserMessage: "" };
  }

  const client = new Anthropic();

  const profileLines: string[] = [];
  if (preferences.travelCompany)
    profileLines.push(`- Travelling as: ${preferences.travelCompany}`);
  if (preferences.styleTags?.length)
    profileLines.push(`- Travel style: ${preferences.styleTags.join(", ")}`);
  if (preferences.budgetTier)
    profileLines.push(`- Budget: ${preferences.budgetTier}`);
  if (preferences.childrenAges?.length)
    profileLines.push(
      `- Children ages: ${preferences.childrenAges.join(", ")}`,
    );
  if (preferences.archetype)
    profileLines.push(`- Archetype: ${preferences.archetype}`);
  if (preferences.accessibilityNeeds && preferences.accessibilityNeeds !== "none")
    profileLines.push(`- Accessibility: ${preferences.accessibilityNeeds}`);
  if (preferences.tripShape)
    profileLines.push(`- Trip shape: ${preferences.tripShape}`);

  // Build hint block — affinity nudges + archetype/accessibility/trip-shape
  // guidance — only for signals actually present on this request. Each line
  // is a self-contained sentence so Haiku can weigh them independently.
  const hintLines: string[] = [];
  const styleAffinities = countryCode
    ? overrides.countries[countryCode]?.styleAffinities
    : undefined;
  if (styleAffinities && preferences.styleTags?.length) {
    for (const tag of preferences.styleTags) {
      const cities = styleAffinities[tag];
      if (cities && cities.length) {
        hintLines.push(
          `- "${tag}" + ${country}: at least one of [${cities.join("; ")}] should appear in your top 4 picks unless a hard constraint blocks it. These are the iconic matches for this style chip in this country.`,
        );
      }
    }
  }
  if (preferences.archetype)
    hintLines.push(`- Archetype "${preferences.archetype}": ${ARCHETYPE_GUIDANCE[preferences.archetype]}.`);
  if (
    preferences.accessibilityNeeds &&
    preferences.accessibilityNeeds !== "none"
  )
    hintLines.push(
      `- Accessibility "${preferences.accessibilityNeeds}": ${ACCESSIBILITY_GUIDANCE[preferences.accessibilityNeeds]}.`,
    );
  if (preferences.tripShape)
    hintLines.push(`- Trip shape "${preferences.tripShape}": ${TRIP_SHAPE_GUIDANCE[preferences.tripShape]}.`);

  const hintBlock = hintLines.length
    ? `\nProfile-specific hints (treat as load-bearing — apply them when ranking):\n${hintLines.join("\n")}\n`
    : "";

  const userMessage =
    `The traveller said they want to go to ${country} but hasn't picked a city or region yet.\n\n` +
    `Profile:\n${profileLines.join("\n") || "- (no preferences captured)"}\n` +
    hintBlock +
    `\nCandidate cities/regions in ${country}:\n${candidates.map((c) => `- ${c.name}`).join("\n")}\n\n` +
    `Pick up to 4 that best match this traveller's profile. Rank them best-first. ` +
    `When weighing fit, consider what the profile implies about pacing and physical accessibility — ` +
    `young children mean stroller-friendly cities and short transfers; relaxed or slow-travel styles ` +
    `favour walkable cities with good transit over driving-required rural regions; multi-city travellers ` +
    `want a varied mix (urban + nature + food), not three of the same kind. ` +
    `For each, write a one-sentence "why" (≤18 words) that references at least one ` +
    `specific preference (style chip, company, budget, kids' ages, archetype). Never claim partnerships, sponsorships, or licensing. ` +
    `If the candidate is a region rather than a city, set kind to "region".`;

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 800,
    tools: [RANKING_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "rank_cities" },
    messages: [{ role: "user", content: userMessage }],
  });

  void logApiUsage({
    provider: "anthropic",
    apiType: "rank-cities",
    feature: "country-recommender",
    model: HAIKU_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    suiteRunId: opts.suiteRunId,
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    return {
      recommendations: [],
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      rawUserMessage: userMessage,
    };
  }
  const input = block.input as { recommendations?: { name: string; kind: "city" | "region"; why: string }[] };
  const recs = input.recommendations ?? [];

  // Merge coordinates back from candidates by name match.
  const candByName = new Map<string, CityCandidate>();
  for (const c of candidates) candByName.set(c.name.toLowerCase(), c);

  const recommendations = recs.map((r) => {
    const matched = candByName.get(r.name.toLowerCase());
    return {
      name: r.name,
      kind: r.kind,
      why: r.why,
      ...(matched?.lat !== undefined && { lat: matched.lat }),
      ...(matched?.lng !== undefined && { lng: matched.lng }),
    };
  });

  return {
    recommendations,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    rawUserMessage: userMessage,
  };
}
