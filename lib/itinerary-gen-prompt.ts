/**
 * PHI-90 — Itinerary-gen prompt: single source of truth.
 *
 * Mirrors the PHI-43 discipline established for activity-gen
 * (lib/activity-gen-prompt.ts): the prompt-building logic for
 * /api/itinerary/generate lives here so the eval harness can import the
 * exact bytes the route uses. Edit here, not in the route or the eval —
 * they're the same string by construction.
 *
 * IMPORTANT: when changing the prompt, run `npm run eval:anchors` AND
 * `npm run eval:activities` before merging. Both must pass clean.
 */
import { buildCompositionSegment } from "@/lib/composition";
import { buildInspirationMultiItemInjection } from "@/lib/activity-gen-prompt";
import { matchFranchise, buildAtlasAnchorSegment } from "@/lib/themed-atlas";
import type { TripLeg } from "@/lib/trip-schema";

export type ItineraryGenFeedbackEntry = {
  activityName: string;
  feedbackType: "thumbs_up" | "chip_selected" | "thumbs_down_no_chip";
  chip?: { label: string; type: "hard_exclusion" | "soft_signal" };
};

export type ItineraryGenInputs = {
  destination: string;
  /**
   * PHI-99 — leg dates remain strings to keep the existing exact-date path
   * byte-identical; in flex mode the route passes empty strings here and
   * provides `nights` + `seasonHint` directly so the builder can skip
   * date arithmetic. Empty string in either field flips the builder into
   * flex rendering (no "Travel dates" line, day labels carry no date).
   */
  departureDate: string;
  returnDate: string;
  hotel?: string | null;
  travelCompany?: string | null;
  travelerTypes?: string[] | null;
  budgetTier?: string | null;
  activityFeedback?: ItineraryGenFeedbackEntry[] | null;
  travelerCount?: number | null;
  childrenAges?: string[] | null;
  inspiration?: string | null;
  legs?: TripLeg[] | null;
  /**
   * PHI-90 — traveller-provided must-dos. Each entry becomes an ANCHOR the
   * generator must place on exactly one day in exactly one time block. The
   * generator builds the rest of the schedule around them. Empty / null =
   * no anchors block, existing behaviour unchanged.
   */
  userSeededActivities?: string[] | null;
  /**
   * PHI-100 — soft area anchor from the welcome step-2 neighbourhood
   * picker. Only consulted when `hotel` is null. When set, the generator
   * uses it as a base-area hint (final-day evening near here, walking-
   * distance bias for nearby slots) without inventing hotel-proximity
   * claims. Multi-leg trips ignore this — per-leg hotels carry the signal.
   */
  anchorNeighborhood?: string | null;
  /**
   * PHI-99 — pre-resolved trip duration. When set, overrides the
   * date-diff computation inside the builder. The route always passes
   * `nights` from `resolveTripDuration` so both exact-date and flex paths
   * funnel through the same number. Null = legacy date-diff path.
   */
  nights?: number | null;
  /**
   * PHI-99 — human-readable month-year ("October 2026") to inject as a
   * seasonal calibration hint when the traveller is in flex mode. Null =
   * exact-date path; the prompt is byte-identical to pre-PHI-99.
   */
  seasonHint?: string | null;
  /**
   * PHI-105 — optional hotel context (lat/lng/neighbourhood) used by the
   * anchors block to resolve hotel-relative entries ("near our hotel").
   * Null / missing coords = byte-identical to pre-PHI-105; the anchors
   * block has no hotel-context subsection. Single-leg only — multi-leg
   * trips can carry per-leg coords inside legs[i].hotelLat already, but
   * the anchor-resolution prompt only consumes the primary hotel context.
   */
  hotelContext?: AnchorHotelContext | null;
};

// ── Activity-feedback segment ─────────────────────────────────────────────

export function buildFeedbackSegment(feedback: ItineraryGenFeedbackEntry[]): string {
  if (!feedback?.length) return "";

  const hardExclusions = feedback
    .filter((f) => f.feedbackType === "chip_selected" && f.chip?.type === "hard_exclusion")
    .map((f) => f.activityName);

  const softWithReason = feedback
    .filter((f) => f.feedbackType === "chip_selected" && f.chip?.type === "soft_signal")
    .map((f) => `${f.activityName} (${f.chip!.label})`);

  const softNoReason = feedback
    .filter((f) => f.feedbackType === "thumbs_down_no_chip")
    .map((f) => f.activityName);

  const parts: string[] = [];

  if (hardExclusions.length) {
    parts.push(
      `IMPORTANT — Never include these activities in any form. The user has explicitly excluded them:\n` +
        hardExclusions.map((n) => `- ${n}`).join("\n")
    );
  }

  if (softWithReason.length) {
    parts.push(
      `The user rejected these activities and stated a reason. Avoid them; you may suggest alternatives in the same category:\n` +
        softWithReason.map((s) => `- ${s}`).join("\n")
    );
  }

  if (softNoReason.length) {
    parts.push(
      `The user rejected these activities without stating a reason. Treat as soft signal only — deprioritise but do not exclude:\n` +
        softNoReason.map((n) => `- ${n}`).join("\n")
    );
  }

  const liked = feedback
    .filter((f) => f.feedbackType === "thumbs_up")
    .map((f) => f.activityName);

  if (liked.length) {
    parts.push(
      `The user expressed interest in these activities — prioritise similar experiences:\n` +
        liked.map((n) => `- ${n}`).join("\n")
    );
  }

  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

// ── PHI-97: canonical user-seeded-activities cleaner ─────────────────────
//
// Single source of truth for the 20 × 200-char cap on user-seeded must-dos.
// Used by the welcome wizard (textarea splitter) and the three server entry
// points (POST/PATCH /api/travelers, POST /api/itinerary/generate) so a
// direct API call gets the same forgiveness the wizard does — silently
// truncate, never reject. Empty array when the input is missing/null/non-
// array; always slice(0, 20); always filter length > 0 && <= 200.
export function cleanUserSeededActivities(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 200)
    .slice(0, 20);
}

// ── PHI-90: user-seeded anchor segment ───────────────────────────────────
//
// Modelled on lib/composition.ts: build a structured block off of typed user
// input rather than string-concatenating inline at the call site. The block
// carries the hard constraints the generator must respect — placement,
// no-silent-drops, and the wrong-city guard (PHI-51 precedent).

const DEST_PLACEHOLDER = "<<DESTINATION>>";

/**
 * PHI-105 — optional hotel context. When supplied AND lat/lng are both
 * numbers, `buildUserSeededAnchorsSegment` appends a "Hotel context"
 * subsection so the model has the signal to resolve "near our hotel" /
 * "across from where we're staying" / etc. anchors. When null OR missing
 * coords, the segment is byte-identical to the pre-PHI-105 PHI-103 shape.
 *
 * `childrenAges` flows through so the walking-radius cue can flip between
 * the couples-and-solo (10–15 min) and families-with-small-kids (5–10 min)
 * thresholds; the cue is a soft preference, not a hard radius filter.
 */
export type AnchorHotelContext = {
  name: string;
  neighborhood: string | null;
  lat: number;
  lng: number;
  childrenAges?: string[] | null;
};

export function buildUserSeededAnchorsSegment(
  userSeededActivities: string[] | null | undefined,
  destination: string,
  legs?: TripLeg[] | null,
  hotelContext?: AnchorHotelContext | null,
): string {
  if (!Array.isArray(userSeededActivities)) return "";
  const cleaned = userSeededActivities
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);
  if (cleaned.length === 0) return "";

  const isMultiLeg = Array.isArray(legs) && legs.length >= 2;
  const tripScope = isMultiLeg
    ? legs!.map((l) => l.place?.name ?? "?").join(" / ")
    : destination;

  const list = cleaned.map((s) => `- ${s}`).join("\n");

  // PHI-105: hotel context is appended at the END of the anchor block so
  // the model has read the resolve-vs-flag rules first, and the radius cue
  // is part of the anchor reasoning rather than a separate guidance layer.
  // We DO NOT loosen the flag-bias from PHI-103 — hotel context narrows
  // ambiguity but doesn't eliminate it. When the hotel sits in a generic
  // business district (Elena's flag), the model is still expected to flag
  // hotel-relative entries rather than fabricate.
  const hotelContextStr = (() => {
    if (
      !hotelContext ||
      typeof hotelContext.lat !== "number" ||
      typeof hotelContext.lng !== "number"
    ) {
      return "";
    }
    const hasSmallKids =
      Array.isArray(hotelContext.childrenAges) &&
      hotelContext.childrenAges.some((a) => a === "Under 2" || a === "2–4");
    const radiusCue = hasSmallKids
      ? "5–10 minutes walking (travellers with small kids tire fast; keep the radius tight)"
      : "10–15 minutes walking";
    const neighborhoodLine = hotelContext.neighborhood
      ? `Neighbourhood: ${hotelContext.neighborhood}.`
      : "Neighbourhood: not resolved — work from the coordinates and the city's known shape.";
    const lat = hotelContext.lat.toFixed(4);
    const lng = hotelContext.lng.toFixed(4);
    return `\n\n**Hotel context (PHI-105).** Use this to resolve hotel-relative anchors ("near our hotel", "across from where we're staying", "the place by our hotel"). Do NOT fabricate venues or pretend to know the actual street-level surroundings beyond what the persisted neighbourhood implies.\n\n- Hotel name: ${hotelContext.name}.\n- ${neighborhoodLine}\n- Coordinates (rough): ${lat}, ${lng}.\n- Walking-distance cue for hotel-relative anchors: ${radiusCue}. This is a soft preference, NOT a hard radius filter; honour it when picking which candidate to surface, but don't reject a great match a couple minutes further.\n\n**Hotel-context flag rule (mode 3 override).** When the hotel sits in a neighbourhood with real personality (Tanjong Pagar, Cais do Sodré, Shimokitazawa, Le Marais, Trastevere) and the hotel-relative anchor has a confident single candidate within walking distance, mode 2 (resolve) applies — name the resolved venue, surface the resolution in placement_notes. When the hotel sits in a generic business district / airport area / motorway-junction chain hotel (Pullman CDG, anywhere with no walking-distance personality), or when the description ("the place the concierge mentioned") doesn't pin a venue Rise could know, mode 3 (flag) applies — do not fabricate, ask the user to be more specific. Mode 3 always wins ties: a confident wrong answer near the hotel is worse than a friendly clarifying question.`;
  })();

  // Hard rules — every one of these is load-bearing. Treat them as
  // non-negotiable in the same way the life-impacting constraints in
  // activity-gen are non-negotiable.
  return `\n\n## Must-include activities (user-seeded anchors)\n\nThe traveller has listed the following must-dos. Each entry is an ANCHOR — place exactly one of these on a sensible day, in a sensible time block, and then build the surrounding schedule around it. The trip stays in ${tripScope}; these are anchors WITHIN the trip, not destination changes.\n\n${list}\n\nAnchor rules (non-negotiable):
- Every anchor above MUST be accounted for — either PLACED on exactly one day in exactly one time block (modes 1 and 2 below) or SURFACED in "placement_notes" without being placed (mode 3 and the wrong-city case). Silent drops = hard fail.
- Placement-block rules (when an anchor IS placed): restaurants go in a meal-appropriate block (lunch → afternoon, dinner → evening); a sunset viewpoint goes in the evening; a museum goes in morning or afternoon.

**Anchor titling — three modes (PHI-103). Pick exactly one mode per anchor:**

  1. **Specific venue (proper-noun entry).** The entry already names a real, specific place — capitalised proper noun, distinctive named experience. Examples: \"Cervejaria Ramiro\", \"Time Out Market\", \"Sushi Saito splurge dinner\", \"Tram 28 ride\", \"Sunset at Miradouro da Senhora do Monte\", \"Museu Nacional do Azulejo\". Action: use the entry text as the item title VERBATIM — do not paraphrase. Place the item with \"seededByUser\": true.

  2. **Vague entry, UNAMBIGUOUS resolution.** The entry is descriptive (no proper noun, hedge words like \"the\", \"that\", \"famous\") BUT you have HIGH CONFIDENCE in exactly one specific real venue a resident would recognise — a unique landmark, a singular cuisine+neighbourhood combo with one clear answer, an iconic dish where one venue dominates the conversation. Action: place the resolved venue with its REAL NAME as the item title (NOT the verbatim entry text), \"seededByUser\": true. AND surface the substitution in \"placement_notes\" — the resolution must be visible to the traveller. Use a phrasing like: \"We took 'that famous pastéis place' to mean Pastéis de Belém — the original 1837 nata bakery in Belém. Tell us if you meant somewhere else.\" Silent resolution (placing the resolved item without surfacing it in placement_notes) = hard fail per Maya's surface-the-verbatim rule.

  3. **Vague entry, AMBIGUOUS (more than one venue could plausibly match).** The entry is descriptive AND multiple real venues could reasonably match (multiple Lisbon viewpoints, multiple ramen shops Anthony Bourdain visited on TV, multiple \"famous\" Xs in the same city). Action: do NOT place an item for this anchor. Flag in \"placement_notes\" by quoting the verbatim text and asking the user for a more specific name. Use framings like \"not sure which X you meant\", \"could be one of several\", \"try a specific name\" — and name 2–3 plausible candidates so the user can pick. Example: \"Not sure which 'famous viewpoint' you meant — Lisbon has several. Could be Miradouro da Senhora do Monte (locals' pick), Miradouro de São Pedro de Alcântara (sunset crowd), or Miradouro de Santa Catarina (sunset over the river). Try a specific name.\"

**Bias toward flag (mode 3) over resolve (mode 2) when uncertain.** A confident wrong answer ('the famous viewpoint' resolved to São Pedro de Alcântara when the traveller meant Senhora do Monte) is worse than a friendly question back. Mode 2 is for cases where you'd bet money on the resolution; everything else is mode 3. \"Multiple plausible candidates\" is the trigger — don't guess.

**The \"most widely cited\" tiebreaker is forbidden.** If you find yourself reasoning \"X is the most widely cited / most famous / most iconic of several candidates\" — that is a mode 3 signal, not a mode 2 license. \"Bourdain visited several Tokyo ramen shops, but Fuunji is the most cited\" → mode 3, flag. \"Lisbon has many famous viewpoints, but Senhora do Monte is most beloved by locals\" → mode 3, flag. \"There are several painted-tile museums in Lisbon, but Museu Nacional do Azulejo is most well-known\" → mode 3, flag. The \"most cited\" tiebreaker is forbidden because different travellers heard about different ones, and confidently picking the wrong one for THIS traveller is the failure mode this rule exists to prevent. If your placement_notes for an anchor would contain a hedging phrase like \"this is technically ambiguous but...\", \"the most widely cited\", \"the most well-known of several\", \"the classic choice when picking from many\" — STOP. That anchor is mode 3. Do not place it. Flag it instead.

**Hard fails (any of these = bad output):**
  - Hallucinating a fabricated venue (a real-sounding name that doesn't exist or isn't in this destination).
  - Shipping a non-proper-noun verbatim entry as the item title (mode 1 misapplied to a vague entry).
  - Silent resolution: mode 2 placement WITHOUT a \"We took '<verbatim>' to mean <resolved>\" mention in placement_notes.
  - Dropping an anchor without surfacing it in placement_notes.

- **Pacing around anchors is a hard rule, not a soft preference.** The anchor is the centrepiece of its day. Build the rest of that day to give the anchor room to breathe:
  * If the anchor is a splurge or high-stakes meal (a once-in-a-trip tasting menu, an iconic restaurant, a chef's-counter omakase), keep the same day's other meal lighter and keep the surrounding activity load low — no second sit-down meal in that meal's category, no overscheduling that would leave the traveller fatigued before they arrive.
  * If the family modifiers apply (children under 9), and the anchor is a heavy cultural item (museum, monastery, gallery), the same day MUST NOT stack additional heavy cultural items. Use kid-friendly counterweight on the rest of that day — a park, an outdoor walk, a snack stop, a tram ride — never two museums on the same day for a 5–8 year-old. Respect the 90-minute attention window already enforced by composition.
  * If the anchor is in a specific neighbourhood, surround it with items in walking distance of the same neighbourhood. Don't pair it with a cross-city item that burns the gap.
- Anchors NEVER silently disappear. If you genuinely cannot place every anchor (e.g. 10 anchors on a 2-day trip), reduce filler activities to fit them. If even that is not enough, add a "placement_notes" entry naming exactly which anchor(s) could not be placed and why (e.g. "Couldn't place 'Cervejaria Ramiro' — Lisbon trip has no evening slot remaining after fitting the other 9 anchors"). Never drop an anchor without surfacing it.
- If an anchor names a place that is OBVIOUSLY in a different city (the user typed "the Louvre" on a Lisbon trip), DO NOT relocate the trip and DO NOT invent a Louvre in Lisbon. Treat it as a misspecified anchor: omit it from the returned days, and surface the omission in "placement_notes" (e.g. "'the Louvre' is in Paris, not Lisbon — left out of this itinerary"). The trip stays in ${tripScope}. This is the same wrong-city rule the edit API already honours (PHI-51). Wrong-city is misspecification, NOT vagueness — record it as mode \"flagged\" in seeded_anchor_resolutions (see below) with a wrong-city reason; do not run the resolve path on it.
- Anchors set "seededByUser": true. Every other item the generator emits leaves seededByUser unset (or false).
- Anchors keep their normal item shape: id, title, description, type, time_block, status, source, is_outdoor, alternative. Description should be a one-sentence note useful to the traveller (e.g. "Beloved no-frills tasca — booking strongly recommended"), not a justification of the placement.

**seeded_anchor_resolutions (PHI-103 debug field).** When anchors are present, return a top-level \"seeded_anchor_resolutions\" array on the response — one entry per anchor, in the SAME ORDER as the anchor list above. Shape:
[
  { \"verbatim\": \"Cervejaria Ramiro\", \"mode\": \"verbatim\", \"placed_title\": \"Cervejaria Ramiro\" },
  { \"verbatim\": \"that famous pastéis place\", \"mode\": \"resolved\", \"placed_title\": \"Pastéis de Belém\", \"reason\": \"well-known Lisbon bakery — single clear answer\" },
  { \"verbatim\": \"the famous viewpoint\", \"mode\": \"flagged\", \"reason\": \"multiple Lisbon viewpoints could plausibly match — flagged for user clarification\" }
]
\"mode\" is \"verbatim\" (rule 1), \"resolved\" (rule 2), or \"flagged\" (rule 3 OR wrong-city). \"placed_title\" is REQUIRED for verbatim and resolved modes (the title that landed on the day) and OMITTED for flagged. \"reason\" is REQUIRED for resolved and flagged modes and optional for verbatim. This field is for downstream debugging — emit it on every response with anchors.${hotelContextStr}`;
}

// ── Headline + multi-leg block ────────────────────────────────────────────

function buildMultiLegBlock(legs: TripLeg[]): string {
  return `\n\nThis is a MULTI-LEG trip. Plan day-by-day across all legs in order.\n\nLegs (in order):\n${legs
    .map((leg, i) => {
      const name = leg.place?.name ?? `Leg ${i + 1}`;
      // PHI-99: prefer date-diff (exact path) → leg.nights (flex path) →
      // unknown. The flex path is the new branch; exact stays byte-identical.
      const legNights =
        leg.startDate && leg.endDate
          ? Math.round(
              (new Date(leg.endDate).getTime() -
                new Date(leg.startDate).getTime()) /
                86_400_000
            )
          : typeof leg.nights === "number" && leg.nights > 0
            ? leg.nights
            : null;
      const nightsStr = legNights
        ? ` (${legNights} night${legNights === 1 ? "" : "s"})`
        : "";
      const dateStr =
        leg.startDate && leg.endDate
          ? `, ${leg.startDate} → ${leg.endDate}`
          : "";
      const hotelStr = leg.hotel ? `, hotel: ${leg.hotel}` : "";
      return `- LEG ${i}: ${name}${nightsStr}${dateStr}${hotelStr}`;
    })
    .join("\n")}\n\nMulti-leg rules:\n- Tag every day with "leg_index": <index>. The first leg is leg_index 0.\n- Bias toward fewer activities per day on short legs (≤2 nights). Travellers want lighter plans on later legs.\n- Stay in the previous leg's hotel when a leg is ≤2 nights AND day-trip distance is reasonable; suggest day-trip activities from the previous base.\n- Never recommend cross-leg activities (e.g. for "Spain + Portugal", no Lisbon-to-Madrid day trips).\n- Insert exactly ONE transition day between consecutive legs. A transition day:\n    * has "is_transition": true and "leg_index" set to the leg the user is travelling INTO\n    * contains a single transport item: { title: "Travel to <next leg name>", description: "<a brief note>", type: "transport", time_block: "morning" or "afternoon" }\n    * has NO other activities — travellers lose meals/naps/check-in time on transition days; do not over-plan.\n- Hotel guidance: each leg may have its own hotel listed above. When set, anchor that leg's activities (especially day 1 and the final evening) around that hotel. When a leg has no hotel listed, skip hotel-proximity claims for that leg — never invent one.\n`;
}

// ── Main builder ──────────────────────────────────────────────────────────

export function buildItineraryGenPrompt(args: ItineraryGenInputs): string {
  const {
    destination,
    departureDate,
    returnDate,
    hotel,
    travelCompany,
    travelerTypes,
    budgetTier,
    activityFeedback,
    travelerCount,
    childrenAges,
    inspiration,
    legs,
    userSeededActivities,
    anchorNeighborhood,
    nights: nightsOverride,
    seasonHint,
    hotelContext,
  } = args;

  // PHI-99: flex mode flips on when the caller passes empty strings for
  // departure/return AND supplies a pre-resolved nights count (via the
  // duration helper). The exact-date path keeps the same date-diff
  // computation, so existing trips render byte-identically.
  const flexMode = !departureDate || !returnDate;
  const nights =
    typeof nightsOverride === "number" && nightsOverride > 0
      ? nightsOverride
      : Math.round(
          (new Date(returnDate).getTime() - new Date(departureDate).getTime()) / 86_400_000,
        );
  const days = Math.max(1, nights);
  const trimmedSeason =
    typeof seasonHint === "string" ? seasonHint.trim() : "";
  const seasonNote =
    flexMode && trimmedSeason.length > 0
      ? `\nTraveller is planning for ${trimmedSeason}, exact dates not yet decided. Calibrate seasonal references (weather, daylight, festivals, peak-vs-shoulder) accordingly; avoid date-specific claims.`
      : "";

  const styleStr = travelerTypes?.length ? `Travel style: ${travelerTypes.join(", ")}.` : "";
  const companyStr = travelCompany ? `Travelling: ${travelCompany}.` : "";
  const budgetStr = budgetTier ? `Budget tier: ${budgetTier}.` : "";
  // PHI-100: hotel is the strong location signal; the neighbourhood anchor
  // is only used when no hotel is set, and only on single-leg trips
  // (multi-leg per-leg hotels already carry the signal).
  const trimmedAnchor =
    typeof anchorNeighborhood === "string" ? anchorNeighborhood.trim() : "";
  const useAnchor =
    trimmedAnchor.length > 0 &&
    !hotel &&
    !(Array.isArray(legs) && legs.length >= 2);
  const hotelStr = hotel
    ? `Staying at: ${hotel}.`
    : useAnchor
      ? `Based in: ${trimmedAnchor} neighbourhood (no specific hotel — treat this as a soft area anchor; do NOT fabricate hotel-proximity claims).`
      : "";

  const feedbackSegment = buildFeedbackSegment(activityFeedback ?? []);
  const composition = buildCompositionSegment(travelerCount, childrenAges);
  const compositionStr = composition ? `\nTraveller composition: ${composition}` : "";

  // PHI-51 / PHI-52: shared multi-item soft-bias string.
  const inspirationStrength: "adult" | "family" =
    Array.isArray(childrenAges) && childrenAges.length > 0 ? "family" : "adult";
  const trimmedInspiration =
    typeof inspiration === "string" ? inspiration.trim() : "";
  const inspirationStr = trimmedInspiration.length
    ? `\n\n${buildInspirationMultiItemInjection(trimmedInspiration, inspirationStrength)}`
    : "";

  // PHI-54: deterministic atlas anchor segment when the inspiration matches a curated franchise.
  let atlasStr = "";
  if (trimmedInspiration.length) {
    const franchise = matchFranchise(trimmedInspiration);
    if (franchise) {
      const cities = Array.isArray(legs) && legs.length >= 2
        ? legs.map((l) => l.place?.name ?? "")
        : destination
          ? [destination]
          : [];
      const segments: string[] = [];
      for (const city of cities) {
        const seg = buildAtlasAnchorSegment(franchise, city);
        if (seg) segments.push(seg);
      }
      if (segments.length > 0) atlasStr = `\n\n${segments.join("\n\n")}`;
    }
  }

  // PHI-90: user-seeded anchors block. PHI-105: optional hotel context for
  // anchor resolution flows through here so the segment can append a
  // "Hotel context" subsection when the traveller has coords.
  const userSeededStr = buildUserSeededAnchorsSegment(
    userSeededActivities,
    destination,
    legs,
    hotelContext ?? null,
  );

  const isMultiLeg = Array.isArray(legs) && legs.length >= 2;
  const multiLegBlock = isMultiLeg ? buildMultiLegBlock(legs!) : "";

  const headline = isMultiLeg
    ? `You are a trip planning AI. Generate a structured day-by-day itinerary for a ${days}-day multi-leg trip across ${legs!.map((l) => l.place?.name ?? "?").join(" → ")}.`
    : `You are a trip planning AI. Generate a structured day-by-day itinerary for a ${days}-day trip to ${destination}.`;

  // PHI-90: when anchors are present, the schema example below additionally
  // includes "seededByUser" and the response shape adds top-level
  // "placement_notes". Surfaced in the prompt so the generator emits the
  // right keys.
  const hasAnchors = userSeededStr.length > 0;
  const seededExample = hasAnchors
    ? `,\n  "seededByUser": false   // true ONLY on the items that match a user-seeded must-do; omit/false otherwise`
    : "";
  const placementNotesNote = hasAnchors
    ? `\n\nReturn shape (when anchors are present):\nReturn an OBJECT with shape { "days": [<day objects>], "placement_notes": "<string or null>", "seeded_anchor_resolutions": [<one entry per anchor>] } — NOT a bare array. Use "placement_notes" whenever an anchor was vague-resolved (mode 2, surface the substitution), vague-flagged (mode 3, ask the user to be more specific), filtered as wrong-city, or could not be placed for capacity reasons. Set it to null only when every anchor was placed verbatim (mode 1) and nothing needed surfacing. "seeded_anchor_resolutions" is REQUIRED on every response with anchors — see the anchor block above for the per-entry shape and modes.`
    : "";

  // PHI-99: header line differs by mode. Exact stays byte-identical;
  // flex swaps in a trip-duration line + a seasonal calibration note.
  const tripLine = flexMode
    ? `Trip duration: ${days} night${days === 1 ? "" : "s"}.${seasonNote}`
    : `Travel dates: ${departureDate} to ${returnDate}.`;
  // Day-shape instructions for the `date` field also differ by mode —
  // flex tells the model NOT to fabricate a date string; the page renders
  // "Day N" headers instead.
  const dateFieldComment = flexMode
    ? `"date": "",            // leave blank — traveller is in flex mode, no concrete dates yet`
    : `"date": "YYYY-MM-DD",   // starting from ${departureDate}`;

  return `${headline}
${tripLine}
${companyStr}
${hotelStr}
${styleStr}
${budgetStr}${compositionStr}${inspirationStr}${atlasStr}${feedbackSegment}${userSeededStr}${multiLegBlock}

Return ONLY valid JSON — no markdown, no explanation, no code fences. ${
    hasAnchors
      ? `Top-level shape: { "days": [...], "placement_notes": "<string or null>", "seeded_anchor_resolutions": [...] }. The "days" array MUST have exactly ${days} elements, one per day. The "seeded_anchor_resolutions" array MUST have exactly one entry per anchor in the order they were given.`
      : `The response MUST be a JSON array with exactly ${days} elements, one per day.`
  }

Each day object:
{
  ${dateFieldComment}
  "day_number": 1,         // 1-indexed
  "items": [...]${
    isMultiLeg
      ? `,
  "leg_index": 0,          // 0-indexed pointer into the Legs list above
  "is_transition": false   // true on the day the traveller moves between legs`
      : ""
  }
}

Each item object:
{
  "id": "unique-string-id",
  "title": "Activity name",
  "description": "One sentence. Be specific to ${destination}.",
  "type": "activity" | "restaurant" | "transport",
  "time_block": "morning" | "afternoon" | "evening",
  "status": "idea",
  "source": "ai_generated",
  "is_outdoor": false,
  "alternative": null${seededExample}
}

is_outdoor / alternative rules (PHI-53):
- "is_outdoor" is REQUIRED on every item. Set true if the primary experience happens outside (parks, viewpoints, walks, beaches, outdoor markets, gardens, hikes, ferry rides, open-top tours). Set false for museums, indoor restaurants, covered venues, theatres, shopping malls.
- When "is_outdoor" is true, "alternative" MUST be a real, in-destination indoor or covered option that fits the same time slot if weather is bad. Shape: { "title": "...", "description": "One sentence.", "type": "activity" | "restaurant" | "transport" | "note" }. Apply the standard hallucination guard: only suggest a real, high-quality option that exists in the destination — never invent venues. If no genuine indoor alternative exists for that slot, set "alternative" to null and accept the outdoor recommendation as standalone.
- When "is_outdoor" is false, set "alternative" to null. Do not generate alternatives for indoor items.

For items where type is "restaurant", include these additional fields:
{
  "cuisine": "Italian",           // cuisine category
  "vibe": "romantic",             // one-word vibe descriptor
  "price_tier": "€€€",           // €, €€, €€€, or €€€€
  "booking_meta": {
    "preferred_platform": "opentable" | "resy" | "thefork",  // your best guess for the primary booking platform this restaurant uses
    "confidence": "high" | "medium" | "low",                  // how confident you are this restaurant is on that platform
    "search_query": "exact restaurant name city"               // the exact search string to use in booking platform URLs — optimise for finding the right restaurant, not the raw name
  }
}

Rules:
- Cover morning, afternoon, and evening for each day (one item per slot minimum, max two)${
    isMultiLeg
      ? " — EXCEPT transition days, which contain exactly one transport item"
      : ""
  }
- Mix types: include at least one restaurant per day${
    isMultiLeg ? " (skip on transition days)" : ""
  }
- Day 1 morning: arrival/orientation activity
- Final day evening: something easy near ${hotel ? hotel : useAnchor ? `the ${trimmedAnchor} area` : "the accommodation"}
- Be specific to ${isMultiLeg ? "each leg" : destination} — no generic suggestions
- Keep descriptions under 20 words
- id must be unique across all days (e.g. "day1-morning-1")
- For booking_meta.search_query: use the restaurant's commonly known name plus the city — this will be used to construct deep links, so accuracy matters more than matching the title field exactly
- Within each time block, order items in the sequence they should happen. Place meals at the right time: breakfast before morning activities, lunch before afternoon sightseeing, dinner before evening leisure. The items array order IS the display order.${placementNotesNote}`;
}

// Re-export the placeholder constant in case the eval needs to reference it.
export const _INTERNAL = { DEST_PLACEHOLDER };
