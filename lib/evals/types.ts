/**
 * PHI-118 — Shared eval-runner types.
 *
 * Each suite under `lib/evals/<suite>/` exposes a `cases.ts` (data + check
 * helpers) and a `runner.ts` (per-case run + suite main entry). Suites that
 * use an LLM-as-judge step also expose a `judge.ts` and import the shared
 * scaffolding in `lib/evals/judge.ts`.
 *
 * Cards 2–5 of PHI-117 will wire these shapes through `/api/admin/evals/*`
 * so the GUI workbench and the CLI share a single source of truth.
 */

/** Minimal contract every eval case satisfies. Suites extend with their own fields. */
export type EvalCase = {
  /** Stable identifier for diffing, sorting, and per-case re-runs. */
  id: string;
  /** Optional human-readable label used in CLI / GUI output. */
  label?: string;
};

/** Result envelope for a single case run. Suite-specific data hangs off `detail`. */
export type EvalCaseResult<D = unknown> = {
  caseId: string;
  passed: boolean;
  detail?: D;
};

/**
 * Contract the GUI workbench (PHI-117 cards 2–5) calls into. CLI scripts
 * don't need to instantiate this — they run their suite's `main()` directly
 * — but the types match so a future port to the GUI doesn't bend the shape.
 */
export interface SuiteRunner<
  C extends EvalCase = EvalCase,
  R extends EvalCaseResult = EvalCaseResult,
> {
  /** Suite identifier, e.g. "family", "anchors", "popular-picks". */
  readonly name: string;
  /** Rough USD cost estimate for a full run — used to warn before launch. */
  costEstimateUsd(): number;
  /** Exercise a single case. */
  run(opts: { case: C }): Promise<R>;
}

/**
 * PHI-120 — Unified per-case outcome shape returned by every suite's GUI
 * executor. Each suite fills in the fields that apply: offline suites
 * (family) leave `judgeScore` / `judgeReasoning` null and populate the
 * family-specific assertion counts; LLM-as-judge suites populate the
 * judge fields and skip the assertion counts.
 *
 * The runs route persists each outcome to one `eval_case_runs` row and
 * returns the array unchanged to the page so the CaseList component can
 * branch on whichever fields are present.
 */
export type GuiCaseOutcome = {
  caseName: string;
  /**
   * Aggregate pass for this case. For offline suites: all assertions
   * passed. For LLM-as-judge suites: judge score ≥ 7 (the existing CLI
   * threshold). On error, false.
   */
  programmaticPass: boolean;
  /** Judge score 0–10 for LLM-as-judge suites; null for offline. */
  judgeScore: number | null;
  /** Judge summary text for LLM-as-judge suites; null for offline. */
  judgeReasoning: string | null;
  /** Up to 1KB of representative output for the History case detail row. */
  outputSnippet: string;
  /** Per-case best-effort cost estimate (USD). Realised cost is rolled up to `eval_suite_runs.total_cost_usd`. */
  costUsdEstimate: number;
  /** Wall-clock duration for this case in milliseconds. */
  durationMs: number;
  /** Failure message string when the case errored or failed. Null on success. */
  errorMessage: string | null;
  // Offline-suite extras (family). Absent for LLM-judge suites.
  assertionsPassed?: number;
  assertionsFailed?: number;
  failedAssertionLabels?: string[];
};

/**
 * PHI-120 — Aggregate suite outcome returned to the runs route. The
 * route persists `caseOutcomes` to `eval_case_runs` and writes the
 * aggregate to `eval_suite_runs` (`pass_rate`, `summary_score`).
 */
export type GuiSuiteOutcome = {
  caseOutcomes: GuiCaseOutcome[];
  /** Percentage of cases that passed, 0–100. */
  passRate: number;
  // Offline-suite extras (family). Absent for LLM-judge suites.
  totalAssertions?: number;
  passedAssertions?: number;
};

/**
 * PHI-120 — Options passed to every paid suite's GUI executor.
 *
 * `baseUrl` is the inbound request's origin (`req.nextUrl.origin`) so
 * the loopback fetch lands on the same Next.js instance that triggered
 * the run. `authCookie` is the inbound request's full `Cookie` header
 * value, forwarded through middleware so the site-password gate stays
 * intact. `suiteRunId` is set as the `X-Suite-Run-Id` request header on
 * every API call so the routes can tag their `api_usage` rows for the
 * end-of-run cost rollup.
 */
export type GuiRunOpts = {
  baseUrl: string;
  authCookie: string | null;
  suiteRunId: string;
};
