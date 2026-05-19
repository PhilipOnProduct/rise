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

import { useState, useEffect, useCallback, useMemo } from "react";
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

// ── Compare tab (PHI-122) ──────────────────────────────────────────────────────
//
// Diff two runs of the same suite, with explicit variance bands for multi-run
// suites so a single-run delta inside both runs' min..max ranges renders as
// `noise`, not `regression`. The PHI-42 incident is the canonical example —
// same prompt, different runs, different failures — and the entire point of
// this surface is to keep that kind of noise from generating false alarms.
//
// Data model: one CaseAggregate per (run × case_name), collapsing the N rows
// from runsPerCase>1 suites into a single { mean, min, max, runs } record.
// Single-run suites produce a degenerate aggregate where min === max === mean.

type CaseAggregate = {
  scores: number[];               // judge scores (filtered to non-null) in run_index order
  mean: number | null;            // null if no judge scores at all (offline / family suite)
  min: number | null;
  max: number | null;
  programmaticPasses: boolean[];  // programmatic_pass per run row
  reasonings: (string | null)[];  // judge_reasoning per run row, in run_index order
  errors: (string | null)[];      // error string per run row (carries "Failed assertions: …" for family)
};

type CaseClassification =
  | "programmatic-flip-regression"  // pass → fail (highest-priority red row)
  | "programmatic-flip-improvement" // fail → pass
  | "regression"                    // candidate mean < baseline mean, no overlap on multi-run
  | "improvement"                   // candidate mean > baseline mean, no overlap on multi-run
  | "noise"                         // multi-run bands overlap; treat as within-noise
  | "unchanged"                     // single-run, identical score (or no judge data)
  | "new"                           // case only in candidate
  | "removed";                      // case only in baseline

type CaseDelta = {
  caseName: string;
  baseline: CaseAggregate | null;
  candidate: CaseAggregate | null;
  classification: CaseClassification;
  deltaMean: number | null;
};

function aggregateRunsForCase(rows: CaseRunRow[], caseName: string): CaseAggregate {
  const sorted = rows
    .filter((r) => r.case_name === caseName)
    .slice()
    .sort((a, b) => a.run_index - b.run_index);
  const scores = sorted
    .map((r) => (r.judge_score === null ? null : Number(r.judge_score)))
    .filter((s): s is number => s !== null && !Number.isNaN(s));
  const programmaticPasses = sorted.map((r) => r.programmatic_pass === true);
  const reasonings = sorted.map((r) => r.judge_reasoning);
  const errors = sorted.map((r) => r.error);
  return {
    scores,
    mean: scores.length > 0 ? scores.reduce((s, n) => s + n, 0) / scores.length : null,
    min: scores.length > 0 ? Math.min(...scores) : null,
    max: scores.length > 0 ? Math.max(...scores) : null,
    programmaticPasses,
    reasonings,
    errors,
  };
}

function classifyDelta(
  baseline: CaseAggregate,
  candidate: CaseAggregate,
  isMultiRun: boolean,
): { classification: CaseClassification; deltaMean: number | null } {
  // Programmatic-pass transitions are the loudest signal — a case that flipped
  // pass → fail (or vice versa) is more important than any numeric drift.
  // Surface first regardless of judge scores.
  const baseAllPass =
    baseline.programmaticPasses.length > 0 && baseline.programmaticPasses.every((p) => p);
  const candAllPass =
    candidate.programmaticPasses.length > 0 && candidate.programmaticPasses.every((p) => p);
  if (baseAllPass && !candAllPass) {
    return { classification: "programmatic-flip-regression", deltaMean: null };
  }
  if (!baseAllPass && candAllPass) {
    return { classification: "programmatic-flip-improvement", deltaMean: null };
  }

  // Offline / family suites carry no judge scores — nothing more to compare
  // beyond the programmatic flip we already handled.
  if (baseline.mean === null || candidate.mean === null) {
    return { classification: "unchanged", deltaMean: null };
  }

  const deltaMean = candidate.mean - baseline.mean;

  // The load-bearing UX rule from PHI-117 hard constraints: for multi-run
  // suites, single-run deltas that sit within both runs' overlap range
  // render as `noise`, not `regression`. Overlap exists iff the closed
  // interval [base.min, base.max] intersects [cand.min, cand.max].
  if (isMultiRun) {
    const overlap = baseline.max! >= candidate.min! && candidate.max! >= baseline.min!;
    if (overlap) return { classification: "noise", deltaMean };
  }

  if (deltaMean > 0) return { classification: "improvement", deltaMean };
  if (deltaMean < 0) return { classification: "regression", deltaMean };
  return { classification: "unchanged", deltaMean };
}

// Sort order: red rows (regressions / programmatic-flips) first, sorted by
// magnitude, then categorical changes (new/removed), then noise, then quiet
// rows (unchanged + improvements). PRD: "sorted by regression magnitude
// (red rows first)".
function classificationOrder(c: CaseClassification): number {
  switch (c) {
    case "programmatic-flip-regression":
      return 0;
    case "regression":
      return 1;
    case "removed":
      return 2;
    case "new":
      return 3;
    case "noise":
      return 4;
    case "unchanged":
      return 5;
    case "programmatic-flip-improvement":
      return 6;
    case "improvement":
      return 7;
  }
}

function buildDeltas(
  baselineCases: CaseRunRow[],
  candidateCases: CaseRunRow[],
  isMultiRun: boolean,
): CaseDelta[] {
  const baselineNames = new Set(baselineCases.map((c) => c.case_name));
  const candidateNames = new Set(candidateCases.map((c) => c.case_name));
  const allNames = new Set<string>();
  baselineNames.forEach((n) => allNames.add(n));
  candidateNames.forEach((n) => allNames.add(n));

  const deltas: CaseDelta[] = [];
  for (const caseName of allNames) {
    const inBase = baselineNames.has(caseName);
    const inCand = candidateNames.has(caseName);
    if (!inBase && inCand) {
      deltas.push({
        caseName,
        baseline: null,
        candidate: aggregateRunsForCase(candidateCases, caseName),
        classification: "new",
        deltaMean: null,
      });
      continue;
    }
    if (inBase && !inCand) {
      deltas.push({
        caseName,
        baseline: aggregateRunsForCase(baselineCases, caseName),
        candidate: null,
        classification: "removed",
        deltaMean: null,
      });
      continue;
    }
    const baseline = aggregateRunsForCase(baselineCases, caseName);
    const candidate = aggregateRunsForCase(candidateCases, caseName);
    const { classification, deltaMean } = classifyDelta(baseline, candidate, isMultiRun);
    deltas.push({ caseName, baseline, candidate, classification, deltaMean });
  }

  deltas.sort((a, b) => {
    const orderDiff = classificationOrder(a.classification) - classificationOrder(b.classification);
    if (orderDiff !== 0) return orderDiff;
    // Within the same classification, sort by |delta| desc so the biggest
    // movers float to the top of their group. Categorical rows (new /
    // removed / programmatic-flip) carry null deltas — keep alphabetical.
    const ad = Math.abs(a.deltaMean ?? 0);
    const bd = Math.abs(b.deltaMean ?? 0);
    if (ad !== bd) return bd - ad;
    return a.caseName.localeCompare(b.caseName);
  });

  return deltas;
}

function formatBand(agg: CaseAggregate | null, judgeMax: 5 | 10, runs: number): string {
  if (!agg || agg.mean === null) return "—";
  if (runs <= 1 || agg.min === agg.max) {
    return `${agg.mean.toFixed(1)}/${judgeMax}`;
  }
  // Multi-run: explicit min → max band so the noise classification is
  // legible. "(N runs)" follows the actual row count, not runsPerCase,
  // so a partially-completed run is reflected honestly.
  return `${agg.min!.toFixed(1)} → ${agg.max!.toFixed(1)}/${judgeMax} (mean ${agg.mean.toFixed(1)}, ${agg.scores.length} run${agg.scores.length === 1 ? "" : "s"})`;
}

function ClassificationPill({ c }: { c: CaseClassification }) {
  const map: Record<CaseClassification, { label: string; bg: string; fg: string }> = {
    "programmatic-flip-regression": {
      label: "✗ pass → fail",
      bg: "bg-[#fde8e8]",
      fg: "text-[#c0392b]",
    },
    regression: { label: "↓ regression", bg: "bg-[#fde8e8]", fg: "text-[#c0392b]" },
    removed: { label: "− removed", bg: "bg-[#f0ede8]", fg: "text-[var(--text-muted)]" },
    new: { label: "+ new", bg: "bg-[#e8f0f4]", fg: "text-[#1a6b7f]" },
    noise: { label: "≈ noise", bg: "bg-[#fef3e2]", fg: "text-[#ba7517]" },
    unchanged: { label: "= unchanged", bg: "bg-[#f0ede8]", fg: "text-[var(--text-muted)]" },
    "programmatic-flip-improvement": {
      label: "✓ fail → pass",
      bg: "bg-[#eaf4ee]",
      fg: "text-[#2d7a4f]",
    },
    improvement: { label: "↑ improvement", bg: "bg-[#eaf4ee]", fg: "text-[#2d7a4f]" },
  };
  const { label, bg, fg } = map[c];
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full ${bg} ${fg}`}>
      {label}
    </span>
  );
}

function CompareTab({ suite }: { suite: SuiteCard }) {
  const [runs, setRuns] = useState<SuiteRunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [baselineCases, setBaselineCases] = useState<CaseRunRow[] | null>(null);
  const [candidateCases, setCandidateCases] = useState<CaseRunRow[] | null>(null);
  const [pairLoading, setPairLoading] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Load the runs list for the picker — same endpoint History tab uses.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await fetch(`/api/admin/evals/suites/${suite.slug}/runs`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          if (!cancelled) setError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as { runs: SuiteRunRow[] };
        if (cancelled) return;
        setRuns(data.runs);
        // Default pairing: candidate = most recent, baseline = next most recent.
        // PRD success metric #1 is "diff against the last run" — make that the
        // zero-click default.
        if (data.runs.length >= 2 && baselineId === null && candidateId === null) {
          setCandidateId(data.runs[0].id);
          setBaselineId(data.runs[1].id);
        } else if (data.runs.length === 1 && candidateId === null) {
          setCandidateId(data.runs[0].id);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // suite.slug-scoped: reset the picker when the user switches suites.
    // baselineId / candidateId intentionally NOT in deps — we set them
    // inside the effect and don't want to re-fetch on every set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suite.slug]);

  // Reset the case picks when the suite changes so we don't carry stale ids
  // across suites (a country-destination run id is meaningless for family).
  useEffect(() => {
    setBaselineId(null);
    setCandidateId(null);
    setBaselineCases(null);
    setCandidateCases(null);
    setExpanded(null);
    setPairError(null);
  }, [suite.slug]);

  // Whenever both run ids are set, fetch them in parallel.
  useEffect(() => {
    if (!baselineId || !candidateId) {
      setBaselineCases(null);
      setCandidateCases(null);
      return;
    }
    let cancelled = false;
    setPairLoading(true);
    setPairError(null);
    (async () => {
      try {
        const [baseRes, candRes] = await Promise.all([
          fetch(`/api/admin/evals/suites/${suite.slug}/runs/${baselineId}`),
          fetch(`/api/admin/evals/suites/${suite.slug}/runs/${candidateId}`),
        ]);
        if (cancelled) return;
        if (!baseRes.ok || !candRes.ok) {
          const failedRes = !baseRes.ok ? baseRes : candRes;
          const body = await failedRes.json().catch(() => ({ error: `HTTP ${failedRes.status}` }));
          setPairError(body.error ?? `HTTP ${failedRes.status}`);
          return;
        }
        const [baseData, candData] = await Promise.all([
          baseRes.json() as Promise<{ caseRuns: CaseRunRow[] }>,
          candRes.json() as Promise<{ caseRuns: CaseRunRow[] }>,
        ]);
        if (cancelled) return;
        setBaselineCases(baseData.caseRuns);
        setCandidateCases(candData.caseRuns);
      } catch (err) {
        if (!cancelled) setPairError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setPairLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baselineId, candidateId, suite.slug]);

  const deltas = useMemo<CaseDelta[] | null>(() => {
    if (!baselineCases || !candidateCases) return null;
    return buildDeltas(baselineCases, candidateCases, suite.runsPerCase > 1);
  }, [baselineCases, candidateCases, suite.runsPerCase]);

  const summary = useMemo(() => {
    if (!deltas) return null;
    const counts: Record<CaseClassification, number> = {
      "programmatic-flip-regression": 0,
      regression: 0,
      noise: 0,
      unchanged: 0,
      "programmatic-flip-improvement": 0,
      improvement: 0,
      new: 0,
      removed: 0,
    };
    for (const d of deltas) counts[d.classification]++;
    return counts;
  }, [deltas]);

  if (!suite.wired) {
    return (
      <div className="bg-white border border-[#e8e4de] rounded-2xl p-6">
        <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">Not yet wired in the GUI</p>
        <p className="text-sm text-[var(--text-secondary)]">
          Compare needs runs produced by this surface. Wire the suite&apos;s Run tab first.
        </p>
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-[#c0392b]">Error loading runs: {error}</p>;
  }
  if (runs === null) {
    return <p className="text-sm text-[var(--text-muted)]">Loading runs…</p>;
  }
  if (runs.length === 0) {
    return (
      <div className="bg-white border border-[#e8e4de] rounded-2xl p-6">
        <p className="text-sm text-[var(--text-secondary)]">
          No runs to compare yet. Switch to the Run tab to fire this suite at least twice — then come
          back here.
        </p>
      </div>
    );
  }
  if (runs.length === 1) {
    return (
      <div className="bg-white border border-[#e8e4de] rounded-2xl p-6">
        <p className="text-sm text-[var(--text-secondary)]">
          Only one run exists for{" "}
          <code className="text-[var(--text-primary)] font-semibold">{suite.title}</code>. Run it
          once more to start comparing.
        </p>
      </div>
    );
  }

  const judgeMax = judgeScoreMaxForSuite(suite.slug);

  return (
    <div className="flex flex-col gap-5">
      {/* Picker */}
      <div className="bg-white border border-[#e8e4de] rounded-2xl p-5">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <RunPicker
            label="Baseline"
            runs={runs}
            value={baselineId}
            otherValue={candidateId}
            onChange={setBaselineId}
          />
          <div className="flex md:items-end md:pb-1">
            <button
              onClick={() => {
                const b = baselineId;
                setBaselineId(candidateId);
                setCandidateId(b);
              }}
              disabled={!baselineId || !candidateId}
              className="text-sm font-semibold text-[#1a6b7f] hover:underline disabled:opacity-30 disabled:no-underline px-2"
              title="Swap baseline and candidate"
            >
              ⇄ Swap
            </button>
          </div>
          <RunPicker
            label="Candidate"
            runs={runs}
            value={candidateId}
            otherValue={baselineId}
            onChange={setCandidateId}
          />
        </div>
      </div>

      {pairLoading && (
        <p className="text-sm text-[var(--text-muted)] italic">Loading case data for both runs…</p>
      )}
      {pairError && (
        <div className="bg-[#fde8e8] border border-[#c0392b]/30 rounded-2xl p-4 text-sm text-[#c0392b]">
          {pairError}
        </div>
      )}

      {deltas && summary && (
        <>
          <CompareSummary
            summary={summary}
            isMultiRun={suite.runsPerCase > 1}
          />
          <CompareTable
            deltas={deltas}
            judgeMax={judgeMax}
            runsPerCase={suite.runsPerCase}
            expanded={expanded}
            onToggle={(name) => setExpanded((cur) => (cur === name ? null : name))}
          />
        </>
      )}
    </div>
  );
}

function RunPicker({
  label,
  runs,
  value,
  otherValue,
  onChange,
}: {
  label: string;
  runs: SuiteRunRow[];
  value: string | null;
  otherValue: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white border border-[#e8e4de] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)]"
      >
        <option value="" disabled>
          Pick a run…
        </option>
        {runs.map((r) => {
          const isSame = r.id === otherValue;
          const passLabel =
            r.pass_rate != null ? `${Number(r.pass_rate).toFixed(0)}%` : "—";
          const scoreLabel =
            r.summary_score != null ? `${Number(r.summary_score).toFixed(0)}` : "—";
          return (
            <option key={r.id} value={r.id} disabled={isSame}>
              {formatDate(r.started_at)} · {r.status} · pass {passLabel} · score {scoreLabel}
              {isSame ? " (already picked)" : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function CompareSummary({
  summary,
  isMultiRun,
}: {
  summary: Record<CaseClassification, number>;
  isMultiRun: boolean;
}) {
  const regressions =
    summary["programmatic-flip-regression"] + summary.regression;
  const improvements =
    summary["programmatic-flip-improvement"] + summary.improvement;
  const total = Object.values(summary).reduce((s, n) => s + n, 0);

  return (
    <div className="bg-white border border-[#e8e4de] rounded-2xl p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">
        Diff summary
      </p>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="text-[#c0392b] font-semibold">
          {regressions} regression{regressions === 1 ? "" : "s"}
        </span>
        <span className="text-[var(--text-muted)]">·</span>
        <span className="text-[#2d7a4f] font-semibold">
          {improvements} improvement{improvements === 1 ? "" : "s"}
        </span>
        {isMultiRun && (
          <>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="text-[#ba7517] font-semibold">
              {summary.noise} within noise band
            </span>
          </>
        )}
        {(summary.new > 0 || summary.removed > 0) && (
          <>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="text-[#1a6b7f] font-semibold">
              {summary.new} new · {summary.removed} removed
            </span>
          </>
        )}
        <span className="text-[var(--text-muted)]">·</span>
        <span className="text-[var(--text-muted)]">
          {summary.unchanged} unchanged · {total} cases total
        </span>
      </div>
      {isMultiRun && (
        <p className="text-[11px] text-[var(--text-muted)] mt-3">
          For multi-run suites, deltas that sit inside both runs&apos; min..max overlap are
          labelled <span className="font-semibold text-[#ba7517]">noise</span> rather than
          regression — same prompt, different runs, different scores (PHI-42).
        </p>
      )}
    </div>
  );
}

function CompareTable({
  deltas,
  judgeMax,
  runsPerCase,
  expanded,
  onToggle,
}: {
  deltas: CaseDelta[];
  judgeMax: 5 | 10;
  runsPerCase: number;
  expanded: string | null;
  onToggle: (caseName: string) => void;
}) {
  if (deltas.length === 0) {
    return (
      <div className="bg-white border border-[#e8e4de] rounded-2xl p-6">
        <p className="text-sm text-[var(--text-secondary)]">
          No case rows in either run.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-[#e8e4de] rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#f8f6f1] border-b border-[#e8e4de]">
          <tr>
            <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Case
            </th>
            <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Baseline
            </th>
            <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Candidate
            </th>
            <th className="text-right px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Δ
            </th>
            <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Verdict
            </th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {deltas.map((d) => (
            <CompareRow
              key={d.caseName}
              delta={d}
              judgeMax={judgeMax}
              runsPerCase={runsPerCase}
              isExpanded={expanded === d.caseName}
              onToggle={() => onToggle(d.caseName)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompareRow({
  delta,
  judgeMax,
  runsPerCase,
  isExpanded,
  onToggle,
}: {
  delta: CaseDelta;
  judgeMax: 5 | 10;
  runsPerCase: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isRedRow =
    delta.classification === "programmatic-flip-regression" ||
    delta.classification === "regression";
  const isGreenRow =
    delta.classification === "programmatic-flip-improvement" ||
    delta.classification === "improvement";
  const rowTone = isRedRow ? "bg-[#fff5f5]" : isGreenRow ? "bg-[#f6fbf7]" : "";

  const deltaCell =
    delta.deltaMean === null ? (
      <span className="text-[var(--text-muted)]">—</span>
    ) : (
      <span
        className={`tabular-nums font-semibold ${
          delta.deltaMean > 0
            ? "text-[#2d7a4f]"
            : delta.deltaMean < 0
              ? "text-[#c0392b]"
              : "text-[var(--text-muted)]"
        }`}
      >
        {delta.deltaMean > 0 ? "↑" : delta.deltaMean < 0 ? "↓" : "="}{" "}
        {delta.deltaMean > 0 ? "+" : ""}
        {delta.deltaMean.toFixed(1)}
      </span>
    );

  const baseCount = delta.baseline?.scores.length ?? 0;
  const candCount = delta.candidate?.scores.length ?? 0;

  return (
    <>
      <tr
        className={`border-b border-[#e8e4de] last:border-b-0 cursor-pointer hover:bg-[#f8f6f1] ${rowTone}`}
        onClick={onToggle}
      >
        <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{delta.caseName}</td>
        <td className="px-4 py-3 text-[var(--text-secondary)] tabular-nums whitespace-nowrap">
          {delta.baseline
            ? formatBand(delta.baseline, judgeMax, Math.max(runsPerCase, baseCount))
            : "—"}
        </td>
        <td className="px-4 py-3 text-[var(--text-secondary)] tabular-nums whitespace-nowrap">
          {delta.candidate
            ? formatBand(delta.candidate, judgeMax, Math.max(runsPerCase, candCount))
            : "—"}
        </td>
        <td className="px-4 py-3 text-right">{deltaCell}</td>
        <td className="px-4 py-3">
          <ClassificationPill c={delta.classification} />
        </td>
        <td className="px-4 py-3 text-[var(--text-muted)]">{isExpanded ? "▾" : "▸"}</td>
      </tr>
      {isExpanded && (
        <tr className="bg-[#f8f6f1]">
          <td colSpan={6} className="px-4 py-4">
            <CompareRowDetail delta={delta} judgeMax={judgeMax} />
          </td>
        </tr>
      )}
    </>
  );
}

function CompareRowDetail({ delta, judgeMax }: { delta: CaseDelta; judgeMax: 5 | 10 }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <RunSideDetail label="Baseline" agg={delta.baseline} judgeMax={judgeMax} />
      <RunSideDetail label="Candidate" agg={delta.candidate} judgeMax={judgeMax} />
    </div>
  );
}

function RunSideDetail({
  label,
  agg,
  judgeMax,
}: {
  label: string;
  agg: CaseAggregate | null;
  judgeMax: 5 | 10;
}) {
  if (!agg) {
    return (
      <div className="bg-white border border-[#e8e4de] rounded-xl p-3">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1">
          {label}
        </p>
        <p className="text-xs italic text-[var(--text-muted)]">
          Case did not exist in this run.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-[#e8e4de] rounded-xl p-3 flex flex-col gap-2">
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <div className="flex flex-col gap-2">
        {agg.programmaticPasses.map((pp, i) => {
          const score = agg.scores.length > i ? agg.scores[i] : null;
          const reasoning = agg.reasonings[i];
          const errorText = agg.errors[i];
          return (
            <div
              key={i}
              className={`text-xs px-3 py-2 rounded-lg border ${
                pp ? "bg-white border-[#e8e4de]" : "bg-[#fff8f5] border-[#c0392b]/20"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-[var(--text-primary)]">
                  Run {i + 1}
                </span>
                <div className="flex items-center gap-2">
                  {score !== null && (
                    <span className="text-[var(--text-muted)] tabular-nums">
                      {score.toFixed(1)}/{judgeMax}
                    </span>
                  )}
                  <PassFailPill passed={pp} />
                </div>
              </div>
              {reasoning && (
                <p className="text-[var(--text-secondary)] italic">{reasoning}</p>
              )}
              {errorText && !reasoning && (
                <p className="text-[#7a2418] break-words">{errorText}</p>
              )}
            </div>
          );
        })}
        {agg.programmaticPasses.length === 0 && (
          <p className="text-xs italic text-[var(--text-muted)]">
            No case rows recorded for this run.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function EvalsSuitesPage() {
  const [suites, setSuites] = useState<SuiteCard[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"run" | "history" | "compare">("run");
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
              Run any wired eval suite from the browser, browse past runs, and diff any two of
              them for regressions — variance bands surfaced for multi-run suites.
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
                    {(["run", "history", "compare"] as const).map((t) => (
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
                {tab === "compare" && <CompareTab suite={selectedSuite} />}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
