/**
 * PHI-118 — Location-constraint eval LLM-as-judge.
 *
 * Sonnet 4.6 + raw-JSON output (no tool_use). Behaviour preserved
 * verbatim from `scripts/eval-itinerary-location.ts`, including the
 * "Failed to parse scorer response:\n${raw}" error message shape.
 */

import { parseJsonJudgeResponse, runRawJudge } from "../judge";
import type { TestCase } from "./cases";

export type ApiResponse = {
  item: { id: string; title: string; description: string; type: string; time_block: string };
  rationale: string;
  conflict: string | null;
};

export type ScoreResult = {
  score: number;
  passed: boolean;
  criteriaScores: { criterion: string; met: boolean; comment: string }[];
  summary: string;
};

export async function judge(testCase: TestCase, response: ApiResponse): Promise<ScoreResult> {
  const criteriaList = testCase.criteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  const userMessage = `You are evaluating whether an AI travel planner respected a location constraint.

## Context
The user is planning a trip to **${testCase.request.destination}**.
Mode: ${testCase.request.mode}
${testCase.request.replacingItem ? `Replacing: "${testCase.request.replacingItem.title}" — ${testCase.request.replacingItem.description}` : "Filling an empty slot."}

## AI suggestion returned
Title: ${response.item.title}
Description: ${response.item.description}
Type: ${response.item.type}
Rationale: ${response.rationale}
${response.conflict ? `Conflict note: ${response.conflict}` : ""}

## Evaluation criteria
${criteriaList}

Evaluate each criterion strictly. A suggestion that names a landmark or venue in the wrong city MUST fail the location criterion, even if the description is otherwise good.

Respond with valid JSON only, no markdown, in this exact shape:
{
  "criteriaScores": [
    { "criterion": "<criterion text>", "met": true|false, "comment": "<one sentence>" }
  ],
  "score": <0-10>,
  "summary": "<two sentences overall assessment>"
}`;

  const raw = await runRawJudge({ userMessage });

  try {
    const parsed = parseJsonJudgeResponse<ScoreResult>(raw);
    parsed.passed = parsed.score >= 7;
    return parsed;
  } catch {
    throw new Error(`Failed to parse scorer response:\n${raw}`);
  }
}
