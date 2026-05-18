/**
 * PHI-118 — Popular Picks LLM-as-judge.
 *
 * Sonnet 4.6 + tool_use → 3-criterion rubric + holistic overall.
 * Extracted verbatim from `scripts/eval-popular-picks.ts`.
 */

import { runToolUseJudge } from "../judge";
import type { PopularPick } from "../../popular-picks-prompt";
import type { Fixture } from "./cases";

const JUDGE_TOOL = {
  name: "score_popular_picks",
  description: "Score a set of popular picks against three criteria + an overall holistic score.",
  input_schema: {
    type: "object" as const,
    properties: {
      factualAccuracy: {
        type: "object",
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: { type: "string" },
        },
        required: ["score", "reasoning"],
      },
      profileFit: {
        type: "object",
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: { type: "string" },
        },
        required: ["score", "reasoning"],
      },
      usefulFriction: {
        type: "object",
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          reasoning: { type: "string" },
        },
        required: ["score", "reasoning"],
      },
      overall: { type: "integer", minimum: 1, maximum: 5 },
    },
    required: ["factualAccuracy", "profileFit", "usefulFriction", "overall"],
  },
} as const;

export type CriterionResult = { score: number; reasoning: string };
export type JudgeResult = {
  factualAccuracy: CriterionResult;
  profileFit: CriterionResult;
  usefulFriction: CriterionResult;
  overall: number;
};

export async function judge(fixture: Fixture, picks: PopularPick[]): Promise<JudgeResult> {
  if (picks.length === 0) {
    return {
      factualAccuracy: { score: 1, reasoning: "Route returned no picks." },
      profileFit: { score: 1, reasoning: "Route returned no picks." },
      usefulFriction: { score: 1, reasoning: "Route returned no picks." },
      overall: 1,
    };
  }

  const picksList = picks
    .map((p, i) => `  ${i + 1}. ${p.name} — [${p.category}] ${p.context_note}`)
    .join("\n");

  const profileLines = [
    `- Travelling as: ${fixture.profile.travelCompany}`,
    fixture.profile.childrenAges ? `- Children ages: ${fixture.profile.childrenAges.join(", ")}` : null,
    `- Travel style: ${fixture.profile.styleTags.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const userMessage = `You are evaluating the quality of "popular picks" surfaced to a traveller about to plan a trip. The picks are an assist — they live next to a textarea where the traveller types must-dos themselves. A bad pick (fabricated venue, wrong-profile, brochure prose) is a day-one trust kill.

# Destination
${fixture.city}

# Traveller profile
${profileLines}

# Profile context
${fixture.profile.context}

# What the AI surfaced
${picksList}

# Your task
Score three criteria (1-5 each with a one-sentence reason) and one holistic overall score (1-5). Use the score_popular_picks tool — do NOT respond in free text.

## Scoring guidance

**factualAccuracy.** Are ALL picks real places in ${fixture.city}? 5 = every pick is a real venue / experience a resident would recognise. 3 = one borderline / niche pick that's hard to verify. 1 = any fabricated or wrong-city venue.

**profileFit.** Do the picks AND the context notes serve THIS traveller's profile? 5 = top picks delight this profile; notes are tied to profile specifics (pram-friendly for the family, counter seating for the solo, near-hotel for the extender). 3 = mixed — generic-but-readable, profile not actively respected. 1 = top pick is actively wrong for the profile (late-night nightlife pushed to a family with a toddler; "great for couples" for a solo traveller; rural day-trip-only for a 2-evening extender).

**usefulFriction.** Elena's hard rule: **a context note that could appear verbatim on the venue's own marketing page does not count as useful.** "Beautiful azulejo tiles, dating from 1837" — fails. "Closes at 7pm, get there before 6" — passes. "Quietest on weekday mornings" — passes. "Skip if travelling with a stroller — steep cobbles" — passes. 5 = every note carries real friction / fit / pro-tip signal a resident would say. 3 = mixed — some useful, some brochure. 1 = mostly brochure prose / generic platitudes.

**overall.** Holistic 1-5. Be strict — beautifully-written brochure copy does NOT rescue an inaccurate fact or a wrong-profile pick.`;

  const result = await runToolUseJudge<JudgeResult, typeof JUDGE_TOOL>({
    tool: JUDGE_TOOL,
    toolName: "score_popular_picks",
    userMessage,
  });

  for (const k of ["factualAccuracy", "profileFit", "usefulFriction"] as const) {
    const c = result[k] as { score?: unknown } | undefined;
    if (!c || typeof c.score !== "number" || !Number.isFinite(c.score)) {
      throw new Error(`Judge output malformed: ${k} for fixture ${fixture.id}`);
    }
  }
  if (typeof result.overall !== "number" || !Number.isFinite(result.overall)) {
    throw new Error(`Judge output malformed: overall for fixture ${fixture.id}`);
  }
  return result;
}
