/**
 * Travel connector logic — coordinate resolution, route computation,
 * gap calculation, and family walk-time modifier.
 *
 * All functions here run server-side only.
 */

import type { Activity, TimeBlock } from "@/types/itinerary";
import { logApiUsage } from "@/lib/log-api-usage";

// ── Types ────────────────────────────────────────────────────────────────────

export type Coords = { lat: number; lng: number };

export type RouteResult = {
  duration_seconds: number;
  distance_meters: number;
  fare_text?: string;
};

export type ConnectorRow = {
  traveler_id: string;
  day_number: number;
  sequence_index: number;
  from_activity_id: string;
  to_activity_id: string;
  from_name: string;
  to_name: string;
  from_lat: number | null;
  from_lng: number | null;
  to_lat: number | null;
  to_lng: number | null;
  walk_seconds: number | null;
  walk_meters: number | null;
  walk_adjusted_seconds: number | null;
  transit_seconds: number | null;
  transit_fare: string | null;
  drive_seconds: number | null;
  drive_meters: number | null;
  gap_seconds: number;
  gap_flagged: boolean;
  flag_reason: string | null;
  error: string | null;
};

// ── Time block ranges (minutes from midnight) ───────────────────────────────

const BLOCK_RANGE: Record<TimeBlock, [number, number]> = {
  morning:   [540, 720],   // 09:00 – 12:00
  afternoon: [780, 1020],  // 13:00 – 17:00
  evening:   [1080, 1260], // 18:00 – 21:00
};

const BLOCK_ORDER: Record<TimeBlock, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
};

const DEFAULT_ACTIVITY_DURATION_MIN = 90;
const GAP_BUFFER_SECONDS = 300; // 5 minutes
const FAMILY_WALK_MULTIPLIER = 1.5;
// Within-block pairs have ~0 computed gap because activities share the time window.
// Apply a 15-minute floor so short walks between nearby venues don't trigger false flags.
const WITHIN_BLOCK_MIN_GAP_SECONDS = 900; // 15 minutes

// ── Coordinate resolution via Places Text Search (New) ───────────────────────

export async function resolveCoordinates(
  activityName: string,
  destination: string,
  destinationCoords: Coords,
): Promise<Coords | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY;
  if (!apiKey) {
    console.error("[travel] Missing NEXT_PUBLIC_GOOGLE_PLACES_KEY");
    return null;
  }

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.location",
      },
      body: JSON.stringify({
        textQuery: `${activityName}, ${destination}`,
        locationBias: {
          circle: {
            center: { latitude: destinationCoords.lat, longitude: destinationCoords.lng },
            radius: 15000,
          },
        },
        maxResultCount: 1,
      }),
    });

    if (!res.ok) {
      console.error("[travel] Places Text Search error:", res.status, await res.text().catch(() => ""));
      return null;
    }

    const data = await res.json() as {
      places?: { location?: { latitude?: number; longitude?: number } }[];
    };

    const loc = data.places?.[0]?.location;
    if (loc?.latitude != null && loc?.longitude != null) {
      void logApiUsage({ provider: "google", apiType: "places-text-search", feature: "travel-connectors" });
      return { lat: loc.latitude, lng: loc.longitude };
    }

    return null;
  } catch (err) {
    console.error("[travel] Places Text Search exception:", err);
    return null;
  }
}

// ── Geocode a city name for destination bias ─────────────────────────────────

export async function geocodeCity(city: string): Promise<Coords | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city)}&key=${apiKey}`,
    );
    if (!res.ok) return null;

    const data = await res.json() as {
      results?: { geometry?: { location?: { lat: number; lng: number } } }[];
    };

    const loc = data.results?.[0]?.geometry?.location;
    if (loc) {
      void logApiUsage({ provider: "google", apiType: "geocoding", feature: "travel-connectors" });
      return loc;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Route computation via Google Routes API ──────────────────────────────────

export async function computeRoute(
  origin: Coords,
  dest: Coords,
  mode: "WALK" | "TRANSIT" | "DRIVE",
): Promise<RouteResult | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY;
  if (!apiKey) return null;

  // Build field mask — include fare info for transit
  const fields = ["routes.duration", "routes.distanceMeters"];
  if (mode === "TRANSIT") {
    fields.push("routes.legs.steps.transitDetails.localizedValues");
  }

  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
    travelMode: mode,
    computeAlternativeRoutes: false,
  };

  if (mode === "DRIVE") {
    body.routingPreference = "TRAFFIC_UNAWARE";
  }

  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fields.join(","),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("[travel] Routes API error:", mode, res.status, await res.text().catch(() => ""));
      return null;
    }

    const data = await res.json() as {
      routes?: {
        duration?: string;
        distanceMeters?: number;
        legs?: {
          steps?: {
            transitDetails?: {
              localizedValues?: { fare?: { text?: string } };
            };
          }[];
        }[];
      }[];
    };

    const route = data.routes?.[0];
    if (!route?.duration) return null;

    // Duration comes as "Xs" string (e.g. "1234s")
    const durationSeconds = parseInt(route.duration.replace("s", ""), 10);
    if (isNaN(durationSeconds)) return null;

    void logApiUsage({ provider: "google", apiType: "routes-compute", feature: "travel-connectors" });

    // Extract transit fare if present
    let fareText: string | undefined;
    if (mode === "TRANSIT") {
      for (const leg of route.legs ?? []) {
        for (const step of leg.steps ?? []) {
          const fare = step.transitDetails?.localizedValues?.fare?.text;
          if (fare) {
            fareText = fare;
            break;
          }
        }
        if (fareText) break;
      }
    }

    return {
      duration_seconds: durationSeconds,
      distance_meters: route.distanceMeters ?? 0,
      fare_text: fareText,
    };
  } catch (err) {
    console.error("[travel] Routes API exception:", mode, err);
    return null;
  }
}

// ── Gap & time calculation ───────────────────────────────────────────────────

type ActivityTime = { start_min: number; end_min: number };

/**
 * Assign estimated start/end times (in minutes from midnight) to each activity
 * based on its time block and sequence position within that block.
 */
export function calculateActivityTimes(
  activities: Activity[],
): Map<string, ActivityTime> {
  const result = new Map<string, ActivityTime>();

  // Group by block
  const groups: Record<TimeBlock, Activity[]> = { morning: [], afternoon: [], evening: [] };
  for (const a of activities) {
    groups[a.time].push(a);
  }

  for (const block of ["morning", "afternoon", "evening"] as TimeBlock[]) {
    const blockActivities = groups[block].sort((a, b) => a.sequence - b.sequence);
    const [start, end] = BLOCK_RANGE[block];
    const count = blockActivities.length;
    if (count === 0) continue;

    const slotWidth = (end - start) / count;
    for (let i = 0; i < count; i++) {
      const actStart = start + i * slotWidth;
      const actEnd = actStart + Math.min(DEFAULT_ACTIVITY_DURATION_MIN, slotWidth);
      result.set(blockActivities[i].id, { start_min: actStart, end_min: actEnd });
    }
  }

  return result;
}

/**
 * Build an ordered list of activity pairs for a day.
 * Activities are sorted by (block_order, sequence).
 */
export function buildActivityPairs(
  activities: Activity[],
): { from: Activity; to: Activity; index: number; sameBlock: boolean }[] {
  const sorted = [...activities].sort(
    (a, b) => BLOCK_ORDER[a.time] - BLOCK_ORDER[b.time] || a.sequence - b.sequence,
  );

  const pairs: { from: Activity; to: Activity; index: number; sameBlock: boolean }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    pairs.push({
      from: sorted[i],
      to: sorted[i + 1],
      index: i,
      sameBlock: sorted[i].time === sorted[i + 1].time,
    });
  }
  return pairs;
}

// ── Family walk-time modifier ────────────────────────────────────────────────

/**
 * Apply walk-time multiplier for families with young children.
 * Returns adjusted seconds or null if no modifier applies.
 */
export function applyFamilyModifier(
  walkSeconds: number,
  childrenAges: string[] | null | undefined,
): number | null {
  if (!childrenAges || childrenAges.length === 0) return null;

  const hasYoungChildren = childrenAges.some(
    (age) => age === "Under 2" || age === "2\u20134",
  );
  if (!hasYoungChildren) return null;

  return Math.ceil(walkSeconds * FAMILY_WALK_MULTIPLIER);
}

// ── Gap flag determination ───────────────────────────────────────────────────

export function determineFlag(
  walkSec: number | null,
  transitSec: number | null,
  driveSec: number | null,
  walkAdjustedSec: number | null,
  gapSec: number,
): { flagged: boolean; reason: string | null } {
  // Collect all non-null travel times, preferring adjusted walk
  const options: { mode: string; seconds: number }[] = [];
  const effectiveWalk = walkAdjustedSec ?? walkSec;
  if (effectiveWalk != null) options.push({ mode: "walk", seconds: effectiveWalk });
  if (transitSec != null) options.push({ mode: "transit", seconds: transitSec });
  if (driveSec != null) options.push({ mode: "drive", seconds: driveSec });

  if (options.length === 0) {
    // No route data at all — can't determine, don't flag
    return { flagged: false, reason: null };
  }

  const fastest = options.reduce((a, b) => (a.seconds < b.seconds ? a : b));

  if (fastest.seconds > gapSec + GAP_BUFFER_SECONDS) {
    const fastestMin = Math.ceil(fastest.seconds / 60);
    const gapMin = Math.round(gapSec / 60);
    return {
      flagged: true,
      reason: `Fastest option (${fastest.mode} ${fastestMin} min) exceeds ${gapMin} min gap`,
    };
  }

  return { flagged: false, reason: null };
}

// ── Build a full connector row ───────────────────────────────────────────────

export function buildConnectorRow(params: {
  travelerId: string;
  dayNumber: number;
  sequenceIndex: number;
  from: Activity;
  to: Activity;
  fromCoords: Coords | null;
  toCoords: Coords | null;
  walk: RouteResult | null;
  transit: RouteResult | null;
  drive: RouteResult | null;
  gapSeconds: number;
  sameBlock: boolean;
  childrenAges: string[] | null | undefined;
  error?: string;
}): ConnectorRow {
  const walkAdjusted = params.walk
    ? applyFamilyModifier(params.walk.duration_seconds, params.childrenAges)
    : null;

  // Apply minimum gap floor for within-block pairs — activities in the same
  // time block are assumed to be in the same neighbourhood with a reasonable
  // transition window, so short walks shouldn't trigger false alarms.
  const effectiveGap = params.sameBlock
    ? Math.max(params.gapSeconds, WITHIN_BLOCK_MIN_GAP_SECONDS)
    : params.gapSeconds;

  const { flagged, reason } = determineFlag(
    params.walk?.duration_seconds ?? null,
    params.transit?.duration_seconds ?? null,
    params.drive?.duration_seconds ?? null,
    walkAdjusted,
    effectiveGap,
  );

  return {
    traveler_id: params.travelerId,
    day_number: params.dayNumber,
    sequence_index: params.sequenceIndex,
    from_activity_id: params.from.id,
    to_activity_id: params.to.id,
    from_name: params.from.name,
    to_name: params.to.name,
    from_lat: params.fromCoords?.lat ?? null,
    from_lng: params.fromCoords?.lng ?? null,
    to_lat: params.toCoords?.lat ?? null,
    to_lng: params.toCoords?.lng ?? null,
    walk_seconds: params.walk?.duration_seconds ?? null,
    walk_meters: params.walk?.distance_meters ?? null,
    walk_adjusted_seconds: walkAdjusted,
    transit_seconds: params.transit?.duration_seconds ?? null,
    transit_fare: params.transit?.fare_text ?? null,
    drive_seconds: params.drive?.duration_seconds ?? null,
    drive_meters: params.drive?.distance_meters ?? null,
    gap_seconds: params.gapSeconds,
    gap_flagged: flagged,
    flag_reason: reason,
    error: params.error ?? null,
  };
}
