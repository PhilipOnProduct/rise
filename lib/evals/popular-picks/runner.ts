/**
 * PHI-118 — Popular Picks eval runner.
 *
 * Extracted from `scripts/eval-popular-picks.ts`. Output format is
 * byte-identical to the pre-refactor script.
 */

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

export type FixtureResult = {
  fixture: Fixture;
  picks: PopularPick[];
  judge: JudgeResult;
  cached: boolean;
};

export async function runFixture(
  fixture: Fixture,
  authCookie: string | null,
): Promise<FixtureResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authCookie) headers["Cookie"] = authCookie;
  const res = await fetch(`${BASE_URL}/api/destination/popular-picks`, {
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
  const judged = await judge(fixture, picks);
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
