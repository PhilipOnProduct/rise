/**
 * PHI-118 — Restaurant recommendations eval runner.
 *
 * Extracted from `scripts/eval-recommendations.ts`. Output format is
 * byte-identical to the pre-refactor script.
 */

import { calculateAnthropicCost } from "../../api-costs";
import type { GuiCaseOutcome, GuiRunOpts, GuiSuiteOutcome } from "../types";
import { TEST_CASES, type Profile, type TestCase } from "./cases";
import { judge, type ScoreResult } from "./judge";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";

// PHI-120 — per-case token estimates for the cost-confirm dialog.
// Sonnet streaming recommendations + Opus judge per case. Tuned to
// CLAUDE.md's empirical ~$0.20/run for this CLI suite.
const ROUTE_MODEL = "claude-sonnet-4-6";
const ROUTE_INPUT_TOKENS = 200;
const ROUTE_OUTPUT_TOKENS = 900;
const JUDGE_MODEL = "claude-opus-4-6";
const JUDGE_INPUT_TOKENS = 1500;
const JUDGE_OUTPUT_TOKENS = 500;

export function costEstimateUsd(): number {
  const perCase =
    calculateAnthropicCost(ROUTE_MODEL, ROUTE_INPUT_TOKENS, ROUTE_OUTPUT_TOKENS) +
    calculateAnthropicCost(JUDGE_MODEL, JUDGE_INPUT_TOKENS, JUDGE_OUTPUT_TOKENS);
  return perCase * TEST_CASES.length;
}

async function getRecommendations(
  profile: Profile,
  opts: { baseUrl?: string; authCookie?: string | null; suiteRunId?: string | null } = {},
): Promise<string> {
  const baseUrl = opts.baseUrl ?? BASE_URL;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.authCookie) headers["Cookie"] = opts.authCookie;
  if (opts.suiteRunId) headers["X-Suite-Run-Id"] = opts.suiteRunId;

  const res = await fetch(`${baseUrl}/api/recommendations`, {
    method: "POST",
    headers,
    body: JSON.stringify(profile),
  });

  if (!res.ok) throw new Error(`API returned ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }

  return text.trim();
}

export async function runOne(testCase: TestCase) {
  const recommendations = await getRecommendations(testCase.profile);
  const result = await judge(testCase, recommendations);
  return { recommendations, result };
}

/**
 * PHI-120 — GUI executor for the recommendations suite. Streams the
 * Sonnet output to completion (the production route is streaming-only),
 * then calls the Opus judge. Same per-case shape as the other paid
 * suites — programmatic_pass mirrors judge `passed: score >= 7`.
 */
export async function runSuiteForGui(opts: GuiRunOpts): Promise<GuiSuiteOutcome> {
  const perCaseEstimate = costEstimateUsd() / TEST_CASES.length;
  const caseOutcomes: GuiCaseOutcome[] = [];

  for (const testCase of TEST_CASES) {
    const t0 = Date.now();
    try {
      const recommendations = await getRecommendations(testCase.profile, {
        baseUrl: opts.baseUrl,
        authCookie: opts.authCookie,
        suiteRunId: opts.suiteRunId,
      });
      const result = await judge(testCase, recommendations, { suiteRunId: opts.suiteRunId });
      const snippet = recommendations;
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

function printResult(testCase: TestCase, recommendations: string, result: ScoreResult) {
  const badge = result.passed ? "✅ PASS" : "❌ FAIL";
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${badge}  ${testCase.label}  (score: ${result.score}/10)`);
  console.log(`${"─".repeat(60)}`);

  console.log("\nRecommendations received:");
  console.log(recommendations.slice(0, 300) + (recommendations.length > 300 ? "…" : ""));

  console.log("\nCriteria:");
  for (const c of result.criteriaScores) {
    const mark = c.met ? "  ✓" : "  ✗";
    console.log(`${mark} ${c.criterion}`);
    console.log(`      ${c.comment}`);
  }

  console.log(`\nSummary: ${result.summary}`);
}

export async function main(): Promise<void> {
  console.log("🔍 Rise — Restaurant Recommendations Eval");
  console.log(`   Targeting: ${BASE_URL}\n`);

  const results: { label: string; passed: boolean; score: number }[] = [];

  for (const testCase of TEST_CASES) {
    process.stdout.write(`Running: ${testCase.label}… `);

    try {
      const recommendations = await getRecommendations(testCase.profile);
      process.stdout.write("scoring… ");
      const result = await judge(testCase, recommendations);
      process.stdout.write("done.\n");

      printResult(testCase, recommendations, result);
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
  console.log(`RESULTS  ${passed}/${results.length} passed  (${passRate}% pass rate)  avg score: ${avgScore}/10`);
  console.log("═".repeat(60));
  for (const r of results) {
    const badge = r.passed ? "✅" : "❌";
    console.log(`  ${badge} ${r.label.padEnd(35)} ${r.score}/10`);
  }
  console.log();

  process.exit(passed === results.length ? 0 : 1);
}
