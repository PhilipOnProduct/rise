import { NextRequest, NextResponse } from "next/server";
import { supabase, CATEGORIES, type Category } from "@/lib/guides";

export async function POST(req: NextRequest) {
  const { name, city, category, title, description } = await req.json();

  if (!name || !city || !category || !title || !description) {
    return NextResponse.json({ error: "All fields are required." }, { status: 400 });
  }

  if (!CATEGORIES.includes(category as Category)) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("tips")
    .insert({ name, city: city.toLowerCase().trim(), category, title, description })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get("city");

  if (!city) {
    return NextResponse.json({ error: "city param required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("tips")
    .select("*")
    .eq("city", city.toLowerCase().trim())
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
