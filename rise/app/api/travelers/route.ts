import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const {
    name,
    email,
    destination,
    departureDate,
    returnDate,
    hotel,
    activities,
    travelCompany,
    styleTags,
    budgetTier,
  } = await req.json();

  if (!destination) {
    return NextResponse.json({ error: "destination is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("travelers")
    .insert({
      name: name || null,
      email: email ? email.toLowerCase().trim() : null,
      destination,
      departure_date: departureDate || null,
      return_date: returnDate || null,
      hotel: hotel || null,
      activities: activities ?? [],
      travel_company: travelCompany || null,
      style_tags: styleTags || null,
      budget_tier: budgetTier || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { id, name, email, travelCompany, styleTags, budgetTier } = await req.json();

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email.toLowerCase().trim();
  if (travelCompany !== undefined) updates.travel_company = travelCompany;
  if (styleTags !== undefined) updates.style_tags = styleTags;
  if (budgetTier !== undefined) updates.budget_tier = budgetTier;

  const { data, error } = await supabase
    .from("travelers")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}
