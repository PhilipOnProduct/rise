import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  const body = await req.json();

  // PHI-61: profiles is a legacy table with no auth_user_id linkage. Writes
  // run without a session — use the service-role admin client.
  const { data, error } = await getSupabaseAdminClient()
    .from("profiles")
    .insert({
      name:           body.name           || null,
      destination:    body.destination    || null,
      traveler_types: body.travelerTypes  ?? [],
      travel_company: body.travelCompany  || null,
      budget:         body.budget         || null,
      departure_date: body.departureDate  || null,
      return_date:    body.returnDate     || null,
      dietary_wishes: body.dietaryWishes  || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
