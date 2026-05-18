/**
 * PHI-118 — Itinerary anchors eval runner.
 *
 * Extracted from `scripts/eval-itinerary-anchors.ts`. Output format is
 * byte-identical to the pre-refactor script.
 */

import { bootstrapSiteAuth } from "../site-auth";
import {
  RUNS_PER_CASE,
  TEST_CASES,
  type GenerateRequest,
  type ProgrammaticArgs,
  type TestCase,
} from "./cases";
import { judgeWithLlm, type JudgeResult } from "./judge";
import type { ApiResponse } from "./types";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";

async function callGenerateApi(
  request: GenerateRequest,
  authCookie: string | null,
): Promise<ApiResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authCookie) headers["Cookie"] = authCookie;

  // PHI-96: one retry on upstream 5xx. The route surfaces transient
  // Anthropic API errors (e.g. "Internal server error" propagated as
  // 500). A single retry absorbs the common-case flake without
  // breaking the "no memoisation, fresh call each time" PRD constraint.
  const maxAttempts = 2;
  let lastErr: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${BASE_URL}/api/itinerary/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });

    if (res.ok) {
      return res.json() as Promise<ApiResponse>;
    }

    const body = await res.text();
    lastErr = `API returned ${res.status}: ${body}`;

    const isRetryable = res.status >= 500 && res.status < 600;
    if (!isRetryable || attempt === maxAttempts) {
      throw new Error(lastErr);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(lastErr ?? "callGenerateApi: unreachable");
}

// PHI-96: per-run result so we can aggregate across RUNS_PER_CASE attempts.
export type RunResult = {
  response: ApiResponse;
  programmaticFailure: { ok: false; reason: string } | null;
  judge: JudgeResult | null;
  score: number;
  passed: boolean;
};

export type CaseResult = {
  label: string;
  runs: RunResult[];
  caseScore: number;
  passed: boolean;
  firstReason?: string;
};

function printCase(testCase: TestCase, caseResult: CaseResult) {
  const badge = caseResult.passed ? "✅ PASS" : "❌ FAIL";
  console.log(`\n${"─".repeat(60)}`);
  console.log(
    `${badge}  ${testCase.label}  (score: ${caseResult.caseScore.toFixed(1)}/10)`,
  );
  console.log(`${"─".repeat(60)}`);

  const runLine = caseResult.runs
    .map((r, i) => `Run ${i + 1}: ${r.score}/10`)
    .join("  ·  ");
  console.log(
    `\n  ${runLine}  →  avg ${caseResult.caseScore.toFixed(1)}/10`,
  );

  caseResult.runs.forEach((r, i) => {
    if (r.programmaticFailure) {
      console.log(
        `    Run ${i + 1} programmatic failure: ${r.programmaticFailure.reason}`,
      );
    }
  });

  const lastRun = caseResult.runs[caseResult.runs.length - 1];
  if (!lastRun) return;

  const response = lastRun.response;
  console.log(`\n  Destination: ${testCase.request.destination}`);
  console.log(
    `  Anchors:     ${testCase.request.userSeededActivities.map((a) => `"${a}"`).join(", ")}`,
  );
  console.log(`  placement_notes (last run): ${response.placement_notes ?? "(none)"}`);
  const alerts = response.time_sensitive_alerts;
  if (Array.isArray(alerts) && alerts.length > 0) {
    console.log(`  time_sensitive_alerts (last run):`);
    for (const a of alerts) console.log(`    ⚠ ${a}`);
  } else {
    console.log(`  time_sensitive_alerts (last run): (none)`);
  }
  console.log(`  Days returned (last run): ${response.days.length}`);
  const seededCount = response.days
    .flatMap((d) => d.items)
    .filter((i) => i.seededByUser === true).length;
  console.log(`  Items with seededByUser=true (last run): ${seededCount}`);
  if (Array.isArray(response.seeded_anchor_resolutions)) {
    console.log(`  seeded_anchor_resolutions (last run):`);
    for (const r of response.seeded_anchor_resolutions) {
      const tail =
        (r.placed_title ? ` → "${r.placed_title}"` : "") +
        (r.reason ? `  (${r.reason})` : "");
      console.log(`    [${r.mode}] "${r.verbatim}"${tail}`);
    }
  } else {
    console.log(`  seeded_anchor_resolutions (last run): (none) ⚠ PHI-103 expects this field`);
  }

  if (lastRun.judge) {
    console.log("\n  Judge criteria (last run):");
    for (const c of lastRun.judge.criteriaScores) {
      const mark = c.met ? "  ✓" : "  ✗";
      console.log(`  ${mark} ${c.criterion}`);
      console.log(`        ${c.comment}`);
    }
    console.log(`\n  Summary (last run): ${lastRun.judge.summary}`);
  }
}

export async function main(): Promise<void> {
  console.log("═".repeat(60));
  console.log("  Itinerary Generate — User-seeded anchors eval (PHI-90)");
  console.log(`  Targeting: ${BASE_URL}`);
  console.log("═".repeat(60));

  let authCookie: string | null = null;
  try {
    authCookie = await bootstrapSiteAuth(BASE_URL);
    if (authCookie) {
      console.log("  Auth: bootstrapped via SITE_PASSWORD");
    } else {
      console.log("  Auth: SITE_PASSWORD not set — proceeding without site_auth cookie");
    }
  } catch (err) {
    console.error(`\nAuth bootstrap failed: ${err instanceof Error ? err.message : err}`);
    console.error("Aborting — fix SITE_PASSWORD or unset it before retrying.");
    process.exit(1);
  }

  console.log(`  Cases: ${TEST_CASES.length}  |  Runs/case: ${RUNS_PER_CASE}`);

  const results: CaseResult[] = [];

  for (const testCase of TEST_CASES) {
    process.stdout.write(`\nRunning: ${testCase.label} (${RUNS_PER_CASE}×)… `);
    const runs: RunResult[] = [];

    // PHI-96: 3× per case to absorb model variance. No memoisation —
    // each run hits /api/itinerary/generate fresh per the PRD hard
    // constraint. Any single run failing the programmatic checks
    // (even if the others pass) fails the whole case; the judge
    // scores are averaged.
    for (let i = 0; i < RUNS_PER_CASE; i++) {
      process.stdout.write(`[run ${i + 1}] `);
      try {
        const response = await callGenerateApi(testCase.request, authCookie);

        const flatItems = response.days.flatMap((d) => d.items);
        const seededItems = flatItems.filter((i) => i.seededByUser === true);
        const programmaticArgs: ProgrammaticArgs = {
          destination: testCase.request.destination,
          anchors: testCase.request.userSeededActivities,
          days: response.days,
          placementNotes: response.placement_notes,
          flatItems,
          seededItems,
          seededAnchorResolutions: response.seeded_anchor_resolutions ?? null,
          timeSensitiveAlerts: response.time_sensitive_alerts ?? null,
        };

        let programmaticFailure: { ok: false; reason: string } | null = null;
        for (const check of testCase.programmatic) {
          const r = check(programmaticArgs);
          if (!r.ok) {
            programmaticFailure = { ok: false, reason: r.reason ?? "(no reason)" };
            break;
          }
        }

        let judge: JudgeResult | null = null;
        if (!programmaticFailure) {
          judge = await judgeWithLlm(testCase, response);
        }

        const score = judge?.score ?? 0;
        const passed = !programmaticFailure && (judge ? judge.passed : false);
        runs.push({
          response,
          programmaticFailure,
          judge,
          score,
          passed,
        });
      } catch (err) {
        console.error(
          `\n  ⚠ ${testCase.label} run ${i + 1}: ${err instanceof Error ? err.message : err}`,
        );
        runs.push({
          response: {
            days: [],
            bad_day_dates: null,
            placement_notes: null,
            seeded_anchor_resolutions: null,
            time_sensitive_alerts: null,
          },
          programmaticFailure: {
            ok: false,
            reason: `run threw: ${err instanceof Error ? err.message : String(err)}`,
          },
          judge: null,
          score: 0,
          passed: false,
        });
      }
    }
    process.stdout.write("done.\n");

    const caseScore = runs.reduce((s, r) => s + r.score, 0) / runs.length;
    const everyRunProgrammaticPassed = runs.every(
      (r) => !r.programmaticFailure,
    );
    const passed = everyRunProgrammaticPassed && caseScore >= 7;
    const firstReason =
      runs.find((r) => r.programmaticFailure)?.programmaticFailure?.reason;

    const caseResult: CaseResult = {
      label: testCase.label,
      runs,
      caseScore,
      passed,
      firstReason,
    };
    printCase(testCase, caseResult);
    results.push(caseResult);
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const passRate = Math.round((passed / results.length) * 100);
  const avgScore = (
    results.reduce((s, r) => s + r.caseScore, 0) / results.length
  ).toFixed(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(
    `  RESULTS  ${passed}/${results.length} passed  (${passRate}% pass rate)  avg score: ${avgScore}/10`,
  );
  console.log("═".repeat(60));
  for (const r of results) {
    const badge = r.passed ? "✅" : "❌";
    const runScores = r.runs.map((rr) => rr.score).join("/");
    console.log(
      `  ${badge} ${r.label.padEnd(55)} avg ${r.caseScore.toFixed(1)}/10 (runs: ${runScores})`,
    );
    if (!r.passed && r.firstReason) {
      console.log(`      ↳ ${r.firstReason}`);
    }
  }
  console.log();

  process.exit(passed === results.length ? 0 : 1);
}
