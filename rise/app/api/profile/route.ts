import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const { data, error } = await supabase
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
