/**
 * PHI-58 — Free-form trip description detector.
 *
 * Used by the homepage submit handler to decide whether the text the user
 * typed into the destination input is a single destination (route into the
 * existing structured wizard) or a free-form trip description (route into
 * the parser flow on /welcome).
 *
 * Pure string check — no API call, O(string length). Multi-word city names
 * (Buenos Aires, New York City, San Francisco) must NOT be misclassified
 * as free-form; the 4-word floor handles 3-word cities.
 */

const ANCHOR_PHRASES = [
  "inspired",
  "family trip",
  "in the footsteps",
  "like in",
  "themed",
  "we want",
  "with my",
  "with our",
];

export function isFreeFormTripDescription(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();
  if (ANCHOR_PHRASES.some((phrase) => lower.includes(phrase))) return true;

  const commaCount = (trimmed.match(/,/g) ?? []).length;
  if (commaCount >= 2) return true;

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 4) return true;

  return false;
}
