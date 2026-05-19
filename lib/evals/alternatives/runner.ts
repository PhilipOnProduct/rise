/**
 * PHI-118 — Restaurant alternatives eval runner.
 *
 * Extracted from `scripts/eval-alternatives.ts`. Output format is
 * byte-identical to the pre-refactor script.
 */

import { calculateAnthropicCost } from "../../api-costs";
import type { GuiCaseOutcome, GuiRunOpts, GuiSuiteOutcome } from "../types";
import { TEST_CASES, type AlternativeRequest, type TestCase } from "./cases";
import { judge, type ScoreResult } from "./judge";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";

// PHI-120 — per-case token estimates for the cost-confirm dialog.
// Calibrated against CLAUDE.md "Eval harnesses" empirical costs and the
// observed prompt + response sizes in this suite (Sonnet route call +
// Opus judge call). Output is sensitive to `lib/api-costs.ts` rate
// changes via `calculateAnthropicCost` — no number is hard-coded here.
const ROUTE_MODEL = "claude-sonnet-4-6";
const ROUTE_INPUT_TOKENS = 600;
const ROUTE_OUTPUT_TOKENS = 500;
const JUDGE_MODEL = "claude-opus-4-6";
const JUDGE_INPUT_TOKENS = 700;
const JUDGE_OUTPUT_TOKENS = 400;

export function costEstimateUsd(): number {
  const perCase =
    calculateAnthropicCost(ROUTE_MODEL, ROUTE_INPUT_TOKENS, ROUTE_OUTPUT_TOKENS) +
    calculateAnthropicCost(JUDGE_MODEL, JUDGE_INPUT_TOKENS, JUDGE_OUTPUT_TOKENS);
  return perCase * TEST_CASES.length;
}

async function getAlternative(
  request: AlternativeRequest,
  opts: { baseUrl?: string; authCookie?: string | null; suiteRunId?: string | null } = {},
): Promise<Record<string, unknown>> {
  const baseUrl = opts.baseUrl ?? BASE_URL;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.authCookie) headers["Cookie"] = opts.authCookie;
  if (opts.suiteRunId) headers["X-Suite-Run-Id"] = opts.suiteRunId;

  const res = await fetch(`${baseUrl}/api/itinerary/alternative`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });

  if (!res.ok) throw new Error(`API returned ${res.status}`);
  const data = await res.json();
  if (!data.alternative) throw new Error("No alternative in response");
  return data.alternative;
}

export async function runOne(testCase: TestCase) {
  const alternative = await getAlternative(testCase.request);
  const result = await judge(testCase, alternative);
  return { alternative, result };
}

/**
 * PHI-120 — GUI executor for the alternatives suite. Mirrors the CLI
 * loop in `main()` but returns structured per-case outcomes instead of
 * printing. Used by `/api/admin/evals/suites/alternatives/runs`.
 *
 * The CLI `main()` continues to use `runOne` and `process.exit`, so its
 * stdout/exit-code output is unchanged (PHI-118 byte-identical guarantee).
 */
export async function runSuiteForGui(opts: GuiRunOpts): Promise<GuiSuiteOutcome> {
  const perCaseEstimate = costEstimateUsd() / TEST_CASES.length;
  const caseOutcomes: GuiCaseOutcome[] = [];

  for (const testCase of TEST_CASES) {
    const t0 = Date.now();
    try {
      const alternative = await getAlternative(testCase.request, {
        baseUrl: opts.baseUrl,
        authCookie: opts.authCookie,
        suiteRunId: opts.suiteRunId,
      });
      const result = await judge(testCase, alternative, { suiteRunId: opts.suiteRunId });
      const snippet = JSON.stringify(alternative);
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

function printResult(
  testCase: TestCase,
  alternative: Record<string, unknown>,
  result: ScoreResult,
) {
  const badge = result.passed ? "✅ PASS" : "❌ FAIL";
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${badge}  ${testCase.label}  (score: ${result.score}/10)`);
  console.log(`${"─".repeat(60)}`);

  console.log("\nGenerated alternative:");
  console.log(`  Title: ${alternative.title}`);
  console.log(`  Cuisine: ${alternative.cuisine} · Vibe: ${alternative.vibe} · Price: ${alternative.price_tier}`);
  console.log(`  Description: ${alternative.description}`);
  const meta = alternative.booking_meta as Record<string, unknown> | undefined;
  if (meta) {
    console.log(`  Booking: ${meta.preferred_platform} (${meta.confidence}) — "${meta.search_query}"`);
  }

  console.log("\nCriteria:");
  for (const c of result.criteriaScores) {
    const mark = c.met ? "  ✓" : "  ✗";
    console.log(`${mark} ${c.criterion}`);
    console.log(`      ${c.comment}`);
  }

  console.log(`\nSummary: ${result.summary}`);
}

export async function main(): Promise<void> {
  console.log("🔍 Rise — Restaurant Alternative Eval");
  console.log(`   Targeting: ${BASE_URL}`);
  console.log(`   Testing ${TEST_CASES.length} replacement scenarios\n`);

  const results: { label: string; passed: boolean; score: number }[] = [];

  for (const testCase of TEST_CASES) {
    process.stdout.write(`Running: ${testCase.label}... `);

    try {
      const alternative = await getAlternative(testCase.request);
      process.stdout.write("scoring... ");
      const result = await judge(testCase, alternative);
      process.stdout.write("done.\n");

      printResult(testCase, alternative, result);
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
    console.log(`  ${badge} ${r.label.padEnd(55)} ${r.score}/10`);
  }
  console.log();

  process.exit(passed === results.length ? 0 : 1);
}
