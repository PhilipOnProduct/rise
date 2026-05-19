/**
 * PHI-118 — Country → city ranking LLM-as-judge.
 *
 * Sonnet 4.6 + tool_use → 4-criterion rubric + holistic overall.
 * Extracted verbatim from `scripts/eval-country-destination.ts`, using
 * the shared `runToolUseJudge` scaffolding so anchors / popular-picks /
 * country-destination keep one canonical invocation shape.
 */

import { runToolUseJudge } from "../judge";
import type { CityRecommendation } from "../../destination-recommender";
import { formatProfile, type Fixture } from "./cases";

const JUDGE_TOOL = {
  name: "score_recommendations",
  description:
    "Score the AI's country-to-city recommendations against four rubric criteria (1-5 each, with one-sentence reasoning each) and produce one holistic overall score (1-5).",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      locationMatch: {
        type: "object",
        additionalProperties: false,
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: {
            type: "string",
            description:
              "One sentence: are all recommendations real places actually in the named country?",
          },
        },
        required: ["score", "reasoning"],
      },
      fitToProfile: {
        type: "object",
        additionalProperties: false,
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: {
            type: "string",
            description:
              "One sentence: do the picks AND the ranking serve THIS traveller's profile/archetype?",
          },
        },
        required: ["score", "reasoning"],
      },
      whyQuality: {
        type: "object",
        additionalProperties: false,
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: {
            type: "string",
            description:
              "One sentence: are the per-recommendation 'why' lines specific (cite a real preference + the destination) or generic filler?",
          },
        },
        required: ["score", "reasoning"],
      },
      noHallucinations: {
        type: "object",
        additionalProperties: false,
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: {
            type: "string",
            description:
              "One sentence: any invented landmarks, fake events, claimed partnerships, or non-existent cities?",
          },
        },
        required: ["score", "reasoning"],
      },
      overall: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description:
          "Holistic 1-5 — your overall judgment of whether these top picks would serve this traveller well on day one. Generally tracks the criterion mean, but weight location/fit higher than why-quality on serious mismatches.",
      },
    },
    required: ["locationMatch", "fitToProfile", "whyQuality", "noHallucinations", "overall"],
  },
} as const;

export type CriterionResult = { score: number; reasoning: string };
export type JudgeResult = {
  locationMatch: CriterionResult;
  fitToProfile: CriterionResult;
  whyQuality: CriterionResult;
  noHallucinations: CriterionResult;
  overall: number;
};

export async function judgeOnce(
  fixture: Fixture,
  recs: CityRecommendation[],
  opts: { suiteRunId?: string } = {},
): Promise<JudgeResult> {
  if (recs.length === 0) {
    return {
      locationMatch: { score: 1, reasoning: "No recommendations returned." },
      fitToProfile: { score: 1, reasoning: "No recommendations returned." },
      whyQuality: { score: 1, reasoning: "No recommendations returned." },
      noHallucinations: { score: 5, reasoning: "Nothing to fabricate." },
      overall: 1,
    };
  }

  const recsLines = recs
    .map((r, i) => `  ${i + 1}. ${r.name} (${r.kind}) — ${r.why}`)
    .join("\n");

  const userMessage = `You are evaluating the quality of an AI's country-to-city recommendations for a real traveller about to plan a trip.

# Country
${fixture.country}

# Traveller context
${fixture.context}

# Profile details
${formatProfile(fixture.preferences)}

# What the AI recommended (best-first ranking)
${recsLines}

# Your task
Score four rubric criteria (1-5 each with a one-sentence reason) and one holistic overall score (1-5). Use the score_recommendations tool — do NOT respond in free text.

Scoring guidance:
- Location match: are ALL recommendations real places actually in ${fixture.country}? 5 = all real and in-country. 1 = invented or wrong-country.
- Fit to profile: do the picks and ranking serve THIS traveller? 5 = top picks delight this profile, ranking is defensible. 3 = mixed (one solid, others marginal). 1 = top pick is actively wrong for the profile.
- Why-quality: each "why" should reference at least one specific preference (style, company, budget, kids, archetype) and be specific to the destination. ≤18 words is the target. 5 = every why ties destination-specific reason to a profile preference. 3 = generic but readable. 1 = filler.
- No hallucinations: no invented landmarks, fake events, claimed partnerships, or non-existent cities. 5 = clean. 1 = obvious fabrication.

Be strict. A beautifully-written "why" does NOT rescue a wrong-city or wrong-profile pick.`;

  const result = await runToolUseJudge<JudgeResult, typeof JUDGE_TOOL>({
    tool: JUDGE_TOOL,
    toolName: "score_recommendations",
    userMessage,
    suiteRunId: opts.suiteRunId,
  });

  // Sonnet occasionally drops fields under tool_choice — validate so a
  // malformed judge output throws into the run-catch path (which scores 1)
  // instead of producing NaN downstream.
  const criteria = ["locationMatch", "fitToProfile", "whyQuality", "noHallucinations"] as const;
  for (const k of criteria) {
    const c = result[k] as { score?: unknown } | undefined;
    if (!c || typeof c.score !== "number" || !Number.isFinite(c.score)) {
      throw new Error(`Judge output missing or malformed: ${k}`);
    }
  }
  if (typeof result.overall !== "number" || !Number.isFinite(result.overall)) {
    throw new Error("Judge output missing or malformed: overall");
  }
  return result;
}
