import { NextRequest, NextResponse } from "next/server";
import { addTip, getTipsForCity, CATEGORIES, type Category } from "@/lib/guides";

export async function POST(req: NextRequest) {
  const { name, city, category, title, description } = await req.json();

  if (!name || !city || !category || !title || !description) {
    return NextResponse.json({ error: "All fields are required." }, { status: 400 });
  }

  if (!CATEGORIES.includes(category as Category)) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }

  const tip = addTip({ name, city, category, title, description });
  return NextResponse.json(tip, { status: 201 });
}

export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get("city");
  if (!city) {
    return NextResponse.json({ error: "city param required." }, { status: 400 });
  }
  return NextResponse.json(getTipsForCity(city));
}
