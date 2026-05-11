/**
 * PHI-89: pick a homepage skyline region from an Accept-Language header.
 *
 * Returns one of "americas" | "asia" | "europe" | null. null = no usable
 * header (missing, unparseable, empty). Callers fall back to the default
 * nine-monument skyline when the result is null.
 *
 * Resolution rules (first match wins, scanning highest-q tag first):
 *   - en-US, en, es-MX, pt-BR, fr-CA → "americas"
 *   - ja, ko, zh, hi, th, vi, ar     → "asia"
 *   - any other parseable tag        → "europe"
 *
 * Pure, deterministic, no external calls.
 */

export type SkylineRegion = "americas" | "asia" | "europe";

const AMERICAS_TAGS = new Set([
  "en-us",
  "es-mx",
  "pt-br",
  "fr-ca",
]);

const AMERICAS_PRIMARY = new Set(["en"]);

const ASIA_PRIMARY = new Set([
  "ja",
  "ko",
  "zh",
  "hi",
  "th",
  "vi",
  "ar",
]);

type ParsedTag = { tag: string; q: number };

function parseAcceptLanguage(header: string): ParsedTag[] {
  const parts = header.split(",");
  const parsed: ParsedTag[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [tagRaw, ...params] = trimmed.split(";");
    const tag = tagRaw.trim().toLowerCase();
    if (!tag || tag === "*") continue;
    let q = 1;
    for (const param of params) {
      const [k, v] = param.split("=").map((s) => s.trim());
      if (k === "q" && v) {
        const parsedQ = parseFloat(v);
        if (Number.isFinite(parsedQ)) q = parsedQ;
      }
    }
    parsed.push({ tag, q });
  }
  // Stable sort by descending quality.
  parsed.sort((a, b) => b.q - a.q);
  return parsed;
}

export function regionFromAcceptLanguage(
  header: string | null | undefined
): SkylineRegion | null {
  if (!header || typeof header !== "string") return null;
  let tags: ParsedTag[];
  try {
    tags = parseAcceptLanguage(header);
  } catch {
    return null;
  }
  if (tags.length === 0) return null;

  for (const { tag } of tags) {
    if (AMERICAS_TAGS.has(tag)) return "americas";
    const primary = tag.split("-")[0];
    if (AMERICAS_PRIMARY.has(primary)) return "americas";
    if (ASIA_PRIMARY.has(primary)) return "asia";
  }
  // Parseable but no Americas/Asia match → Europe variant.
  return "europe";
}
