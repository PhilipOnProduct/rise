/**
 * PHI-54 — Validate data/themed-atlas.json.
 *
 * Checks each franchise has the right shape, every POI has plausible
 * lat/lng, no duplicates within a destination, and aliases are unique
 * across the whole atlas (so "HP" can't match two franchises).
 *
 * Run via `npm run validate:atlas`. Exits non-zero on failure.
 */

import atlasData from "../data/themed-atlas.json";

type Poi = { name: string; lat: number; lng: number; type: string; blurb: string };
type Destination = { city: string; country: string; pois: Poi[] };
type Franchise = {
  name: string;
  aliases: string[];
  destinations: Destination[];
  suggested_legs: { city: string; country: string; nights: number }[];
};

const atlas = atlasData as unknown as { franchises: Franchise[] };

const errors: string[] = [];

function check(cond: boolean, msg: string) {
  if (!cond) errors.push(msg);
}

const seenAliases = new Map<string, string>();

for (const f of atlas.franchises) {
  check(typeof f.name === "string" && f.name.length > 0, `franchise missing name`);
  check(Array.isArray(f.aliases), `${f.name}: aliases must be array`);
  check(Array.isArray(f.destinations), `${f.name}: destinations must be array`);
  check(
    Array.isArray(f.suggested_legs),
    `${f.name}: suggested_legs must be array`
  );

  // Alias uniqueness — case-insensitive — across the whole atlas.
  const allKeys = [f.name, ...f.aliases];
  for (const k of allKeys) {
    const norm = k.trim().toLowerCase();
    const existing = seenAliases.get(norm);
    if (existing && existing !== f.name) {
      errors.push(
        `alias "${k}" in "${f.name}" collides with "${existing}" — pick unique`,
      );
    }
    seenAliases.set(norm, f.name);
  }

  for (const d of f.destinations) {
    check(typeof d.city === "string", `${f.name}: destination missing city`);
    check(
      typeof d.country === "string",
      `${f.name}/${d.city}: missing country`,
    );
    check(Array.isArray(d.pois) && d.pois.length > 0, `${f.name}/${d.city}: must have ≥1 POI`);

    const seenPoiNames = new Set<string>();
    for (const p of d.pois) {
      check(typeof p.name === "string" && p.name.length > 0, `${f.name}/${d.city}: POI missing name`);
      check(
        typeof p.lat === "number" && p.lat >= -90 && p.lat <= 90,
        `${f.name}/${d.city}/${p.name}: lat out of range (${p.lat})`,
      );
      check(
        typeof p.lng === "number" && p.lng >= -180 && p.lng <= 180,
        `${f.name}/${d.city}/${p.name}: lng out of range (${p.lng})`,
      );
      check(
        typeof p.type === "string" && p.type.length > 0,
        `${f.name}/${d.city}/${p.name}: missing type`,
      );
      check(
        typeof p.blurb === "string" && p.blurb.length >= 10,
        `${f.name}/${d.city}/${p.name}: blurb must be ≥10 chars (got ${p.blurb?.length ?? 0})`,
      );
      const k = p.name.toLowerCase();
      if (seenPoiNames.has(k)) {
        errors.push(`${f.name}/${d.city}: duplicate POI name "${p.name}"`);
      }
      seenPoiNames.add(k);
    }
  }

  // suggested_legs cities should appear somewhere in destinations[] so
  // the leg always has anchor POIs to inject downstream.
  const destCities = new Set(f.destinations.map((d) => d.city.toLowerCase()));
  for (const leg of f.suggested_legs) {
    check(
      typeof leg.city === "string" && leg.city.length > 0,
      `${f.name}: suggested_leg missing city`,
    );
    check(
      typeof leg.nights === "number" && leg.nights >= 1,
      `${f.name}/${leg.city}: nights must be ≥1`,
    );
    if (!destCities.has(leg.city.toLowerCase())) {
      errors.push(
        `${f.name}: suggested_leg city "${leg.city}" has no destinations[] entry — no anchor POIs available`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("themed-atlas.json validation FAILED:");
  for (const e of errors) console.error("  •", e);
  process.exit(1);
}

console.log("themed-atlas.json: OK");
console.log(`  ${atlas.franchises.length} franchise(s)`);
for (const f of atlas.franchises) {
  const totalPois = f.destinations.reduce((n, d) => n + d.pois.length, 0);
  console.log(`  - ${f.name}: ${f.destinations.length} destination(s), ${totalPois} POI(s), ${f.suggested_legs.length} leg(s)`);
}
