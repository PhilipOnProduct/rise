/**
 * Itinerary storage API — backed by Supabase `itineraries` table.
 *
 * Required SQL (run once in Supabase dashboard):
 *
 *   create table itineraries (
 *     id           uuid primary key default gen_random_uuid(),
 *     traveler_id  uuid not null,
 *     destination  text,
 *     days         jsonb not null default '[]',
 *     created_at   timestamptz default now()
 *   );
 *
 * GET  /api/itinerary  — fetch latest itinerary for the signed-in user's primary traveler row
 * POST /api/itinerary  — save a new itinerary for the signed-in user's primary traveler row
 *
 * PHI-61: traveler_id is no longer accepted from the client. The signed-in
 * user's primary `travelers` row is resolved server-side from `auth.uid()`.
 * Anonymous callers get 401; their pre-signup itinerary lives in localStorage
 * and the anonymous_sessions table.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { ItineraryDay } from "@/types/itinerary";

async function resolveTravelerId(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
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
    return NextResponse.json({ itinerary: null });
  }

  const { data, error } = await supabase
    .from("itineraries")
    .select("*")
    .eq("traveler_id", travelerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[itinerary GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ itinerary: null });
  }

  return NextResponse.json({ itinerary: data });
}

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = (await req.json()) as {
    destination?: string;
    days?: ItineraryDay[];
  };
  const { destination, days } = body;

  if (!Array.isArray(days)) {
    return NextResponse.json({ error: "days are required" }, { status: 400 });
  }

  const travelerId = await resolveTravelerId(supabase, user.id);
  if (!travelerId) {
    return NextResponse.json({ error: "no traveler row for user" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("itineraries")
    .insert({ traveler_id: travelerId, destination: destination ?? "", days })
    .select()
    .single();

  if (error) {
    console.error("[itinerary POST]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ itinerary: data });
}
