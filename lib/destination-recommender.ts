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
  countries: Record<string, { surface: string[]; deprioritize: string[] }>;
};
const overrides = overridesData as unknown as CountryOverrides;

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
 */
export async function getCandidates(
  country: string,
  countryCode?: string,
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

export async function rankWithHaiku(
  country: string,
  candidates: CityCandidate[],
  preferences: Preferences,
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

  const userMessage =
    `The traveller said they want to go to ${country} but hasn't picked a city or region yet.\n\n` +
    `Profile:\n${profileLines.join("\n") || "- (no preferences captured)"}\n\n` +
    `Candidate cities/regions in ${country}:\n${candidates.map((c) => `- ${c.name}`).join("\n")}\n\n` +
    `Pick up to 4 that best match this traveller's profile. Rank them best-first. ` +
    `When weighing fit, consider what the profile implies about pacing and physical accessibility — ` +
    `young children mean stroller-friendly cities and short transfers; relaxed or slow-travel styles ` +
    `favour walkable cities with good transit over driving-required rural regions; multi-city travellers ` +
    `want a varied mix (urban + nature + food), not three of the same kind. ` +
    `For each, write a one-sentence "why" (≤18 words) that references at least one ` +
    `specific preference (style chip, company, budget, kids' ages). Never claim partnerships, sponsorships, or licensing. ` +
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
