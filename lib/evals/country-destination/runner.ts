/**
 * PHI-118 — Country → city ranking eval runner.
 *
 * Extracted from `scripts/eval-country-destination.ts`. Output format is
 * byte-identical to the pre-refactor script.
 */

import {
  getCandidates,
  rankWithHaiku,
  type CityRecommendation,
} from "../../destination-recommender";
import { FIXTURES, PASS_AVG, PASS_FLOOR, RUNS_PER_CASE, formatProfile, type Fixture } from "./cases";
import { judgeOnce, type JudgeResult } from "./judge";

const JUDGE_MODEL = "claude-sonnet-4-6";

export type RunResult = {
  recs: CityRecommendation[];
  judge: JudgeResult;
};

export type CaseResult = {
  fixture: Fixture;
  runs: RunResult[];
  caseScore: number;
};

export async function runFixture(fixture: Fixture): Promise<CaseResult> {
  // Candidates are deterministic per (country, code) — fetch once per fixture.
  const candidates = await getCandidates(fixture.country, fixture.countryCode);

  const runs: RunResult[] = [];
  for (let i = 0; i < RUNS_PER_CASE; i++) {
    try {
      const ranked = await rankWithHaiku(
        fixture.country,
        candidates,
        fixture.preferences,
        fixture.countryCode,
      );
      const judge = await judgeOnce(fixture, ranked.recommendations);
      runs.push({ recs: ranked.recommendations, judge });
    } catch (err) {
      console.warn(
        `\n    run ${i + 1} errored: ${err instanceof Error ? err.message : err}`,
      );
      runs.push({
        recs: [],
        judge: {
          locationMatch: { score: 1, reasoning: "Run errored." },
          fitToProfile: { score: 1, reasoning: "Run errored." },
          whyQuality: { score: 1, reasoning: "Run errored." },
          noHallucinations: { score: 1, reasoning: "Run errored." },
          overall: 1,
        },
      });
    }
  }
  const caseScore = runs.reduce((s, r) => s + r.judge.overall, 0) / runs.length;
  return { fixture, runs, caseScore };
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
