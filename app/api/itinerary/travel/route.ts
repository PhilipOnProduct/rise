/**
 * Travel connector API — compute and store travel times between itinerary activities.
 *
 * GET  /api/itinerary/travel  — Fetch stored connectors for the signed-in user's primary traveler
 * POST /api/itinerary/travel  — Compute connectors (full or refresh after swap)
 *
 * PHI-61: traveler_id is no longer accepted from the client. The signed-in
 * user's primary `travelers` row is resolved server-side from `auth.uid()`.
 * The route reads/writes `travel_connectors` and `itineraries` under RLS via
 * the SSR client, then logs to the admin-only `ai_logs` table via the
 * service-role admin client.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { checkApiLimit } from "@/lib/log-api-usage";
import { logAiInteraction } from "@/lib/ai-logger";
import type { Activity, ItineraryDay } from "@/types/itinerary";
import {
  type Coords,
  type ConnectorRow,
  resolveCoordinates,
  geocodeCity,
  computeRoute,
  calculateActivityTimes,
  buildActivityPairs,
  buildConnectorRow,
} from "@/lib/travel-connectors";

type SsrClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;

async function resolveTravelerId(
  supabase: SsrClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("travelers")
    .select("id, is_primary, claimed_at, created_at")
    .eq("auth_user_id", userId)
    .order("is_primary", { ascending: false })
    .order("claimed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// ── GET — Fetch stored connectors ────────────────────────────────────────────

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const travelerId = await resolveTravelerId(supabase, user.id);
  if (!travelerId) {
    return NextResponse.json({ connectors: [] });
  }

  const { data, error } = await supabase
    .from("travel_connectors")
    .select("*")
    .eq("traveler_id", travelerId)
    .order("day_number")
    .order("sequence_index");

  if (error) {
    console.error("[travel GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ connectors: data ?? [] });
}

// ── POST — Compute or refresh connectors ─────────────────────────────────────

type PostBody = {
  refresh?: {
    day_number: number;
    swapped_activity_id: string;
  };
};

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = (await req.json()) as PostBody;
  const { refresh } = body;

  // Check Google API limit
  const limit = await checkApiLimit("google");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Google API limit reached", spentUsd: limit.spentUsd, limitUsd: limit.limitUsd },
      { status: 429 },
    );
  }

  const travelerId = await resolveTravelerId(supabase, user.id);
  if (!travelerId) {
    return NextResponse.json({ error: "no traveler row for user" }, { status: 404 });
  }

  // Fetch traveler for children_ages
  const { data: traveler } = await supabase
    .from("travelers")
    .select("children_ages")
    .eq("id", travelerId)
    .single();

  const childrenAges: string[] | null = traveler?.children_ages ?? null;

  // Fetch latest itinerary
  const { data: itinerary, error: itinErr } = await supabase
    .from("itineraries")
    .select("*")
    .eq("traveler_id", travelerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (itinErr || !itinerary) {
    return NextResponse.json({ error: "No itinerary found" }, { status: 404 });
  }

  const days = itinerary.days as ItineraryDay[];
  const destination = itinerary.destination as string;

  // Cost guard: cap the number of activities we'll geocode + route in a single
  // request. A 5-day trip with 6 activities/day = 30 activities, well under
  // the cap. Pathological itineraries (50+ activities/day, 14+ days) are
  // rejected before any external API spend.
  const MAX_ACTIVITIES_PER_REQUEST = 100;
  const totalActivities = days.reduce((sum, d) => sum + (d.activities?.length ?? 0), 0);
  if (totalActivities > MAX_ACTIVITIES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Itinerary has ${totalActivities} activities; cap is ${MAX_ACTIVITIES_PER_REQUEST}.` },
      { status: 400 },
    );
  }

  if (refresh) {
    return handleRefresh(supabase, travelerId, days, destination, childrenAges, refresh, startTime);
  }
  return handleFullCompute(supabase, travelerId, days, destination, childrenAges, startTime);
}

// ── Full compute ─────────────────────────────────────────────────────────────

async function handleFullCompute(
  supabase: SsrClient,
  travelerId: string,
  days: ItineraryDay[],
  destination: string,
  childrenAges: string[] | null,
  startTime: number,
) {
  // Geocode destination for location bias
  const destCoords = await geocodeCity(destination);
  if (!destCoords) {
    return NextResponse.json({ error: "Could not geocode destination" }, { status: 500 });
  }

  // Resolve coordinates for all activities across all days
  const _allActivities: Activity[] = days.flatMap((d) => d.activities);
  void _allActivities;
  const coordMap = new Map<string, Coords | null>();

  // Parallel resolution — batch per day to avoid overwhelming the API
  for (const day of days) {
    const results = await Promise.all(
      day.activities.map((a) => resolveCoordinates(a.name, destination, destCoords)),
    );
    day.activities.forEach((a, i) => coordMap.set(a.id, results[i]));
  }

  // Build connectors for each day
  const allConnectors: ConnectorRow[] = [];
  let flaggedCount = 0;
  let errorsCount = 0;

  for (const day of days) {
    const pairs = buildActivityPairs(day.activities);
    if (pairs.length === 0) continue;

    const times = calculateActivityTimes(day.activities);

    // Compute routes for all pairs in parallel
    const pairResults = await Promise.all(
      pairs.map(async ({ from, to, index, sameBlock }) => {
        const fromCoords = coordMap.get(from.id) ?? null;
        const toCoords = coordMap.get(to.id) ?? null;

        let walk = null;
        let transit = null;
        let drive = null;
        let error: string | undefined;

        if (fromCoords && toCoords) {
          [walk, transit, drive] = await Promise.all([
            computeRoute(fromCoords, toCoords, "WALK"),
            computeRoute(fromCoords, toCoords, "TRANSIT"),
            computeRoute(fromCoords, toCoords, "DRIVE"),
          ]);
        } else {
          error = `Missing coordinates: ${!fromCoords ? from.name : ""} ${!toCoords ? to.name : ""}`.trim();
        }

        // Calculate gap
        const fromTime = times.get(from.id);
        const toTime = times.get(to.id);
        const gapSeconds =
          fromTime && toTime ? (toTime.start_min - fromTime.end_min) * 60 : 0;

        return buildConnectorRow({
          travelerId,
          dayNumber: day.day_number,
          sequenceIndex: index,
          from,
          to,
          fromCoords,
          toCoords,
          walk,
          transit,
          drive,
          gapSeconds: Math.max(0, gapSeconds),
          sameBlock,
          childrenAges,
          error,
        });
      }),
    );

    for (const c of pairResults) {
      allConnectors.push(c);
      if (c.gap_flagged) flaggedCount++;
      if (c.error) errorsCount++;
    }
  }

  // Delete existing and insert new
  const { error: delErr } = await supabase
    .from("travel_connectors")
    .delete()
    .eq("traveler_id", travelerId);

  if (delErr) console.error("[travel] delete error:", delErr.message);

  if (allConnectors.length > 0) {
    const { error: insErr } = await supabase
      .from("travel_connectors")
      .insert(allConnectors);

    if (insErr) {
      console.error("[travel] insert error:", insErr.message);
      return NextResponse.json({ error: "Failed to store connectors" }, { status: 500 });
    }
  }

  // Log to ai_logs for admin visibility
  const pairsCount = allConnectors.length;
  void logAiInteraction({
    feature: "travel-connectors",
    model: "google-routes-api",
    prompt: `Computed travel connectors for ${destination}`,
    input: {
      destination,
      days_count: days.length,
      pairs_count: pairsCount,
      traveler_id: travelerId,
      children_ages: childrenAges,
    },
    output: JSON.stringify({ total_connectors: pairsCount, flagged_count: flaggedCount, errors_count: errorsCount }),
    latency_ms: Date.now() - startTime,
    input_tokens: 0,
    output_tokens: 0,
  });

  // Return stored connectors (re-fetch to get IDs)
  const { data: stored } = await supabase
    .from("travel_connectors")
    .select("*")
    .eq("traveler_id", travelerId)
    .order("day_number")
    .order("sequence_index");

  return NextResponse.json({
    connectors: stored ?? [],
    flagged_count: flaggedCount,
  });
}

// ── Refresh after swap (only affected connectors) ────────────────────────────

async function handleRefresh(
  supabase: SsrClient,
  travelerId: string,
  days: ItineraryDay[],
  destination: string,
  childrenAges: string[] | null,
  refresh: { day_number: number; swapped_activity_id: string },
  _startTime: number,
) {
  const day = days.find((d) => d.day_number === refresh.day_number);
  if (!day) {
    return NextResponse.json({ error: "Day not found" }, { status: 404 });
  }

  const pairs = buildActivityPairs(day.activities);
  const times = calculateActivityTimes(day.activities);

  // Find pairs touching the swapped activity
  const affectedPairs = pairs.filter(
    (p) =>
      p.from.id === refresh.swapped_activity_id ||
      p.to.id === refresh.swapped_activity_id,
  );

  if (affectedPairs.length === 0) {
    // Swapped activity might be at the edge — return all connectors as-is
    const { data: stored } = await supabase
      .from("travel_connectors")
      .select("*")
      .eq("traveler_id", travelerId)
      .order("day_number")
      .order("sequence_index");
    return NextResponse.json({ connectors: stored ?? [] });
  }

  // Geocode destination for bias
  const destCoords = await geocodeCity(destination);

  // Get existing connectors to reuse cached coordinates for non-swapped activities
  const { data: existing } = await supabase
    .from("travel_connectors")
    .select("*")
    .eq("traveler_id", travelerId);

  const cachedCoords = new Map<string, Coords | null>();
  for (const c of existing ?? []) {
    if (c.from_lat != null && c.from_lng != null) {
      cachedCoords.set(c.from_activity_id, { lat: c.from_lat, lng: c.from_lng });
    }
    if (c.to_lat != null && c.to_lng != null) {
      cachedCoords.set(c.to_activity_id, { lat: c.to_lat, lng: c.to_lng });
    }
  }

  // Resolve coordinates for the new swapped activity
  const swappedActivity = day.activities.find((a) => a.id === refresh.swapped_activity_id);
  if (swappedActivity && destCoords) {
    const coords = await resolveCoordinates(swappedActivity.name, destination, destCoords);
    cachedCoords.set(swappedActivity.id, coords);
  }

  // Compute routes for affected pairs
  const newConnectors: ConnectorRow[] = [];
  for (const { from, to, index, sameBlock } of affectedPairs) {
    const fromCoords = cachedCoords.get(from.id) ?? null;
    const toCoords = cachedCoords.get(to.id) ?? null;

    let walk = null;
    let transit = null;
    let drive = null;
    let error: string | undefined;

    if (fromCoords && toCoords) {
      [walk, transit, drive] = await Promise.all([
        computeRoute(fromCoords, toCoords, "WALK"),
        computeRoute(fromCoords, toCoords, "TRANSIT"),
        computeRoute(fromCoords, toCoords, "DRIVE"),
      ]);
    } else {
      error = `Missing coordinates: ${!fromCoords ? from.name : ""} ${!toCoords ? to.name : ""}`.trim();
    }

    const fromTime = times.get(from.id);
    const toTime = times.get(to.id);
    const gapSeconds = fromTime && toTime ? (toTime.start_min - fromTime.end_min) * 60 : 0;

    newConnectors.push(
      buildConnectorRow({
        travelerId,
        dayNumber: day.day_number,
        sequenceIndex: index,
        from,
        to,
        fromCoords,
        toCoords,
        walk,
        transit,
        drive,
        gapSeconds: Math.max(0, gapSeconds),
        sameBlock,
        childrenAges,
        error,
      }),
    );
  }

  // Delete old connectors for affected pairs, insert new ones
  for (const { from, to } of affectedPairs) {
    await supabase
      .from("travel_connectors")
      .delete()
      .eq("traveler_id", travelerId)
      .eq("from_activity_id", from.id)
      .eq("to_activity_id", to.id);
  }

  if (newConnectors.length > 0) {
    await supabase.from("travel_connectors").insert(newConnectors);
  }

  // Return all connectors for the traveler
  const { data: stored } = await supabase
    .from("travel_connectors")
    .select("*")
    .eq("traveler_id", travelerId)
    .order("day_number")
    .order("sequence_index");

  return NextResponse.json({ connectors: stored ?? [] });
}
