/**
 * Builds a plain-language composition context segment for injection into AI prompts.
 * Translates traveler count and children's age ranges into behavioural constraints.
 */

const AGE_CONSTRAINTS: Record<string, string[]> = {
  "Under 2": [
    "pram access required",
    "nap windows mid-morning and mid-afternoon",
    "avoid loud or crowded environments",
  ],
  "2–4": ["45-minute activity maximum", "outdoor space preferable"],
  "5–8": ["90-minute activity tolerance", "interactive experiences preferred"],
  "9–12": ["near-adult stamina"],
  // PHI-27: teens are near-adult travellers — include experiences the
  // family can do *together* that you wouldn't serve to younger kids
  // (food markets, urban exploration, photo spots, age-appropriate
  // adventure, vineyard/cooking class, kayaking). Avoid kid-club /
  // playground framing.
  "13–17": [
    "near-adult stamina",
    "include near-adult experiences (food markets, urban exploration, photo spots, age-appropriate adventure)",
    "avoid playground or kid-club framing",
  ],
};

export function buildCompositionSegment(
  travelerCount: number | null | undefined,
  childrenAges: string[] | null | undefined
): string {
  const parts: string[] = [];

  if (travelerCount != null && travelerCount > 0) {
    parts.push(
      `Party size: ${travelerCount} ${travelerCount === 1 ? "person" : "people"}.`
    );
  }

  if (childrenAges && childrenAges.length > 0) {
    // Deduplicate constraints across children sharing the same age band
    const seen = new Set<string>();
    const constraints: string[] = [];
    for (const age of childrenAges) {
      for (const c of AGE_CONSTRAINTS[age] ?? []) {
        if (!seen.has(c)) {
          seen.add(c);
          constraints.push(c);
        }
      }
    }

    const n = childrenAges.length;
    const ageList = childrenAges.join(", ");
    parts.push(
      `Travelling with ${n} ${n === 1 ? "child" : "children"} (ages: ${ageList}).` +
        (constraints.length > 0
          ? ` Plan every recommendation around these requirements: ${constraints.join("; ")}.`
          : "")
    );
  }

  return parts.join(" ");
}
