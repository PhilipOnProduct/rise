/**
 * PHI-118 — Free-form parser eval runner.
 *
 * Extracted from `scripts/eval-freeform-parser.ts`. Output format is
 * byte-identical to the pre-refactor script.
 */

import { exitIfGateFailed, printCaseChecksLine, printChecksSummary } from "../cli";
import { CASES, type Case } from "./cases";
import { PARSER_MODEL, parse } from "./judge";

export async function runOne(c: Case) {
  const intent = await parse(c.input);
  let casePassed = 0;
  const failures: string[] = [];
  for (const { name, check } of c.checks) {
    try {
      if (check(intent)) {
        casePassed++;
      } else {
        failures.push(name);
      }
    } catch {
      failures.push(name + " (threw)");
    }
  }
  return { intent, casePassed, failures };
}

export async function main(): Promise<void> {
  console.log(`\nRunning ${CASES.length} parser eval cases against ${PARSER_MODEL}...\n`);
  let totalChecks = 0;
  let passedChecks = 0;
  let constraintFailures = 0;

  for (const c of CASES) {
    const { intent, casePassed, failures } = await runOne(c);
    totalChecks += c.checks.length;
    passedChecks += casePassed;
    for (const f of failures) {
      if (/constraint|knee|hiking|allergy|wheelchair|life-impact/i.test(f)) {
        constraintFailures++;
      }
    }
    printCaseChecksLine(c.id, 28, casePassed, c.checks.length, c.description);
    if (failures.length > 0) {
      for (const f of failures) console.log(`    × ${f}`);
      console.log("    intent:", JSON.stringify(intent));
    }
  }

  const accuracy = (passedChecks / totalChecks) * 100;
  printChecksSummary({
    accuracy,
    secondLine: `Constraint preservation:  ${constraintFailures === 0 ? "100%" : `${constraintFailures} failures`}  (target 100%)`,
    casesRun: CASES.length,
    totalChecks,
    passedChecks,
  });

  exitIfGateFailed(accuracy < 85 || constraintFailures > 0);
}
