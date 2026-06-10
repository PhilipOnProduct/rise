/**
 * PHI-118 — Activity-gen eval runner.
 *
 * Extracted from `scripts/eval-activities.ts`. Output format is
 * byte-identical to the pre-refactor script.
 */

import { exitIfGateFailed, printCaseChecksLine, printChecksSummary } from "../cli";
import { ALL_CASES, parseCards, type Case, type ParsedCard } from "./cases";
import { ACTIVITIES_MODEL, runActivityGen } from "./judge";

export async function runOne(c: Case): Promise<{ cards: ParsedCard[]; raw: string }> {
  const raw = await runActivityGen(c);
  const cards = parseCards(raw);
  return { cards, raw };
}

export async function main(): Promise<void> {
  console.log(
    `\nRunning ${ALL_CASES.length} activity-gen eval cases against ${ACTIVITIES_MODEL}...\n`,
  );
  let totalChecks = 0;
  let passedChecks = 0;
  let lifeImpactingFailures = 0;

  for (const c of ALL_CASES) {
    const { cards, raw } = await runOne(c);
    let casePassed = 0;
    const failures: string[] = [];
    for (const { name, check, lifeImpacting } of c.checks) {
      totalChecks++;
      try {
        if (check(cards, raw)) {
          passedChecks++;
          casePassed++;
        } else {
          failures.push(name + (lifeImpacting ? " [life-impacting]" : ""));
          if (lifeImpacting) lifeImpactingFailures++;
        }
      } catch {
        failures.push(name + " (threw)");
        if (lifeImpacting) lifeImpactingFailures++;
      }
    }
    printCaseChecksLine(c.id, 34, casePassed, c.checks.length, c.description);
    if (failures.length > 0) {
      for (const f of failures) console.log(`    × ${f}`);
      console.log(`    cards: ${cards.length} parsed`);
    }
  }

  const accuracy = (passedChecks / totalChecks) * 100;
  printChecksSummary({
    accuracy,
    secondLine: `Life-impacting failures:  ${lifeImpactingFailures === 0 ? "0 (target 0)" : `${lifeImpactingFailures}`}`,
    casesRun: ALL_CASES.length,
    totalChecks,
    passedChecks,
  });

  exitIfGateFailed(accuracy < 85 || lifeImpactingFailures > 0);
}
