/**
 * PHI-118 — Restaurant alternatives eval runner.
 *
 * Extracted from `scripts/eval-alternatives.ts`. Output format is
 * byte-identical to the pre-refactor script.
 */

import { TEST_CASES, type AlternativeRequest, type TestCase } from "./cases";
import { judge, type ScoreResult } from "./judge";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";

async function getAlternative(request: AlternativeRequest): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/api/itinerary/alternative`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!res.ok) throw new Error(`API returned ${res.status}`);
  const data = await res.json();
  if (!data.alternative) throw new Error("No alternative in response");
  return data.alternative;
}

export async function runOne(testCase: TestCase) {
  const alternative = await getAlternative(testCase.request);
  const result = await judge(testCase, alternative);
  return { alternative, result };
}

function printResult(
  testCase: TestCase,
  alternative: Record<string, unknown>,
  result: ScoreResult,
) {
  const badge = result.passed ? "✅ PASS" : "❌ FAIL";
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${badge}  ${testCase.label}  (score: ${result.score}/10)`);
  console.log(`${"─".repeat(60)}`);

  console.log("\nGenerated alternative:");
  console.log(`  Title: ${alternative.title}`);
  console.log(`  Cuisine: ${alternative.cuisine} · Vibe: ${alternative.vibe} · Price: ${alternative.price_tier}`);
  console.log(`  Description: ${alternative.description}`);
  const meta = alternative.booking_meta as Record<string, unknown> | undefined;
  if (meta) {
    console.log(`  Booking: ${meta.preferred_platform} (${meta.confidence}) — "${meta.search_query}"`);
  }

  console.log("\nCriteria:");
  for (const c of result.criteriaScores) {
    const mark = c.met ? "  ✓" : "  ✗";
    console.log(`${mark} ${c.criterion}`);
    console.log(`      ${c.comment}`);
  }

  console.log(`\nSummary: ${result.summary}`);
}

export async function main(): Promise<void> {
  console.log("🔍 Rise — Restaurant Alternative Eval");
  console.log(`   Targeting: ${BASE_URL}`);
  console.log(`   Testing ${TEST_CASES.length} replacement scenarios\n`);

  const results: { label: string; passed: boolean; score: number }[] = [];

  for (const testCase of TEST_CASES) {
    process.stdout.write(`Running: ${testCase.label}... `);

    try {
      const alternative = await getAlternative(testCase.request);
      process.stdout.write("scoring... ");
      const result = await judge(testCase, alternative);
      process.stdout.write("done.\n");

      printResult(testCase, alternative, result);
      results.push({ label: testCase.label, passed: result.passed, score: result.score });
    } catch (err) {
      process.stdout.write("error.\n");
      console.error(`  ⚠ ${testCase.label}: ${err instanceof Error ? err.message : err}`);
      results.push({ label: testCase.label, passed: false, score: 0 });
    }
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const passRate = Math.round((passed / results.length) * 100);
  const avgScore = (results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`RESULTS  ${passed}/${results.length} passed  (${passRate}% pass rate)  avg score: ${avgScore}/10`);
  console.log("═".repeat(60));
  for (const r of results) {
    const badge = r.passed ? "✅" : "❌";
    console.log(`  ${badge} ${r.label.padEnd(55)} ${r.score}/10`);
  }
  console.log();

  process.exit(passed === results.length ? 0 : 1);
}
