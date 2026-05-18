/**
 * PHI-119 — Per-run detail.
 *
 * GET /api/admin/evals/suites/<slug>/runs/<runId>
 * → { run, caseRuns }
 *
 * Used by the History tab to expand a row and show per-case pass/fail
 * + duration + the failed-assertion error string for failing cases.
 *
 * The suite slug is validated against the run row so a wrong-slug
 * URL returns 404 instead of leaking cross-suite data.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminRequest, adminForbiddenResponse } from "@/lib/auth";
import { getSuite } from "@/lib/evals/registry";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ suite: string; runId: string }> },
) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();
  const { suite, runId } = await params;

  if (!getSuite(suite)) {
    return NextResponse.json({ error: `Unknown suite: ${suite}` }, { status: 404 });
  }

  const admin = getSupabaseAdminClient();

  const { data: run, error: runErr } = await admin
    .from("eval_suite_runs")
    .select("id, suite, started_at, finished_at, status, model, total_cost_usd, pass_rate, summary_score, notes, created_by")
    .eq("id", runId)
    .eq("suite", suite)
    .maybeSingle();

  if (runErr) {
    return NextResponse.json({ error: runErr.message }, { status: 500 });
  }
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const { data: caseRuns, error: caseErr } = await admin
    .from("eval_case_runs")
    .select("id, case_name, run_index, programmatic_pass, judge_score, judge_reasoning, output_snippet, cost_usd, duration_ms, error, created_at")
    .eq("suite_run_id", runId)
    .order("run_index", { ascending: true });

  if (caseErr) {
    return NextResponse.json({ error: caseErr.message }, { status: 500 });
  }

  return NextResponse.json({ run, caseRuns: caseRuns ?? [] });
}
