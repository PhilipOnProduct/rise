import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: tip, error: fetchError } = await supabase
    .from("tips")
    .select("views, guide_id")
    .eq("id", id)
    .single();

  if (fetchError || !tip) {
    return NextResponse.json({ error: "Tip not found." }, { status: 404 });
  }

  const newViews = tip.views + 1;

  const { error: updateError } = await supabase
    .from("tips")
    .update({ views: newViews })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Award 15 points when a tip reaches 10 views
  if (newViews === 10 && tip.guide_id) {
    const { data: guide } = await supabase
      .from("guides")
      .select("points")
      .eq("id", tip.guide_id)
      .single();

    if (guide) {
      await supabase
        .from("guides")
        .update({ points: guide.points + 15 })
        .eq("id", tip.guide_id);
    }
  }

  return NextResponse.json({ views: newViews });
}
