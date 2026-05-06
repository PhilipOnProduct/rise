import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(
  req: NextRequest,
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

  // Server-side dedupe: tag each rating with the rise_session_id cookie so
  // a single anonymous visitor can only award points to a tip once. Replace
  // with a real user id when accounts land. The unique constraint must exist
  // on (tip_id, rater_session) — see SQL note in CLAUDE.md.
  const raterSession = req.cookies.get("rise_session_id")?.value ?? null;

  if (raterSession) {
    const { count } = await supabase
      .from("tip_ratings")
      .select("id", { count: "exact", head: true })
      .eq("tip_id", id)
      .eq("rater_session", raterSession);
    if (count && count > 0) {
      return NextResponse.json({ success: true, alreadyRated: true });
    }
  }

  const { error: ratingError } = await supabase
    .from("tip_ratings")
    .insert({ tip_id: id, rater_session: raterSession });

  if (ratingError) {
    // 23505 = unique_violation — race-loser path, treat as success.
    if (ratingError.code === "23505") {
      return NextResponse.json({ success: true, alreadyRated: true });
    }
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
