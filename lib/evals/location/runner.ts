/**
 * PHI-118 — Location-constraint eval runner.
 *
 * Extracted from `scripts/eval-itinerary-location.ts`. Output format is
 * byte-identical to the pre-refactor script.
 */

import { calculateAnthropicCost } from "../../api-costs";
import { bootstrapSiteAuthOrExit, printScoreSummaryAndExit, runScoredCliCases } from "../cli";
import { runSequentialJudgedGuiSuite } from "../gui";
import type { GuiRunOpts, GuiSuiteOutcome } from "../types";
import { TEST_CASES, type EditRequest, type TestCase } from "./cases";
import { judge, type ApiResponse, type ScoreResult } from "./judge";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";

// PHI-120 — per-case token estimates for the cost-confirm dialog.
// Sonnet edit call + Sonnet judge call per case. Calibrated against the
// rubric / response sizes observed in this suite and CLAUDE.md's empirical
// ~$0.20/run for this CLI suite.
const ROUTE_MODEL = "claude-sonnet-4-6";
const ROUTE_INPUT_TOKENS = 2500;
const ROUTE_OUTPUT_TOKENS = 300;
const JUDGE_MODEL = "claude-sonnet-4-6";
const JUDGE_INPUT_TOKENS = 2000;
const JUDGE_OUTPUT_TOKENS = 500;

export function costEstimateUsd(): number {
  const perCase =
    calculateAnthropicCost(ROUTE_MODEL, ROUTE_INPUT_TOKENS, ROUTE_OUTPUT_TOKENS) +
    calculateAnthropicCost(JUDGE_MODEL, JUDGE_INPUT_TOKENS, JUDGE_OUTPUT_TOKENS);
  return perCase * TEST_CASES.length;
}

async function callEditApi(
  request: EditRequest,
  authCookie: string | null,
  opts: { baseUrl?: string; suiteRunId?: string | null } = {},
): Promise<ApiResponse> {
  const baseUrl = opts.baseUrl ?? BASE_URL;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authCookie) headers["Cookie"] = authCookie;
  if (opts.suiteRunId) headers["X-Suite-Run-Id"] = opts.suiteRunId;

  const res = await fetch(`${baseUrl}/api/itinerary/edit`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });

  if (!res.ok) throw new Error(`API returned ${res.status}: ${await res.text()}`);
  return res.json() as Promise<ApiResponse>;
}

export async function runOne(
  testCase: TestCase,
  authCookie: string | null,
): Promise<{ response: ApiResponse; result: ScoreResult }> {
  const response = await callEditApi(testCase.request, authCookie);
  const result = await judge(testCase, response);
  return { response, result };
}

/**
 * PHI-120 — GUI executor for the location suite. Mirrors the CLI loop
 * in `main()` but returns structured per-case outcomes; the inbound
 * admin's `site_auth` cookie is forwarded so middleware lets the
 * loopback through.
 */
export async function runSuiteForGui(opts: GuiRunOpts): Promise<GuiSuiteOutcome> {
  return runSequentialJudgedGuiSuite(TEST_CASES, opts, {
    perCaseEstimate: costEstimateUsd() / TEST_CASES.length,
    caseName: (testCase) => testCase.label,
    exec: async (testCase, o) => {
      const response = await callEditApi(testCase.request, o.authCookie, {
        baseUrl: o.baseUrl,
        suiteRunId: o.suiteRunId,
      });
      const result = await judge(testCase, response, { suiteRunId: o.suiteRunId });
      return {
        snippet: JSON.stringify(response),
        passed: result.passed,
        score: result.score,
        summary: result.summary,
      };
    },
  });
}

function printResult(testCase: TestCase, response: ApiResponse, result: ScoreResult) {
  const badge = result.passed ? "✅ PASS" : "❌ FAIL";
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${badge}  ${testCase.label}  (score: ${result.score}/10)`);
  console.log(`${"─".repeat(60)}`);

  console.log(`\n  Destination: ${testCase.request.destination}`);
  console.log(`  Suggestion:  ${response.item.title}`);
  console.log(`  Description: ${response.item.description}`);
  console.log(`  Rationale:   ${response.rationale}`);
  if (response.conflict) console.log(`  Conflict:    ${response.conflict}`);

  console.log("\n  Criteria:");
  for (const c of result.criteriaScores) {
    const mark = c.met ? "  ✓" : "  ✗";
    console.log(`  ${mark} ${c.criterion}`);
    console.log(`        ${c.comment}`);
  }

  console.log(`\n  Summary: ${result.summary}`);
}

export async function main(): Promise<void> {
  console.log("═".repeat(60));
  console.log("  Itinerary Edit — Location Constraint Eval");
  console.log(`  Targeting: ${BASE_URL}`);
  console.log("═".repeat(60));

  const authCookie = await bootstrapSiteAuthOrExit(BASE_URL);

  const results = await runScoredCliCases(TEST_CASES, {
    label: (testCase) => testCase.label,
    runningPrefix: "\n",
    ellipsis: "…",
    fetchOutput: (testCase) => callEditApi(testCase.request, authCookie),
    judgeOutput: (testCase, response) => judge(testCase, response),
    printResult,
  });

  // Summary
  printScoreSummaryAndExit(results, { indent: "  ", labelPad: 55 });
}
