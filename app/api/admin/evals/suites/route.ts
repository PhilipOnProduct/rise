/**
 * PHI-119 — Suites picker list.
 *
 * GET /api/admin/evals/suites
 * → { suites: Array<SuiteDescriptor & { lastRun: LastRunSummary | null }> }
 *
 * The page renders one card per suite with: name, cost estimate, last
 * run timestamp, last run pass/fail dot. We collapse the "last run" to
 * a single per-suite row server-side rather than streaming every
 * historical row to the browser.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminRequest, adminForbiddenResponse } from "@/lib/auth";
import { SUITES } from "@/lib/evals/registry";

type LastRunRow = {
  suite: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  pass_rate: number | null;
  summary_score: number | null;
  total_cost_usd: number | null;
};

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();

  const admin = getSupabaseAdminClient();
  // Pull recent rows per suite. We over-fetch (200 rows total) then
  // reduce client-side to the latest one per suite — simpler than a
  // window function and the volume here is tiny by design (one row
  // per user-clicked Run).
  const { data, error } = await admin
    .from("eval_suite_runs")
    .select("suite, status, started_at, finished_at, pass_rate, summary_score, total_cost_usd")
    .order("started_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const lastBySuite = new Map<string, LastRunRow>();
  for (const row of (data ?? []) as LastRunRow[]) {
    if (!lastBySuite.has(row.suite)) lastBySuite.set(row.suite, row);
  }

  const suites = SUITES.map((s) => {
    const last = lastBySuite.get(s.slug);
    return {
      ...s,
      lastRun: last
        ? {
            status: last.status,
            startedAt: last.started_at,
            finishedAt: last.finished_at,
            passRate: last.pass_rate,
            summaryScore: last.summary_score,
            totalCostUsd: last.total_cost_usd,
          }
        : null,
    };
  });

  return NextResponse.json({ suites });
}
