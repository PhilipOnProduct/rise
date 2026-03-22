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
 * GET  /api/itinerary?traveler_id=<uuid>  — fetch latest itinerary for a traveler
 * POST /api/itinerary                     — save a new itinerary
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { ItineraryDay } from "@/types/itinerary";

export async function GET(req: NextRequest) {
  const traveler_id = req.nextUrl.searchParams.get("traveler_id");
  if (!traveler_id) {
    return NextResponse.json({ error: "traveler_id is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("itineraries")
    .select("*")
    .eq("traveler_id", traveler_id)
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
  const body = await req.json() as {
    traveler_id: string;
    destination: string;
    days: ItineraryDay[];
  };

  const { traveler_id, destination, days } = body;

  if (!traveler_id || !days) {
    return NextResponse.json({ error: "traveler_id and days are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("itineraries")
    .insert({ traveler_id, destination: destination ?? "", days })
    .select()
    .single();

  if (error) {
    console.error("[itinerary POST]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ itinerary: data });
}
