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
 * PHI-120 (card 3) wires the three single-shot Anthropic-paid suites:
 *   - location, recommendations, alternatives.
 * Cost estimates are read live from each suite's exported
 * `costEstimateUsd()` (which derives from `lib/api-costs.ts` rates), so
 * model-rate changes in one place flow through to the picker + dialog.
 */
import { runOne as runFamilyCase } from "./family/runner";
import { SCENARIOS as FAMILY_SCENARIOS } from "./family/cases";
import { costEstimateUsd as familyCost } from "./family/runner";
import {
  costEstimateUsd as locationCost,
  runSuiteForGui as runLocationSuite,
} from "./location/runner";
import {
  costEstimateUsd as recommendationsCost,
  runSuiteForGui as runRecommendationsSuite,
} from "./recommendations/runner";
import {
  costEstimateUsd as alternativesCost,
  runSuiteForGui as runAlternativesSuite,
} from "./alternatives/runner";
import type {
  GuiCaseOutcome,
  GuiRunOpts,
  GuiSuiteOutcome,
} from "./types";

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
  /** Rough USD cost per full run. 0 for offline suites. Derived from `lib/api-costs.ts` via each suite's own `costEstimateUsd()`. */
  costEstimateUsd: number;
  /** Number of cases the suite executes (used for "Case N of M" progress). */
  caseCount: number;
  /** Runs per case (anchors uses 3×; everything else is 1×). */
  runsPerCase: number;
  /** Whether the GUI wiring is live (card 2 ships only `family`; card 3 adds location/recommendations/alternatives). */
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
    costEstimateUsd: familyCost(),
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
    costEstimateUsd: recommendationsCost(),
    caseCount: 3,
    runsPerCase: 1,
    wired: true,
    cliScript: "eval:recommendations",
  },
  {
    slug: "alternatives",
    title: "eval:alternatives",
    description: "5-case restaurant alternative eval against /api/itinerary/alternative. Opus 4.6 judge.",
    kind: "needs-dev-server",
    costEstimateUsd: alternativesCost(),
    caseCount: 5,
    runsPerCase: 1,
    wired: true,
    cliScript: "eval:alternatives",
  },
  {
    slug: "location",
    title: "eval:location",
    description: "6 wrong-city trap cases against /api/itinerary/edit. Sonnet judge.",
    kind: "needs-dev-server",
    costEstimateUsd: locationCost(),
    caseCount: 6,
    runsPerCase: 1,
    wired: true,
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

// ── Suite executors ──────────────────────────────────────────────────────────
//
// Family's executor lives here (offline, no opts needed) — PHI-119
// rationale. Paid suites' executors live in their own runner.ts files
// and are dispatched via `getSuiteExecutor` below.

/**
 * PHI-119/120 — Family suite executor for the GUI.
 *
 * Mirrors the CLI's `runOne` loop but returns the unified
 * {@link GuiSuiteOutcome} so the runs route and the page can treat
 * offline + paid suites uniformly. Family is the only offline suite
 * wired in this card, so the `judgeScore` / `judgeReasoning` fields
 * stay null and the family-specific assertion fields carry the detail
 * the CaseList component renders.
 */
export function runFamilySuiteForGui(): GuiSuiteOutcome {
  const caseOutcomes: GuiCaseOutcome[] = [];
  let totalAssertions = 0;
  let passedAssertions = 0;

  for (const scenario of FAMILY_SCENARIOS) {
    const t0 = Date.now();
    const { output, passed, failed, results } = runFamilyCase(scenario);
    const durationMs = Date.now() - t0;

    totalAssertions += passed + failed;
    passedAssertions += passed;

    const failedAssertionLabels = results.filter((r) => !r.ok).map((r) => r.label);
    const programmaticPass = failed === 0;
    caseOutcomes.push({
      caseName: scenario.name,
      programmaticPass,
      judgeScore: null,
      judgeReasoning: null,
      // Cap snippet at 1KB — the full segment is regenerable from the scenario inputs.
      outputSnippet: output.length > 1024 ? output.slice(0, 1024) + "…" : output,
      costUsdEstimate: 0,
      durationMs,
      errorMessage: programmaticPass
        ? null
        : `Failed assertions: ${failedAssertionLabels.join(" | ")}`,
      assertionsPassed: passed,
      assertionsFailed: failed,
      failedAssertionLabels,
    });
  }

  const passedCases = caseOutcomes.filter((c) => c.programmaticPass).length;
  const passRate = caseOutcomes.length === 0 ? 0 : (passedCases / caseOutcomes.length) * 100;

  return { caseOutcomes, passRate, totalAssertions, passedAssertions };
}

/**
 * PHI-120 — Dispatch table for paid suites. The runs route POSTs to
 * `/api/admin/evals/suites/<slug>/runs`, the slug is looked up here,
 * and the executor is invoked with the inbound request's origin +
 * cookie + the new suite_run row's id (for the `X-Suite-Run-Id` header).
 *
 * Returns `undefined` for slugs not yet wired (the runs route falls back
 * to the "not_wired" 409 response). Family is handled directly by the
 * runs route via `runFamilySuiteForGui()` because it doesn't need opts.
 */
export function getGuiSuiteExecutor(
  slug: string,
): ((opts: GuiRunOpts) => Promise<GuiSuiteOutcome>) | undefined {
  switch (slug) {
    case "location":
      return runLocationSuite;
    case "recommendations":
      return runRecommendationsSuite;
    case "alternatives":
      return runAlternativesSuite;
    default:
      return undefined;
  }
}
