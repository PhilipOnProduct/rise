/**
 * PHI-118 — Restaurant alternatives eval LLM-as-judge.
 *
 * Opus 4.6 + raw-JSON output. Behaviour preserved verbatim from
 * `scripts/eval-alternatives.ts`, including the "Failed to parse scorer
 * response:\n${raw}" error message.
 */

import { parseJsonJudgeResponse, runRawJudge } from "../judge";
import type { TestCase } from "./cases";

const JUDGE_MODEL = "claude-opus-4-6";

export type ScoreResult = {
  score: number;
  passed: boolean;
  criteriaScores: { criterion: string; met: boolean; comment: string }[];
  summary: string;
};

export async function judge(
  testCase: TestCase,
  alternative: Record<string, unknown>,
): Promise<ScoreResult> {
  const criteriaList = testCase.criteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  const userMessage = `You are evaluating the quality of an AI-generated restaurant alternative.

## Scenario
- Label: ${testCase.label}
- Destination: ${testCase.request.destination}
- Replacing: ${testCase.request.replacingRestaurant} (${testCase.request.cuisine}, ${testCase.request.vibe})
- Travel dates: ${testCase.request.departureDate} to ${testCase.request.returnDate}
- Meal date: ${testCase.request.date} (Day ${testCase.request.dayNumber}, ${testCase.request.timeBlock})
- Travel company: ${testCase.request.travelCompany}
- Travel style: ${testCase.request.travelerTypes.join(", ")}
- Budget: ${testCase.request.budgetTier}

## Generated alternative
${JSON.stringify(alternative, null, 2)}

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

  const raw = await runRawJudge({ userMessage, model: JUDGE_MODEL });

  try {
    const parsed = parseJsonJudgeResponse<ScoreResult>(raw);
    parsed.passed = parsed.score >= 7;
    return parsed;
  } catch {
    throw new Error(`Failed to parse scorer response:\n${raw}`);
  }
}
