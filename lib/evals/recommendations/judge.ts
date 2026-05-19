/**
 * PHI-118 — Restaurant recommendations LLM-as-judge.
 *
 * Opus 4.6 + raw-JSON output. Behaviour preserved verbatim from
 * `scripts/eval-recommendations.ts`, including the "Failed to parse
 * scorer response:\n${raw}" error message.
 */

import { parseJsonJudgeResponse, runRawJudge } from "../judge";
import type { TestCase } from "./cases";

const JUDGE_MODEL = "claude-opus-4-6";

export type ScoreResult = {
  score: number;        // 0–10
  passed: boolean;      // score >= 7
  criteriaScores: { criterion: string; met: boolean; comment: string }[];
  summary: string;
};

export async function judge(
  testCase: TestCase,
  recommendations: string,
  opts: { suiteRunId?: string } = {},
): Promise<ScoreResult> {
  const criteriaList = testCase.criteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  const userMessage = `You are evaluating the quality of AI-generated restaurant recommendations.

## Traveler profile
- Label: ${testCase.label}
- Destination: ${testCase.profile.destination}
- Traveler types: ${testCase.profile.travelerTypes.join(", ")}
- Travel company: ${testCase.profile.travelCompany}
- Budget: ${testCase.profile.budget}
- Dietary wishes: ${testCase.profile.dietaryWishes || "none"}

## Recommendations to evaluate
${recommendations}

## Evaluation criteria
${criteriaList}

Evaluate whether each criterion is met. Then give an overall score from 0 to 10.

Respond with valid JSON only, no markdown, in this exact shape:
{
  "criteriaScores": [
    { "criterion": "<criterion text>", "met": true|false, "comment": "<one sentence>" }
  ],
  "score": <0-10>,
  "summary": "<two sentences overall assessment>"
}`;

  const raw = await runRawJudge({ userMessage, model: JUDGE_MODEL, suiteRunId: opts.suiteRunId });

  try {
    const parsed = parseJsonJudgeResponse<ScoreResult>(raw);
    parsed.passed = parsed.score >= 7;
    return parsed;
  } catch {
    throw new Error(`Failed to parse scorer response:\n${raw}`);
  }
}
