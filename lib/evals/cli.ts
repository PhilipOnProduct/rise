/**
 * Shared CLI scaffolding for the eval runners under `lib/evals/<suite>/`.
 *
 * PHI-118 extracted each suite into its own runner; this module dedups the
 * scaffolding those runners genuinely share. Every helper preserves the
 * pre-extraction stdout/stderr/exit-code behaviour byte-for-byte — the
 * differences between suites (ellipsis style, label padding, indent) are
 * explicit parameters, not new formatting.
 *
 * The 10 `main()` bodies fall into distinct output families, so there is
 * deliberately NO single "run a suite" mega-abstraction here — only the
 * blocks that are identical (or identical modulo a literal) across 2+
 * suites:
 *   - heavy box header/footer (family, free-form-detect)
 *   - per-case checks line + "──── Summary ────" block + gate (parser, activities)
 *   - "Running: … scoring: … done." loop (alternatives, recommendations, location)
 *   - "RESULTS …" footer + exit code (alternatives, recommendations, location)
 *   - site-auth bootstrap with logging + abort (location, anchors)
 */

import { bootstrapSiteAuth } from "./site-auth";

/** 63-char heavy bar used by the offline suites' box header/footer. */
export const BOX_BAR = "═".repeat(63);

/** Heavy box header: bar / two-space-indented title / bar + blank line. */
export function printBoxHeader(title: string): void {
  console.log(BOX_BAR);
  console.log(`  ${title}`);
  console.log(BOX_BAR + "\n");
}

/** Heavy box footer: bar / two-space-indented line / bar. */
export function printBoxFooter(line: string, opts: { leadingNewline?: boolean } = {}): void {
  console.log(opts.leadingNewline ? "\n" + BOX_BAR : BOX_BAR);
  console.log(`  ${line}`);
  console.log(BOX_BAR);
}

/** Per-case result line for the checks-accuracy suites (parser, activities). */
export function printCaseChecksLine(
  id: string,
  idPad: number,
  casePassed: number,
  totalChecks: number,
  description: string,
): void {
  const ratio = `${casePassed}/${totalChecks}`;
  const mark = casePassed === totalChecks ? "✓" : "✗";
  console.log(`${mark} ${id.padEnd(idPad)} ${ratio.padStart(5)}  — ${description}`);
}

/**
 * "──── Summary ────" block for the checks-accuracy suites. The second
 * line is suite-specific (constraint preservation vs life-impacting
 * failures) and is passed in fully formatted.
 */
export function printChecksSummary(opts: {
  accuracy: number;
  secondLine: string;
  casesRun: number;
  totalChecks: number;
  passedChecks: number;
}): void {
  console.log(`\n──── Summary ────`);
  console.log(`Field accuracy:           ${opts.accuracy.toFixed(1)}%  (target ≥ 85%)`);
  console.log(opts.secondLine);
  console.log(`Cases run:                ${opts.casesRun}`);
  console.log(`Total checks:             ${opts.totalChecks}`);
  console.log(`Passed:                   ${opts.passedChecks}\n`);
}

/** Shared pass-gate failure path for the checks-accuracy suites. */
export function exitIfGateFailed(failed: boolean): void {
  if (failed) {
    console.error("EVAL FAILED — pass gate not met. Iterate the prompt.");
    process.exit(1);
  }
}

/** Tally row produced by {@link runScoredCliCases} and consumed by {@link printScoreSummaryAndExit}. */
export type ScoredCaseResult = { label: string; passed: boolean; score: number };

/**
 * The "Running: <label>… scoring… done." per-case loop shared by the
 * HTTP-loopback + LLM-judge suites (alternatives, recommendations,
 * location). `ellipsis` and `runningPrefix` carry the per-suite literal
 * differences ("..." vs "…", leading newline) so output stays
 * byte-identical to each suite's pre-dedup loop.
 */
export async function runScoredCliCases<TCase, TOut, TResult extends { passed: boolean; score: number }>(
  cases: TCase[],
  opts: {
    label: (c: TCase) => string;
    /** Written before "Running:" on each case — "" (default) or "\n". */
    runningPrefix?: string;
    /** "..." (alternatives) or "…" (recommendations, location). */
    ellipsis: string;
    fetchOutput: (c: TCase) => Promise<TOut>;
    judgeOutput: (c: TCase, out: TOut) => Promise<TResult>;
    printResult: (c: TCase, out: TOut, result: TResult) => void;
  },
): Promise<ScoredCaseResult[]> {
  const results: ScoredCaseResult[] = [];

  for (const c of cases) {
    const label = opts.label(c);
    process.stdout.write(`${opts.runningPrefix ?? ""}Running: ${label}${opts.ellipsis} `);

    try {
      const out = await opts.fetchOutput(c);
      process.stdout.write(`scoring${opts.ellipsis} `);
      const result = await opts.judgeOutput(c, out);
      process.stdout.write("done.\n");

      opts.printResult(c, out, result);
      results.push({ label, passed: result.passed, score: result.score });
    } catch (err) {
      process.stdout.write("error.\n");
      console.error(`  ⚠ ${label}: ${err instanceof Error ? err.message : err}`);
      results.push({ label, passed: false, score: 0 });
    }
  }

  return results;
}

/**
 * "RESULTS …" summary footer + per-case rows + exit code, shared by the
 * scored CLI suites. `indent` ("" or "  ") and `labelPad` (35 / 55) carry
 * the per-suite literal differences.
 */
export function printScoreSummaryAndExit(
  results: ScoredCaseResult[],
  opts: { indent?: string; labelPad: number },
): never {
  const passed = results.filter((r) => r.passed).length;
  const passRate = Math.round((passed / results.length) * 100);
  const avgScore = (results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(
    `${opts.indent ?? ""}RESULTS  ${passed}/${results.length} passed  (${passRate}% pass rate)  avg score: ${avgScore}/10`,
  );
  console.log("═".repeat(60));
  for (const r of results) {
    const badge = r.passed ? "✅" : "❌";
    console.log(`  ${badge} ${r.label.padEnd(opts.labelPad)} ${r.score}/10`);
  }
  console.log();

  process.exit(passed === results.length ? 0 : 1);
}

/**
 * Site-auth bootstrap with the CLI logging + abort behaviour shared
 * byte-for-byte by the location and anchors `main()`s. Returns the
 * cookie (or null when SITE_PASSWORD is unset); exits the process when
 * the bootstrap throws.
 */
export async function bootstrapSiteAuthOrExit(baseUrl: string): Promise<string | null> {
  try {
    const authCookie = await bootstrapSiteAuth(baseUrl);
    if (authCookie) {
      console.log("  Auth: bootstrapped via SITE_PASSWORD");
    } else {
      console.log("  Auth: SITE_PASSWORD not set — proceeding without site_auth cookie");
    }
    return authCookie;
  } catch (err) {
    console.error(`\nAuth bootstrap failed: ${err instanceof Error ? err.message : err}`);
    console.error("Aborting — fix SITE_PASSWORD or unset it before retrying.");
    process.exit(1);
  }
}
