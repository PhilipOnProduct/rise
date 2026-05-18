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
