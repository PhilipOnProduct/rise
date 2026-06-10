/**
 * Shared GUI-executor scaffolding for the eval suites (PHI-120/121).
 *
 * Every suite's `runSuiteForGui` builds the same `GuiCaseOutcome` rows;
 * this module dedups the bits that are identical across suites — snippet
 * truncation, pass-rate maths, the error-shaped outcome row, and the
 * full sequential loop shared by the three single-run judged suites
 * (alternatives, recommendations, location). The fan-out suites
 * (anchors, country-destination, popular-picks) keep their own loops —
 * their parallelism, multi-run grouping, and suite gates are genuinely
 * different — and use only the small helpers.
 */

import type { GuiCaseOutcome, GuiRunOpts, GuiSuiteOutcome } from "./types";

/** `err.message` for Errors, `String(err)` otherwise. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Cap a snippet at 1KB — full output is regenerable from the case inputs. */
export function truncateSnippet(s: string): string {
  return s.length > 1024 ? s.slice(0, 1024) + "…" : s;
}

/** Percentage of case-runs with `programmaticPass`, 0–100 (0 for empty). */
export function passRateOf(caseOutcomes: GuiCaseOutcome[]): number {
  const passed = caseOutcomes.filter((c) => c.programmaticPass).length;
  return caseOutcomes.length === 0 ? 0 : (passed / caseOutcomes.length) * 100;
}

/** Error-shaped outcome row — used for thrown/rejected case-runs. */
export function erroredGuiOutcome(args: {
  caseName: string;
  runIndex: number;
  costUsdEstimate: number;
  durationMs?: number;
  errorMessage: string;
}): GuiCaseOutcome {
  return {
    caseName: args.caseName,
    runIndex: args.runIndex,
    programmaticPass: false,
    judgeScore: null,
    judgeReasoning: null,
    outputSnippet: "",
    costUsdEstimate: args.costUsdEstimate,
    durationMs: args.durationMs ?? 0,
    errorMessage: args.errorMessage,
  };
}

/**
 * Sequential GUI loop for the single-run judged suites (alternatives,
 * recommendations, location): one fetch + one judge per case, judge
 * `passed`/`score`/`summary` mapped straight onto the outcome row.
 * `exec` receives the {@link GuiRunOpts} so it can forward
 * baseUrl/authCookie/suiteRunId to the route + judge calls.
 */
export async function runSequentialJudgedGuiSuite<TCase>(
  cases: TCase[],
  opts: GuiRunOpts,
  args: {
    perCaseEstimate: number;
    caseName: (c: TCase) => string;
    exec: (
      c: TCase,
      opts: GuiRunOpts,
    ) => Promise<{ snippet: string; passed: boolean; score: number; summary: string }>;
  },
): Promise<GuiSuiteOutcome> {
  const caseOutcomes: GuiCaseOutcome[] = [];

  for (const c of cases) {
    const t0 = Date.now();
    try {
      const { snippet, passed, score, summary } = await args.exec(c, opts);
      caseOutcomes.push({
        caseName: args.caseName(c),
        runIndex: 0,
        programmaticPass: passed,
        judgeScore: score,
        judgeReasoning: summary,
        outputSnippet: truncateSnippet(snippet),
        costUsdEstimate: args.perCaseEstimate,
        durationMs: Date.now() - t0,
        errorMessage: passed ? null : `Judge score ${score}/10 — ${summary}`,
      });
    } catch (err) {
      caseOutcomes.push(
        erroredGuiOutcome({
          caseName: args.caseName(c),
          runIndex: 0,
          costUsdEstimate: args.perCaseEstimate,
          durationMs: Date.now() - t0,
          errorMessage: errMsg(err),
        }),
      );
    }
  }

  return { caseOutcomes, passRate: passRateOf(caseOutcomes) };
}
