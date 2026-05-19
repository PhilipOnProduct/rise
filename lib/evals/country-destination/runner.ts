/**
 * PHI-118 — Country → city ranking eval runner.
 *
 * Extracted from `scripts/eval-country-destination.ts`. Output format is
 * byte-identical to the pre-refactor script.
 *
 * PHI-121 — GUI executor added. The country-destination suite does not
 * use HTTP loopback (calls `getCandidates` + `rankWithHaiku` from the
 * recommender lib directly), so the `authCookie`/`baseUrl` fields on
 * GuiRunOpts are unused — only `suiteRunId` matters, threaded through
 * to the recommender + judge for `api_usage` linkage.
 */

import { calculateAnthropicCost, calculateGoogleCost } from "../../api-costs";
import type { GuiCaseOutcome, GuiRunOpts, GuiSuiteOutcome } from "../types";
import {
  getCandidates,
  rankWithHaiku,
  type CityRecommendation,
} from "../../destination-recommender";
import { FIXTURES, PASS_AVG, PASS_FLOOR, RUNS_PER_CASE, formatProfile, type Fixture } from "./cases";
import { judgeOnce, type JudgeResult } from "./judge";

const JUDGE_MODEL = "claude-sonnet-4-6";

// PHI-121 — per-case-run cost estimates for the cost-confirm dialog.
// 10 fixtures × 3 runs = 30 case-runs. Each case-run does:
//   1× getCandidates (Places Text Search — once per fixture, but for
//      estimation purposes count it per case-run since the candidates
//      aren't cached across runs in the suite path; runFixture re-fetches
//      candidates once per fixture but we estimate per case-run to be
//      conservative)
//   1× rankWithHaiku (Haiku tool_use, ~800 in / ~400 out)
//   1× judgeOnce (Sonnet tool_use, ~2000 in / ~400 out)
// CLAUDE.md cites ~$0.60/CLI run; the estimate below comes in around
// that figure with reasonable token counts.
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const HAIKU_INPUT_TOKENS = 800;
const HAIKU_OUTPUT_TOKENS = 400;
const JUDGE_INPUT_TOKENS = 2000;
const JUDGE_OUTPUT_TOKENS = 400;

export function costEstimateUsd(): number {
  // Candidates is one Places call per FIXTURE (not per case-run), so
  // amortise it: 1 places call shared across 3 runs.
  const placesPerFixture = calculateGoogleCost("places-text-search");
  const perCaseRun =
    placesPerFixture / RUNS_PER_CASE +
    calculateAnthropicCost(HAIKU_MODEL, HAIKU_INPUT_TOKENS, HAIKU_OUTPUT_TOKENS) +
    calculateAnthropicCost(JUDGE_MODEL, JUDGE_INPUT_TOKENS, JUDGE_OUTPUT_TOKENS);
  return perCaseRun * FIXTURES.length * RUNS_PER_CASE;
}

export type RunResult = {
  recs: CityRecommendation[];
  judge: JudgeResult;
  /** PHI-121 — populated when the run threw; null on success. */
  errorMessage?: string;
};

export type CaseResult = {
  fixture: Fixture;
  runs: RunResult[];
  caseScore: number;
};

export async function runFixture(
  fixture: Fixture,
  opts: { suiteRunId?: string } = {},
): Promise<CaseResult> {
  // Candidates are deterministic per (country, code) — fetch once per fixture.
  const candidates = await getCandidates(fixture.country, fixture.countryCode, {
    suiteRunId: opts.suiteRunId,
  });

  const runs: RunResult[] = [];
  for (let i = 0; i < RUNS_PER_CASE; i++) {
    const run = await runSingleAttempt(fixture, candidates, opts);
    if (run.errorMessage) {
      // Preserve pre-PHI-121 CLI warn line exactly. The CLI loop never
      // saw the errorMessage field — the try/catch was inline — so the
      // shape stays \n    run X errored: <msg>.
      console.warn(`\n    run ${i + 1} errored: ${run.errorMessage}`);
    }
    runs.push(run);
  }
  const caseScore = runs.reduce((s, r) => s + r.judge.overall, 0) / runs.length;
  return { fixture, runs, caseScore };
}

/**
 * PHI-121 — One attempt = one rankWithHaiku + one judgeOnce.
 * Shared between the CLI `runFixture` (sequential, 3 attempts) and the
 * GUI `runSuiteForGui` (parallel fan-out across all fixture×run pairs).
 *
 * On error returns the score-1 "errored" run shape both paths consume,
 * preserving the CLI's `console.warn(\n    run X errored: ...)` shape
 * is the CLI loop's responsibility (kept inline below).
 */
export async function runSingleAttempt(
  fixture: Fixture,
  candidates: Awaited<ReturnType<typeof getCandidates>>,
  opts: { suiteRunId?: string } = {},
): Promise<RunResult> {
  try {
    const ranked = await rankWithHaiku(
      fixture.country,
      candidates,
      fixture.preferences,
      fixture.countryCode,
      { suiteRunId: opts.suiteRunId },
    );
    const judge = await judgeOnce(fixture, ranked.recommendations, {
      suiteRunId: opts.suiteRunId,
    });
    return { recs: ranked.recommendations, judge };
  } catch (err) {
    return {
      recs: [],
      judge: {
        locationMatch: { score: 1, reasoning: "Run errored." },
        fitToProfile: { score: 1, reasoning: "Run errored." },
        whyQuality: { score: 1, reasoning: "Run errored." },
        noHallucinations: { score: 1, reasoning: "Run errored." },
        overall: 1,
      },
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function printFailureBlock(c: CaseResult): void {
  const f = c.fixture;
  const sep = "─".repeat(60);
  console.log(`\n${sep}`);
  console.log(`❌ FAIL  ${f.id}  (case score: ${c.caseScore.toFixed(2)}/5)`);
  console.log(sep);
  console.log(`\n  Country:     ${f.country} (${f.countryCode})`);
  console.log(`  Preferences:`);
  for (const line of formatProfile(f.preferences).split("\n")) {
    console.log(`    ${line}`);
  }
  console.log(`  Context:     ${f.context}`);

  c.runs.forEach((r, i) => {
    console.log(`\n  Run ${i + 1}: overall ${r.judge.overall}/5`);
    console.log(`    AI top picks:`);
    if (r.recs.length === 0) {
      console.log(`      (none returned)`);
    } else {
      r.recs.forEach((rec, j) => {
        console.log(`      ${j + 1}. ${rec.name} (${rec.kind}) — ${rec.why}`);
      });
    }
    console.log(`    Judge:`);
    console.log(
      `      location match  (${r.judge.locationMatch.score}/5) — ${r.judge.locationMatch.reasoning}`,
    );
    console.log(
      `      fit to profile  (${r.judge.fitToProfile.score}/5) — ${r.judge.fitToProfile.reasoning}`,
    );
    console.log(
      `      why quality     (${r.judge.whyQuality.score}/5) — ${r.judge.whyQuality.reasoning}`,
    );
    console.log(
      `      no hallucinate  (${r.judge.noHallucinations.score}/5) — ${r.judge.noHallucinations.reasoning}`,
    );
  });
}

export async function main(): Promise<void> {
  console.log("═".repeat(60));
  console.log("  PHI-69 — Country → city ranking quality eval");
  console.log(
    `  Cases: ${FIXTURES.length}  |  Runs/case: ${RUNS_PER_CASE}  |  Judge: ${JUDGE_MODEL}`,
  );
  console.log("═".repeat(60));

  const results: CaseResult[] = [];
  for (const fixture of FIXTURES) {
    process.stdout.write(`\n  Running ${fixture.id}…  `);
    try {
      const result = await runFixture(fixture);
      const flag =
        result.caseScore < PASS_FLOOR
          ? " ❌"
          : result.caseScore < PASS_AVG
            ? " ⚠"
            : " ✓";
      process.stdout.write(`done — ${result.caseScore.toFixed(2)}/5${flag}\n`);
      results.push(result);
    } catch (err) {
      process.stdout.write(`error.\n`);
      console.error(
        `  ⚠ ${fixture.id}: ${err instanceof Error ? err.message : err}`,
      );
      results.push({ fixture, runs: [], caseScore: 0 });
    }
  }

  const overallAvg =
    results.reduce((s, r) => s + r.caseScore, 0) / results.length;
  // Use !(>=) so NaN from a degraded run is treated as a failure rather
  // than silently slipping through the per-case floor check.
  const failingCases = results.filter((r) => !(r.caseScore >= PASS_FLOOR));
  const overallPass = overallAvg >= PASS_AVG && failingCases.length === 0;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  PER-CASE SUMMARY`);
  console.log("═".repeat(60));
  for (const r of results) {
    const badge = r.caseScore >= PASS_FLOOR ? "✓" : "✗";
    console.log(
      `  ${badge}  ${r.fixture.id.padEnd(42)}  ${r.caseScore.toFixed(2)}/5`,
    );
  }

  if (failingCases.length > 0) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  FAILURE DETAIL  (cases < ${PASS_FLOOR.toFixed(1)}/5)`);
    console.log("═".repeat(60));
    for (const c of failingCases) printFailureBlock(c);
  }

  // PHI-85: also print detail for warning cases (≥ floor but < pass avg) so
  // it's clear which cases are dragging the gate down without re-running.
  const warningCases = results.filter(
    (r) => r.caseScore >= PASS_FLOOR && r.caseScore < PASS_AVG,
  );
  if (warningCases.length > 0) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(
      `  WARNING DETAIL  (cases ≥ ${PASS_FLOOR.toFixed(1)} but < ${PASS_AVG.toFixed(1)}/5)`,
    );
    console.log("═".repeat(60));
    for (const c of warningCases) printFailureBlock(c);
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(
    `  OVERALL AVG: ${overallAvg.toFixed(2)}/5  |  ` +
      `Failing cases: ${failingCases.length}  |  ` +
      `Gate: ${overallPass ? "✅ PASS" : "❌ FAIL"}`,
  );
  console.log(
    `  Pass criteria: ≥${PASS_AVG.toFixed(1)} avg AND no case < ${PASS_FLOOR.toFixed(1)}`,
  );
  console.log("═".repeat(60));
  console.log();

  process.exit(overallPass ? 0 : 1);
}

/**
 * PHI-121 — GUI executor for the country-destination suite.
 *
 * Fan-out — all `FIXTURES.length * RUNS_PER_CASE` case-runs in parallel
 * via `Promise.allSettled`. The recommender's `getCandidates` Places
 * call runs once per fixture (re-used across the 3 runs of that
 * fixture); rank + judge each run independently.
 *
 * Per-row `programmaticPass` = "this run's judge.overall ≥ PASS_FLOOR
 * (3/5)" — the per-case floor. `overallSuitePass` carries the full
 * suite gate (`avg ≥ PASS_AVG AND no case < PASS_FLOOR`), which is
 * stricter than "every row ≥ floor" because it also requires the
 * suite-wide average ≥ 4/5.
 */
export async function runSuiteForGui(opts: GuiRunOpts): Promise<GuiSuiteOutcome> {
  const perCaseRunCost = costEstimateUsd() / (FIXTURES.length * RUNS_PER_CASE);

  // Step 1: fetch candidates per fixture (parallel) — cheaper than
  // refetching inside every (fixture, run) pair.
  const candidatesByFixture = await Promise.all(
    FIXTURES.map(async (fixture) => ({
      fixture,
      candidates: await getCandidates(fixture.country, fixture.countryCode, {
        suiteRunId: opts.suiteRunId,
      }),
    })),
  );

  // Step 2: fan-out all (fixture, run) pairs.
  type Task = { fixture: Fixture; candidates: Awaited<ReturnType<typeof getCandidates>>; runIndex: number };
  const tasks: Task[] = candidatesByFixture.flatMap(({ fixture, candidates }) =>
    Array.from({ length: RUNS_PER_CASE }, (_, i) => ({ fixture, candidates, runIndex: i })),
  );

  const settled = await Promise.allSettled(
    tasks.map(async (t) => {
      const t0 = Date.now();
      const run = await runSingleAttempt(t.fixture, t.candidates, {
        suiteRunId: opts.suiteRunId,
      });
      return { run, durationMs: Date.now() - t0 };
    }),
  );

  // Step 3: materialise per-row outcomes.
  const caseOutcomes: GuiCaseOutcome[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const { fixture, runIndex } = tasks[i];
    const result = settled[i];

    if (result.status === "rejected") {
      caseOutcomes.push({
        caseName: fixture.id,
        runIndex,
        programmaticPass: false,
        judgeScore: null,
        judgeReasoning: null,
        outputSnippet: "",
        costUsdEstimate: perCaseRunCost,
        durationMs: 0,
        errorMessage:
          result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      continue;
    }

    const { run, durationMs } = result.value;
    const snippet = JSON.stringify({
      recs: run.recs.map((r) => ({ name: r.name, kind: r.kind, why: r.why })),
      judge: {
        locationMatch: run.judge.locationMatch.score,
        fitToProfile: run.judge.fitToProfile.score,
        whyQuality: run.judge.whyQuality.score,
        noHallucinations: run.judge.noHallucinations.score,
        overall: run.judge.overall,
      },
    });
    const rowPassed = run.judge.overall >= PASS_FLOOR && !run.errorMessage;
    const reasoning = [
      `Overall ${run.judge.overall}/5`,
      `loc=${run.judge.locationMatch.score} fit=${run.judge.fitToProfile.score} why=${run.judge.whyQuality.score} no-halluc=${run.judge.noHallucinations.score}`,
      run.judge.fitToProfile.reasoning,
    ].join(" · ");
    caseOutcomes.push({
      caseName: fixture.id,
      runIndex,
      programmaticPass: rowPassed,
      judgeScore: run.judge.overall,
      judgeReasoning: reasoning,
      outputSnippet: snippet.length > 1024 ? snippet.slice(0, 1024) + "…" : snippet,
      costUsdEstimate: perCaseRunCost,
      durationMs,
      errorMessage: run.errorMessage ?? (rowPassed ? null : `Run scored ${run.judge.overall}/5 — below ${PASS_FLOOR}/5 floor`),
    });
  }

  // Step 4: suite-level aggregate — group by fixture, compute case avg,
  // apply the avg ≥ PASS_AVG AND no-case-<-PASS_FLOOR gate.
  const rowsByCase = new Map<string, GuiCaseOutcome[]>();
  for (const row of caseOutcomes) {
    if (!rowsByCase.has(row.caseName)) rowsByCase.set(row.caseName, []);
    rowsByCase.get(row.caseName)!.push(row);
  }

  const caseAverages: number[] = [];
  for (const rows of rowsByCase.values()) {
    const scores = rows.map((r) => r.judgeScore).filter((s): s is number => s !== null);
    const avg = scores.length > 0 ? scores.reduce((s, n) => s + n, 0) / scores.length : 0;
    caseAverages.push(avg);
  }

  const overallAvg =
    caseAverages.length > 0 ? caseAverages.reduce((s, n) => s + n, 0) / caseAverages.length : 0;
  const everyCaseAboveFloor = caseAverages.every((a) => a >= PASS_FLOOR);
  const overallSuitePass = overallAvg >= PASS_AVG && everyCaseAboveFloor;

  const passedRows = caseOutcomes.filter((c) => c.programmaticPass).length;
  const passRate = caseOutcomes.length === 0 ? 0 : (passedRows / caseOutcomes.length) * 100;

  return {
    caseOutcomes,
    passRate,
    overallSuitePass,
    suiteAverageScore: overallAvg,
  };
}
