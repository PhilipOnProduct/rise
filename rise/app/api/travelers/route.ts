import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function dbErr(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  return [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") || JSON.stringify(err);
}

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
    travelerCount,
    childrenAges,
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
      traveler_count: travelerCount ?? null,
      children_ages: childrenAges?.length > 0 ? childrenAges : null,
    })
    .select()
    .single();

  if (error) {
    console.error("[travelers] POST:", dbErr(error));
    return NextResponse.json({ error: dbErr(error) }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { id, name, email, travelCompany, styleTags, budgetTier, travelerCount, childrenAges } =
    await req.json();

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email.toLowerCase().trim();
  if (travelCompany !== undefined) updates.travel_company = travelCompany;
  if (styleTags !== undefined) updates.style_tags = styleTags;
  if (budgetTier !== undefined) updates.budget_tier = budgetTier;
  if (travelerCount !== undefined) updates.traveler_count = travelerCount ?? null;
  if (childrenAges !== undefined)
    updates.children_ages = childrenAges?.length > 0 ? childrenAges : null;

  const { data, error } = await supabase
    .from("travelers")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[travelers] PATCH:", dbErr(error));
    return NextResponse.json({ error: dbErr(error) }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}
