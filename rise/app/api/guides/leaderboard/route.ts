import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data: guides, error } = await supabase
    .from("guides")
    .select("id, name, points")
    .order("points", { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Count tips per guide
  const guidesWithCounts = await Promise.all(
    (guides ?? []).map(async (guide) => {
      const { count } = await supabase
        .from("tips")
        .select("*", { count: "exact", head: true })
        .eq("guide_id", guide.id);
      return { ...guide, tip_count: count ?? 0 };
    })
  );

  return NextResponse.json(guidesWithCounts);
}
