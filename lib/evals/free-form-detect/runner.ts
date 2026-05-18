/**
 * PHI-118 — Free-form-detect eval runner.
 *
 * Offline; no API calls. Extracted from `scripts/eval-free-form-detect.ts`.
 * Output format is byte-identical to the pre-refactor script.
 */

import { isFreeFormTripDescription } from "../../free-form-detect";
import { CASES, type Case } from "./cases";

/** Per-case run — pure, no console output. */
export function runOne(c: Case): { got: boolean; ok: boolean } {
  const got = isFreeFormTripDescription(c.input);
  return { got, ok: got === c.expected };
}

export async function main(): Promise<void> {
  let pass = 0;
  let fail = 0;

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  PHI-58 — Free-form detection cases");
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const c of CASES) {
    const { got, ok } = runOne(c);
    if (ok) pass++;
    else fail++;
    const icon = ok ? "✓ PASS" : "✗ FAIL";
    console.log(`${icon}  ${JSON.stringify(c.input)}`);
    console.log(`        expected ${c.expected} · got ${got} · ${c.note}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`  ${pass} passed, ${fail} failed out of ${pass + fail}`);
  console.log("═══════════════════════════════════════════════════════════════");

  if (fail > 0) process.exit(1);
}
