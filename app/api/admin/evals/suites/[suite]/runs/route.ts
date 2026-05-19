/**
 * PHI-119 — History list for one suite.
 *
 * GET  /api/admin/evals/suites/<slug>/runs
 *  → { runs: SuiteRunRow[] }     (most recent first, capped at 50)
 *
 * POST /api/admin/evals/suites/<slug>/runs
 *  → { run, caseRuns }            (executes the suite synchronously)
 *
 * PHI-120 (card 3) extended the POST dispatcher to handle three paid
 * suites that hit local API routes — location / recommendations /
 * alternatives. The inbound admin's `site_auth` cookie is forwarded so
 * the loopback fetches pass middleware, and the new suite_run row's id
 * is sent as `X-Suite-Run-Id` so the routes' `logApiUsage` calls tag
 * their `api_usage` rows with it. At finish, the route SUMs
 * `api_usage.estimated_cost_usd` keyed by `suite_run_id` and writes the
 * realised total back to `eval_suite_runs.total_cost_usd`.
 *
 * Default Vercel function timeout (10s/60s by tier) is too short for the
 * paid suites (alternatives ≈ 5 × ~5s, recommendations ≈ 3 × ~20s).
 * `maxDuration = 300` puts the ceiling at Vercel's Pro-tier max.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminRequest, adminForbiddenResponse } from "@/lib/auth";
import { getSuite, runFamilySuiteForGui, getGuiSuiteExecutor } from "@/lib/evals/registry";
import type { GuiSuiteOutcome } from "@/lib/evals/types";

// PHI-120 — paid suites take much longer than family (offline ~100ms).
// Recommendations streams 3 × Sonnet completions + 3 × Opus judges;
// alternatives runs 5 × of each. Bump the ceiling so Vercel doesn't
// terminate the route mid-suite.
export const maxDuration = 300;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ suite: string }> },
) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();
  const { suite } = await params;

  if (!getSuite(suite)) {
    return NextResponse.json({ error: `Unknown suite: ${suite}` }, { status: 404 });
  }

  const admin = getSupabaseAdminClient();
  const { data: runs, error } = await admin
    .from("eval_suite_runs")
    .select("id, suite, started_at, finished_at, status, model, total_cost_usd, pass_rate, summary_score, notes, created_by")
    .eq("suite", suite)
    .order("started_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ runs: runs ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ suite: string }> },
) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();
  const { suite } = await params;

  const descriptor = getSuite(suite);
  if (!descriptor) {
    return NextResponse.json({ error: `Unknown suite: ${suite}` }, { status: 404 });
  }

  if (!descriptor.wired) {
    // The placeholder in the GUI never offers a Run button for these,
    // but a curl from the terminal could land here — answer honestly.
    return NextResponse.json(
      {
        error: "not_wired",
        message: `Suite '${suite}' is in the picker but not yet wired in the GUI. Run \`npm run ${descriptor.cliScript}\` from the terminal.`,
      },
      { status: 409 },
    );
  }

  const admin = getSupabaseAdminClient();

  // 1. Insert the suite_run row in `running` state. We update it to
  // succeeded/failed/etc. once the work finishes.
  const startedAt = new Date().toISOString();
  const { data: runRow, error: insertErr } = await admin
    .from("eval_suite_runs")
    .insert({
      suite,
      started_at: startedAt,
      status: "running",
      created_by: "philip",
      total_cost_usd: 0,
    })
    .select("id")
    .single();

  if (insertErr || !runRow) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to create suite_run" },
      { status: 500 },
    );
  }

  const suiteRunId = runRow.id as string;

  // 2. Execute the suite. Offline suites (family) need no opts; paid
  // suites need the inbound origin + cookie + suite_run_id so they can
  // loop back through middleware and tag their api_usage rows.
  try {
    let outcome: GuiSuiteOutcome;
    if (suite === "family") {
      outcome = runFamilySuiteForGui();
    } else {
      const executor = getGuiSuiteExecutor(suite);
      if (!executor) {
        // Defensive: a registry entry can be wired:true without a paired
        // executor only via developer error. Surface explicitly.
        throw new Error(`Suite '${suite}' marked wired but no GUI executor registered.`);
      }
      outcome = await executor({
        baseUrl: req.nextUrl.origin,
        authCookie: req.headers.get("cookie"),
        suiteRunId,
      });
    }

    // PHI-120 — persist the unified case outcomes. Both offline + paid
    // suites flow through the same row shape; `judge_score` is null for
    // offline cases, `programmatic_pass` is the aggregate boolean for
    // both flavours.
    //
    // PHI-121 — multi-run suites supply an explicit `runIndex` per row
    // (anchors: 0/1/2 per case_name; country-destination: same). The
    // single-run suites set runIndex=0. The fallback to array-index
    // shouldn't trip anymore but is left for defence-in-depth.
    const caseRunRows = outcome.caseOutcomes.map((c, i) => ({
      suite_run_id: suiteRunId,
      case_name: c.caseName,
      run_index: c.runIndex ?? i,
      programmatic_pass: c.programmaticPass,
      judge_score: c.judgeScore,
      judge_reasoning: c.judgeReasoning,
      output_snippet: c.outputSnippet,
      cost_usd: c.costUsdEstimate,
      duration_ms: c.durationMs,
      error: c.errorMessage,
    }));

    const { error: caseErr } = await admin
      .from("eval_case_runs")
      .insert(caseRunRows);

    if (caseErr) throw new Error(`case_runs insert failed: ${caseErr.message}`);

    // PHI-121 — multi-run suites with composite gates (anchors,
    // country-destination, popular-picks) supply `overallSuitePass`
    // because their case-level rule is more than "every row passed"
    // (anchors needs mean judge ≥7; country-destination + popular-picks
    // need the suite avg ≥ PASS_AVG). Single-run suites omit it and we
    // fall back to the row-level "every passed" derivation.
    const allPassed =
      outcome.overallSuitePass ??
      outcome.caseOutcomes.every((c) => c.programmaticPass);
    const status = allPassed ? "succeeded" : "failed";

    // 3. Roll up realised cost from api_usage rows tagged with this
    // suite_run_id. Offline suites won't have any rows (no Anthropic
    // calls) so the SUM is null → 0.
    let realisedCostUsd = 0;
    const { data: costRows, error: costErr } = await admin
      .from("api_usage")
      .select("estimated_cost_usd")
      .eq("suite_run_id", suiteRunId);
    if (costErr) {
      // Cost rollup is non-fatal — the suite already ran. Log but don't
      // throw away the result.
      console.error("[suites/runs] cost rollup failed:", costErr.message);
    } else {
      realisedCostUsd = (costRows ?? []).reduce(
        (sum, row) => sum + (parseFloat(String(row.estimated_cost_usd)) || 0),
        0,
      );
    }

    // Summary score: paid suites use the mean judge score, rescaled to
    // 0-100 for the table column. Anchors uses a 0-10 rubric; country-
    // destination + popular-picks use 0-5. The suite executor signals
    // the scale by populating `suiteAverageScore` and we infer 5-vs-10
    // from the suite slug — only three multi-run suites use 0-5 and
    // they're an exhaustive set here. Offline suites mirror pass rate.
    let summaryScore = outcome.passRate;
    if (outcome.suiteAverageScore !== undefined) {
      const isFiveScale =
        suite === "country-destination" || suite === "popular-picks";
      const scaleMax = isFiveScale ? 5 : 10;
      summaryScore = (outcome.suiteAverageScore / scaleMax) * 100;
    } else {
      const judgeScores = outcome.caseOutcomes
        .map((c) => c.judgeScore)
        .filter((s): s is number => typeof s === "number");
      if (judgeScores.length > 0) {
        const meanJudge = judgeScores.reduce((s, n) => s + n, 0) / judgeScores.length;
        summaryScore = (meanJudge / 10) * 100; // 0-10 → 0-100
      }
    }

    const finishedAt = new Date().toISOString();
    const { error: updateErr } = await admin
      .from("eval_suite_runs")
      .update({
        finished_at: finishedAt,
        status,
        pass_rate: outcome.passRate,
        summary_score: summaryScore,
        total_cost_usd: realisedCostUsd,
      })
      .eq("id", suiteRunId);

    if (updateErr) throw new Error(`suite_run update failed: ${updateErr.message}`);

    return NextResponse.json({
      run: {
        id: suiteRunId,
        suite,
        startedAt,
        finishedAt,
        status,
        passRate: outcome.passRate,
        summaryScore,
        totalCostUsd: realisedCostUsd,
        // Family-specific (omitted for paid suites — undefined deserialises cleanly).
        totalAssertions: outcome.totalAssertions,
        passedAssertions: outcome.passedAssertions,
      },
      caseRuns: outcome.caseOutcomes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort failure marker so the History table doesn't show a
    // perpetually "running" row. Errors in the update itself are swallowed
    // because the original error is what we want to surface.
    await admin
      .from("eval_suite_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "failed",
        notes: message.slice(0, 500),
      })
      .eq("id", suiteRunId);

    return NextResponse.json(
      { error: message, runId: suiteRunId },
      { status: 500 },
    );
  }
}
