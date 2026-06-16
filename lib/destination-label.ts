/**
 * PHI-130 — Human-friendly city label for UI headings.
 *
 * Places autocomplete / geocoder selections land in the `destination` state
 * as the full formatted string ("Rome, Metropolitan City of Rome Capital,
 * Italy"). That reads clumsily in a heading ("Activities for your Rome,
 * Metropolitan City of Rome Capital, Italy trip."). This returns just the
 * leading locality segment ("Rome") for DISPLAY, while callers keep the full
 * `destination` string for the AI prompts and downstream location logic.
 *
 * Mirrors the `split(",")[0]` idiom already used elsewhere for city
 * extraction (Step2Hotel `onSelect`, `getHotelPlaceholder`). The free-form
 * parser and country-recommendation paths set a short name with no comma —
 * those pass through unchanged.
 *
 * Guard (PHI-78): this trims for DISPLAY only. Never feed the result back
 * into stored state or an API call — that would re-introduce the
 * country-loss bug PHI-78 fixed.
 *
 * Pure local computation — no API calls.
 */
export function cityLabel(destination: string | null | undefined): string {
  if (!destination) return "";
  const first = destination.split(",")[0].trim();
  // Fall back to the trimmed full string if the first segment is empty
  // (e.g. a leading comma) so we never render an empty heading.
  return first.length > 0 ? first : destination.trim();
}
