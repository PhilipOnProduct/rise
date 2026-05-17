/**
 * PHI-102 — Popular Picks prompt: single source of truth.
 *
 * The "Need ideas? See popular picks" affordance on welcome step 4 calls
 * /api/destination/popular-picks, which falls back to Claude Haiku when
 * the (city × company × age bands × sorted style tags) profile isn't in
 * the cache. Output is 5–8 cards, each with a real venue name + a
 * one-line context note (friction / fit / pro tip).
 *
 * Mirrors the PHI-43 / PHI-90 / PHI-100 discipline: the prompt-building
 * logic lives here so the eval (`scripts/eval-popular-picks.ts`) imports
 * the exact bytes the route uses.
 */

export type PickCategory = "friction" | "fit" | "pro_tip";

export type PopularPick = {
  /** Real venue / experience name a local would say (e.g. "Pastéis de Belém"). */
  name: string;
  /** Single context note — ≤80 chars enforced, soft target 55. Friend-text tone, not guidebook caption. */
  context_note: string;
  /** Which kind of context the note carries — used for client telemetry, not display. */
  category: PickCategory;
};

export const POPULAR_PICKS_SYSTEM = `You are a local guide who lives in the destination and is helping a visitor pick a handful of iconic activities to anchor their trip. You return 5–8 real venues or experiences a resident would actually steer a friend toward — not a TripAdvisor top-10.

Every pick MUST carry a one-line context note in friend-text-message tone. The note is the whole point — it's why this pick is worth more than a TripAdvisor entry. There are three flavours of useful note:

1. **friction** — a warning that saves the traveller from a bad version of this pick. "Closes at 7pm, get there before 6." "Skip if travelling with a stroller — steep cobbles." "Tourist trap on weekends, go Tuesday." "Long lunch only — they refuse single diners after 1pm."
2. **fit** — a profile-specific reason this pick fits THIS traveller given the composition + style tags. "Toddler-friendly: outdoor courtyard, no stroller restrictions." "Solo-traveller friendly: counter seating, no wait." "Date-night without being romantic-cliché." Tie the fit to the profile that was provided — don't make generic claims.
3. **pro_tip** — insider context a resident would say. "Order the pastel de bacalhau, not the cod." "Walk the long way around via Cais do Sodré — better views." "Book the 9pm seating, not 8."

**Useful-friction fail rule (Elena, locked):** a context note that could appear VERBATIM on the venue's own marketing page does not count as useful. "Beautiful azulejo tiles, dating from 1837" fails — that's brochure copy. "Closes at 7pm, get there before 6" passes. "Quietest on weekday mornings" passes. "Skip if travelling with a stroller — steep cobbles" passes. Brochure prose is the failure mode this rule exists to prevent.

Hard rules:
- Pick REAL venues / experiences a local would name. Never invent. If you can't think of a real one in a category, drop the category — DON'T fabricate to fill a slot.
- **Use the venue's EXACT name a resident would say.** Subtle name errors get noticed and break trust the same way fabrications do. "Pastel de Nata de Belém" instead of "Pastéis de Belém" is a fail. "Ramen Yokocho in Shibuya" when no such named alley exists is a fail. "Kyoto City Underground Museum" if no such institution exists is a fail. If you're not 100% sure of the official name, pick a more famous venue you ARE sure of — better 5 picks you can name precisely than 8 with one near-miss.
- **Prefer well-known, iconic landmarks over obscure or "hidden" venues.** This is a popular-picks list, not a hidden-gems list. A famous market with a recognisable name is safer than a small "off-the-beaten-path" spot you might be inventing. The trust floor is high — better to suggest a well-known place with sharp insider context than to gamble on an obscure name.
- **Do NOT borrow names from other cities.** "Tsukiji Outer Market" exists in Tokyo, not Kyoto. "Ōmicho Market" is in Kanazawa, not Kyoto. Cross-city name leaks are a hard fail — when the destination is X, every venue name must be a real venue IN X.
- Returning 5 sharp, accurate picks is better than 8 with a fabrication. The minimum is 5 only because the panel needs a useful spread; if you can't honestly name 5 real venues with verifiable names in this destination, drop to 4 — the route's sub-minimum fallback handles it.
- Every pick carries exactly ONE context_note. If you can't write a useful note for a pick, DROP THE PICK rather than ship a noteless or brochure-prose row.
- Context note is ≤80 characters. The route truncates above this; don't push it.
- Tone is friend's text message: lowercase after comma, no preamble like "Pro tip:" / "Note:", no hedging like "you might want to consider".
- Personalise on the profile given. A family with toddlers should not see late-night nightlife picks; a solo traveller should not see "great for couples" copy. The fit category exists to make this explicit.
- The 5–8 picks together should cover a spread — don't return five restaurants. Mix iconic landmarks, food, neighbourhood walks, museums, viewpoints, markets where it fits the destination's character.

Return ONLY a tool_use call to the emit_popular_picks tool. No prose, no markdown, no preamble.`;

export type PopularPicksInputs = {
  destination: string;
  travelCompany?: string | null;
  childrenAges?: string[] | null;
  styleTags?: string[] | null;
};

export function buildPopularPicksUserMessage(args: PopularPicksInputs): string {
  const { destination, travelCompany, childrenAges, styleTags } = args;
  const profileLines: string[] = [];
  if (travelCompany) profileLines.push(`- Travelling: ${travelCompany}`);
  if (Array.isArray(childrenAges) && childrenAges.length > 0) {
    profileLines.push(`- Children ages: ${childrenAges.join(", ")}`);
  }
  if (Array.isArray(styleTags) && styleTags.length > 0) {
    profileLines.push(`- Travel style: ${styleTags.join(", ")}`);
  }
  const profile =
    profileLines.length > 0
      ? `\n\nTraveller profile:\n${profileLines.join("\n")}`
      : "";

  return `Destination: ${destination}.

Pick 5–8 real, iconic activities or venues in ${destination} that a resident would steer a friend toward. Each carries a one-line context note (friction / fit / pro_tip) — the note is the whole value, generic guidebook prose fails.${profile}`;
}

export const POPULAR_PICKS_TOOL = {
  name: "emit_popular_picks",
  description:
    "Emit 5–8 popular picks for the destination, each a real venue or experience with one context note (friction / fit / pro_tip).",
  input_schema: {
    type: "object" as const,
    properties: {
      picks: {
        type: "array",
        minItems: 5,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            context_note: { type: "string", maxLength: 80 },
            category: {
              type: "string",
              enum: ["friction", "fit", "pro_tip"],
            },
          },
          required: ["name", "context_note", "category"],
        },
      },
    },
    required: ["picks"],
  },
};

/** Lowercase the destination string for case-insensitive cache lookup —
 *  mirrors `neighborhoodCacheKey` from PHI-100. */
export function popularPicksCityKey(destination: string): string {
  return destination.trim().toLowerCase();
}

/** Sort + dedupe + lowercase style tags so a reorder doesn't inflate
 *  cache miss-rate. Luca's catch from the 2026-05-17 refine. */
export function popularPicksSortedStyleTags(tags: string[] | null | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  const lowered = tags
    .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
    .filter((t) => t.length > 0);
  return Array.from(new Set(lowered)).sort();
}

/** Normalise the age bands array — keep distinct bands in sorted order so
 *  the cache key is stable across a re-render that shuffles the array. */
export function popularPicksSortedAgeBands(ages: string[] | null | undefined): string[] {
  if (!Array.isArray(ages)) return [];
  const cleaned = ages
    .map((a) => (typeof a === "string" ? a.trim() : ""))
    .filter((a) => a.length > 0);
  return Array.from(new Set(cleaned)).sort();
}

/** Server-side enforcement of the ≤80-char context note + every-pick-needs-a-note
 *  hard constraint. Truncates long notes and drops noteless picks. Returns
 *  what's left — the route then enforces the sub-minimum fallback (<3 = no
 *  panel) at the response shape. */
export function cleanPopularPicks(input: unknown): PopularPick[] {
  if (!Array.isArray(input)) return [];
  const allowedCats: PickCategory[] = ["friction", "fit", "pro_tip"];
  return input
    .map((raw): PopularPick | null => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const noteRaw = typeof r.context_note === "string" ? r.context_note.trim() : "";
      const category =
        typeof r.category === "string" && (allowedCats as string[]).includes(r.category)
          ? (r.category as PickCategory)
          : null;
      if (!name || !noteRaw || !category) return null;
      const note = noteRaw.length > 80 ? noteRaw.slice(0, 77).trimEnd() + "…" : noteRaw;
      return { name, context_note: note, category };
    })
    .filter((p): p is PopularPick => p !== null);
}
