import { NextRequest, NextResponse } from "next/server";
// TODO(PHI-C): grandfathered on the legacy anon client — guides/tips have
// no RLS today. If these tables ever get policies (or tip writes become
// user-scoped), migrate to getSupabaseServerClient() / the admin client
// per the CLAUDE.md client conventions.
import { supabase } from "@/lib/supabase";
import { awardGuidePoints, incrementTipViews } from "@/lib/guides";

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

  let newViews: number;
  try {
    newViews = await incrementTipViews(id, tip.views);
  } catch (updateError) {
    return NextResponse.json({ error: (updateError as Error).message }, { status: 500 });
  }

  // Award 15 points when a tip reaches 10 views
  if (newViews === 10 && tip.guide_id) {
    await awardGuidePoints(tip.guide_id, 15);
  }

  return NextResponse.json({ views: newViews });
}
