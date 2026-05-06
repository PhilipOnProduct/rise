/**
 * Travel connector admin summary — aggregated flag data across all travelers.
 *
 * GET /api/itinerary/travel/admin
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isAdminRequest, adminForbiddenResponse } from "@/lib/auth";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();
  // Fetch all connectors and aggregate in JS (Supabase JS client doesn't support
  // filter(where ...) aggregation, so we pull rows and summarise).
  const { data, error } = await supabase
    .from("travel_connectors")
    .select("traveler_id, gap_flagged, error")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[travel-admin]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group by traveler
  const byTraveler = new Map<
    string,
    { total: number; flagged: number; errors: number }
  >();

  for (const row of data ?? []) {
    const entry = byTraveler.get(row.traveler_id) ?? {
      total: 0,
      flagged: 0,
      errors: 0,
    };
    entry.total++;
    if (row.gap_flagged) entry.flagged++;
    if (row.error) entry.errors++;
    byTraveler.set(row.traveler_id, entry);
  }

  const summaries = Array.from(byTraveler.entries())
    .map(([traveler_id, stats]) => ({ traveler_id, ...stats }))
    .sort((a, b) => b.flagged - a.flagged);

  return NextResponse.json({ summaries });
}
