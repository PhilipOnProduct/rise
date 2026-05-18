/**
 * PHI-119 — Suite registry.
 *
 * Single source of truth for what shows up in the suites picker at
 * /admin/evals/suites. Each entry mirrors a `lib/evals/<slug>/` suite
 * + its `npm run eval:<slug>` script.
 *
 * Cards 3 + 4 + 5 of PHI-117 read this registry to know:
 *   - which suites are paid (card 3 adds the cost-confirm UI),
 *   - which need the dev server up (card 3 surfaces a precondition note),
 *   - which run multi-pass (card 4 wires the runs/case knob),
 *   - which support compare (card 5 wires variance bands).
 *
 * For card 2 only `family` is wired end-to-end (`wired: true`). Every
 * other suite renders as a placeholder in the GUI; the metadata still
 * needs to be accurate because the placeholder cards display it.
 *
 * Cost estimates are rough — keep `lib/api-costs.ts` rates fresh and
 * re-check after any prompt change that materially shifts token counts.
 * Numbers below are sourced from CLAUDE.md "Eval harnesses" and from
 * each suite's PRD comment.
 */
import { runOne as runFamilyCase } from "./family/runner";
import { SCENARIOS as FAMILY_SCENARIOS } from "./family/cases";

/** Where the suite runs from, and what it needs to be up. */
export type SuiteKind =
  /** Pure local computation. No API key, no dev server. */
  | "offline"
  /** Calls Anthropic SDK directly. Needs `ANTHROPIC_API_KEY`. */
  | "needs-api"
  /** Hits a Rise API route over HTTP. Needs `localhost:3000` (or `EVAL_BASE_URL`). */
  | "needs-dev-server";

export type SuiteDescriptor = {
  /** Slug used in URLs (`/admin/evals/suites/<slug>`) and in `eval_suite_runs.suite`. */
  slug: string;
  /** Human-readable label — matches the `npm run eval:<slug>` script. */
  title: string;
  /** One-sentence description displayed on the picker card. */
  description: string;
  kind: SuiteKind;
  /** Rough USD cost per full run. 0 for offline suites. */
  costEstimateUsd: number;
  /** Number of cases the suite executes (used for "Case N of M" progress). */
  caseCount: number;
  /** Runs per case (anchors uses 3×; everything else is 1×). */
  runsPerCase: number;
  /** Whether the GUI wiring is live (card 2 ships only `family`). */
  wired: boolean;
  /** The `npm run` script that invokes the same suite from the CLI. */
  cliScript: string;
};

export const SUITES: SuiteDescriptor[] = [
  {
    slug: "family",
    title: "eval:family",
    description: "Composition segment — 7 family scenarios × 20 assertions against buildCompositionSegment.",
    kind: "offline",
    costEstimateUsd: 0,
    caseCount: 7,
    runsPerCase: 1,
    wired: true,
    cliScript: "eval:family",
  },
  {
    slug: "free-form-detect",
    title: "eval:free-form-detect",
    description: "PHI-58 free-form trip-description detector — pure heuristic cases.",
    kind: "offline",
    costEstimateUsd: 0,
    caseCount: 20,
    runsPerCase: 1,
    wired: false,
    cliScript: "eval:free-form-detect",
  },
  {
    slug: "parser",
    title: "eval:parser",
    description: "50-case free-form parser eval. Pass gate: ≥85% field accuracy, 100% on constraint preservation.",
    kind: "needs-api",
    costEstimateUsd: 0.5,
    caseCount: 50,
    runsPerCase: 1,
    wired: false,
    cliScript: "eval:parser",
  },
  {
    slug: "activities",
    title: "eval:activities",
    description: "30 activity-gen cases (15 single-leg + 15 multi-leg). Pass gate: ≥85% accuracy, 0 life-impacting failures.",
    kind: "needs-api",
    costEstimateUsd: 0.45,
    caseCount: 30,
    runsPerCase: 1,
    wired: false,
    cliScript: "eval:activities",
  },
  {
    slug: "recommendations",
    title: "eval:recommendations",
    description: "Restaurant recommendations against /api/recommendations. LLM-as-judge.",
    kind: "needs-dev-server",
    costEstimateUsd: 0.2,
    caseCount: 3,
    runsPerCase: 1,
    wired: false,
    cliScript: "eval:recommendations",
  },
  {
    slug: "alternatives",
    title: "eval:alternatives",
    description: "5-case restaurant alternative eval against /api/itinerary/alternative. Opus 4.6 judge.",
    kind: "needs-dev-server",
    costEstimateUsd: 0.15,
    caseCount: 5,
    runsPerCase: 1,
    wired: false,
    cliScript: "eval:alternatives",
  },
  {
    slug: "location",
    title: "eval:location",
    description: "5 wrong-city trap cases against /api/itinerary/edit. Sonnet judge.",
    kind: "needs-dev-server",
    costEstimateUsd: 0.2,
    caseCount: 5,
    runsPerCase: 1,
    wired: false,
    cliScript: "eval:location",
  },
  {
    slug: "anchors",
    title: "eval:anchors",
    description: "11 user-seeded anchors cases × 3 runs each against /api/itinerary/generate. Pass gate: all cases pass.",
    kind: "needs-dev-server",
    costEstimateUsd: 2.2,
    caseCount: 11,
    runsPerCase: 3,
    wired: false,
    cliScript: "eval:anchors",
  },
  {
    slug: "country-destination",
    title: "eval:country-destination",
    description: "10-country × 3-run city ranking eval. Pass gate: ≥4/5 overall AND no single case <3/5.",
    kind: "needs-api",
    costEstimateUsd: 0.6,
    caseCount: 10,
    runsPerCase: 3,
    wired: false,
    cliScript: "eval:country-destination",
  },
  {
    slug: "popular-picks",
    title: "eval:popular-picks",
    description: "18 popular-picks cases (6 cities × 3 profiles). Pass gate: avg ≥4/5 AND no single fixture <3/5.",
    kind: "needs-dev-server",
    costEstimateUsd: 1.2,
    caseCount: 18,
    runsPerCase: 1,
    wired: false,
    cliScript: "eval:popular-picks",
  },
];

export function getSuite(slug: string): SuiteDescriptor | undefined {
  return SUITES.find((s) => s.slug === slug);
}

/**
 * PHI-119 — Family suite executor for the GUI.
 *
 * Mirrors the CLI's `runOne` loop but returns structured per-case data
 * the API route can persist to `eval_case_runs` directly. No console
 * output and no `process.exit` — both belong to the CLI `main()`.
 *
 * Keeping this in the registry instead of `family/runner.ts` means the
 * CLI runner stays byte-identical (CLAUDE.md hard constraint from
 * PHI-118).
 */
export type FamilyCaseOutcome = {
  caseName: string;
  programmaticPass: boolean;
  assertionsPassed: number;
  assertionsFailed: number;
  outputSnippet: string;
  durationMs: number;
  failedAssertionLabels: string[];
};

export type FamilySuiteOutcome = {
  caseOutcomes: FamilyCaseOutcome[];
  passRate: number; // 0–100, percentage of cases where all assertions pass
  totalAssertions: number;
  passedAssertions: number;
};

export function runFamilySuiteForGui(): FamilySuiteOutcome {
  const caseOutcomes: FamilyCaseOutcome[] = [];
  let totalAssertions = 0;
  let passedAssertions = 0;

  for (const scenario of FAMILY_SCENARIOS) {
    const t0 = Date.now();
    const { output, passed, failed, results } = runFamilyCase(scenario);
    const durationMs = Date.now() - t0;

    totalAssertions += passed + failed;
    passedAssertions += passed;

    caseOutcomes.push({
      caseName: scenario.name,
      programmaticPass: failed === 0,
      assertionsPassed: passed,
      assertionsFailed: failed,
      // Cap snippet at 1KB — the full segment is regenerable from the scenario inputs.
      outputSnippet: output.length > 1024 ? output.slice(0, 1024) + "…" : output,
      durationMs,
      failedAssertionLabels: results.filter((r) => !r.ok).map((r) => r.label),
    });
  }

  const passedCases = caseOutcomes.filter((c) => c.programmaticPass).length;
  const passRate = caseOutcomes.length === 0 ? 0 : (passedCases / caseOutcomes.length) * 100;

  return { caseOutcomes, passRate, totalAssertions, passedAssertions };
}
