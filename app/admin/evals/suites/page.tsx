"use client";

/**
 * PHI-119/120 — Evals GUI suites surface.
 *
 * Card-per-suite picker + Run/History tabs. PHI-119 wired `family` only
 * (offline, ~100ms runs); PHI-120 (card 3) adds three paid suites
 * (location / recommendations / alternatives) and the cost-confirm
 * modal that fires before any paid run.
 *
 * The page lives at /admin/evals/suites (not as a tab inside /admin/evals)
 * per the PRD — the old per-test-case evals page stays put; this is the
 * new workbench surface.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { SuiteKind } from "@/lib/evals/registry";

// ── Types ──────────────────────────────────────────────────────────────────────

type LastRun = {
  status: string;
  startedAt: string;
  finishedAt: string | null;
  passRate: number | null;
  summaryScore: number | null;
  totalCostUsd: number | null;
};

type SuiteCard = {
  slug: string;
  title: string;
  description: string;
  kind: SuiteKind;
  costEstimateUsd: number;
  caseCount: number;
  runsPerCase: number;
  wired: boolean;
  cliScript: string;
  lastRun: LastRun | null;
};

type SuiteRunRow = {
  id: string;
  suite: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  model: string | null;
  total_cost_usd: number | null;
  pass_rate: number | null;
  summary_score: number | null;
  notes: string | null;
  created_by: string | null;
};

type CaseRunRow = {
  id: string;
  case_name: string;
  run_index: number;
  programmatic_pass: boolean | null;
  judge_score: number | null;
  judge_reasoning: string | null;
  output_snippet: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  error: string | null;
};

type RunSummary = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  passRate: number;
  summaryScore: number;
  totalCostUsd: number;
  // Family-specific (undefined for paid suites).
  totalAssertions?: number;
  passedAssertions?: number;
};

/** PHI-120 — Unified case outcome shape returned by every suite. */
type GuiCaseOutcome = {
  caseName: string;
  /** PHI-121 — 0..runsPerCase-1. Single-run suites set 0. */
  runIndex: number;
  programmaticPass: boolean;
  judgeScore: number | null;
  judgeReasoning: string | null;
  outputSnippet: string;
  costUsdEstimate: number;
  durationMs: number;
  errorMessage: string | null;
  assertionsPassed?: number;
  assertionsFailed?: number;
  failedAssertionLabels?: string[];
};

/** PHI-121 — anchors uses 0-10, country-destination + popular-picks use 0-5. */
function judgeScoreMaxForSuite(slug: string): 5 | 10 {
  return slug === "country-destination" || slug === "popular-picks" ? 5 : 10;
}

type UsageStatus = {
  anthropic: {
    warningLevel: "ok" | "warning" | "exceeded";
    percentUsed: number;
    spentUsd: number;
    limitUsd: number;
  };
  google: {
    warningLevel: "ok" | "warning" | "exceeded";
    percentUsed: number;
    spentUsd: number;
    limitUsd: number;
  };
};

// PRD-named states; only the subset reachable in cards 2-3 is populated below.
type RunState =
  | { kind: "idle" }
  | { kind: "confirming"; usage: UsageStatus | null; usageError: string | null }
  | { kind: "running"; startedAt: number }
  | { kind: "succeeded-pass"; run: RunSummary; cases: GuiCaseOutcome[] }
  | { kind: "succeeded-fail"; run: RunSummary; cases: GuiCaseOutcome[] }
  | { kind: "failed"; message: string };

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCost(n: number): string {
  if (n === 0) return "free";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function formatDurationMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function kindLabel(kind: SuiteKind): string {
  switch (kind) {
    case "offline":
      return "Offline";
    case "needs-api":
      return "Anthropic API";
    case "needs-dev-server":
      return "Needs dev server";
  }
}

function StatusDot({ status }: { status: string }) {
  const tone =
    status === "succeeded"
      ? "bg-[#2d7a4f]"
      : status === "failed"
        ? "bg-[#c0392b]"
        : status === "running"
          ? "bg-[#ba7517]"
          : status === "cancelled"
            ? "bg-[var(--text-muted)]"
            : "bg-[#1a6b7f]";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${tone}`} aria-label={status} />;
}

function PassFailPill({ passed }: { passed: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full ${
        passed ? "bg-[#eaf4ee] text-[#2d7a4f]" : "bg-[#fde8e8] text-[#c0392b]"
      }`}
    >
      {passed ? "✓ Pass" : "✗ Fail"}
    </span>
  );
}

// ── Suite picker ───────────────────────────────────────────────────────────────

function SuitePicker({
  suites,
  selectedSlug,
  onSelect,
}: {
  suites: SuiteCard[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {suites.map((s) => {
        const isSelected = s.slug === selectedSlug;
        const lastStatus = s.lastRun?.status;
        return (
          <button
            key={s.slug}
            onClick={() => onSelect(s.slug)}
            className={`text-left bg-white border rounded-2xl p-4 transition-colors ${
              isSelected
                ? "border-[#1a6b7f] ring-1 ring-[#1a6b7f]/30"
                : "border-[#e8e4de] hover:border-[#1a6b7f]/40"
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <code className="text-sm font-bold text-[var(--text-primary)]">{s.title}</code>
                {!s.wired && (
                  <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] bg-[#f0ede8] px-1.5 py-0.5 rounded-full">
                    placeholder
                  </span>
                )}
              </div>
              {lastStatus && <StatusDot status={lastStatus} />}
            </div>
            <p className="text-xs text-[var(--text-secondary)] mb-3 line-clamp-2">{s.description}</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <span className="text-[10px] uppercase tracking-widest bg-[#e8f4f6] text-[#1a6b7f] px-2 py-0.5 rounded-full">
                {kindLabel(s.kind)}
              </span>
              <span className="text-[10px] uppercase tracking-widest bg-[#f0ede8] text-[var(--text-muted)] px-2 py-0.5 rounded-full">
                {formatCost(s.costEstimateUsd)} / run
              </span>
              <span className="text-[10px] uppercase tracking-widest bg-[#f0ede8] text-[var(--text-muted)] px-2 py-0.5 rounded-full">
                {s.caseCount} cases{s.runsPerCase > 1 ? ` × ${s.runsPerCase}` : ""}
              </span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              Last run: {s.lastRun ? formatDate(s.lastRun.startedAt) : "never"}
            </p>
          </button>
        );
      })}
    </div>
  );
}

// ── Cost-confirm dialog (PHI-120) ──────────────────────────────────────────────

function CostConfirmDialog({
  suite,
  usage,
  usageError,
  onCancel,
  onConfirm,
}: {
  suite: SuiteCard;
  usage: UsageStatus | null;
  usageError: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const estimate = suite.costEstimateUsd;
  const exceeded = usage?.anthropic.warningLevel === "exceeded";
  const warning = usage?.anthropic.warningLevel === "warning";
  // Mirrors `ApiLimitBanner` + `checkApiLimit()`: when exceeded with hard
  // limit on, the per-route 429 would block the call anyway. Refuse here.
  const canRun = !exceeded;

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white border border-[#e8e4de] rounded-2xl p-6 max-w-md w-full">
        <h2 className="text-lg font-extrabold text-[var(--text-primary)] mb-1">
          Confirm paid run
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mb-5">
          <code className="text-[var(--text-primary)] font-semibold">{suite.title}</code> will
          call the Anthropic API. Realised cost gets logged back to this run when it finishes.
        </p>

        <div className="bg-[#f8f6f1] border border-[#e8e4de] rounded-xl p-4 mb-4 flex flex-col gap-2.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[var(--text-secondary)]">This run will use ~</span>
            <span className="font-bold text-[var(--text-primary)] tabular-nums">
              {formatCost(estimate)}
            </span>
          </div>
          {usage && (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[var(--text-secondary)]">You&apos;ve used</span>
                <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                  ${usage.anthropic.spentUsd.toFixed(2)} of ${usage.anthropic.limitUsd.toFixed(2)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[var(--text-secondary)]">After this run</span>
                <span
                  className={`font-semibold tabular-nums ${
                    exceeded || warning ? "text-[#ba7517]" : "text-[var(--text-primary)]"
                  }`}
                >
                  ~${(usage.anthropic.spentUsd + estimate).toFixed(2)} ·{" "}
                  {Math.round(
                    usage.anthropic.limitUsd > 0
                      ? ((usage.anthropic.spentUsd + estimate) / usage.anthropic.limitUsd) * 100
                      : 0,
                  )}
                  %
                </span>
              </div>
            </>
          )}
          {!usage && !usageError && (
            <p className="text-xs text-[var(--text-muted)] italic">Loading spend…</p>
          )}
          {usageError && (
            <p className="text-xs text-[#c0392b]">Couldn&apos;t load spend: {usageError}</p>
          )}
        </div>

        {exceeded && (
          <div className="bg-[#fde8e8] border border-[#c0392b]/30 rounded-xl p-3 mb-4 text-xs text-[#c0392b]">
            Anthropic limit reached. Bump the limit at{" "}
            <Link href="/admin/usage" className="underline font-semibold">
              /admin/usage
            </Link>{" "}
            before running.
          </div>
        )}
        {warning && !exceeded && (
          <div className="bg-[#fef3e2] border border-[#ba7517]/30 rounded-xl p-3 mb-4 text-xs text-[#ba7517]">
            You&apos;re at {Math.round(usage?.anthropic.percentUsed ?? 0)}% of your Anthropic
            budget this month.
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-4 py-2 rounded-xl"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canRun}
            className="rounded-2xl bg-[#1a6b7f] text-white font-bold px-5 py-2.5 hover:bg-[#155a6b] transition-colors disabled:opacity-30 text-sm"
          >
            Run →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Run tab ────────────────────────────────────────────────────────────────────

function RunTab({ suite }: { suite: SuiteCard }) {
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);

  // Tick the elapsed counter while the run is in flight.
  useEffect(() => {
    if (state.kind !== "running") return;
    const start = state.startedAt;
    const interval = setInterval(() => setElapsedMs(Date.now() - start), 100);
    return () => clearInterval(interval);
  }, [state]);

  const triggerRun = useCallback(async () => {
    setState({ kind: "running", startedAt: Date.now() });
    setElapsedMs(0);
    try {
      const res = await fetch(`/api/admin/evals/suites/${suite.slug}/runs`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setState({ kind: "failed", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      const data = (await res.json()) as { run: RunSummary; caseRuns: GuiCaseOutcome[] };
      const allPassed = data.run.status === "succeeded";
      setState({
        kind: allPassed ? "succeeded-pass" : "succeeded-fail",
        run: data.run,
        cases: data.caseRuns,
      });
    } catch (err) {
      setState({
        kind: "failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [suite.slug]);

  const openConfirm = useCallback(async () => {
    // PHI-120 — offline suites skip the dialog and run immediately.
    if (suite.kind === "offline") {
      void triggerRun();
      return;
    }
    // Paid suites: open dialog in "confirming" state, then fetch fresh
    // spend numbers. Hard constraint: reload spend on every open — no
    // stickiness across multiple Run clicks.
    setState({ kind: "confirming", usage: null, usageError: null });
    try {
      const res = await fetch("/api/usage/status");
      if (!res.ok) {
        setState({ kind: "confirming", usage: null, usageError: `HTTP ${res.status}` });
        return;
      }
      const usage = (await res.json()) as UsageStatus;
      setState({ kind: "confirming", usage, usageError: null });
    } catch (err) {
      setState({
        kind: "confirming",
        usage: null,
        usageError: err instanceof Error ? err.message : String(err),
      });
    }
  }, [suite.kind, triggerRun]);

  if (!suite.wired) {
    return (
      <div className="bg-white border border-[#e8e4de] rounded-2xl p-6">
        <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">Not yet wired in the GUI</p>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          This suite is in the picker so card 3+ can layer it on, but the in-browser
          runner isn&apos;t live yet. Run it from the terminal:
        </p>
        <code className="block bg-[#f0ede8] text-[var(--text-primary)] text-sm font-mono px-3 py-2 rounded-xl">
          npm run {suite.cliScript}
        </code>
        {suite.kind === "needs-dev-server" && (
          <p className="text-xs text-[var(--text-muted)] mt-3">
            Suite hits a Rise API route — `npm run dev` must be up before running.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Run trigger + state badge */}
      <div className="bg-white border border-[#e8e4de] rounded-2xl p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1">
              State
            </p>
            <div className="flex items-center gap-2">
              <RunStateBadge state={state} />
              {state.kind === "running" && (
                <span className="text-sm text-[var(--text-muted)]">
                  · {Math.floor(elapsedMs / 1000)}s elapsed
                </span>
              )}
            </div>
          </div>
          <button
            onClick={openConfirm}
            disabled={state.kind === "running" || state.kind === "confirming"}
            className="rounded-2xl bg-[#1a6b7f] text-white font-bold px-6 py-3 hover:bg-[#155a6b] transition-colors disabled:opacity-30 text-sm"
          >
            {state.kind === "running"
              ? "Running…"
              : state.kind === "idle"
                ? "Run →"
                : state.kind === "confirming"
                  ? "Confirming…"
                  : "Run again →"}
          </button>
        </div>
        {suite.kind === "needs-dev-server" && (
          <p className="text-[11px] text-[var(--text-muted)] mt-3">
            Suite calls a local Rise API route. On Vercel the loopback runs against the same
            deployment; locally it goes through your dev server on port 3000.
          </p>
        )}
      </div>

      {/* Results (post-run) */}
      {(state.kind === "succeeded-pass" || state.kind === "succeeded-fail") && (
        <div className="bg-white border border-[#e8e4de] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1">
                Result
              </p>
              <p className="text-sm text-[var(--text-primary)]">
                {/* Family carries assertions; paid suites carry judge scores. */}
                {/* PHI-121 — multi-run suites count case-runs (rows), not unique cases. */}
                {state.run.totalAssertions !== undefined ? (
                  <>
                    {state.run.passedAssertions} of {state.run.totalAssertions} assertions passed
                    {" · "}
                    {state.run.passRate.toFixed(0)}% case pass rate
                  </>
                ) : suite.runsPerCase > 1 ? (
                  <>
                    {state.cases.filter((c) => c.programmaticPass).length} of {state.cases.length}{" "}
                    case-runs passed ({suite.caseCount} cases × {suite.runsPerCase} runs)
                    {" · "}
                    {state.run.passRate.toFixed(0)}% pass rate
                    {state.run.totalCostUsd > 0 && (
                      <>
                        {" · "}
                        realised cost {formatCost(state.run.totalCostUsd)}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {state.cases.filter((c) => c.programmaticPass).length} of {state.cases.length}{" "}
                    cases passed
                    {" · "}
                    {state.run.passRate.toFixed(0)}% pass rate
                    {state.run.totalCostUsd > 0 && (
                      <>
                        {" · "}
                        realised cost {formatCost(state.run.totalCostUsd)}
                      </>
                    )}
                  </>
                )}
              </p>
            </div>
            <PassFailPill passed={state.kind === "succeeded-pass"} />
          </div>
          <CaseList cases={state.cases} suite={suite} />
        </div>
      )}

      {state.kind === "failed" && (
        <div className="bg-[#fde8e8] border border-[#c0392b]/30 rounded-2xl p-5">
          <p className="text-sm font-semibold text-[#c0392b] mb-1">Run failed</p>
          <p className="text-sm text-[#7a2418] font-mono break-words">{state.message}</p>
        </div>
      )}

      {state.kind === "confirming" && (
        <CostConfirmDialog
          suite={suite}
          usage={state.usage}
          usageError={state.usageError}
          onCancel={() => setState({ kind: "idle" })}
          onConfirm={() => void triggerRun()}
        />
      )}
    </div>
  );
}

function RunStateBadge({ state }: { state: RunState }) {
  switch (state.kind) {
    case "idle":
      return <span className="text-sm text-[var(--text-muted)] italic">idle — click Run to start</span>;
    case "confirming":
      return (
        <span className="text-sm text-[var(--text-muted)] italic">awaiting cost confirmation…</span>
      );
    case "running":
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#ba7517]">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#ba7517] animate-pulse" />
          running
        </span>
      );
    case "succeeded-pass":
      return <PassFailPill passed={true} />;
    case "succeeded-fail":
      return <PassFailPill passed={false} />;
    case "failed":
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#c0392b]">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#c0392b]" />
          failed
        </span>
      );
  }
}

function CaseList({ cases, suite }: { cases: GuiCaseOutcome[]; suite: SuiteCard }) {
  // PHI-121 — multi-run suites group their case-runs and render a per-case
  // card showing "Run 1 · Run 2 · Run 3 → avg" per the CLI's format.
  // Single-run suites keep the pre-PHI-121 flat card-per-row layout.
  if (suite.runsPerCase > 1) {
    return <MultiRunCaseList cases={cases} suite={suite} />;
  }
  return <SingleRunCaseList cases={cases} suite={suite} />;
}

function SingleRunCaseList({ cases, suite }: { cases: GuiCaseOutcome[]; suite: SuiteCard }) {
  const judgeMax = judgeScoreMaxForSuite(suite.slug);
  return (
    <div className="flex flex-col gap-2">
      {cases.map((c) => {
        const isJudgeSuite = c.judgeScore !== null;
        return (
          <div
            key={`${c.caseName}-${c.runIndex}`}
            className={`border rounded-xl p-3 ${
              c.programmaticPass ? "border-[#e8e4de] bg-white" : "border-[#c0392b]/30 bg-[#fff5f5]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{c.caseName}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {isJudgeSuite ? (
                    <>
                      Judge score: {c.judgeScore}/{judgeMax} · {formatDurationMs(c.durationMs)}
                    </>
                  ) : (
                    <>
                      {c.assertionsPassed} /{" "}
                      {(c.assertionsPassed ?? 0) + (c.assertionsFailed ?? 0)} assertions
                      {" · "}
                      {formatDurationMs(c.durationMs)}
                    </>
                  )}
                </p>
              </div>
              <PassFailPill passed={c.programmaticPass} />
            </div>
            {/* Family-style failed-assertion list */}
            {!c.programmaticPass &&
              c.failedAssertionLabels &&
              c.failedAssertionLabels.length > 0 && (
                <ul className="mt-2 text-xs text-[#c0392b] list-disc list-inside">
                  {c.failedAssertionLabels.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              )}
            {/* Judge reasoning surfaced on failures for the paid suites */}
            {isJudgeSuite && !c.programmaticPass && c.judgeReasoning && (
              <p className="mt-2 text-xs text-[#7a2418] italic">{c.judgeReasoning}</p>
            )}
            {/* Hard error (API down, network, etc.) */}
            {c.errorMessage && !c.failedAssertionLabels?.length && (
              <p className="mt-2 text-xs text-[#c0392b] break-words">{c.errorMessage}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * PHI-121 — Multi-run case list.
 *
 * Groups `cases` by `caseName` and renders one card per group with:
 *   - Aggregate pass/fail pill (case-level gate, suite-specific)
 *   - "Run 1: X · Run 2: Y · Run 3: Z → avg N" summary line
 *   - Per-run details, expandable on click — programmatic-failure first,
 *     judge reasoning + scoring second
 *
 * The case-level pass rule differs by suite:
 *   - anchors: every run programmatic OK AND mean judge score ≥ 7/10
 *   - country-destination / popular-picks: mean judge score ≥ 3/5 (per-case floor)
 *
 * Computed locally from row data so the page renders consistent verdicts
 * without re-deriving the suite-level pass via API.
 */
function MultiRunCaseList({ cases, suite }: { cases: GuiCaseOutcome[]; suite: SuiteCard }) {
  const judgeMax = judgeScoreMaxForSuite(suite.slug);
  // Stable group order: first appearance of each caseName preserves the
  // CLI's natural ordering (anchors PHI-90 #1, #2, …).
  const groupMap = new Map<string, GuiCaseOutcome[]>();
  for (const c of cases) {
    const list = groupMap.get(c.caseName);
    if (list) list.push(c);
    else groupMap.set(c.caseName, [c]);
  }
  const groups = Array.from(groupMap.entries()).map(([caseName, rows]) => ({
    caseName,
    rows: rows.slice().sort((a, b) => a.runIndex - b.runIndex),
  }));

  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => (
        <MultiRunCaseGroup
          key={g.caseName}
          caseName={g.caseName}
          rows={g.rows}
          suite={suite}
          judgeMax={judgeMax}
        />
      ))}
    </div>
  );
}

function MultiRunCaseGroup({
  caseName,
  rows,
  suite,
  judgeMax,
}: {
  caseName: string;
  rows: GuiCaseOutcome[];
  suite: SuiteCard;
  judgeMax: 5 | 10;
}) {
  const [expanded, setExpanded] = useState(false);

  // Case-level gate derived locally so the pill matches what the
  // executor told the runs route. judgeScore is null when the judge
  // step didn't run (programmatic failure) — those rows count as
  // programmatic-fail in any per-suite gate.
  const everyRunReachedJudge = rows.every((r) => r.judgeScore !== null);
  const judgeScores = rows
    .map((r) => r.judgeScore)
    .filter((s): s is number => s !== null);
  const avg =
    judgeScores.length > 0 ? judgeScores.reduce((s, n) => s + n, 0) / judgeScores.length : 0;

  let casePassed: boolean;
  if (suite.slug === "anchors") {
    // 0-10 scale, ≥7 case-level mean AND every run programmatic OK.
    casePassed = everyRunReachedJudge && avg >= 7;
  } else if (suite.slug === "country-destination" || suite.slug === "popular-picks") {
    // 0-5 scale, ≥3/5 case-level mean (PASS_FLOOR).
    casePassed = avg >= 3;
  } else {
    // Defensive: any future multi-run suite falls back to "every row passed".
    casePassed = rows.every((r) => r.programmaticPass);
  }

  const runScoreLine = rows
    .map((r, i) =>
      r.judgeScore !== null
        ? `Run ${i + 1}: ${r.judgeScore}/${judgeMax}`
        : `Run ${i + 1}: ✗ programmatic`,
    )
    .join(" · ");

  const totalMs = rows.reduce((s, r) => s + r.durationMs, 0);

  return (
    <div
      className={`border rounded-xl ${
        casePassed ? "border-[#e8e4de] bg-white" : "border-[#c0392b]/30 bg-[#fff5f5]"
      }`}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left p-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{caseName}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {runScoreLine} → avg {avg.toFixed(1)}/{judgeMax}
              {" · "}
              {formatDurationMs(totalMs)} total
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <PassFailPill passed={casePassed} />
            <span className="text-[var(--text-muted)] text-xs">{expanded ? "▾" : "▸"}</span>
          </div>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-[#e8e4de] p-3 flex flex-col gap-2">
          {rows.map((r) => (
            <div
              key={r.runIndex}
              className={`text-xs px-3 py-2 rounded-lg border ${
                r.programmaticPass
                  ? "bg-white border-[#e8e4de]"
                  : "bg-[#fff8f5] border-[#c0392b]/20"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[var(--text-primary)]">
                  Run {r.runIndex + 1}
                </span>
                <div className="flex items-center gap-2">
                  {r.judgeScore !== null && (
                    <span className="text-[var(--text-muted)] tabular-nums">
                      {r.judgeScore}/{judgeMax}
                    </span>
                  )}
                  <span className="text-[var(--text-muted)]">
                    {formatDurationMs(r.durationMs)}
                  </span>
                  <PassFailPill passed={r.programmaticPass} />
                </div>
              </div>
              {r.errorMessage && (
                <p className="mt-1.5 text-[#7a2418] break-words">{r.errorMessage}</p>
              )}
              {r.judgeReasoning && r.programmaticPass && (
                <p className="mt-1.5 text-[var(--text-muted)] italic">{r.judgeReasoning}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── History tab ────────────────────────────────────────────────────────────────

function HistoryTab({ suite }: { suite: SuiteCard }) {
  const [runs, setRuns] = useState<SuiteRunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedCases, setExpandedCases] = useState<CaseRunRow[] | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/evals/suites/${suite.slug}/runs`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { runs: SuiteRunRow[] };
      setRuns(data.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [suite.slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggleExpand(runId: string) {
    if (expanded === runId) {
      setExpanded(null);
      setExpandedCases(null);
      return;
    }
    setExpanded(runId);
    setExpandedCases(null);
    setExpandedLoading(true);
    try {
      const res = await fetch(`/api/admin/evals/suites/${suite.slug}/runs/${runId}`);
      if (res.ok) {
        const data = (await res.json()) as { caseRuns: CaseRunRow[] };
        setExpandedCases(data.caseRuns);
      }
    } finally {
      setExpandedLoading(false);
    }
  }

  if (error) {
    return <p className="text-sm text-[#c0392b]">Error: {error}</p>;
  }
  if (runs === null) {
    return <p className="text-sm text-[var(--text-muted)]">Loading…</p>;
  }
  if (runs.length === 0) {
    return (
      <div className="bg-white border border-[#e8e4de] rounded-2xl p-6">
        <p className="text-sm text-[var(--text-secondary)]">
          No runs yet. Switch to the Run tab to execute this suite.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">
          Showing the {runs.length} most recent run{runs.length === 1 ? "" : "s"}.
        </p>
        <button
          onClick={() => void refresh()}
          className="text-xs text-[#1a6b7f] hover:underline font-semibold"
        >
          Refresh
        </button>
      </div>
      <div className="bg-white border border-[#e8e4de] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#f8f6f1] border-b border-[#e8e4de]">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                Started
              </th>
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                Status
              </th>
              <th className="text-right px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                Pass rate
              </th>
              <th className="text-right px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                Cost
              </th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const isOpen = expanded === r.id;
              return (
                <FragmentRow
                  key={r.id}
                  row={r}
                  isOpen={isOpen}
                  expandedCases={isOpen ? expandedCases : null}
                  expandedLoading={isOpen && expandedLoading}
                  onToggle={() => void toggleExpand(r.id)}
                  suite={suite}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({
  row,
  isOpen,
  expandedCases,
  expandedLoading,
  onToggle,
  suite,
}: {
  row: SuiteRunRow;
  isOpen: boolean;
  expandedCases: CaseRunRow[] | null;
  expandedLoading: boolean;
  onToggle: () => void;
  suite: SuiteCard;
}) {
  // PHI-121 — anchors uses 0-10 judge; country-destination + popular-picks 0-5.
  const judgeMax = judgeScoreMaxForSuite(suite.slug);
  return (
    <>
      <tr className="border-b border-[#e8e4de] last:border-b-0 cursor-pointer hover:bg-[#f8f6f1]" onClick={onToggle}>
        <td className="px-4 py-3 text-[var(--text-primary)]">{formatDate(row.started_at)}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <StatusDot status={row.status} />
            <span className="text-[var(--text-secondary)] capitalize">{row.status}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-primary)]">
          {row.pass_rate != null ? `${Number(row.pass_rate).toFixed(0)}%` : "—"}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-muted)]">
          {row.total_cost_usd != null ? formatCost(Number(row.total_cost_usd)) : "—"}
        </td>
        <td className="px-4 py-3 text-[var(--text-muted)]">{isOpen ? "▾" : "▸"}</td>
      </tr>
      {isOpen && (
        <tr className="bg-[#f8f6f1]">
          <td colSpan={5} className="px-4 py-3">
            {expandedLoading && (
              <p className="text-xs text-[var(--text-muted)] italic">Loading cases…</p>
            )}
            {!expandedLoading && expandedCases && (
              <div className="flex flex-col gap-1.5">
                {expandedCases.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-start justify-between gap-3 text-xs px-3 py-2 rounded-lg ${
                      c.programmatic_pass
                        ? "bg-white border border-[#e8e4de]"
                        : "bg-[#fff5f5] border border-[#c0392b]/30"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[var(--text-primary)]">
                        {c.case_name}
                        {suite.runsPerCase > 1 && (
                          <span className="text-[var(--text-muted)] font-normal">
                            {" "}
                            · run {c.run_index + 1}
                          </span>
                        )}
                      </p>
                      {c.judge_score != null && (
                        <p className="text-[var(--text-muted)] mt-0.5">
                          Judge: {Number(c.judge_score).toFixed(1)}/{judgeMax}
                        </p>
                      )}
                      {c.error && (
                        <p className="text-[#c0392b] mt-0.5 break-words">{c.error}</p>
                      )}
                    </div>
                    <span className="text-[var(--text-muted)] shrink-0">
                      {formatDurationMs(c.duration_ms)}
                    </span>
                    <PassFailPill passed={c.programmatic_pass === true} />
                  </div>
                ))}
              </div>
            )}
            {!expandedLoading && expandedCases && expandedCases.length === 0 && (
              <p className="text-xs text-[var(--text-muted)] italic">
                No case rows recorded for this run.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function EvalsSuitesPage() {
  const [suites, setSuites] = useState<SuiteCard[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"run" | "history">("run");
  const [error, setError] = useState<string | null>(null);
  const [pickerVersion, setPickerVersion] = useState(0);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/evals/suites");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { suites: SuiteCard[] };
      setSuites(data.suites);
      // Default to the first wired suite on first load.
      if (selected === null) {
        const firstWired = data.suites.find((s) => s.wired);
        if (firstWired) setSelected(firstWired.slug);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selected]);

  useEffect(() => {
    void refresh();
  }, [refresh, pickerVersion]);

  const selectedSuite = suites?.find((s) => s.slug === selected) ?? null;

  return (
    <main className="min-h-screen bg-[#f8f6f1] px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight mb-2">Eval suites</h1>
            <p className="text-[var(--text-secondary)]">
              Run any wired eval suite from the browser. Card 3 adds the three single-shot
              Anthropic-paid suites alongside the offline family suite.
            </p>
          </div>
          <Link
            href="/admin/evals"
            className="text-sm text-[#1a6b7f] hover:underline font-semibold"
          >
            ← Per-case evals
          </Link>
        </div>

        {error && (
          <div className="mb-6 bg-[#fde8e8] border border-[#c0392b]/30 rounded-2xl p-4 text-sm text-[#c0392b]">
            Error loading suites: {error}
          </div>
        )}

        {suites === null && !error && (
          <p className="text-sm text-[var(--text-muted)]">Loading suites…</p>
        )}

        {suites && (
          <>
            <div className="mb-8">
              <SuitePicker
                suites={suites}
                selectedSlug={selected}
                onSelect={(slug) => {
                  setSelected(slug);
                  setTab("run");
                }}
              />
            </div>

            {selectedSuite && (
              <div>
                <div className="mb-6 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex gap-1 bg-white border border-[#e8e4de] rounded-2xl p-1 w-fit">
                    {(["run", "history"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors capitalize ${
                          tab === t
                            ? "bg-[#1a6b7f] text-white"
                            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setPickerVersion((v) => v + 1)}
                    className="text-xs text-[#1a6b7f] hover:underline font-semibold"
                  >
                    ↻ Refresh picker
                  </button>
                </div>

                {tab === "run" && <RunTab suite={selectedSuite} />}
                {tab === "history" && <HistoryTab suite={selectedSuite} />}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
