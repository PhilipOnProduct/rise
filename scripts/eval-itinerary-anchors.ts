/**
 * PHI-90 — Itinerary anchors eval
 *
 * Verifies the /api/itinerary/generate prompt honours the hard constraints
 * on user-seeded must-dos:
 *
 *   1. Anchors are PLACED. Every must-do appears in the returned itinerary
 *      on exactly one day in exactly one time block.
 *   2. Anchors are FLAGGED. Items the model places against a must-do are
 *      returned with `"seededByUser": true`.
 *   3. Anchors are NEVER silently dropped. When the generator can't fit
 *      one, it returns a top-level `placement_notes` string explaining
 *      what it cut and why.
 *   4. The trip stays put. A "wrong city" anchor (the Louvre on a Lisbon
 *      trip) MUST be surfaced in `placement_notes` and the trip MUST
 *      remain in the requested destination.
 *   5. Anchors land in sensible time blocks. A splurge dinner goes to the
 *      evening; a museum that fits a 90-min child-tolerance constraint
 *      respects it.
 *
 * LLM-as-judge per the pattern in eval-itinerary-location.ts (Sonnet 4.6
 * scorer with structured JSON output). Programmatic checks run first; a
 * single criterion failing programmatically marks the case failed without
 * burning a judge call.
 *
 * Usage (requires the dev server running on localhost:3000):
 *   npm run eval:anchors
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
const SITE_PASSWORD = process.env.SITE_PASSWORD;

// ---------------------------------------------------------------------------
// Auth bootstrap — mirrors scripts/eval-itinerary-location.ts. Required when
// SITE_PASSWORD is set (CI / staging). Local dev with the gate off returns
// null and we proceed cookie-less.
// ---------------------------------------------------------------------------
async function bootstrapAuth(): Promise<string | null> {
  if (!SITE_PASSWORD) return null;

  const body = new URLSearchParams();
  body.set("password", SITE_PASSWORD);
  body.set("redirect_to", "/");

  const res = await fetch(`${BASE_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });

  if (res.status !== 303) {
    throw new Error(`Auth bootstrap got unexpected status ${res.status} from /api/auth`);
  }

  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") ?? "").split(/,(?=\s*[a-zA-Z0-9_-]+=)/);

  const siteAuth = setCookies.find((c) => c.trim().startsWith("site_auth="));
  if (!siteAuth) {
    throw new Error(
      "Auth bootstrap: no site_auth cookie in /api/auth response — SITE_PASSWORD likely incorrect.",
    );
  }

  return siteAuth.split(";")[0].trim();
}

// ---------------------------------------------------------------------------
// Test cases — the 5 PRD-mandated traps.
// ---------------------------------------------------------------------------

type GenerateRequest = {
  destination: string;
  departureDate: string;
  returnDate: string;
  hotel?: string | null;
  travelCompany?: string | null;
  travelerTypes?: string[] | null;
  budgetTier?: string | null;
  travelerCount?: number | null;
  childrenAges?: string[] | null;
  userSeededActivities: string[];
};

type TestCase = {
  label: string;
  request: GenerateRequest;
  /**
   * Programmatic checks run before the LLM judge — if any fail, the case
   * is marked failed without a judge call. Each entry returns:
   *   - { ok: true } when satisfied
   *   - { ok: false, reason: "..." } when violated
   *
   * The case-level `description` (below) is a natural-language summary of
   * what we expect for the judge prompt — it doesn't gate the result.
   */
  programmatic: ((args: ProgrammaticArgs) => { ok: boolean; reason?: string })[];
  judgeCriteria: string[];
};

type ProgrammaticArgs = {
  destination: string;
  anchors: string[];
  days: Day[];
  placementNotes: string | null;
  flatItems: Item[];
  seededItems: Item[];
};

type Item = {
  id: string;
  title: string;
  description: string;
  type: string;
  time_block: string;
  seededByUser?: boolean;
};

type Day = {
  date: string;
  day_number: number;
  items: Item[];
};

// Programmatic check helpers — share across cases.
const allAnchorsPlacedOrNoted = ({ anchors, seededItems, placementNotes }: ProgrammaticArgs) => {
  // Every anchor must EITHER have a seededByUser-flagged item whose title
  // closely matches, OR appear in placement_notes (case-insensitive
  // substring). Missing from both = silent drop = hard fail.
  const flagged = new Set(seededItems.map((i) => i.title.toLowerCase()));
  const notes = (placementNotes ?? "").toLowerCase();
  const missing: string[] = [];
  for (const anchor of anchors) {
    const a = anchor.toLowerCase();
    const wasFlagged = [...flagged].some(
      (t) => t.includes(a) || a.includes(t),
    );
    const inNotes = notes.includes(a);
    if (!wasFlagged && !inNotes) missing.push(anchor);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `silent drop — anchor(s) neither placed nor mentioned in placement_notes: ${missing.join(" | ")}`,
    };
  }
  return { ok: true };
};

const tripStaysInDestination = ({ destination, days }: ProgrammaticArgs) => {
  // Light sanity check — the model can mention nearby cities, but the
  // overall trip should still reference the destination. We look for the
  // destination name to appear in at least one item description.
  const dest = destination.toLowerCase();
  const allDesc = days
    .flatMap((d) => d.items.map((i) => i.description))
    .join(" ")
    .toLowerCase();
  if (!allDesc.includes(dest.split(",")[0].trim().split(" ")[0])) {
    return {
      ok: false,
      reason: `destination "${destination}" not referenced in any description`,
    };
  }
  return { ok: true };
};

const anchorsAreFlagged = ({ anchors, days }: ProgrammaticArgs) => {
  // For each anchor, the actual ANCHOR item (the one the user asked for)
  // must carry seededByUser: true. Other items can share the anchor's
  // name string (e.g. "Breakfast at <Museum> café") — that's fine as
  // long as the real anchor item itself is flagged. So we pass the check
  // when there's AT LEAST one matching item with the flag set. Only fail
  // when matching items exist but none are flagged.
  const flat = days.flatMap((d) => d.items);
  for (const anchor of anchors) {
    const a = anchor.toLowerCase();
    const matches = flat.filter(
      (i) =>
        i.title.toLowerCase().includes(a) || a.includes(i.title.toLowerCase()),
    );
    if (matches.length === 0) continue; // covered by allAnchorsPlacedOrNoted
    const anyFlagged = matches.some((m) => m.seededByUser === true);
    if (!anyFlagged) {
      const sample = matches[0];
      return {
        ok: false,
        reason: `anchor "${anchor}" referenced by item(s) like "${sample.title}" but no matching item is flagged seededByUser=true`,
      };
    }
  }
  return { ok: true };
};

// PHI-94 — Vague free-text anchor handling.
//
// For vague entries (e.g. "the famous viewpoint", "that ramen spot Anthony
// Bourdain went to"), the prompt's "use the entry text as the title
// verbatim" rule forces two failure modes that the existing helpers can't
// distinguish from success:
//   - unhelpful-verbatim: item is shipped with title equal to the vague
//     string, putting an empty container on the day.
//   - silent hallucination: model invents a fabricated venue name to
//     satisfy the entry (the wrong-city precedent in PHI-51 shows this
//     risk is non-trivial).
//
// This helper passes when, for each verbatim vague string, either
//   (a) RESOLVE: no placed item has a title exactly equal to the verbatim
//       string, AND at least one seededByUser item exists with a different
//       title (the model resolved the vague entry to a real venue), or
//   (b) FLAG: placement_notes mentions the verbatim string (case-
//       insensitive substring) AND uses one of the "try a specific name"
//       / "we weren't sure" / "could be" framings.
// Otherwise the helper fails. Note: the resolve check is intentionally
// loose — it accepts the existence of ANY non-verbatim seededByUser item
// rather than trying to tie it back to the specific anchor. The
// per-anchor judgement of whether the resolution is correct lives in the
// LLM judge criteria, where each vague entry is evaluated on its own.
const VAGUE_FLAG_FRAMINGS: RegExp[] = [
  /try (?:a )?(?:more )?specific name/i,
  /be more specific/i,
  /we(?:'| )?weren'?t sure/i,
  /not sure (?:which|what)/i,
  /could be (?:one of|several|any|either)/i,
  /which (?:one|place|specific|venue|spot|of (?:these|several))/i,
  /ambiguous/i,
];

const vagueAnchorsResolvedOrFlagged =
  (verbatimStrings: string[]) =>
  ({ placementNotes, flatItems, seededItems }: ProgrammaticArgs) => {
    const notes = placementNotes ?? "";
    const notesLower = notes.toLowerCase();
    const failures: string[] = [];

    for (const verbatim of verbatimStrings) {
      const verbatimLower = verbatim.trim().toLowerCase();

      // Unhelpful-verbatim mode: any item (not just seeded ones) titled
      // exactly the vague entry. Reject regardless of resolve / flag —
      // shipping the verbatim as a title is the failure mode we're
      // probing for.
      const verbatimTitled = flatItems.find(
        (i) => i.title.trim().toLowerCase() === verbatimLower,
      );
      if (verbatimTitled) {
        failures.push(
          `item shipped with verbatim vague title "${verbatim}" (unhelpful-verbatim mode)`,
        );
        continue;
      }

      const resolved = seededItems.some(
        (i) => i.title.trim().toLowerCase() !== verbatimLower,
      );

      const inNotes = notesLower.includes(verbatimLower);
      const hasFramingPhrase = VAGUE_FLAG_FRAMINGS.some((re) => re.test(notes));
      const flagged = inNotes && hasFramingPhrase;

      if (!resolved && !flagged) {
        failures.push(
          `vague anchor "${verbatim}" was neither resolved (no seededByUser item with a non-verbatim title) nor flagged in placement_notes (must quote the verbatim AND use a "try a specific name" / "we weren't sure" / "could be" framing)`,
        );
      }
    }

    if (failures.length > 0) {
      return { ok: false, reason: failures.join(" | ") };
    }
    return { ok: true };
  };

const TEST_CASES: TestCase[] = [
  {
    label: "PHI-90 #1: Lisbon with 3 must-dos — all three land, badged",
    request: {
      destination: "Lisbon",
      departureDate: "2026-09-14",
      returnDate: "2026-09-17",
      hotel: "Pousada de Lisboa",
      travelCompany: "partner",
      travelerTypes: ["Cultural", "Food-led"],
      budgetTier: "comfortable",
      travelerCount: 2,
      childrenAges: null,
      userSeededActivities: [
        "Cervejaria Ramiro",
        "Time Out Market",
        "Sunset at Miradouro da Senhora do Monte",
      ],
    },
    programmatic: [allAnchorsPlacedOrNoted, tripStaysInDestination, anchorsAreFlagged],
    judgeCriteria: [
      "All three user-seeded must-dos appear as items in the itinerary — none silently dropped",
      "Each anchor sits in a time block that makes sense for what it is (restaurant in afternoon/evening, sunset viewpoint in evening)",
      "The trip remains anchored to Lisbon — no items from other cities",
      "The surrounding (non-anchor) activities respect the budget and travel-style profile",
    ],
  },
  {
    label: "PHI-90 #2: 2-day Lisbon with 10 must-dos — all included OR placement_notes lists cuts",
    request: {
      destination: "Lisbon",
      departureDate: "2026-09-14",
      returnDate: "2026-09-16",
      hotel: null,
      travelCompany: "solo",
      travelerTypes: ["Cultural"],
      budgetTier: "budget",
      travelerCount: 1,
      childrenAges: null,
      userSeededActivities: [
        "Cervejaria Ramiro",
        "Pastéis de Belém",
        "Tram 28 ride",
        "Jerónimos Monastery",
        "Time Out Market",
        "LX Factory",
        "Fado in Alfama",
        "Castelo de São Jorge",
        "Sunset at Miradouro da Senhora do Monte",
        "Oceanário de Lisboa",
      ],
    },
    programmatic: [allAnchorsPlacedOrNoted, tripStaysInDestination],
    judgeCriteria: [
      "Every must-do is EITHER placed in the itinerary as an anchor OR explicitly listed in placement_notes — no silent drops",
      "If placement_notes is present, it names the SPECIFIC anchor(s) that couldn't be fitted and explains why",
      "The trip remains a 2-day Lisbon plan — no destination change",
    ],
  },
  {
    label: "PHI-90 #3: 'the Louvre' on Lisbon trip — trip stays in Lisbon, anchor flagged in placement_notes",
    request: {
      destination: "Lisbon",
      departureDate: "2026-09-14",
      returnDate: "2026-09-17",
      hotel: "Pousada de Lisboa",
      travelCompany: "partner",
      travelerTypes: ["Cultural"],
      budgetTier: "comfortable",
      travelerCount: 2,
      childrenAges: null,
      userSeededActivities: [
        "Cervejaria Ramiro",
        "the Louvre",
      ],
    },
    programmatic: [
      tripStaysInDestination,
      // Custom check: the Louvre MUST NOT appear as a placed item.
      ({ days }) => {
        const louvre = days
          .flatMap((d) => d.items)
          .find((i) => i.title.toLowerCase().includes("louvre"));
        if (louvre) {
          return {
            ok: false,
            reason: `'the Louvre' was placed as an item ("${louvre.title}") on a Lisbon trip — wrong-city trap was not honoured`,
          };
        }
        return { ok: true };
      },
      // Custom check: placement_notes MUST mention the Louvre being out of scope.
      ({ placementNotes }) => {
        const notes = (placementNotes ?? "").toLowerCase();
        if (!notes.includes("louvre")) {
          return {
            ok: false,
            reason: `'the Louvre' anchor was filtered but not surfaced in placement_notes`,
          };
        }
        return { ok: true };
      },
      // The valid anchor (Ramiro) should still land.
      allAnchorsPlacedOrNoted,
    ],
    judgeCriteria: [
      "The trip remains in Lisbon — no items from Paris or any other city",
      "The Louvre is NOT placed as an activity in any day",
      "placement_notes explicitly names 'the Louvre' (or equivalent) as an anchor that was filtered out for being in the wrong city",
      "The other anchor (Cervejaria Ramiro) is still placed in the itinerary",
    ],
  },
  {
    label: "PHI-90 #4: Tokyo splurge-dinner anchor lands on dinner block, not lunch",
    request: {
      destination: "Tokyo",
      departureDate: "2026-10-12",
      returnDate: "2026-10-16",
      hotel: "Aman Tokyo",
      travelCompany: "partner",
      travelerTypes: ["Food-led", "Cultural"],
      budgetTier: "luxury",
      travelerCount: 2,
      childrenAges: null,
      userSeededActivities: [
        "Sushi Saito splurge dinner",
      ],
    },
    programmatic: [
      allAnchorsPlacedOrNoted,
      // Custom check: the Saito anchor MUST be in the evening block.
      ({ days }) => {
        const saito = days
          .flatMap((d) => d.items)
          .find((i) => i.title.toLowerCase().includes("saito"));
        if (!saito) return { ok: true }; // covered by allAnchorsPlacedOrNoted
        if (saito.time_block !== "evening") {
          return {
            ok: false,
            reason: `Sushi Saito splurge dinner placed in '${saito.time_block}' block instead of 'evening'`,
          };
        }
        return { ok: true };
      },
      tripStaysInDestination,
    ],
    judgeCriteria: [
      "The 'Sushi Saito splurge dinner' anchor is placed in an EVENING time block (not morning or afternoon)",
      "The day containing the splurge dinner is not over-loaded — afternoon stays light so the traveller arrives at dinner relaxed",
      "The rest of the trip is Tokyo-specific and respects the luxury budget",
    ],
  },
  {
    label: "PHI-90 #5: Family with 5–8 child — museum anchor respects 90-min child tolerance",
    request: {
      destination: "Lisbon",
      departureDate: "2026-09-14",
      returnDate: "2026-09-17",
      hotel: "Olissippo Lapa Palace",
      travelCompany: "family",
      travelerTypes: ["Cultural", "Kid-friendly"],
      budgetTier: "comfortable",
      travelerCount: 4,
      childrenAges: ["5–8", "5–8"],
      userSeededActivities: [
        "Museu Nacional do Azulejo",
      ],
    },
    programmatic: [
      allAnchorsPlacedOrNoted,
      anchorsAreFlagged,
      tripStaysInDestination,
    ],
    judgeCriteria: [
      "The Museu Nacional do Azulejo anchor is placed in the itinerary",
      "The same day the museum lands does not pile on more heavy cultural items — the schedule respects a 5–8 year-old's 90-minute attention span",
      "Other activities on the same day include some kid-friendly counterweight (outdoor space, a snack stop, a park) — not back-to-back museums",
      "The trip remains in Lisbon",
    ],
  },
  // ---------------------------------------------------------------------
  // PHI-94 — Vague free-text anchor entries.
  //
  // Real traveller notes look like "that famous pastéis place" or "the
  // viewpoint with the painted tiles", not like "Pastéis de Belém". The
  // PHI-90 prompt's "use the entry text as the title verbatim" rule
  // creates two failure modes on vague input — silent hallucination
  // (inventing a fabricated venue) and unhelpful-verbatim (shipping the
  // vague text as a title). These cases probe both. Pass condition for
  // each case: the generator either RESOLVES the vague entry to a real,
  // recognisable in-destination venue (placed with seededByUser=true,
  // title NOT equal to the verbatim) OR FLAGS the ambiguity in
  // placement_notes by quoting the verbatim and asking the user for a
  // more specific name.
  // ---------------------------------------------------------------------
  {
    label: "PHI-94 #6: Lisbon — vague pastéis + vague viewpoint resolve OR flag",
    request: {
      destination: "Lisbon",
      departureDate: "2026-09-14",
      returnDate: "2026-09-17",
      hotel: "Pousada de Lisboa",
      travelCompany: "partner",
      travelerTypes: ["Cultural", "Food-led"],
      budgetTier: "comfortable",
      travelerCount: 2,
      childrenAges: null,
      userSeededActivities: [
        "that famous pastéis place",
        "the viewpoint with the painted tiles",
      ],
    },
    programmatic: [
      tripStaysInDestination,
      vagueAnchorsResolvedOrFlagged([
        "that famous pastéis place",
        "the viewpoint with the painted tiles",
      ]),
    ],
    judgeCriteria: [
      "For each vague entry, the generator either places a real, in-destination venue (whose title is NOT the verbatim vague text) OR surfaces the ambiguity in placement_notes by quoting the vague text and asking the user for a specific name. Inventing a fabricated venue name = fail.",
      "If venues were resolved, they are well-known Lisbon spots — pastéis de nata at a real bakery (Pastéis de Belém, Manteigaria, or similar); a real Lisbon viewpoint with a verifiable name (Miradouro da Senhora do Monte, Miradouro de Santa Catarina, or similar). The resolution must be a place a Lisbon resident would recognise — not a plausible-sounding invention.",
      "No item title is the verbatim vague string ('that famous pastéis place' or 'the viewpoint with the painted tiles')",
      "The trip remains in Lisbon — no items from other cities",
    ],
  },
  {
    label: "PHI-94 #7: Tokyo — vague Bourdain ramen reference resolves OR flags ambiguity",
    request: {
      destination: "Tokyo",
      departureDate: "2026-10-12",
      returnDate: "2026-10-16",
      hotel: "Aman Tokyo",
      travelCompany: "partner",
      travelerTypes: ["Food-led"],
      budgetTier: "luxury",
      travelerCount: 2,
      childrenAges: null,
      userSeededActivities: [
        "that ramen spot Anthony Bourdain went to",
      ],
    },
    programmatic: [
      tripStaysInDestination,
      vagueAnchorsResolvedOrFlagged([
        "that ramen spot Anthony Bourdain went to",
      ]),
    ],
    judgeCriteria: [
      "For the vague Bourdain reference, the generator either places a real Tokyo ramen shop (whose title is NOT 'that ramen spot Anthony Bourdain went to') OR surfaces the ambiguity in placement_notes by quoting the vague text and asking the user for specifics (Bourdain visited several ramen spots in Tokyo). A fabricated ramen shop name = fail.",
      "If a venue was resolved, it is a real, verifiable Tokyo ramen shop a Tokyo resident would recognise — not a plausible-sounding invention",
      "No item title is the verbatim vague string",
      "The trip remains a Tokyo plan and respects the luxury budget",
    ],
  },
  {
    label: "PHI-94 #8: Lisbon — vague 'the famous viewpoint' resolves OR flags ambiguity",
    request: {
      destination: "Lisbon",
      departureDate: "2026-09-14",
      returnDate: "2026-09-17",
      hotel: "Pousada de Lisboa",
      travelCompany: "partner",
      travelerTypes: ["Cultural"],
      budgetTier: "comfortable",
      travelerCount: 2,
      childrenAges: null,
      userSeededActivities: [
        "the famous viewpoint",
      ],
    },
    programmatic: [
      tripStaysInDestination,
      vagueAnchorsResolvedOrFlagged([
        "the famous viewpoint",
      ]),
    ],
    judgeCriteria: [
      "For the vague 'famous viewpoint' entry, the generator either picks a specific Lisbon viewpoint with a real name (Miradouro da Senhora do Monte, Miradouro de Santa Catarina, Miradouro de São Pedro de Alcântara, or similar) OR surfaces the ambiguity in placement_notes (Lisbon has several famous viewpoints) by quoting the vague text and asking the user to pick one. A fabricated viewpoint name = fail.",
      "If a venue was resolved, it is a real, verifiable Lisbon viewpoint a Lisbon resident would recognise",
      "No item title is the verbatim vague string 'the famous viewpoint'",
      "The trip remains in Lisbon",
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers — API call, scoring, printing.
// ---------------------------------------------------------------------------

type ApiResponse = {
  days: Day[];
  bad_day_dates: string[] | null;
  placement_notes: string | null;
};

async function callGenerateApi(
  request: GenerateRequest,
  authCookie: string | null,
): Promise<ApiResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authCookie) headers["Cookie"] = authCookie;

  const res = await fetch(`${BASE_URL}/api/itinerary/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<ApiResponse>;
}

type JudgeResult = {
  score: number;
  passed: boolean;
  criteriaScores: { criterion: string; met: boolean; comment: string }[];
  summary: string;
};

async function judgeWithLlm(
  testCase: TestCase,
  response: ApiResponse,
): Promise<JudgeResult> {
  const criteriaList = testCase.judgeCriteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  const flatItems = response.days
    .flatMap((d) =>
      d.items.map((i) => ({
        day: d.day_number,
        block: i.time_block,
        title: i.title,
        description: i.description,
        seededByUser: i.seededByUser === true,
      })),
    )
    .map(
      (i) =>
        `Day ${i.day}, ${i.block}: ${i.title}${i.seededByUser ? " [ANCHOR]" : ""} — ${i.description}`,
    )
    .join("\n");

  const result = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are evaluating whether an AI trip planner respected user-seeded anchors when generating an itinerary.

## Context
Destination: ${testCase.request.destination}
Trip dates: ${testCase.request.departureDate} → ${testCase.request.returnDate}
User-seeded must-dos: ${testCase.request.userSeededActivities.map((a) => `"${a}"`).join(", ")}

## Items returned
${flatItems || "(empty)"}

## placement_notes returned
${response.placement_notes ?? "(none)"}

## Evaluation criteria
${criteriaList}

Evaluate each criterion strictly. Anchors must never be silently dropped — if a must-do isn't placed AND isn't explained in placement_notes, that's a hard fail.

For vague, free-text anchor entries (entries that don't name a specific venue — e.g. "the famous viewpoint", "that ramen spot Anthony Bourdain went to", "the museum with the painted tiles", "that famous pastéis place"), the resolve-OR-flag rule applies: the generator must EITHER (a) resolve the entry to a real, in-destination venue whose title is a recognisable, verifiable name (NOT the verbatim vague text) and place it with seededByUser=true, OR (b) surface the ambiguity in placement_notes by quoting the vague text and asking the user for a more specific name (framings like "try a specific name" / "we weren't sure" / "could be one of several"). Both of the following are hard fails: inventing a fabricated venue name to satisfy the entry; shipping an item whose title is the verbatim vague text. When judging a resolved venue, ask whether a resident of that destination would recognise the name as a real place — if not, that's a hallucination.

Respond with valid JSON only, no markdown, in this exact shape:
{
  "criteriaScores": [
    { "criterion": "<criterion text>", "met": true|false, "comment": "<one sentence>" }
  ],
  "score": <0-10>,
  "summary": "<two sentences overall assessment>"
}`,
      },
    ],
  });

  const raw = result.content.find((b) => b.type === "text")?.text ?? "";

  try {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as JudgeResult;
    parsed.passed = parsed.score >= 7;
    return parsed;
  } catch {
    throw new Error(`Failed to parse judge response:\n${raw}`);
  }
}

type FinalResult = {
  label: string;
  passed: boolean;
  score: number;
  reason?: string;
};

function printCase(
  testCase: TestCase,
  response: ApiResponse,
  programmaticFailure: { ok: false; reason: string } | null,
  judge: JudgeResult | null,
) {
  const passed = !programmaticFailure && (judge ? judge.passed : false);
  const badge = passed ? "✅ PASS" : "❌ FAIL";
  const score = judge ? judge.score : 0;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${badge}  ${testCase.label}  (score: ${score}/10)`);
  console.log(`${"─".repeat(60)}`);

  console.log(`\n  Destination: ${testCase.request.destination}`);
  console.log(`  Anchors:     ${testCase.request.userSeededActivities.map((a) => `"${a}"`).join(", ")}`);
  console.log(`  placement_notes: ${response.placement_notes ?? "(none)"}`);
  console.log(`  Days returned: ${response.days.length}`);
  const seededCount = response.days.flatMap((d) => d.items).filter((i) => i.seededByUser === true).length;
  console.log(`  Items with seededByUser=true: ${seededCount}`);

  if (programmaticFailure) {
    console.log(`\n  ⚠ Programmatic failure: ${programmaticFailure.reason}`);
    return;
  }

  if (judge) {
    console.log("\n  Judge criteria:");
    for (const c of judge.criteriaScores) {
      const mark = c.met ? "  ✓" : "  ✗";
      console.log(`  ${mark} ${c.criterion}`);
      console.log(`        ${c.comment}`);
    }
    console.log(`\n  Summary: ${judge.summary}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("═".repeat(60));
  console.log("  Itinerary Generate — User-seeded anchors eval (PHI-90)");
  console.log(`  Targeting: ${BASE_URL}`);
  console.log("═".repeat(60));

  let authCookie: string | null = null;
  try {
    authCookie = await bootstrapAuth();
    if (authCookie) {
      console.log("  Auth: bootstrapped via SITE_PASSWORD");
    } else {
      console.log("  Auth: SITE_PASSWORD not set — proceeding without site_auth cookie");
    }
  } catch (err) {
    console.error(`\nAuth bootstrap failed: ${err instanceof Error ? err.message : err}`);
    console.error("Aborting — fix SITE_PASSWORD or unset it before retrying.");
    process.exit(1);
  }

  const results: FinalResult[] = [];

  for (const testCase of TEST_CASES) {
    process.stdout.write(`\nRunning: ${testCase.label}… `);

    try {
      const response = await callGenerateApi(testCase.request, authCookie);
      process.stdout.write("checking… ");

      const flatItems = response.days.flatMap((d) => d.items);
      const seededItems = flatItems.filter((i) => i.seededByUser === true);
      const programmaticArgs: ProgrammaticArgs = {
        destination: testCase.request.destination,
        anchors: testCase.request.userSeededActivities,
        days: response.days,
        placementNotes: response.placement_notes,
        flatItems,
        seededItems,
      };

      let programmaticFailure: { ok: false; reason: string } | null = null;
      for (const check of testCase.programmatic) {
        const r = check(programmaticArgs);
        if (!r.ok) {
          programmaticFailure = { ok: false, reason: r.reason ?? "(no reason)" };
          break;
        }
      }

      let judge: JudgeResult | null = null;
      if (!programmaticFailure) {
        process.stdout.write("judging… ");
        judge = await judgeWithLlm(testCase, response);
      }
      process.stdout.write("done.\n");

      printCase(testCase, response, programmaticFailure, judge);

      const passed = !programmaticFailure && (judge ? judge.passed : false);
      results.push({
        label: testCase.label,
        passed,
        score: judge?.score ?? 0,
        reason: programmaticFailure?.reason,
      });
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
  console.log(`  RESULTS  ${passed}/${results.length} passed  (${passRate}% pass rate)  avg score: ${avgScore}/10`);
  console.log("═".repeat(60));
  for (const r of results) {
    const badge = r.passed ? "✅" : "❌";
    console.log(`  ${badge} ${r.label.padEnd(55)} ${r.score}/10`);
    if (!r.passed && r.reason) {
      console.log(`      ↳ ${r.reason}`);
    }
  }
  console.log();

  process.exit(passed === results.length ? 0 : 1);
}

main();
