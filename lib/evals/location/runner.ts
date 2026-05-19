/**
 * PHI-118 — Location-constraint eval runner.
 *
 * Extracted from `scripts/eval-itinerary-location.ts`. Output format is
 * byte-identical to the pre-refactor script.
 */

import { calculateAnthropicCost } from "../../api-costs";
import type { GuiCaseOutcome, GuiRunOpts, GuiSuiteOutcome } from "../types";
import { bootstrapSiteAuth } from "../site-auth";
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
  const perCaseEstimate = costEstimateUsd() / TEST_CASES.length;
  const caseOutcomes: GuiCaseOutcome[] = [];

  for (const testCase of TEST_CASES) {
    const t0 = Date.now();
    try {
      const response = await callEditApi(testCase.request, opts.authCookie, {
        baseUrl: opts.baseUrl,
        suiteRunId: opts.suiteRunId,
      });
      const result = await judge(testCase, response, { suiteRunId: opts.suiteRunId });
      const snippet = JSON.stringify(response);
      caseOutcomes.push({
        caseName: testCase.label,
        programmaticPass: result.passed,
        judgeScore: result.score,
        judgeReasoning: result.summary,
        outputSnippet: snippet.length > 1024 ? snippet.slice(0, 1024) + "…" : snippet,
        costUsdEstimate: perCaseEstimate,
        durationMs: Date.now() - t0,
        errorMessage: result.passed ? null : `Judge score ${result.score}/10 — ${result.summary}`,
      });
    } catch (err) {
      caseOutcomes.push({
        caseName: testCase.label,
        programmaticPass: false,
        judgeScore: null,
        judgeReasoning: null,
        outputSnippet: "",
        costUsdEstimate: perCaseEstimate,
        durationMs: Date.now() - t0,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const passed = caseOutcomes.filter((c) => c.programmaticPass).length;
  const passRate = caseOutcomes.length === 0 ? 0 : (passed / caseOutcomes.length) * 100;
  return { caseOutcomes, passRate };
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

  let authCookie: string | null = null;
  try {
    authCookie = await bootstrapSiteAuth(BASE_URL);
    if (authCookie) {
      console.log("  Auth: bootstrapped via SITE_PASSWORD");
    } else {
      console.log("  Auth: SITE_PASSWORD not set — proceeding without site_auth cookie");
    }
  } catch (err) {
    console.error(`\nAuth bootstrap failed: ${err instanceof Error ? err.message : err}`);
    console.error("Aborting — fix SITE_PASSWORD or unset it before retrying.");
    process.exit(1);
  }

  const results: { label: string; passed: boolean; score: number }[] = [];

  for (const testCase of TEST_CASES) {
    process.stdout.write(`\nRunning: ${testCase.label}… `);

    try {
      const response = await callEditApi(testCase.request, authCookie);
      process.stdout.write("scoring… ");
      const result = await judge(testCase, response);
      process.stdout.write("done.\n");

      printResult(testCase, response, result);
      results.push({ label: testCase.label, passed: result.passed, score: result.score });
    } catch (err) {
      process.stdout.write("error.\n");
      console.error(`  ⚠ ${testCase.label}: ${err instanceof Error ? err.message : err}`);
      results.push({ label: testCase.label, passed: false, score: 0 });
    }
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const passRate = Math.round((passed / results.length) * 100);
  const avgScore = (results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  RESULTS  ${passed}/${results.length} passed  (${passRate}% pass rate)  avg score: ${avgScore}/10`);
  console.log("═".repeat(60));
  for (const r of results) {
    const badge = r.passed ? "✅" : "❌";
    console.log(`  ${badge} ${r.label.padEnd(55)} ${r.score}/10`);
  }
  console.log();

  process.exit(passed === results.length ? 0 : 1);
}
