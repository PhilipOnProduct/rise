/**
 * PHI-118 — Activity-gen eval AI invocation.
 *
 * The activities eval doesn't have an LLM-as-judge step — the "judge"
 * here is the activity-gen prompt invocation itself. The structured
 * text output is parsed by `parseCards` (in cases.ts) and then scored
 * by programmatic `check` functions.
 *
 * Temperature 0.2 is load-bearing (PHI-42): default temperature gave
 * noisy results on "every card mentions X" checks. The production
 * route at `app/api/activities-stream/route.ts` stays at default
 * temperature so real users still see variation.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  ACTIVITY_GEN_SYSTEM,
  buildActivityGenUserMessage,
} from "../../activity-gen-prompt";
import type { Case } from "./cases";

const client = new Anthropic();
export const ACTIVITIES_MODEL = "claude-sonnet-4-6";
export const ACTIVITIES_SYSTEM = ACTIVITY_GEN_SYSTEM;

// ── User-message construction (delegates to the lib) ─────────────────────
// PHI-43: the construction logic lives in lib/activity-gen-prompt.ts.
// This wrapper just maps the Case shape to ActivityGenInputs.
export function buildUserMessage(c: Case): string {
  return buildActivityGenUserMessage({
    destination: c.destination,
    duration: c.duration, // eval cases provide pre-formatted duration
    travelCompany: c.travelCompany,
    styleTags: c.styleTags,
    budgetTier: c.budgetTier,
    travelerCount: c.travelerCount,
    childrenAges: c.childrenAges,
    constraintTags: c.constraintTags,
    constraintText: c.constraintText,
    legs: c.legs,
  });
}

export async function runActivityGen(c: Case): Promise<string> {
  const userMessage = buildUserMessage(c);
  const response = await client.messages.create({
    model: ACTIVITIES_MODEL,
    max_tokens: 1500,
    // PHI-42: temperature 0.2 reduces variance vs the default ~1.0. Trial
    // runs across {0.2, 0.5, default} showed 0.2 with the strict per-card
    // check produced the best result (1 life-impacting failure vs 2–3 at
    // other configs). Loosening the check to "≥(N−1) of N" did not improve
    // outcomes at any temperature — the multi-leg-allergy 9-card case
    // remained the dominant failure mode. So we ship the simplest config:
    // temperature 0.2 + strict per-card check, accepting that one
    // 9-card-allergy variance failure is the practical ceiling for this
    // prompt + model combination. The production route stays at default
    // temperature so real users still see variation.
    temperature: 0.2,
    system: [{ type: "text", text: ACTIVITIES_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage }],
  });
  return (
    response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n") ?? ""
  );
}
