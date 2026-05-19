/**
 * PHI-118 — Itinerary anchors eval runner.
 *
 * Extracted from `scripts/eval-itinerary-anchors.ts`. Output format is
 * byte-identical to the pre-refactor script.
 *
 * PHI-121 — GUI executor added. The CLI's per-run logic moved into
 * {@link runSingleAttempt} so both `main()` (sequential, prints to
 * stdout) and `runSuiteForGui` (parallel fan-out via `Promise.allSettled`)
 * share one source of truth for what a single anchors case-run does.
 * CLI stdout/exit-code output is byte-identical to pre-refactor.
 */

import { calculateAnthropicCost } from "../../api-costs";
import { bootstrapSiteAuth } from "../site-auth";
import type { GuiCaseOutcome, GuiRunOpts, GuiSuiteOutcome } from "../types";
import {
  RUNS_PER_CASE,
  TEST_CASES,
  type GenerateRequest,
  type ProgrammaticArgs,
  type TestCase,
} from "./cases";
import { judgeWithLlm, type JudgeResult } from "./judge";
import type { ApiResponse } from "./types";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";

// PHI-121 — per case-run cost estimates for the cost-confirm dialog.
// Anchors hits /api/itinerary/generate (Sonnet 4.6 multi-day itinerary
// generation) + a Sonnet 4.6 judge. Empirical CLI cost is ~$2.20/run
// across 11 cases × 3 runs = 33 case-runs (~$0.067/case-run).
//
// The multi-leg case (#9 Tokyo→Kyoto→Seoul, 9 days) is materially heavier
// than the single-leg cases, so these numbers are the case-mean — the
// realised cost rollup at run finish corrects this with actual token
// counts from `api_usage`.
const ROUTE_MODEL = "claude-sonnet-4-6";
const ROUTE_INPUT_TOKENS = 2500;
const ROUTE_OUTPUT_TOKENS = 3000;
const JUDGE_MODEL = "claude-sonnet-4-6";
const JUDGE_INPUT_TOKENS = 3000;
const JUDGE_OUTPUT_TOKENS = 600;

export function costEstimateUsd(): number {
  const perCaseRun =
    calculateAnthropicCost(ROUTE_MODEL, ROUTE_INPUT_TOKENS, ROUTE_OUTPUT_TOKENS) +
    calculateAnthropicCost(JUDGE_MODEL, JUDGE_INPUT_TOKENS, JUDGE_OUTPUT_TOKENS);
  return perCaseRun * TEST_CASES.length * RUNS_PER_CASE;
}

async function callGenerateApi(
  request: GenerateRequest,
  authCookie: string | null,
  opts: { baseUrl?: string; suiteRunId?: string | null } = {},
): Promise<ApiResponse> {
  const baseUrl = opts.baseUrl ?? BASE_URL;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authCookie) headers["Cookie"] = authCookie;
  if (opts.suiteRunId) headers["X-Suite-Run-Id"] = opts.suiteRunId;

  // PHI-96: one retry on upstream 5xx. The route surfaces transient
  // Anthropic API errors (e.g. "Internal server error" propagated as
  // 500). A single retry absorbs the common-case flake without
  // breaking the "no memoisation, fresh call each time" PRD constraint.
  const maxAttempts = 2;
  let lastErr: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${baseUrl}/api/itinerary/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });

    if (res.ok) {
      return res.json() as Promise<ApiResponse>;
    }

    const body = await res.text();
    lastErr = `API returned ${res.status}: ${body}`;

    const isRetryable = res.status >= 500 && res.status < 600;
    if (!isRetryable || attempt === maxAttempts) {
      throw new Error(lastErr);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(lastErr ?? "callGenerateApi: unreachable");
}

/**
 * PHI-121 — One attempt = one generate call + (if programmatic passes) one
 * judge call. Shared between the CLI `main()` and `runSuiteForGui`.
 *
 * Returns the same `RunResult` shape both paths consume; on a thrown
 * error from the generate call, returns the error-shaped run (empty
 * response, programmaticFailure populated, judge null, score 0).
 */
export async function runSingleAttempt(
  testCase: TestCase,
  authCookie: string | null,
  opts: { baseUrl?: string; suiteRunId?: string | null } = {},
): Promise<RunResult> {
  try {
    const response = await callGenerateApi(testCase.request, authCookie, opts);

    const flatItems = response.days.flatMap((d) => d.items);
    const seededItems = flatItems.filter((i) => i.seededByUser === true);
    const programmaticArgs: ProgrammaticArgs = {
      destination: testCase.request.destination,
      anchors: testCase.request.userSeededActivities,
      days: response.days,
      placementNotes: response.placement_notes,
      flatItems,
      seededItems,
      seededAnchorResolutions: response.seeded_anchor_resolutions ?? null,
      timeSensitiveAlerts: response.time_sensitive_alerts ?? null,
    };

    let programmaticFailure: { ok: false; reason: string } | null = null;
    for (const check of testCase.programmatic) {
      const r = check(programmaticArgs);
      if (!r.ok) {
        programmaticFailure = { ok: false, reason: r.reason ?? "(no reason)" };
        break;
      }
    }

    let judge: JudgeResult | null = null;
    if (!programmaticFailure) {
      judge = await judgeWithLlm(testCase, response, { suiteRunId: opts.suiteRunId ?? undefined });
    }

    const score = judge?.score ?? 0;
    const passed = !programmaticFailure && (judge ? judge.passed : false);
    return {
      response,
      programmaticFailure,
      judge,
      score,
      passed,
    };
  } catch (err) {
    return {
      response: {
        days: [],
        bad_day_dates: null,
        placement_notes: null,
        seeded_anchor_resolutions: null,
        time_sensitive_alerts: null,
      },
      programmaticFailure: {
        ok: false,
        reason: `run threw: ${err instanceof Error ? err.message : String(err)}`,
      },
      judge: null,
      score: 0,
      passed: false,
    };
  }
}

// PHI-96: per-run result so we can aggregate across RUNS_PER_CASE attempts.
export type RunResult = {
  response: ApiResponse;
  programmaticFailure: { ok: false; reason: string } | null;
  judge: JudgeResult | null;
  score: number;
  passed: boolean;
};

export type CaseResult = {
  label: string;
  runs: RunResult[];
  caseScore: number;
  passed: boolean;
  firstReason?: string;
};

function printCase(testCase: TestCase, caseResult: CaseResult) {
  const badge = caseResult.passed ? "✅ PASS" : "❌ FAIL";
  console.log(`\n${"─".repeat(60)}`);
  console.log(
    `${badge}  ${testCase.label}  (score: ${caseResult.caseScore.toFixed(1)}/10)`,
  );
  console.log(`${"─".repeat(60)}`);

  const runLine = caseResult.runs
    .map((r, i) => `Run ${i + 1}: ${r.score}/10`)
    .join("  ·  ");
  console.log(
    `\n  ${runLine}  →  avg ${caseResult.caseScore.toFixed(1)}/10`,
  );

  caseResult.runs.forEach((r, i) => {
    if (r.programmaticFailure) {
      console.log(
        `    Run ${i + 1} programmatic failure: ${r.programmaticFailure.reason}`,
      );
    }
  });

  const lastRun = caseResult.runs[caseResult.runs.length - 1];
  if (!lastRun) return;

  const response = lastRun.response;
  console.log(`\n  Destination: ${testCase.request.destination}`);
  console.log(
    `  Anchors:     ${testCase.request.userSeededActivities.map((a) => `"${a}"`).join(", ")}`,
  );
  console.log(`  placement_notes (last run): ${response.placement_notes ?? "(none)"}`);
  const alerts = response.time_sensitive_alerts;
  if (Array.isArray(alerts) && alerts.length > 0) {
    console.log(`  time_sensitive_alerts (last run):`);
    for (const a of alerts) console.log(`    ⚠ ${a}`);
  } else {
    console.log(`  time_sensitive_alerts (last run): (none)`);
  }
  console.log(`  Days returned (last run): ${response.days.length}`);
  const seededCount = response.days
    .flatMap((d) => d.items)
    .filter((i) => i.seededByUser === true).length;
  console.log(`  Items with seededByUser=true (last run): ${seededCount}`);
  if (Array.isArray(response.seeded_anchor_resolutions)) {
    console.log(`  seeded_anchor_resolutions (last run):`);
    for (const r of response.seeded_anchor_resolutions) {
      const tail =
        (r.placed_title ? ` → "${r.placed_title}"` : "") +
        (r.reason ? `  (${r.reason})` : "");
      console.log(`    [${r.mode}] "${r.verbatim}"${tail}`);
    }
  } else {
    console.log(`  seeded_anchor_resolutions (last run): (none) ⚠ PHI-103 expects this field`);
  }

  if (lastRun.judge) {
    console.log("\n  Judge criteria (last run):");
    for (const c of lastRun.judge.criteriaScores) {
      const mark = c.met ? "  ✓" : "  ✗";
      console.log(`  ${mark} ${c.criterion}`);
      console.log(`        ${c.comment}`);
    }
    console.log(`\n  Summary (last run): ${lastRun.judge.summary}`);
  }
}

export async function main(): Promise<void> {
  console.log("═".repeat(60));
  console.log("  Itinerary Generate — User-seeded anchors eval (PHI-90)");
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

  console.log(`  Cases: ${TEST_CASES.length}  |  Runs/case: ${RUNS_PER_CASE}`);

  const results: CaseResult[] = [];

  for (const testCase of TEST_CASES) {
    process.stdout.write(`\nRunning: ${testCase.label} (${RUNS_PER_CASE}×)… `);
    const runs: RunResult[] = [];

    // PHI-96: 3× per case to absorb model variance. No memoisation —
    // each run hits /api/itinerary/generate fresh per the PRD hard
    // constraint. Any single run failing the programmatic checks
    // (even if the others pass) fails the whole case; the judge
    // scores are averaged.
    //
    // PHI-121: per-run logic now lives in `runSingleAttempt` so the
    // CLI loop and the GUI's parallel fan-out share one source of truth.
    // The CLI path stays sequential and prints to stdout — output is
    // byte-identical to pre-refactor.
    for (let i = 0; i < RUNS_PER_CASE; i++) {
      process.stdout.write(`[run ${i + 1}] `);
      const run = await runSingleAttempt(testCase, authCookie);
      if (run.programmaticFailure && run.programmaticFailure.reason.startsWith("run threw:")) {
        // Preserve the pre-PHI-121 CLI error path (newline + warn line)
        // exactly so the byte-identical stdout gate doesn't trip.
        console.error(
          `\n  ⚠ ${testCase.label} run ${i + 1}: ${run.programmaticFailure.reason.replace(/^run threw:\s*/, "")}`,
        );
      }
      runs.push(run);
    }
    process.stdout.write("done.\n");

    const caseScore = runs.reduce((s, r) => s + r.score, 0) / runs.length;
    const everyRunProgrammaticPassed = runs.every(
      (r) => !r.programmaticFailure,
    );
    const passed = everyRunProgrammaticPassed && caseScore >= 7;
    const firstReason =
      runs.find((r) => r.programmaticFailure)?.programmaticFailure?.reason;

    const caseResult: CaseResult = {
      label: testCase.label,
      runs,
      caseScore,
      passed,
      firstReason,
    };
    printCase(testCase, caseResult);
    results.push(caseResult);
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const passRate = Math.round((passed / results.length) * 100);
  const avgScore = (
    results.reduce((s, r) => s + r.caseScore, 0) / results.length
  ).toFixed(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(
    `  RESULTS  ${passed}/${results.length} passed  (${passRate}% pass rate)  avg score: ${avgScore}/10`,
  );
  console.log("═".repeat(60));
  for (const r of results) {
    const badge = r.passed ? "✅" : "❌";
    const runScores = r.runs.map((rr) => rr.score).join("/");
    console.log(
      `  ${badge} ${r.label.padEnd(55)} avg ${r.caseScore.toFixed(1)}/10 (runs: ${runScores})`,
    );
    if (!r.passed && r.firstReason) {
      console.log(`      ↳ ${r.firstReason}`);
    }
  }
  console.log();

  process.exit(passed === results.length ? 0 : 1);
}

/**
 * PHI-121 — GUI executor for the anchors suite.
 *
 * Fan-out — all `TEST_CASES.length * RUNS_PER_CASE` case-runs scheduled at
 * once via `Promise.allSettled`. Anthropic absorbs the burst; the bigger
 * risk is the Vercel 300s function timeout on the surrounding route
 * (`maxDuration = 300` covers it for the CLI-equivalent ~6–8min on a fully
 * sequential run, but parallelising should comfortably bring the wall
 * clock under 5 min).
 *
 * Each row in the returned `caseOutcomes` represents ONE attempt — the
 * page groups by `caseName` to render the "Run 1 · Run 2 · Run 3 → avg"
 * summary line that mirrors the CLI's per-case block.
 *
 * `overallSuitePass` reflects the anchors gate: every case passes IFF
 * every run for that case had no programmatic failure AND the mean of
 * the three judge scores is ≥ 7. The runs route prefers this flag over
 * the default "every row's programmaticPass === true" derivation because
 * the row-level pass (which is the individual run's `passed` — combined
 * programmatic AND judge ≥7) is stricter than the case-level gate (every
 * run programmatic AND mean judge ≥7).
 */
export async function runSuiteForGui(opts: GuiRunOpts): Promise<GuiSuiteOutcome> {
  const perCaseRunCost = costEstimateUsd() / (TEST_CASES.length * RUNS_PER_CASE);

  type Task = { testCase: TestCase; runIndex: number };
  const tasks: Task[] = TEST_CASES.flatMap((testCase) =>
    Array.from({ length: RUNS_PER_CASE }, (_, i) => ({ testCase, runIndex: i })),
  );

  const settled = await Promise.allSettled(
    tasks.map(async (t) => {
      const t0 = Date.now();
      const run = await runSingleAttempt(t.testCase, opts.authCookie, {
        baseUrl: opts.baseUrl,
        suiteRunId: opts.suiteRunId,
      });
      return { run, durationMs: Date.now() - t0 };
    }),
  );

  const caseOutcomes: GuiCaseOutcome[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const { testCase, runIndex } = tasks[i];
    const result = settled[i];

    if (result.status === "rejected") {
      // `runSingleAttempt` catches its own throws, so we land here only
      // on harness bugs. Record the failure and move on.
      caseOutcomes.push({
        caseName: testCase.label,
        runIndex,
        programmaticPass: false,
        judgeScore: null,
        judgeReasoning: null,
        outputSnippet: "",
        costUsdEstimate: perCaseRunCost,
        durationMs: 0,
        errorMessage:
          result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      continue;
    }

    const { run, durationMs } = result.value;
    // Snippet — the full ApiResponse can be tens of KB for a 9-day
    // multi-leg itinerary. Capture only the fields the History detail
    // would care about; the full output is regenerable from the request.
    const snippet = JSON.stringify({
      day_count: run.response.days.length,
      item_count: run.response.days.flatMap((d) => d.items).length,
      seeded_count: run.response.days
        .flatMap((d) => d.items)
        .filter((it) => it.seededByUser === true).length,
      placement_notes: run.response.placement_notes,
      time_sensitive_alerts: run.response.time_sensitive_alerts,
      seeded_anchor_resolutions: run.response.seeded_anchor_resolutions,
    });
    const errorMessage = run.programmaticFailure
      ? run.programmaticFailure.reason
      : !run.passed
        ? `Judge score ${run.score}/10 — ${run.judge?.summary ?? "(no summary)"}`
        : null;
    caseOutcomes.push({
      caseName: testCase.label,
      runIndex,
      // Row-level pass — combined programmatic AND judge ≥7. The
      // case-level aggregate (every-run programmatic AND mean ≥7) lives
      // in `overallSuitePass` below; the page derives the per-case pill
      // from these row outcomes.
      programmaticPass: run.passed,
      judgeScore: run.judge ? run.score : null,
      judgeReasoning: run.judge?.summary ?? null,
      outputSnippet: snippet.length > 1024 ? snippet.slice(0, 1024) + "…" : snippet,
      costUsdEstimate: perCaseRunCost,
      durationMs,
      errorMessage,
    });
  }

  // Suite-level aggregate — group by case, apply anchors gate.
  const rowsByCase = new Map<string, GuiCaseOutcome[]>();
  for (const row of caseOutcomes) {
    if (!rowsByCase.has(row.caseName)) rowsByCase.set(row.caseName, []);
    rowsByCase.get(row.caseName)!.push(row);
  }

  let allCasesPassed = true;
  const allJudgeScores: number[] = [];
  for (const rows of rowsByCase.values()) {
    // judgeScore is non-null IFF the run reached the judge step (which
    // happens IFF the run's programmatic checks passed). Treat that as
    // the per-run "programmatic ok" signal.
    const everyProgrammaticOk = rows.every((r) => r.judgeScore !== null);
    const scores = rows
      .map((r) => r.judgeScore)
      .filter((s): s is number => s !== null);
    const avg = scores.length > 0 ? scores.reduce((s, n) => s + n, 0) / scores.length : 0;
    const casePassed = everyProgrammaticOk && avg >= 7;
    if (!casePassed) allCasesPassed = false;
    allJudgeScores.push(...scores);
  }

  const passedRows = caseOutcomes.filter((c) => c.programmaticPass).length;
  const passRate = caseOutcomes.length === 0 ? 0 : (passedRows / caseOutcomes.length) * 100;
  const suiteAverageScore =
    allJudgeScores.length > 0
      ? allJudgeScores.reduce((s, n) => s + n, 0) / allJudgeScores.length
      : 0;

  return {
    caseOutcomes,
    passRate,
    overallSuitePass: allCasesPassed,
    suiteAverageScore,
  };
}
