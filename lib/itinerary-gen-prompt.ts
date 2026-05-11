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

// ── PHI-90: user-seeded anchor segment ───────────────────────────────────
//
// Modelled on lib/composition.ts: build a structured block off of typed user
// input rather than string-concatenating inline at the call site. The block
// carries the hard constraints the generator must respect — placement,
// no-silent-drops, and the wrong-city guard (PHI-51 precedent).

const DEST_PLACEHOLDER = "<<DESTINATION>>";

export function buildUserSeededAnchorsSegment(
  userSeededActivities: string[] | null | undefined,
  destination: string,
  legs?: TripLeg[] | null,
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

  // Hard rules — every one of these is load-bearing. Treat them as
  // non-negotiable in the same way the life-impacting constraints in
  // activity-gen are non-negotiable.
  return `\n\n## Must-include activities (user-seeded anchors)\n\nThe traveller has listed the following must-dos. Each entry is an ANCHOR — place exactly one of these on a sensible day, in a sensible time block, and then build the surrounding schedule around it. The trip stays in ${tripScope}; these are anchors WITHIN the trip, not destination changes.\n\n${list}\n\nAnchor rules (non-negotiable):\n- Every anchor above MUST appear in the returned itinerary on exactly one day, in exactly one time block. Mark it with "seededByUser": true on the item.\n- If an anchor is a restaurant, place it in a meal-appropriate block (lunch → afternoon, dinner → evening). If it's a viewpoint at sunset, place it in the evening. If it's a museum, place it in morning or afternoon. Use the entry text as the title verbatim — do not paraphrase it.
- **Pacing around anchors is a hard rule, not a soft preference.** The anchor is the centrepiece of its day. Build the rest of that day to give the anchor room to breathe:
  * If the anchor is a splurge or high-stakes meal (a once-in-a-trip tasting menu, an iconic restaurant, a chef's-counter omakase), keep the same day's other meal lighter and keep the surrounding activity load low — no second sit-down meal in that meal's category, no overscheduling that would leave the traveller fatigued before they arrive.
  * If the family modifiers apply (children under 9), and the anchor is a heavy cultural item (museum, monastery, gallery), the same day MUST NOT stack additional heavy cultural items. Use kid-friendly counterweight on the rest of that day — a park, an outdoor walk, a snack stop, a tram ride — never two museums on the same day for a 5–8 year-old. Respect the 90-minute attention window already enforced by composition.
  * If the anchor is in a specific neighbourhood, surround it with items in walking distance of the same neighbourhood. Don't pair it with a cross-city item that burns the gap.
- Anchors NEVER silently disappear. If you genuinely cannot place every anchor (e.g. 10 anchors on a 2-day trip), reduce filler activities to fit them. If even that is not enough, return a top-level "placement_notes" string listing exactly which anchor(s) could not be placed and why (e.g. "Couldn't place 'Cervejaria Ramiro' — Lisbon trip has no evening slot remaining after fitting the other 9 anchors"). Never drop an anchor without a placement_notes entry explaining why.
- If an anchor names a place that is OBVIOUSLY in a different city (the user typed "the Louvre" on a Lisbon trip), DO NOT relocate the trip and DO NOT invent a Louvre in Lisbon. Treat it as a misspecified anchor: omit it from the returned days, and surface the omission in "placement_notes" (e.g. "'the Louvre' is in Paris, not Lisbon — left out of this itinerary"). The trip stays in ${tripScope}. This is the same wrong-city rule the edit API already honours (PHI-51).
- Anchors set "seededByUser": true. Every other item the generator emits leaves seededByUser unset (or false).
- Anchors keep their normal item shape: id, title, description, type, time_block, status, source, is_outdoor, alternative. Description should be a one-sentence note useful to the traveller (e.g. "Beloved no-frills tasca — booking strongly recommended"), not a justification of the placement.`;
}

// ── Headline + multi-leg block ────────────────────────────────────────────

function buildMultiLegBlock(legs: TripLeg[]): string {
  return `\n\nThis is a MULTI-LEG trip. Plan day-by-day across all legs in order.\n\nLegs (in order):\n${legs
    .map((leg, i) => {
      const name = leg.place?.name ?? `Leg ${i + 1}`;
      const legNights =
        leg.startDate && leg.endDate
          ? Math.round(
              (new Date(leg.endDate).getTime() -
                new Date(leg.startDate).getTime()) /
                86_400_000
            )
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
  } = args;

  const nights = Math.round(
    (new Date(returnDate).getTime() - new Date(departureDate).getTime()) / 86_400_000
  );
  const days = Math.max(1, nights);

  const styleStr = travelerTypes?.length ? `Travel style: ${travelerTypes.join(", ")}.` : "";
  const companyStr = travelCompany ? `Travelling: ${travelCompany}.` : "";
  const budgetStr = budgetTier ? `Budget tier: ${budgetTier}.` : "";
  const hotelStr = hotel ? `Staying at: ${hotel}.` : "";

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

  // PHI-90: user-seeded anchors block.
  const userSeededStr = buildUserSeededAnchorsSegment(
    userSeededActivities,
    destination,
    legs,
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
    ? `\n\nReturn shape (when anchors are present):\nReturn an OBJECT with shape { "days": [<day objects>], "placement_notes": "<string or null>" } — NOT a bare array. Use "placement_notes" only when an anchor could not be placed cleanly OR was filtered out as a misspecified wrong-city anchor. Leave it null or omit it when every anchor was placed and nothing needed flagging.`
    : "";

  return `${headline}
Travel dates: ${departureDate} to ${returnDate}.
${companyStr}
${hotelStr}
${styleStr}
${budgetStr}${compositionStr}${inspirationStr}${atlasStr}${feedbackSegment}${userSeededStr}${multiLegBlock}

Return ONLY valid JSON — no markdown, no explanation, no code fences. ${
    hasAnchors
      ? `Top-level shape: { "days": [...], "placement_notes": "<string or null>" }. The "days" array MUST have exactly ${days} elements, one per day.`
      : `The response MUST be a JSON array with exactly ${days} elements, one per day.`
  }

Each day object:
{
  "date": "YYYY-MM-DD",   // starting from ${departureDate}
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
- Final day evening: something easy near ${hotel ? hotel : "the accommodation"}
- Be specific to ${isMultiLeg ? "each leg" : destination} — no generic suggestions
- Keep descriptions under 20 words
- id must be unique across all days (e.g. "day1-morning-1")
- For booking_meta.search_query: use the restaurant's commonly known name plus the city — this will be used to construct deep links, so accuracy matters more than matching the title field exactly
- Within each time block, order items in the sequence they should happen. Place meals at the right time: breakfast before morning activities, lunch before afternoon sightseeing, dinner before evening leisure. The items array order IS the display order.${placementNotesNote}`;
}

// Re-export the placeholder constant in case the eval needs to reference it.
export const _INTERNAL = { DEST_PLACEHOLDER };
