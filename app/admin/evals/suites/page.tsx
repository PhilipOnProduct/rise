"use client";

/**
 * PHI-119 — Evals GUI card 2: Suites surface.
 *
 * Card-per-suite picker + Run/History tabs. Only `family` is wired
 * end-to-end in this card; the others render the "Not yet wired"
 * placeholder so the picker shape is correct for cards 3+ to layer on.
 *
 * The page intentionally lives at /admin/evals/suites (not as a tab
 * inside /admin/evals) per the PRD — the old per-test-case evals page
 * stays put; this is the new workbench surface.
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
  totalAssertions: number;
  passedAssertions: number;
};

type FamilyCaseOutcome = {
  caseName: string;
  programmaticPass: boolean;
  assertionsPassed: number;
  assertionsFailed: number;
  outputSnippet: string;
  durationMs: number;
  failedAssertionLabels: string[];
};

// PRD-named states; only the subset reachable in card 2 is populated below.
type RunState =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number }
  | { kind: "succeeded-pass"; run: RunSummary; cases: FamilyCaseOutcome[] }
  | { kind: "succeeded-fail"; run: RunSummary; cases: FamilyCaseOutcome[] }
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

  const handleRun = useCallback(async () => {
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
      const data = (await res.json()) as { run: RunSummary; caseRuns: FamilyCaseOutcome[] };
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

  if (!suite.wired) {
    return (
      <div className="bg-white border border-[#e8e4de] rounded-2xl p-6">
        <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">Not yet wired in the GUI</p>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          This suite is in the picker so card 3+ can layer it on, but the in-browser
          runner isn't live yet. Run it from the terminal:
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
            onClick={handleRun}
            disabled={state.kind === "running"}
            className="rounded-2xl bg-[#1a6b7f] text-white font-bold px-6 py-3 hover:bg-[#155a6b] transition-colors disabled:opacity-30 text-sm"
          >
            {state.kind === "running" ? "Running…" : state.kind === "idle" ? "Run →" : "Run again →"}
          </button>
        </div>
      </div>

      {/* Results (post-run) */}
      {(state.kind === "succeeded-pass" || state.kind === "succeeded-fail") && (
        <div className="bg-white border border-[#e8e4de] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1">
                Result
              </p>
              <p className="text-sm text-[var(--text-primary)]">
                {state.run.passedAssertions} of {state.run.totalAssertions} assertions passed
                {" · "}
                {state.run.passRate.toFixed(0)}% case pass rate
              </p>
            </div>
            <PassFailPill passed={state.kind === "succeeded-pass"} />
          </div>
          <CaseList cases={state.cases} />
        </div>
      )}

      {state.kind === "failed" && (
        <div className="bg-[#fde8e8] border border-[#c0392b]/30 rounded-2xl p-5">
          <p className="text-sm font-semibold text-[#c0392b] mb-1">Run failed</p>
          <p className="text-sm text-[#7a2418] font-mono break-words">{state.message}</p>
        </div>
      )}
    </div>
  );
}

function RunStateBadge({ state }: { state: RunState }) {
  switch (state.kind) {
    case "idle":
      return <span className="text-sm text-[var(--text-muted)] italic">idle — click Run to start</span>;
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

function CaseList({ cases }: { cases: FamilyCaseOutcome[] }) {
  return (
    <div className="flex flex-col gap-2">
      {cases.map((c) => (
        <div
          key={c.caseName}
          className={`border rounded-xl p-3 ${
            c.programmaticPass ? "border-[#e8e4de] bg-white" : "border-[#c0392b]/30 bg-[#fff5f5]"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{c.caseName}</p>
              <p className="text-xs text-[var(--text-muted)]">
                {c.assertionsPassed} / {c.assertionsPassed + c.assertionsFailed} assertions
                {" · "}
                {formatDurationMs(c.durationMs)}
              </p>
            </div>
            <PassFailPill passed={c.programmaticPass} />
          </div>
          {!c.programmaticPass && c.failedAssertionLabels.length > 0 && (
            <ul className="mt-2 text-xs text-[#c0392b] list-disc list-inside">
              {c.failedAssertionLabels.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
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
}: {
  row: SuiteRunRow;
  isOpen: boolean;
  expandedCases: CaseRunRow[] | null;
  expandedLoading: boolean;
  onToggle: () => void;
}) {
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
                      <p className="font-semibold text-[var(--text-primary)]">{c.case_name}</p>
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
              Run any eval suite from the browser. Card 2 wires <code>eval:family</code> end-to-end;
              the rest are placeholders until cards 3–5.
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
