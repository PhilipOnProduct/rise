/**
 * PHI-129 — Destination-aware placeholder for the welcome Step-4 must-dos
 * textarea.
 *
 * The textarea previously hardcoded Lisbon examples ("Cervejaria Ramiro /
 * Sunset at Miradouro da Senhora do Monte / Time Out Market") regardless of
 * destination — so a Rome trip saw Lisbon prompts, the same small "this
 * isn't really about my trip" signal PHI-80 fixed for the hotel input.
 *
 * Mirrors `getHotelPlaceholder` exactly: a small static map of well-known
 * per-city examples (a sight, a food spot, an experience), with a generic
 * non-city-specific prompt as the fallback. The returned string already
 * carries the "e.g.\n" prefix and newline-separated examples so the caller
 * can drop it straight into the textarea `placeholder`.
 *
 * Pure local computation — no API calls. Examples are real, recognisable
 * places (this is greyed placeholder text, not AI output, but keeping them
 * real avoids modelling bad input for the user).
 */

const FALLBACK_PLACEHOLDER = [
  "e.g.",
  "A landmark you don't want to miss",
  "A restaurant or dish to try",
  "A neighbourhood to explore",
].join("\n");

/**
 * Keys are lowercased, diacritic-stripped city names — same keying as
 * `getHotelPlaceholder` so the two stay in lockstep. Values are the three
 * example lines (no "e.g." prefix — that's prepended on read).
 */
const MUST_DOS_BY_CITY: Record<string, string[]> = {
  // GB
  "london":       ["The British Museum", "A West End show", "Borough Market"],
  "edinburgh":    ["Edinburgh Castle", "Climb Arthur's Seat", "The Royal Mile"],
  // IT
  "rome":         ["The Colosseum", "Dinner in Trastevere", "The Trevi Fountain"],
  "florence":     ["The Uffizi Gallery", "Climb the Duomo", "Sunset at Piazzale Michelangelo"],
  "venice":       ["St Mark's Basilica", "A gondola ride", "The Rialto Market"],
  // JP
  "tokyo":        ["Senso-ji Temple", "Sushi at Tsukiji Outer Market", "Shibuya Crossing"],
  "kyoto":        ["Fushimi Inari Shrine", "Arashiyama Bamboo Grove", "Kiyomizu-dera"],
  // TH
  "bangkok":      ["The Grand Palace", "Street food on Yaowarat Road", "Wat Arun"],
  // US
  "new york":     ["The Met", "A Broadway show", "Walk the High Line"],
  "los angeles":  ["Griffith Observatory", "The Getty", "Venice Beach"],
  // FR
  "paris":        ["The Louvre", "Climb the Eiffel Tower", "A café in Le Marais"],
  "nice":         ["The Promenade des Anglais", "Vieux Nice (Old Town)", "Cours Saleya market"],
  // ES
  "barcelona":    ["La Sagrada Família", "Tapas in El Born", "Park Güell"],
  "madrid":       ["The Prado Museum", "Retiro Park", "Mercado de San Miguel"],
  // GR
  "athens":       ["The Acropolis", "Dinner in Plaka", "The Acropolis Museum"],
  "santorini":    ["Sunset in Oia", "A catamaran cruise", "Red Beach"],
  // MX
  "mexico city":  ["Teotihuacán pyramids", "Frida Kahlo Museum", "Tacos al pastor in Roma"],
  "tulum":        ["The Tulum ruins", "Swim in a cenote", "Playa Paraíso"],
  // AU
  "sydney":       ["The Opera House", "Bondi to Coogee coastal walk", "The Harbour Bridge"],
  "melbourne":    ["The laneways", "Queen Victoria Market", "Coffee in Fitzroy"],
  // PT / NL / DE / TR / MA / AE / ID
  "lisbon":       ["Cervejaria Ramiro", "Sunset at Miradouro da Senhora do Monte", "Time Out Market"],
  "amsterdam":    ["The Rijksmuseum", "Anne Frank House", "A canal cruise"],
  "berlin":       ["The Brandenburg Gate", "East Side Gallery", "Museum Island"],
  "istanbul":     ["Hagia Sophia", "The Grand Bazaar", "A Bosphorus ferry"],
  "marrakech":    ["Jemaa el-Fnaa", "The Majorelle Garden", "Get lost in the souks"],
  "dubai":        ["The Burj Khalifa", "The Dubai Fountain", "A desert safari"],
  "bali":         ["Tegallalang Rice Terraces", "Uluwatu Temple at sunset", "Ubud Monkey Forest"],
};

/**
 * Given a destination string (which may be "Rome" or "Rome, Italy" or
 * "  ROME  " or "São Paulo"), return a multi-line placeholder for the
 * must-dos textarea. Falls back to a generic, non-city-specific prompt when
 * the city isn't in the map.
 */
export function getMustDosPlaceholder(destination: string | null | undefined): string {
  if (!destination) return FALLBACK_PLACEHOLDER;
  const key = destination
    .split(",")[0]
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const examples = MUST_DOS_BY_CITY[key];
  return examples ? ["e.g.", ...examples].join("\n") : FALLBACK_PLACEHOLDER;
}
