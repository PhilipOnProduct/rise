import { NextRequest, NextResponse } from "next/server";
import { supabase, CATEGORIES, type Category } from "@/lib/guides";

async function awardPoints(guideId: string, amount: number) {
  const { data: guide } = await supabase
    .from("guides")
    .select("points")
    .eq("id", guideId)
    .single();
  if (!guide) return;
  await supabase
    .from("guides")
    .update({ points: guide.points + amount })
    .eq("id", guideId);
}

export async function POST(req: NextRequest) {
  const { name, email, city, category, title, description } = await req.json();

  if (!name || !email || !city || !category || !title || !description) {
    return NextResponse.json({ error: "All fields are required." }, { status: 400 });
  }

  if (!CATEGORIES.includes(category as Category)) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }

  // Find or create guide by email
  let guideId: string | null = null;
  const { data: existingGuide } = await supabase
    .from("guides")
    .select("id")
    .eq("email", email.toLowerCase().trim())
    .single();

  if (existingGuide) {
    guideId = existingGuide.id;
  } else {
    const { data: newGuide, error: guideError } = await supabase
      .from("guides")
      .insert({ name, email: email.toLowerCase().trim(), points: 0 })
      .select("id")
      .single();
    if (guideError) {
      return NextResponse.json({ error: guideError.message }, { status: 500 });
    }
    guideId = newGuide.id;
  }

  // Insert tip
  const { data, error } = await supabase
    .from("tips")
    .insert({
      name,
      guide_id: guideId,
      city: city.toLowerCase().trim(),
      category,
      title,
      description,
      views: 0,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Award 10 points for submitting a tip
  await awardPoints(guideId, 10);

  return NextResponse.json(data, { status: 201 });
}

export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get("city");

  if (!city) {
    return NextResponse.json({ error: "city param required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("tips")
    .select("*, guide:guides(name, points)")
    .eq("city", city.toLowerCase().trim())
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
