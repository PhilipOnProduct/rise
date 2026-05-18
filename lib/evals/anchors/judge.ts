/**
 * PHI-118 — Itinerary anchors eval LLM-as-judge.
 *
 * Sonnet 4.6 + raw-JSON output (no tool_use) + trailing-comma cleanup.
 * Extracted verbatim from `scripts/eval-itinerary-anchors.ts`, including
 * the "Failed to parse judge response:\n${raw}" error message shape
 * (note: anchors uses "judge response", not "scorer response").
 */

import { parseJsonJudgeResponse, runRawJudge } from "../judge";
import type { ApiResponse, TestCase } from "./types";

export type JudgeResult = {
  score: number;
  passed: boolean;
  criteriaScores: { criterion: string; met: boolean; comment: string }[];
  summary: string;
};

export async function judgeWithLlm(
  testCase: TestCase,
  response: ApiResponse,
): Promise<JudgeResult> {
  const criteriaList = testCase.judgeCriteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  // PHI-95: surface leg_index / is_transition in the items dump for
  // multi-leg cases so the judge can score the leg-routing criterion.
  const isMultiLeg = Array.isArray(testCase.request.legs) && testCase.request.legs.length >= 2;
  const flatItems = response.days
    .flatMap((d) =>
      d.items.map((i) => ({
        day: d.day_number,
        block: i.time_block,
        title: i.title,
        description: i.description,
        seededByUser: i.seededByUser === true,
        leg_index: d.leg_index,
        is_transition: d.is_transition === true,
      })),
    )
    .map((i) => {
      const legTag =
        typeof i.leg_index === "number"
          ? ` [leg ${i.leg_index}${i.is_transition ? ", transition" : ""}]`
          : "";
      return `Day ${i.day}${legTag}, ${i.block}: ${i.title}${i.seededByUser ? " [ANCHOR]" : ""} — ${i.description}`;
    })
    .join("\n");

  const resolutionsBlock = Array.isArray(response.seeded_anchor_resolutions)
    ? response.seeded_anchor_resolutions
        .map((r) => {
          const placedPart = r.placed_title ? `, placed: "${r.placed_title}"` : "";
          const reasonPart = r.reason ? `, reason: ${r.reason}` : "";
          return `- "${r.verbatim}" → mode: ${r.mode}${placedPart}${reasonPart}`;
        })
        .join("\n")
    : "(none)";

  const destinationBlock = isMultiLeg
    ? `Multi-leg trip — legs (in order):\n${testCase.request.legs!
        .map((l, i) => {
          const dates =
            l.startDate && l.endDate ? `, ${l.startDate} → ${l.endDate}` : "";
          const hotel = l.hotel ? `, hotel: ${l.hotel}` : "";
          return `  [leg ${i}] ${l.place?.name ?? "?"}${dates}${hotel}`;
        })
        .join("\n")}`
    : `Destination: ${testCase.request.destination}`;

  const multiLegPreamble = isMultiLeg
    ? "\n\nThis is a multi-leg trip; assess leg routing alongside the usual anchor rules — anchors should land on a day whose leg_index matches the city the anchor belongs to (or be flagged in placement_notes when ambiguous)."
    : "";

  const userMessage = `You are evaluating whether an AI trip planner respected user-seeded anchors when generating an itinerary.${multiLegPreamble}

## Context
${destinationBlock}
Trip dates: ${testCase.request.departureDate} → ${testCase.request.returnDate}
User-seeded must-dos: ${testCase.request.userSeededActivities.map((a) => `"${a}"`).join(", ")}

## Items returned
${flatItems || "(empty)"}

## placement_notes returned
${response.placement_notes ?? "(none)"}

## time_sensitive_alerts returned (PHI-114 — array of one-sentence facts the traveller must verify or act on)
${
  Array.isArray(response.time_sensitive_alerts) && response.time_sensitive_alerts.length > 0
    ? response.time_sensitive_alerts.map((a) => `- ${a}`).join("\n")
    : "(none)"
}

## seeded_anchor_resolutions returned (PHI-103 — model's per-anchor titling-mode declaration)
${resolutionsBlock}

## Evaluation criteria
${criteriaList}

Evaluate each criterion strictly. Anchors must never be silently dropped — if a must-do isn't placed AND isn't explained in placement_notes, that's a hard fail.

For vague, free-text anchor entries (entries that don't name a specific venue — e.g. "the famous viewpoint", "that ramen spot Anthony Bourdain went to", "the museum with the painted tiles", "that famous pastéis place"), the three-mode resolve-OR-flag rubric applies (PHI-103):

* **Resolve (mode 2)** — the model places a real, in-destination venue whose title is a recognisable, verifiable name (NOT the verbatim vague text), with seededByUser=true. When this path is taken, the placement_notes MUST ALSO surface the substitution by mentioning both the verbatim and the resolved venue (e.g. *"We took 'that famous pastéis place' to mean Pastéis de Belém"*). Silent resolution — resolving without surfacing in placement_notes — is a hard fail per Maya's surface-the-verbatim rule.
* **Flag (mode 3)** — the model declines to place an item and instead surfaces the ambiguity in placement_notes, quoting the verbatim and asking for a more specific name (framings like "try a specific name", "we weren't sure", "could be one of several"). Naming 2–3 plausible candidates is a plus.

**Flag-bias on ambiguity** (Elena): when more than one venue could plausibly match the verbatim (multiple Lisbon viewpoints, multiple ramen shops Bourdain visited, multiple "famous" Xs in the same city), flagging is the correct choice — a confident wrong answer is worse than a friendly question back. Resolve only when the venue is unique enough that a resident would consistently give the same answer.

**Hard fails:** inventing a fabricated venue name; shipping an item whose title is the verbatim vague text; silent resolution (placed but not surfaced); resolving when multiple plausible candidates exist (should have flagged). When judging a resolved venue, ask whether a resident of that destination would recognise the name as a real, specific place — if not, that's a hallucination.

The model also returns a "seeded_anchor_resolutions" field declaring its own per-anchor titling mode ("verbatim" / "resolved" / "flagged"). Cross-check that field against what actually shipped: a "resolved" entry must have a corresponding placed item AND a placement_notes mention; a "flagged" entry must have no placed item AND a flag-shaped placement_notes mention; a "verbatim" entry must have an item whose title matches the verbatim. Inconsistency between the field and the items/notes is a defect even when the criteria above look met.

Respond with valid JSON only, no markdown, in this exact shape — NO EXTRA TOP-LEVEL FIELDS (don't invent debug objects, audits, or per-anchor breakdowns; if you need to surface per-anchor reasoning, fold it into the per-criterion comments):
{
  "criteriaScores": [
    { "criterion": "<criterion text>", "met": true|false, "comment": "<one sentence>" }
  ],
  "score": <0-10>,
  "summary": "<two sentences overall assessment>"
}`;

  const raw = await runRawJudge({ userMessage });

  try {
    // PHI-103: trailing-comma stripping is load-bearing — Sonnet 4.6
    // occasionally emits them in the structured-JSON path.
    const parsed = parseJsonJudgeResponse<JudgeResult>(raw, true);
    parsed.passed = parsed.score >= 7;
    return parsed;
  } catch {
    throw new Error(`Failed to parse judge response:\n${raw}`);
  }
}
