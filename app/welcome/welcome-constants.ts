import type { Chip } from "./welcome-types";

// PHI-90: Step 4 ("Anything you already want to do?") sits between
// preferences (3) and the AI activity preview (now 5). Account creation
// moves from 5 to 6. Step 3.5 (country recs, sentinel value 35) is
// unchanged and now hands off to step 4 (must-dos) when picked.
export const TOTAL_WIZARD_STEPS = 6; // steps 1–6

export const COMPANY_OPTIONS: Record<string, { label: string; emoji: string }> = {
  solo: { label: "Just me", emoji: "🧳" },
  partner: { label: "Couple", emoji: "💑" },
  friends: { label: "Friend group", emoji: "👯" },
  family: { label: "Family", emoji: "👨‍👩‍👧" },
};

export const STYLE_OPTIONS_BASE = [
  "Cultural",
  "Food-led",
  "Relaxed",
  "Adventure",
  "Off the beaten track",
  "History",
];

export const STYLE_OPTIONS_BY_COMPANY: Record<string, string[]> = {
  solo:    ["Budget-savvy", "Slow travel", "Wellness", "Photography", "Nightlife", "Art & Design"],
  partner: ["Romantic", "Wellness", "Nightlife", "Art & Design", "Photography"],
  friends: ["Nightlife", "Active", "Festivals", "Art & Design", "Photography"],
  // Per Elena's input on PHI-27: split family chips so users can signal
  // whether they're travelling with kids, teens, or both. The model uses
  // these to bias activity selection (toddler-friendly vs. near-adult).
  family:  ["Kid-friendly", "Teen-friendly", "Beach", "Educational", "Wellness", "Photography"],
};

export function getStyleOptions(company: string): string[] {
  const extra = STYLE_OPTIONS_BY_COMPANY[company] ?? ["Nightlife", "Wellness", "Art & Design", "Photography"];
  return [...STYLE_OPTIONS_BASE, ...extra];
}

export const BUDGET_OPTIONS = [
  { id: "budget", label: "Savvy", description: "Great value, local finds" },
  { id: "comfortable", label: "Comfortable", description: "Quality without excess" },
  { id: "luxury", label: "Flexible", description: "Spend where it matters" },
];

// PHI-35 / RISE-302: high-stakes constraint chips, prioritised per Elena.
// Six chips spanning the highest-stakes categories: mobility, dietary,
// religious/cultural, family. The free-text box catches everything else.
// Severe allergy is flagged for the model as life-impacting in the prompt.
export const CONSTRAINT_CHIPS = [
  "Wheelchair access",
  "No long walks",
  "Vegetarian",
  "Halal/Kosher",
  "Severe allergy",
  "Stroller-friendly",
] as const;

export const MAX_STYLE_SELECTIONS = 3;

// PHI-27: added "13–17" so teen families aren't silently excluded.
export const CHILD_AGE_RANGES = ["Under 2", "2–4", "5–8", "9–12", "13–17"] as const;

// PHI-47: permissive email format check. Rejects "x", "abc", "@", "user@",
// while accepting plus-addressing, subdomains, and country TLDs. Server-
// side check in /api/travelers mirrors this regex.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Shown immediately on thumbs-down; replaced silently by dynamic chips once they arrive
export const FALLBACK_CHIPS: Chip[] = [
  { label: "Done it before", type: "hard_exclusion" },
  { label: "Doesn't fit my itinerary", type: "soft_signal" },
  { label: "Not really my thing", type: "soft_signal" },
  { label: "Not for me", type: "soft_signal" },
];
