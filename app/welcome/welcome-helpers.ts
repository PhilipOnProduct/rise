import { cleanUserSeededActivities } from "@/lib/itinerary-gen-prompt";
import type { ParsedActivity } from "./welcome-types";

export function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

// PHI-99: build the 18-month dropdown options for flex-date entry. Returns
// `[{ value: "2026-10", label: "October 2026" }, ...]` starting from the
// current month. Default is current month + 2 (handled at state-init time
// inside the wizard).
export function buildFlexMonthOptions(today: Date = new Date()): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  for (let i = 0; i < 18; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    out.push({
      value: `${d.getFullYear()}-${m}`,
      label: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
    });
  }
  return out;
}

export function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

/**
 * PHI-90 — split the free-text must-dos textarea into a clean string array.
 * PHI-97 — now a thin wrapper around the canonical `cleanUserSeededActivities`
 * helper so the wizard, the three server routes, and any future client share
 * one implementation of the 20 × 200-char cap.
 */
export function splitSeededActivities(raw: string): string[] {
  return cleanUserSeededActivities(raw ? raw.split(/\r?\n/) : []);
}

/**
 * PHI-37 slice 1: nights between two ISO dates (return - departure, in
 * whole nights). Returns null when either side is missing or unparseable.
 */
export function nightsBetween(
  departure: string | undefined,
  ret: string | undefined
): number | null {
  if (!departure || !ret) return null;
  const a = Date.parse(departure);
  const b = Date.parse(ret);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/**
 * PHI-37 slice 1: equal-split a total night count across N legs.
 *
 * Default is even distribution; remainder loaded into earlier legs. A
 * 7-night, 3-leg trip splits 3 / 2 / 2. A 5-night, 2-leg trip splits
 * 3 / 2. Returns an array of length `legCount` summing to `totalNights`.
 * If totalNights is 0 or unknown, returns zeros so callers can decide
 * the fallback (e.g. "ask the user" or "default 1 per leg").
 */
export function equalSplitNights(legCount: number, totalNights: number): number[] {
  if (legCount <= 0) return [];
  if (totalNights <= 0) return new Array(legCount).fill(0);
  const base = Math.floor(totalNights / legCount);
  const remainder = totalNights - base * legCount;
  return Array.from({ length: legCount }, (_, i) =>
    i < remainder ? base + 1 : base
  );
}

/**
 * Persistent trip-type confirmation label (PHI-26 / RISE-102).
 *
 * Two of five personas in the May 2026 onboarding review (solo and family
 * travellers) got NO confirmation that the system understood who's
 * traveling because the Trip Type chip section was hidden in their cases.
 * This function derives a human label from the same inputs so the user
 * always sees their composition reflected back.
 *
 * Pure derived state — no new fields, no side effects.
 */
export function tripTypeLabel(
  adultCount: number,
  childrenAges: string[],
  travelCompany: string,
): string {
  // Family — any children present
  if (childrenAges.length > 0) {
    const kidWord = childrenAges.length === 1 ? "child" : "children";
    // PHI-27: if any age is unset, prompt the user before showing detail.
    if (childrenAges.some((a) => a.length === 0)) {
      return `Planning a family trip with ${childrenAges.length} ${kidWord} — pick an age range for each`;
    }
    // Truncate the age list at 2 entries for legibility
    const ageDisplay =
      childrenAges.length <= 2
        ? childrenAges.join(", ")
        : `${childrenAges[0]}, ${childrenAges[1]} +${childrenAges.length - 2} more`;
    return `Planning a family trip with ${childrenAges.length} ${kidWord} (${ageDisplay})`;
  }
  // Solo
  if (adultCount === 1) return "Planning a solo trip";
  // 2 adults — depends on chip choice (chip stays visible to resolve the ambiguity)
  if (adultCount === 2) {
    if (travelCompany === "partner") return "Planning a couple's trip";
    if (travelCompany === "friends") return "Planning a trip for two friends";
    return "Planning a trip for two"; // neutral prompt while user picks
  }
  // 3+ adults
  if (travelCompany === "family") return `Planning a family trip with ${adultCount} adults`;
  return `Planning a trip for ${adultCount} friends`;
}

export function previewLoadingLabel(destination: string, travelCompany: string): string {
  const companyLabel: Record<string, string> = {
    solo: "solo",
    partner: "couple",
    family: "family",
    friends: "friends",
  };
  const label = companyLabel[travelCompany];
  if (label) return `Planning your ${label} trip to ${destination}…`;
  return `Planning your trip to ${destination}…`;
}

export function parseActivities(text: string): ParsedActivity[] {
  // Matches: **Name** — Category\nDescription\n*When: timing*\n[*Why: rationale*]
  // PHI-32: Why line is optional — old streams without rationale still parse.
  const regex =
    /\*\*([^*\n]+)\*\*\s*[—–\-]\s*([^\n]+)\n([^\n*][^\n]*)\n\*When:\s*([^*\n]+)\*(?:\s*\n\*Why:\s*([^*\n]+)\*)?/g;
  // PHI-37: scan for "LEG: <index>" markers so multi-leg streams tag each
  // activity with its leg. Single-leg streams have no markers and the
  // legIndex stays undefined, which is fine for downstream renderers.
  const legMarker = /LEG:\s*(\d+)/g;
  const legAt: { offset: number; index: number }[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = legMarker.exec(text)) !== null) {
    legAt.push({ offset: mm.index, index: Number(mm[1]) });
  }

  const results: ParsedActivity[] = [];
  let match;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    // Find the most recent LEG marker that appeared before this card.
    let legIndex: number | undefined;
    for (const m of legAt) {
      if (m.offset < match.index) legIndex = m.index;
      else break;
    }
    results.push({
      id: `act-${idx++}`,
      name: match[1].trim(),
      category: match[2].trim(),
      description: match[3].trim(),
      when: match[4].trim(),
      rationale: match[5]?.trim() || undefined,
      ...(legIndex !== undefined && { legIndex }),
    });
  }
  return results;
}

export function logActivityEvent(payload: {
  event: string;
  activityId: string;
  activityName: string;
  activityCategory: string;
  chipLabel?: string;
  chipType?: string;
  chipsSource?: string;
  firstChipLabel?: string;
  // PHI-51: optional creative-inspiration; lands in activity_feedback.metadata
  // because the route auto-buckets unknown fields into the jsonb column.
  // The success-metric query joins thumbs_up rate against this field.
  inspiration?: string | null;
  // PHI-52: which strength branch the prompt took for this trip's activity-gen.
  // "family" if any child in party, else "adult". Null when no inspiration.
  inspirationStrength?: "adult" | "family" | null;
}) {
  fetch("/api/activity-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
