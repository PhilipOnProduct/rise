/**
 * PHI-54 — Curated themed atlas loader and matcher.
 *
 * Reads data/themed-atlas.json once at module init. Provides:
 *   - matchFranchise(inspiration) — case-insensitive name + alias match
 *   - poisForDestination(franchiseName, city) — anchor list for the prompt
 *   - suggestLegs(franchiseName) — default leg structure for chip-confirm
 *
 * The atlas is additive — never replaces the PHI-51 soft-bias path.
 * When the atlas matches, downstream prompts get a "deterministic anchor
 * list" appended; the PHI-51 hallucination guard is preserved verbatim.
 *
 * Match policy: case-insensitive equality on canonical name OR aliases.
 * No fuzzy matching — that risks false positives like "Harry Styles"
 * matching "Harry Potter".
 */

import atlasData from "@/data/themed-atlas.json";

export type AtlasPoi = {
  name: string;
  lat: number;
  lng: number;
  type: string;
  blurb: string;
};

export type AtlasDestination = {
  city: string;
  country: string;
  pois: AtlasPoi[];
};

export type AtlasSuggestedLeg = {
  city: string;
  country: string;
  nights: number;
};

export type AtlasFranchise = {
  name: string;
  aliases: string[];
  destinations: AtlasDestination[];
  suggested_legs: AtlasSuggestedLeg[];
};

type AtlasShape = {
  franchises: AtlasFranchise[];
};

const atlas = atlasData as unknown as AtlasShape;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Returns the franchise that matches the given inspiration string by
 * canonical name or any alias (case-insensitive equality). Returns null
 * if nothing matches — the soft-bias path runs alone for those.
 */
export function matchFranchise(inspiration: string): AtlasFranchise | null {
  if (!inspiration) return null;
  const target = norm(inspiration);
  for (const f of atlas.franchises) {
    if (norm(f.name) === target) return f;
    for (const a of f.aliases) {
      if (norm(a) === target) return f;
    }
  }
  return null;
}

/**
 * Returns the POI list for a franchise + destination city. Match is
 * case-insensitive on city name. Returns [] when the destination is not
 * in the atlas (the soft-bias path still runs in that case).
 */
export function poisForDestination(
  franchise: AtlasFranchise,
  city: string
): AtlasPoi[] {
  const target = norm(city);
  const dest = franchise.destinations.find((d) => norm(d.city) === target);
  return dest?.pois ?? [];
}

/**
 * Returns the default leg structure for a franchise. Used by parse-trip
 * to surface multi-leg suggestions on the chip-confirm screen.
 */
export function suggestLegs(franchise: AtlasFranchise): AtlasSuggestedLeg[] {
  return franchise.suggested_legs;
}

/**
 * Builds a "deterministic anchor list" segment for activity-gen and
 * itinerary-gen prompts. Caller decides whether to inject (atlas matched
 * AND city is in atlas's destination list). Returns null when no POIs
 * exist for the destination — caller falls back to soft-bias only.
 */
export function buildAtlasAnchorSegment(
  franchise: AtlasFranchise,
  city: string
): string | null {
  const pois = poisForDestination(franchise, city);
  if (pois.length === 0) return null;
  const lines = pois
    .slice(0, 8)
    .map((p) => `- ${p.name}: ${p.blurb}`)
    .join("\n");
  return `Themed anchor list (real, locatable POIs in ${city} linked to ${franchise.name}):\n${lines}\n\nSurface 1–2 of these where natural for this slot; do not invent additional themed venues. Apply the standard hallucination guard: only suggest theme-relevant items if a real, high-quality option exists in the destination.`;
}

export const __atlasForTests = atlas;
