import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Check tip exists and get guide_id
  const { data: tip, error: fetchError } = await supabase
    .from("tips")
    .select("guide_id")
    .eq("id", id)
    .single();

  if (fetchError || !tip) {
    return NextResponse.json({ error: "Tip not found." }, { status: 404 });
  }

  // Insert rating row
  const { error: ratingError } = await supabase
    .from("tip_ratings")
    .insert({ tip_id: id });

  if (ratingError) {
    return NextResponse.json({ error: ratingError.message }, { status: 500 });
  }

  // Award 25 points to the guide
  if (tip.guide_id) {
    const { data: guide } = await supabase
      .from("guides")
      .select("points")
      .eq("id", tip.guide_id)
      .single();

    if (guide) {
      await supabase
        .from("guides")
        .update({ points: guide.points + 25 })
        .eq("id", tip.guide_id);
    }
  }

  return NextResponse.json({ success: true });
}
