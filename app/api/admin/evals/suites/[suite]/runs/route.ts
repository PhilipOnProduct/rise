/**
 * PHI-119 — History list for one suite.
 *
 * GET  /api/admin/evals/suites/<slug>/runs
 *  → { runs: SuiteRunRow[] }     (most recent first, capped at 50)
 *
 * POST /api/admin/evals/suites/<slug>/runs
 *  → { run, caseRuns }            (executes the suite synchronously)
 *
 * The POST handler is the run trigger. Card 2 wires only `family`
 * (offline, runs in ~100ms — synchronous response is fine). Any other
 * slug returns 409 with a "not yet wired" hint; card 3 takes over.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminRequest, adminForbiddenResponse } from "@/lib/auth";
import { getSuite, runFamilySuiteForGui } from "@/lib/evals/registry";

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

  if (suite !== "family") {
    // Defensive: only `family` is wired in card 2. If we widen `wired:true`
    // in the registry without adding the executor branch here, surface
    // it as a 500 rather than silently 200-with-empty.
    return NextResponse.json(
      { error: `Suite '${suite}' marked wired but no GUI executor implemented.` },
      { status: 500 },
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

  // 2. Execute the suite. If this throws, mark the run failed and surface.
  try {
    const outcome = runFamilySuiteForGui();

    const caseRunRows = outcome.caseOutcomes.map((c, i) => ({
      suite_run_id: suiteRunId,
      case_name: c.caseName,
      run_index: i,
      programmatic_pass: c.programmaticPass,
      judge_score: null,
      judge_reasoning: null,
      output_snippet: c.outputSnippet,
      cost_usd: 0,
      duration_ms: c.durationMs,
      error: c.programmaticPass
        ? null
        : `Failed assertions: ${c.failedAssertionLabels.join(" | ")}`,
    }));

    const { error: caseErr } = await admin
      .from("eval_case_runs")
      .insert(caseRunRows);

    if (caseErr) throw new Error(`case_runs insert failed: ${caseErr.message}`);

    const allPassed = outcome.caseOutcomes.every((c) => c.programmaticPass);
    const status = allPassed ? "succeeded" : "failed";

    const finishedAt = new Date().toISOString();
    const { error: updateErr } = await admin
      .from("eval_suite_runs")
      .update({
        finished_at: finishedAt,
        status,
        pass_rate: outcome.passRate,
        // Family has no LLM-judge — summary_score mirrors the assertion
        // pass rate (0–100) so the History table has a sortable column
        // even for offline suites.
        summary_score: outcome.passRate,
        total_cost_usd: 0,
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
