/**
 * PHI-118 — Popular Picks eval runner.
 *
 * Extracted from `scripts/eval-popular-picks.ts`. Output format is
 * byte-identical to the pre-refactor script.
 *
 * PHI-121 — GUI executor added. Popular-picks is single-run per fixture
 * (18 fixtures total — 6 cities × 3 profiles), so the fan-out concurrency
 * peaks at 18 simultaneous /api/destination/popular-picks calls + 18
 * judge calls (sequenced after each). Wall-clock fits comfortably under
 * the 300s timeout even on a cold cache.
 */

import { calculateAnthropicCost } from "../../api-costs";
import type { GuiCaseOutcome, GuiRunOpts, GuiSuiteOutcome } from "../types";
import type { PopularPick } from "../../popular-picks-prompt";
import { bootstrapSiteAuth } from "../site-auth";
import {
  CITIES,
  FIXTURES,
  PASS_AVG,
  PASS_FLOOR,
  PROFILES,
  type Fixture,
} from "./cases";
import { judge, type JudgeResult } from "./judge";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";

// PHI-121 — per-case-run cost estimates for the cost-confirm dialog.
// Each fixture is 1× /api/destination/popular-picks (Sonnet 4.6 per
// PHI-102's model bump — system prompt + tool schema + per-profile user
// message ≈ 3500 input, ~6 picks via tool_use ≈ 1200 output) + 1×
// Sonnet judge (full rubric prose + 6-pick recap ≈ 3000 input, tool_use
// output ≈ 700). Targets CLAUDE.md's ~$1.20/run empirical figure for
// the cold-cache case. Cache hits (PHI-102 cache_key is city × company
// × age_bands × style_tags) drop realised cost dramatically — the
// rollup at run finish corrects the estimate.
const ROUTE_MODEL = "claude-sonnet-4-6";
const ROUTE_INPUT_TOKENS = 3500;
const ROUTE_OUTPUT_TOKENS = 1200;
const JUDGE_MODEL = "claude-sonnet-4-6";
const JUDGE_INPUT_TOKENS = 3000;
const JUDGE_OUTPUT_TOKENS = 700;

export function costEstimateUsd(): number {
  const perFixture =
    calculateAnthropicCost(ROUTE_MODEL, ROUTE_INPUT_TOKENS, ROUTE_OUTPUT_TOKENS) +
    calculateAnthropicCost(JUDGE_MODEL, JUDGE_INPUT_TOKENS, JUDGE_OUTPUT_TOKENS);
  return perFixture * FIXTURES.length;
}

export type FixtureResult = {
  fixture: Fixture;
  picks: PopularPick[];
  judge: JudgeResult;
  cached: boolean;
};

export async function runFixture(
  fixture: Fixture,
  authCookie: string | null,
  opts: { baseUrl?: string; suiteRunId?: string | null } = {},
): Promise<FixtureResult> {
  const baseUrl = opts.baseUrl ?? BASE_URL;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authCookie) headers["Cookie"] = authCookie;
  if (opts.suiteRunId) headers["X-Suite-Run-Id"] = opts.suiteRunId;
  const res = await fetch(`${baseUrl}/api/destination/popular-picks`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      destination: fixture.city,
      travelCompany: fixture.profile.travelCompany,
      childrenAges: fixture.profile.childrenAges,
      styleTags: fixture.profile.styleTags,
    }),
  });
  if (!res.ok) {
    throw new Error(`Route returned ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { picks?: PopularPick[]; cached?: boolean };
  const picks = Array.isArray(data.picks) ? data.picks : [];
  const judged = await judge(fixture, picks, { suiteRunId: opts.suiteRunId ?? undefined });
  return { fixture, picks, judge: judged, cached: data.cached === true };
}

function printFixture(r: FixtureResult) {
  const cacheTag = r.cached ? " (cached)" : "";
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${r.fixture.id}${cacheTag}`);
  console.log(
    `  factual=${r.judge.factualAccuracy.score} · fit=${r.judge.profileFit.score} · friction=${r.judge.usefulFriction.score} · overall=${r.judge.overall}`,
  );
  console.log(`  picks (${r.picks.length}):`);
  for (const p of r.picks) {
    console.log(`    - ${p.name} [${p.category}] — ${p.context_note}`);
  }
  console.log(`  why-factual: ${r.judge.factualAccuracy.reasoning}`);
  console.log(`  why-fit:     ${r.judge.profileFit.reasoning}`);
  console.log(`  why-friction: ${r.judge.usefulFriction.reasoning}`);
}

export async function main(): Promise<void> {
  const authCookie = await bootstrapSiteAuth(BASE_URL);

  console.log(
    `\nPHI-102 popular-picks eval — ${FIXTURES.length} fixtures (${CITIES.length} cities × ${PROFILES.length} profiles).`,
  );
  console.log(`Pass gate: average overall ≥ ${PASS_AVG} AND no fixture < ${PASS_FLOOR}.\n`);

  const results: FixtureResult[] = [];
  for (const fixture of FIXTURES) {
    try {
      const r = await runFixture(fixture, authCookie);
      printFixture(r);
      results.push(r);
    } catch (err) {
      console.error(`\n${fixture.id} — CRASHED: ${err instanceof Error ? err.message : String(err)}`);
      results.push({
        fixture,
        picks: [],
        judge: {
          factualAccuracy: { score: 1, reasoning: `crashed: ${err instanceof Error ? err.message : "unknown"}` },
          profileFit: { score: 1, reasoning: "crashed" },
          usefulFriction: { score: 1, reasoning: "crashed" },
          overall: 1,
        },
        cached: false,
      });
    }
  }

  const overallScores = results.map((r) => r.judge.overall);
  const avg = overallScores.reduce((s, n) => s + n, 0) / overallScores.length;
  const min = Math.min(...overallScores);
  const failedFixtures = results.filter((r) => r.judge.overall < PASS_FLOOR);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`SUMMARY — ${results.length} fixtures`);
  console.log(`  average overall: ${avg.toFixed(2)} / 5  (gate: ≥${PASS_AVG})`);
  console.log(`  minimum overall: ${min} / 5  (floor: ≥${PASS_FLOOR})`);
  console.log(`  failed fixtures (<${PASS_FLOOR}): ${failedFixtures.length}`);
  for (const f of failedFixtures) {
    console.log(`    × ${f.fixture.id} — overall=${f.judge.overall}`);
  }

  const passed = avg >= PASS_AVG && min >= PASS_FLOOR;
  console.log(`\nResult: ${passed ? "✅ PASS" : "❌ FAIL"}\n`);
  process.exit(passed ? 0 : 1);
}

/**
 * PHI-121 — GUI executor for the popular-picks suite.
 *
 * Fan-out — all 18 fixtures via `Promise.allSettled`. Each fixture does
 * 1× POST /api/destination/popular-picks (Sonnet 4.6 per PHI-102) + 1×
 * Sonnet judge. The route caches per (city × profile shard) in
 * `popular_picks_cache`, so re-runs of the same suite hit the cache and
 * realised cost drops dramatically.
 *
 * Per-row `programmaticPass` = "this fixture's judge.overall ≥ PASS_FLOOR
 * (3/5)" — the per-fixture floor. `overallSuitePass` reflects the full
 * suite gate (`avg ≥ PASS_AVG (4) AND min ≥ PASS_FLOOR (3)`).
 */
export async function runSuiteForGui(opts: GuiRunOpts): Promise<GuiSuiteOutcome> {
  const perFixtureCost = costEstimateUsd() / FIXTURES.length;

  const settled = await Promise.allSettled(
    FIXTURES.map(async (fixture) => {
      const t0 = Date.now();
      const fr = await runFixture(fixture, opts.authCookie, {
        baseUrl: opts.baseUrl,
        suiteRunId: opts.suiteRunId,
      });
      return { fr, durationMs: Date.now() - t0 };
    }),
  );

  const caseOutcomes: GuiCaseOutcome[] = [];
  for (let i = 0; i < FIXTURES.length; i++) {
    const fixture = FIXTURES[i];
    const result = settled[i];

    if (result.status === "rejected") {
      caseOutcomes.push({
        caseName: fixture.id,
        runIndex: 0,
        programmaticPass: false,
        judgeScore: null,
        judgeReasoning: null,
        outputSnippet: "",
        costUsdEstimate: perFixtureCost,
        durationMs: 0,
        errorMessage:
          result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      continue;
    }

    const { fr, durationMs } = result.value;
    const snippet = JSON.stringify({
      cached: fr.cached,
      picks: fr.picks.map((p) => ({
        name: p.name,
        category: p.category,
        note: p.context_note,
      })),
    });
    const rowPassed = fr.judge.overall >= PASS_FLOOR;
    const reasoning = [
      `Overall ${fr.judge.overall}/5`,
      `factual=${fr.judge.factualAccuracy.score} fit=${fr.judge.profileFit.score} friction=${fr.judge.usefulFriction.score}`,
      fr.cached ? "(cached)" : "",
      fr.judge.usefulFriction.reasoning,
    ]
      .filter(Boolean)
      .join(" · ");
    caseOutcomes.push({
      caseName: fixture.id,
      runIndex: 0,
      programmaticPass: rowPassed,
      judgeScore: fr.judge.overall,
      judgeReasoning: reasoning,
      outputSnippet: snippet.length > 1024 ? snippet.slice(0, 1024) + "…" : snippet,
      costUsdEstimate: fr.cached ? perFixtureCost / 5 : perFixtureCost,
      durationMs,
      errorMessage: rowPassed ? null : `Scored ${fr.judge.overall}/5 — below ${PASS_FLOOR}/5 floor`,
    });
  }

  const judgeScores = caseOutcomes
    .map((c) => c.judgeScore)
    .filter((s): s is number => s !== null);
  const avg =
    judgeScores.length > 0 ? judgeScores.reduce((s, n) => s + n, 0) / judgeScores.length : 0;
  const min = judgeScores.length > 0 ? Math.min(...judgeScores) : 0;
  const overallSuitePass = avg >= PASS_AVG && min >= PASS_FLOOR;

  const passedRows = caseOutcomes.filter((c) => c.programmaticPass).length;
  const passRate = caseOutcomes.length === 0 ? 0 : (passedRows / caseOutcomes.length) * 100;

  return {
    caseOutcomes,
    passRate,
    overallSuitePass,
    suiteAverageScore: avg,
  };
}
