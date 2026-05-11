/**
 * PHI-80 — Destination-aware hotel placeholder for the welcome flow.
 *
 * Step 2's hotel input previously hardcoded "e.g. Hotel Arts" regardless of
 * destination. Hotel Arts is in Barcelona, so a Lisbon trip would see a
 * Barcelona hotel — a small-but-jarring "this isn't really about my trip"
 * signal. This lookup swaps that for a known hotel in the destination, with
 * a generic "Search for your hotel" fallback when we don't have an entry.
 *
 * Pure local computation — no API calls.
 */

const FALLBACK_PLACEHOLDER = "Search for your hotel";

/**
 * Keys are lowercased, diacritic-stripped city names. Values include the
 * "e.g. " prefix so the function returns a complete placeholder string.
 */
const HOTEL_BY_CITY: Record<string, string> = {
  // GB
  "london":         "e.g. The Ned",
  "edinburgh":      "e.g. The Balmoral",
  // IT
  "rome":           "e.g. Hotel de Russie",
  "florence":       "e.g. Villa San Michele",
  "venice":         "e.g. Hotel Danieli",
  // JP
  "tokyo":          "e.g. Park Hyatt Tokyo",
  "kyoto":          "e.g. Hoshinoya Kyoto",
  // TH
  "bangkok":        "e.g. The Siam",
  // US
  "new york":       "e.g. The Greenwich Hotel",
  "los angeles":    "e.g. Chateau Marmont",
  // FR
  "paris":          "e.g. Hôtel Costes",
  "nice":           "e.g. Hôtel Negresco",
  // ES
  "barcelona":      "e.g. Cotton House",
  "madrid":         "e.g. Only YOU Atocha",
  // GR
  "athens":         "e.g. Hotel Grande Bretagne",
  "santorini":      "e.g. Andronis Boutique",
  // MX
  "mexico city":    "e.g. Las Alcobas",
  "tulum":          "e.g. Hotel Esencia",
  // AU
  "sydney":         "e.g. Park Hyatt Sydney",
  "melbourne":      "e.g. QT Melbourne",
  // PT / NL / DE / TR / MA / AE / ID — popular destinations outside the
  // country-recommender set
  "lisbon":         "e.g. Memmo Alfama",
  "amsterdam":      "e.g. The Hoxton",
  "berlin":         "e.g. Soho House Berlin",
  "istanbul":       "e.g. Pera Palace",
  "marrakech":      "e.g. Riad Yasmine",
  "dubai":          "e.g. Atlantis The Palm",
  "bali":           "e.g. Bambu Indah",
};

/**
 * Given a destination string (which may be "Lisbon" or "Lisbon, Portugal"
 * or "  LISBON  " or "São Paulo"), return a placeholder for the hotel
 * input. Falls back to a generic prompt when the city isn't in the map.
 */
export function getHotelPlaceholder(destination: string | null | undefined): string {
  if (!destination) return FALLBACK_PLACEHOLDER;
  const key = destination
    .split(",")[0]
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return HOTEL_BY_CITY[key] ?? FALLBACK_PLACEHOLDER;
}
