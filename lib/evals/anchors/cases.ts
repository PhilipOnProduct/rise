/**
 * PHI-118 — Itinerary anchors eval cases + programmatic check helpers.
 *
 * 13 test cases (PHI-90 #1-5, PHI-94 #6-8, PHI-95 #9, PHI-105 #10-11,
 * PHI-114 #12-13) for /api/itinerary/generate. Extracted verbatim from
 * `scripts/eval-itinerary-anchors.ts`.
 *
 * Programmatic check helpers live here (per PRD hard constraint —
 * they're functions, not data, but they're per-case and intimately
 * tied to the cases array).
 */

import type { TripLeg } from "../../trip-schema";

// PHI-96: each case runs 3× to absorb model variance on the judge's ≥7
// gate. Mirrors scripts/eval-country-destination.ts. Pass = every run
// passes programmatic checks AND average judge score ≥7.
export const RUNS_PER_CASE = 3;

export type GenerateRequest = {
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
  // PHI-95: multi-leg trips ship the legs[] array alongside destination
  // (which still pins the first leg). The route uses leg_index on each
  // returned day to tag which leg the day belongs to.
  legs?: TripLeg[];
  // PHI-105: optional rich hotel coordinates so the anchor-resolution
  // prompt has the signal to resolve "near our hotel" / hotel-relative
  // anchors. When set on a single-leg case the route builds the
  // hotelContext object and threads it through buildUserSeededAnchorsSegment.
  hotelPlaceId?: string | null;
  hotelLat?: number | null;
  hotelLng?: number | null;
  hotelNeighborhood?: string | null;
};

export type TestCase = {
  label: string;
  request: GenerateRequest;
  programmatic: ((args: ProgrammaticArgs) => { ok: boolean; reason?: string })[];
  judgeCriteria: string[];
};

export type ProgrammaticArgs = {
  destination: string;
  anchors: string[];
  days: Day[];
  placementNotes: string | null;
  flatItems: Item[];
  seededItems: Item[];
  // PHI-103: per-anchor debug record returned alongside days /
  // placement_notes. Null/missing on responses where the model dropped
  // the field; helpers may treat that as a programmatic failure where
  // the PRD requires the field (vague anchors must surface here).
  seededAnchorResolutions: SeededAnchorResolution[] | null;
  // PHI-114: top-level time-sensitive alerts (closures, pre-booking,
  // seasonal cutoffs, peak-time advice, transport quirks). Null when the
  // model had nothing to flag. Helpers assert on shape + voice + cap.
  timeSensitiveAlerts: string[] | null;
};

// PHI-103: per-anchor titling mode the model picked. Shape mirrors the
// route's returned record (see app/api/itinerary/generate/route.ts).
export type SeededAnchorResolution = {
  verbatim: string;
  mode: "verbatim" | "resolved" | "flagged";
  placed_title?: string;
  reason?: string;
};

export type Item = {
  id: string;
  title: string;
  description: string;
  type: string;
  time_block: string;
  seededByUser?: boolean;
};

export type Day = {
  date: string;
  day_number: number;
  items: Item[];
  // PHI-95: multi-leg responses carry leg_index (0-indexed into the
  // request's legs[]) and is_transition (true on the travel day between
  // consecutive legs). Absent on single-leg responses.
  leg_index?: number;
  is_transition?: boolean;
};

// ── Shared programmatic-check helpers ────────────────────────────────────

export const allAnchorsPlacedOrNoted = ({ anchors, seededItems, placementNotes }: ProgrammaticArgs) => {
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

export const tripStaysInDestination = ({ destination, days, placementNotes }: ProgrammaticArgs) => {
  // PHI-96: see scripts/eval-itinerary-anchors.ts (pre-refactor) for the
  // full rationale on why this is title/description/notes substring OR-ed
  // rather than a stricter destination-mention count. Programmatic check
  // is the cheap early-out; the LLM judge is the authoritative wrong-city
  // gate.
  if (!destination) return { ok: true };
  if (days[0]?.leg_index !== undefined) return { ok: true };

  const dest = destination.toLowerCase();
  const destKey = dest.split(",")[0].trim().split(" ")[0];
  if (!destKey) return { ok: true };

  const allItems = days.flatMap((d) => d.items);
  if (allItems.length === 0) return { ok: true };

  const hits = allItems.filter((i) => {
    const title = i.title.toLowerCase();
    const description = i.description.toLowerCase();
    return title.includes(destKey) || description.includes(destKey);
  });

  const notesMentionsDest = (placementNotes ?? "").toLowerCase().includes(destKey);

  if (hits.length === 0 && !notesMentionsDest) {
    return {
      ok: false,
      reason: `destination "${destination}" not referenced in any item title, description, or placement_notes; possible wrong-city generation`,
    };
  }
  return { ok: true };
};

export const anchorsAreFlagged = ({ anchors, days }: ProgrammaticArgs) => {
  // PHI-96: see scripts/eval-itinerary-anchors.ts (pre-refactor) for why
  // "any single match flagged = pass" is the chosen semantics here.
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

// PHI-105 — hotel-relative anchor resolves to a real, in-destination,
// walking-distance venue (not the verbatim text, not a fabricated name).
export function hotelRelativeAnchorResolves(verbatim: string) {
  return ({ seededAnchorResolutions, seededItems, placementNotes }: ProgrammaticArgs) => {
    const lower = verbatim.toLowerCase();
    if (!Array.isArray(seededAnchorResolutions)) {
      return { ok: false, reason: "seeded_anchor_resolutions missing — PHI-103 field required when anchors present" };
    }
    const entry = seededAnchorResolutions.find(
      (r) => r.verbatim.toLowerCase().trim() === lower.trim(),
    );
    if (!entry) {
      return { ok: false, reason: `no seeded_anchor_resolutions entry for "${verbatim}"` };
    }
    if (entry.mode !== "resolved") {
      return {
        ok: false,
        reason: `expected resolve (mode 2) but model picked mode "${entry.mode}" — hotel-context resolve path failed for "${verbatim}"`,
      };
    }
    if (!entry.placed_title || entry.placed_title.toLowerCase().trim() === lower.trim()) {
      return {
        ok: false,
        reason: `resolve mode missing placed_title or shipped the verbatim as the title — "${entry.placed_title ?? "<missing>"}"`,
      };
    }
    const placedItem = seededItems.find(
      (i) => i.title.toLowerCase().trim() === entry.placed_title!.toLowerCase().trim(),
    );
    if (!placedItem) {
      return {
        ok: false,
        reason: `resolved venue "${entry.placed_title}" was not placed as a seededByUser item`,
      };
    }
    const notes = (placementNotes ?? "").toLowerCase();
    if (!notes.includes(lower) || !notes.includes(entry.placed_title.toLowerCase())) {
      return {
        ok: false,
        reason: `resolved venue "${entry.placed_title}" not surfaced in placement_notes — silent resolution`,
      };
    }
    return { ok: true };
  };
}

// PHI-105 — hotel-relative anchor flags rather than fabricating when the
// hotel sits in a generic business-district / airport area with no
// walking-distance personality.
export function hotelRelativeAnchorFlags(verbatim: string) {
  return ({ seededAnchorResolutions, seededItems, placementNotes }: ProgrammaticArgs) => {
    const lower = verbatim.toLowerCase().trim();
    if (!Array.isArray(seededAnchorResolutions)) {
      return { ok: false, reason: "seeded_anchor_resolutions missing — PHI-103 field required when anchors present" };
    }
    const entry = seededAnchorResolutions.find(
      (r) => r.verbatim.toLowerCase().trim() === lower,
    );
    if (!entry) {
      return { ok: false, reason: `no seeded_anchor_resolutions entry for "${verbatim}"` };
    }
    if (entry.mode !== "flagged") {
      return {
        ok: false,
        reason: `expected flag (mode 3) — hotel in undifferentiated area should NOT resolve — but model picked mode "${entry.mode}"`,
      };
    }
    const placedHit = seededItems.find((i) => i.title.toLowerCase().includes("noodle"));
    if (placedHit) {
      return {
        ok: false,
        reason: `flagged anchor "${verbatim}" still placed item "${placedHit.title}" — flag-mode should not place`,
      };
    }
    const notes = (placementNotes ?? "").toLowerCase();
    if (!notes.includes(lower)) {
      return {
        ok: false,
        reason: `flagged anchor "${verbatim}" not surfaced verbatim in placement_notes`,
      };
    }
    return { ok: true };
  };
}

// PHI-95 — Multi-leg per-leg anchor routing.
export const anchorsLandInExpectedLeg =
  (map: Array<{ anchor: string; expectedLegIndex: number }>) =>
  ({ days }: ProgrammaticArgs) => {
    for (const { anchor, expectedLegIndex } of map) {
      const a = anchor.toLowerCase();
      const matchingDays = days.filter((d) =>
        d.items.some(
          (i) =>
            i.title.toLowerCase().includes(a) || a.includes(i.title.toLowerCase()),
        ),
      );
      if (matchingDays.length === 0) continue; // deferred to allAnchorsPlacedOrNoted
      for (const day of matchingDays) {
        if (day.leg_index !== expectedLegIndex) {
          const placedItem = day.items.find(
            (i) =>
              i.title.toLowerCase().includes(a) ||
              a.includes(i.title.toLowerCase()),
          );
          const actualLeg =
            typeof day.leg_index === "number" ? String(day.leg_index) : "undefined";
          return {
            ok: false,
            reason: `anchor "${anchor}" placed on day ${day.day_number} with leg_index ${actualLeg} (expected ${expectedLegIndex}); placed as "${placedItem?.title ?? "?"}"`,
          };
        }
      }
    }
    return { ok: true };
  };

// PHI-94 — Vague free-text anchor handling.
const VAGUE_FLAG_FRAMINGS: RegExp[] = [
  /try (?:a )?(?:more )?specific name/i,
  /be more specific/i,
  /we(?:'| )?weren'?t sure/i,
  /not sure (?:which|what)/i,
  /could be (?:one of|several|any|either)/i,
  /which (?:one|place|specific|venue|spot|of (?:these|several))/i,
  /ambiguous/i,
  // PHI-103: model legitimately flags using a richer set of framings
  // than the PRD's three exemplars. Accept anything that reads as
  // "I'm uncertain — please clarify".
  /not confident enough/i,
  /(?:could|can|would) you (?:give|tell|share|name|specify|confirm|let)/i,
  /more specific (?:name|venue|spot|reference|info|info|place)/i,
  /(?:please )?(?:specify|clarify|name (?:the|it))/i,
  /could not be placed/i,
  /(?:we|i) (?:can'?t|cannot|couldn'?t)/i,
  /multiple (?:plausible|possible|candidate)/i,
  /(?:rather than|instead of) (?:guess|guessing)/i,
  /please (?:tell|let|share|confirm|specify)/i,
  /once you confirm/i,
];

export const vagueAnchorsResolvedOrFlagged =
  (verbatimStrings: string[]) =>
  ({
    placementNotes,
    flatItems,
    seededItems,
    seededAnchorResolutions,
  }: ProgrammaticArgs) => {
    const notes = placementNotes ?? "";
    const notesLower = notes.toLowerCase();
    const failures: string[] = [];

    for (const verbatim of verbatimStrings) {
      const verbatimLower = verbatim.trim().toLowerCase();

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

      // PHI-103: assert on seeded_anchor_resolutions for each vague anchor.
      if (!seededAnchorResolutions) {
        failures.push(
          `seeded_anchor_resolutions missing on response — PHI-103 requires it whenever anchors are present`,
        );
      } else {
        const entry = seededAnchorResolutions.find(
          (r) => r.verbatim.trim().toLowerCase() === verbatimLower,
        );
        if (!entry) {
          failures.push(
            `seeded_anchor_resolutions has no entry for vague anchor "${verbatim}" (one entry per anchor required)`,
          );
        } else if (entry.mode === "verbatim") {
          failures.push(
            `vague anchor "${verbatim}" has mode="verbatim" in seeded_anchor_resolutions — vague entries must use mode "resolved" or "flagged"`,
          );
        }
      }
    }

    if (failures.length > 0) {
      return { ok: false, reason: failures.join(" | ") };
    }
    return { ok: true };
  };

// PHI-114 — Forbidden tokens scanned by both helpers below.
const PHI114_FORBIDDEN_TOKENS = [
  "ANCHOR PLACEMENTS",
  "REJECTED ACTIVITY NOTES",
  "placed verbatim",
  "REJECTED",
  "verbatim",
] as const;

export const placementNotesIsAnchorContentOnly = ({ placementNotes }: ProgrammaticArgs) => {
  if (!placementNotes) return { ok: true };
  const lower = placementNotes.toLowerCase();
  const hits = PHI114_FORBIDDEN_TOKENS.filter((tok) => lower.includes(tok.toLowerCase()));
  if (hits.length > 0) {
    return {
      ok: false,
      reason: `placement_notes contains forbidden token(s): ${hits.join(", ")} — PHI-114 narrowed scope to anchor surfacing only; no system labels, no rejection audits, no "placed verbatim" debug language`,
    };
  }
  return { ok: true };
};

export const timeSensitiveAlertsRespectVoice = ({ timeSensitiveAlerts }: ProgrammaticArgs) => {
  if (!timeSensitiveAlerts || timeSensitiveAlerts.length === 0) return { ok: true };
  if (timeSensitiveAlerts.length > 4) {
    return {
      ok: false,
      reason: `time_sensitive_alerts has ${timeSensitiveAlerts.length} entries; PHI-114 caps at 4 to prevent the model padding the field`,
    };
  }
  for (let i = 0; i < timeSensitiveAlerts.length; i++) {
    const alert = timeSensitiveAlerts[i];
    if (typeof alert !== "string" || alert.trim().length === 0) {
      return {
        ok: false,
        reason: `time_sensitive_alerts[${i}] is empty or non-string`,
      };
    }
    const lower = alert.toLowerCase();
    const hits = PHI114_FORBIDDEN_TOKENS.filter((tok) => lower.includes(tok.toLowerCase()));
    if (hits.length > 0) {
      return {
        ok: false,
        reason: `time_sensitive_alerts[${i}] contains forbidden token(s): ${hits.join(", ")} — alerts speak as a travel planner, not as a system`,
      };
    }
  }
  return { ok: true };
};

// ── Test cases ───────────────────────────────────────────────────────────

export const TEST_CASES: TestCase[] = [
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
      ({ days }) => {
        const saito = days
          .flatMap((d) => d.items)
          .find((i) => i.title.toLowerCase().includes("saito"));
        if (!saito) return { ok: true };
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
  // PHI-94 vague free-text anchor entries
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
  // PHI-95 multi-leg per-leg anchor routing
  {
    label: "PHI-95 #9: Okafors honeymoon Tokyo → Kyoto → Seoul — per-leg anchors land on the right leg",
    request: {
      destination: "Tokyo",
      departureDate: "2026-10-12",
      returnDate: "2026-10-21",
      legs: [
        {
          id: "leg-tokyo",
          place: { name: "Tokyo" },
          hotel: "Aman Tokyo",
          startDate: "2026-10-12",
          endDate: "2026-10-15",
        },
        {
          id: "leg-kyoto",
          place: { name: "Kyoto" },
          hotel: "The Ritz-Carlton Kyoto",
          startDate: "2026-10-15",
          endDate: "2026-10-18",
        },
        {
          id: "leg-seoul",
          place: { name: "Seoul" },
          hotel: "Four Seasons Seoul",
          startDate: "2026-10-18",
          endDate: "2026-10-21",
        },
      ],
      travelCompany: "partner",
      travelerTypes: ["Food-led", "Cultural", "Romantic"],
      budgetTier: "luxury",
      travelerCount: 2,
      childrenAges: null,
      userSeededActivities: [
        "Sushi Saito splurge dinner",
        "Fushimi Inari shrine",
        "DMZ tour",
      ],
    },
    programmatic: [
      allAnchorsPlacedOrNoted,
      anchorsAreFlagged,
      anchorsLandInExpectedLeg([
        { anchor: "Sushi Saito splurge dinner", expectedLegIndex: 0 }, // Tokyo
        { anchor: "Fushimi Inari shrine", expectedLegIndex: 1 }, // Kyoto
        { anchor: "DMZ tour", expectedLegIndex: 2 }, // Seoul
      ]),
    ],
    judgeCriteria: [
      "Each user-seeded anchor lands on a day whose leg_index matches the city the anchor belongs to in real life — or is flagged in placement_notes with an explanation",
      "No anchor lands on a transition day (is_transition: true) — anchors are real activities, not travel",
      "The full trip respects the multi-leg structure — exactly one transition day between consecutive legs, leg_index on every day",
      "Each leg's content is specific to that city — no cross-leg activities (no Kyoto items on Tokyo days, no Seoul items on Kyoto days, etc.)",
    ],
  },
  // PHI-105 hotel-context resolve
  {
    label: "PHI-105 #10: Singapore Tanjong Pagar hotel — 'noodle place near our hotel' resolves to a real walking-distance shop",
    request: {
      destination: "Singapore",
      departureDate: "2026-10-12",
      returnDate: "2026-10-15",
      hotel: "Pullman Singapore Hill Street",
      hotelPlaceId: "ChIJWX_2D2sZ2jERnzCWf8QqL9Q",
      hotelLat: 1.290272,
      hotelLng: 103.849819,
      hotelNeighborhood: "Clarke Quay",
      travelCompany: "solo",
      travelerTypes: ["Food-led", "Cultural"],
      budgetTier: "comfortable",
      travelerCount: 1,
      childrenAges: null,
      userSeededActivities: ["the noodle place near our hotel"],
    },
    programmatic: [
      allAnchorsPlacedOrNoted,
      tripStaysInDestination,
      hotelRelativeAnchorResolves("the noodle place near our hotel"),
    ],
    judgeCriteria: [
      "The resolved venue is a real, in-Singapore noodle / hawker shop a resident of Tanjong Pagar / Clarke Quay would recognise — not a fabricated name",
      "The resolved venue is plausibly within 10–15 minutes walking from Pullman Singapore Hill Street (Clarke Quay area)",
      "placement_notes surfaces the substitution clearly — quotes the verbatim 'noodle place near our hotel' AND names the resolved venue",
      "Trip remains in Singapore; no fabricated venues; the rest of the itinerary respects the hotel-anchored neighbourhood",
    ],
  },
  // PHI-105 hotel-context flag
  {
    label: "PHI-105 #11: Singapore generic Changi-area hotel — 'noodle place near our hotel' flags rather than fabricating",
    request: {
      destination: "Singapore",
      departureDate: "2026-10-12",
      returnDate: "2026-10-15",
      hotel: "Crowne Plaza Changi Airport",
      hotelPlaceId: "ChIJ_-_-_-_-_-_-_-_-_-_-_-_-",
      hotelLat: 1.359,
      hotelLng: 103.987,
      hotelNeighborhood: "Changi",
      travelCompany: "solo",
      travelerTypes: ["Food-led"],
      budgetTier: "comfortable",
      travelerCount: 1,
      childrenAges: null,
      userSeededActivities: ["the noodle place near our hotel"],
    },
    programmatic: [
      allAnchorsPlacedOrNoted,
      tripStaysInDestination,
      hotelRelativeAnchorFlags("the noodle place near our hotel"),
    ],
    judgeCriteria: [
      "The anchor is flagged in placement_notes (NOT placed as a day item) — Changi airport-area hotels have no walking-distance noodle personality",
      "placement_notes quotes the verbatim and frames the flag as a clarifying question (e.g. 'try a specific name', 'we weren't sure which spot you meant')",
      "No fabricated venue name appears anywhere in the itinerary or notes — the model did not invent a 'Changi Noodle House' or similar to fill the slot",
      "Trip remains in Singapore; the rest of the itinerary still works (the flag doesn't cascade and ruin other days)",
    ],
  },
  // PHI-114 #12 — Amsterdam late May
  {
    label: "PHI-114 #12: Amsterdam late May — Keukenhof + Anne Frank alerts land in time_sensitive_alerts, not placement_notes",
    request: {
      destination: "Amsterdam",
      departureDate: "2026-05-19",
      returnDate: "2026-05-26",
      hotel: "Pulitzer Amsterdam",
      travelCompany: "partner",
      travelerTypes: ["Cultural", "Food-led"],
      budgetTier: "comfortable",
      travelerCount: 2,
      childrenAges: null,
      userSeededActivities: [
        "Rijksmuseum",
        "Anne Frank House",
        "Van Gogh Museum",
        "Vondelpark",
      ],
    },
    programmatic: [
      allAnchorsPlacedOrNoted,
      tripStaysInDestination,
      placementNotesIsAnchorContentOnly,
      timeSensitiveAlertsRespectVoice,
      ({ timeSensitiveAlerts }) => {
        const alerts = timeSensitiveAlerts ?? [];
        const hit = alerts.some((a) => a.toLowerCase().includes("keukenhof"));
        if (!hit) {
          return {
            ok: false,
            reason: `time_sensitive_alerts missing a Keukenhof-shaped alert — late-May Amsterdam should surface the seasonal-cutoff fact (alerts seen: ${JSON.stringify(alerts)})`,
          };
        }
        return { ok: true };
      },
      ({ timeSensitiveAlerts }) => {
        const alerts = timeSensitiveAlerts ?? [];
        const hit = alerts.some((a) => {
          const lower = a.toLowerCase();
          return (
            lower.includes("anne frank") &&
            (lower.includes("book") ||
              lower.includes("ticket") ||
              lower.includes("advance") ||
              lower.includes("online"))
          );
        });
        if (!hit) {
          return {
            ok: false,
            reason: `time_sensitive_alerts missing an Anne-Frank-pre-booking-shaped alert (alerts seen: ${JSON.stringify(alerts)})`,
          };
        }
        return { ok: true };
      },
      ({ placementNotes }) => {
        const notes = (placementNotes ?? "").toLowerCase();
        if (notes.includes("keukenhof")) {
          return {
            ok: false,
            reason: `placement_notes mentions "Keukenhof" — travel facts must move to time_sensitive_alerts (PHI-114 scope narrowing)`,
          };
        }
        return { ok: true };
      },
    ],
    judgeCriteria: [
      "The four anchors (Rijksmuseum, Anne Frank House, Van Gogh Museum, Vondelpark) all land in the itinerary or are surfaced cleanly in placement_notes",
      "time_sensitive_alerts contains the Keukenhof closing-date warning AND an Anne Frank pre-booking warning — phrased as plain one-sentence travel-planner notes",
      "Neither the Keukenhof closure nor the Anne Frank pre-booking warning appears in placement_notes — those travel facts belong in time_sensitive_alerts under PHI-114",
      "placement_notes (if present) speaks in plain prose without 'ANCHOR PLACEMENTS', 'placed verbatim', or 'REJECTED' system language",
      "Neither field includes a rejection audit of activities filtered by user preferences",
    ],
  },
  // PHI-114 #13 — no-false-alarms guard
  {
    label: "PHI-114 #13: Lisbon mid-summer with clean anchors — no false alarms in time_sensitive_alerts",
    request: {
      destination: "Lisbon",
      departureDate: "2026-07-15",
      returnDate: "2026-07-19",
      hotel: "Pousada de Lisboa",
      travelCompany: "partner",
      travelerTypes: ["Cultural", "Food-led"],
      budgetTier: "comfortable",
      travelerCount: 2,
      childrenAges: null,
      userSeededActivities: [
        "Time Out Market",
        "Tram 28 ride",
      ],
    },
    programmatic: [
      allAnchorsPlacedOrNoted,
      tripStaysInDestination,
      placementNotesIsAnchorContentOnly,
      timeSensitiveAlertsRespectVoice,
      ({ timeSensitiveAlerts }) => {
        if (timeSensitiveAlerts && timeSensitiveAlerts.length > 0) {
          return {
            ok: false,
            reason: `time_sensitive_alerts returned ${timeSensitiveAlerts.length} alert(s) on a mid-summer Lisbon trip with clean anchors — PHI-114 forbids padding the field; null/empty was the correct answer (alerts seen: ${JSON.stringify(timeSensitiveAlerts)})`,
          };
        }
        return { ok: true };
      },
    ],
    judgeCriteria: [
      "Both anchors (Time Out Market and Tram 28 ride) land in the itinerary with seededByUser=true",
      "time_sensitive_alerts is null or empty — nothing on this trip warrants a Before-you-go warning, and padding the field with generic 'verify opening hours' notes is a fail",
      "placement_notes is null or speaks in plain prose without 'ANCHOR PLACEMENTS', 'placed verbatim', or 'REJECTED' system language",
      "Trip remains in Lisbon, mid-summer; the surrounding non-anchor activities respect the partner / comfortable / cultural+food-led profile",
    ],
  },
];
