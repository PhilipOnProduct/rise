/**
 * PHI-99 — Trip duration: single source of truth.
 *
 * A traveller can express trip length two ways:
 *
 * 1. **Exact dates** (the long-standing path) — `legs[0].startDate` and
 *    `legs[0].endDate` populated. Nights = endDate − startDate. The trip
 *    has concrete days.
 *
 * 2. **Flex dates** (new) — `flex_month` + `flex_nights` columns on the
 *    traveler row. The user has a month in mind ("we're thinking October")
 *    and a duration but hasn't committed to specific dates. Nights =
 *    `flex_nights`. seasonHint = "October 2026" derived from flex_month.
 *
 * The two paths must never be mixed on the same row. The API layer keeps
 * the columns mutually exclusive (writing one path clears the other).
 *
 * Centralising the resolution here is a hard constraint of the PHI-99 PRD —
 * the failure shape we're guarding against is one route reading flex and
 * another reading dates and getting different durations for the same row.
 * Every consumer (activity-gen, itinerary-gen, itinerary-edit, the
 * dashboard nudge) must funnel through `resolveTripDuration`.
 */

import type { TripLeg } from "@/lib/trip-schema";

export type TripDurationInput = {
  legs?: TripLeg[] | null;
  /** ISO month string e.g. "2026-10". Persisted on the `travelers` row. */
  flexMonth?: string | null;
  flexNights?: number | null;
};

export type TripDuration = {
  /** Whole nights between leg dates OR the flex-nights value. >=1 by construction. */
  nights: number;
  /** "October 2026" derived from flex_month, or null on the exact-date path. */
  seasonHint: string | null;
  mode: "exact" | "flex";
};

const MONTH_NAMES = [
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

/**
 * Parse `"YYYY-MM"` into a human-readable `"Month YYYY"`. Returns null on
 * anything that doesn't parse — falls back to the flex-mode "Month YYYY"
 * fallback being absent rather than fabricated. Tolerant of trimming and
 * a stray "YYYY-MM-DD" (takes the first 7 chars).
 */
export function seasonHintFromFlexMonth(flexMonth: string): string | null {
  const trimmed = flexMonth.trim().slice(0, 7);
  const match = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Resolve trip duration from either the exact-date legs or the flex
 * columns. The exact-date path wins when both happen to be present (the
 * API layer guarantees they aren't, but the helper is defensive).
 *
 * Throws when neither path can produce a duration — that's a programmer
 * error upstream (you shouldn't be running this on a half-filled traveler
 * row).
 */
export function resolveTripDuration(input: TripDurationInput): TripDuration {
  const legs = Array.isArray(input.legs) ? input.legs : [];
  const firstLeg = legs[0];

  // Exact-date path: at least one leg with both startDate and endDate.
  // Multi-leg exact: total nights = sum across legs OR last endDate −
  // first startDate (legs may be adjacent or have transition days; we
  // use the envelope so the count matches what /api/itinerary/generate
  // emits today).
  if (firstLeg?.startDate && legs.length > 0) {
    const allStarts = legs
      .map((l) => l.startDate)
      .filter((d): d is string => !!d)
      .sort();
    const allEnds = legs
      .map((l) => l.endDate)
      .filter((d): d is string => !!d)
      .sort();
    const start = allStarts[0];
    const end = allEnds[allEnds.length - 1];
    if (start && end) {
      const nights = Math.max(
        1,
        Math.round(
          (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000,
        ),
      );
      return { nights, seasonHint: null, mode: "exact" };
    }
  }

  // Flex path.
  const flexMonth =
    typeof input.flexMonth === "string" ? input.flexMonth.trim() : "";
  const flexNights =
    typeof input.flexNights === "number" && Number.isFinite(input.flexNights)
      ? Math.max(1, Math.round(input.flexNights))
      : null;
  if (flexMonth && flexNights) {
    return {
      nights: flexNights,
      seasonHint: seasonHintFromFlexMonth(flexMonth),
      mode: "flex",
    };
  }

  throw new Error(
    "resolveTripDuration: traveler has neither leg dates nor flex columns.",
  );
}

/**
 * Soft variant — returns null instead of throwing when the traveler row
 * is mid-onboarding and not yet usable. Callers that render UI under a
 * loading state prefer this over the throwing variant.
 */
export function tryResolveTripDuration(
  input: TripDurationInput,
): TripDuration | null {
  try {
    return resolveTripDuration(input);
  } catch {
    return null;
  }
}
