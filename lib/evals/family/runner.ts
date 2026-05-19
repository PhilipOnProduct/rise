/**
 * PHI-118 — Family composition eval runner.
 *
 * Offline; no API calls. Extracted from `scripts/eval-family-prompts.ts`.
 * Output format is byte-identical to the pre-refactor script.
 */

import { buildCompositionSegment } from "../../composition";
import { SCENARIOS, type Scenario } from "./cases";

/**
 * PHI-120 — Family is offline (no API calls), so the cost estimate is
 * always zero. Exported via the same per-suite contract as the paid
 * suites so the registry can read every suite uniformly.
 */
export function costEstimateUsd(): number {
  return 0;
}

/** Per-case run — pure, no console output. Used by GUI in card 2+. */
export function runOne(scenario: Scenario): {
  output: string;
  passed: number;
  failed: number;
  results: { label: string; ok: boolean }[];
} {
  const output = buildCompositionSegment(scenario.travelerCount, scenario.childrenAges);
  const results = scenario.assertions.map((a) => ({
    label: a.label,
    ok: a.test(output),
  }));
  return {
    output,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

export async function main(): Promise<void> {
  let totalPass = 0;
  let totalFail = 0;

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Family Prompt Evaluation — Level 1 (Prompt Inspection)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const scenario of SCENARIOS) {
    const { output, results } = runOne(scenario);

    console.log(`── ${scenario.name} ──`);
    if (scenario.destination) {
      console.log(`   Destination: ${scenario.destination}`);
    }
    console.log(`   Travelers: ${scenario.travelerCount}, Children: [${scenario.childrenAges.join(", ") || "none"}]`);
    console.log(`   ┌─────────────────────────────────────────────`);
    console.log(`   │ PROMPT OUTPUT:`);
    if (output) {
      for (const line of output.split(". ")) {
        console.log(`   │   ${line.trim()}${line.trim().endsWith(".") ? "" : "."}`);
      }
    } else {
      console.log(`   │   (empty — no composition segment generated)`);
    }
    console.log(`   └─────────────────────────────────────────────`);

    for (const r of results) {
      if (r.ok) totalPass++;
      else totalFail++;
      const icon = r.ok ? "✓ PASS" : "✗ FAIL";
      console.log(`   ${icon}  ${r.label}`);
    }

    console.log();
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Results: ${totalPass} passed, ${totalFail} failed out of ${totalPass + totalFail} assertions`);
  console.log("═══════════════════════════════════════════════════════════════");

  if (totalFail > 0) {
    process.exit(1);
  }
}
