import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const { name, email, destination, departureDate, returnDate, hotel, activities } = await req.json();

  if (!name || !email || !destination) {
    return NextResponse.json({ error: "name, email, and destination are required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("travelers")
    .insert({
      name,
      email: email.toLowerCase().trim(),
      destination,
      departure_date: departureDate || null,
      return_date: returnDate || null,
      hotel: hotel || null,
      activities: activities ?? [],
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
