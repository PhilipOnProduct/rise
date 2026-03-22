import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const {
    event,
    activityId,
    activityName,
    activityCategory,
    chipLabel,
    chipType,
    chipsSource,
    firstChipLabel,
  } = await req.json();

  const { error } = await supabase.from("activity_feedback").insert({
    event,
    activity_id: activityId,
    activity_name: activityName,
    activity_category: activityCategory,
    chip_label: chipLabel ?? null,
    chip_type: chipType ?? null,
    chips_source: chipsSource ?? null,
    first_chip_label: firstChipLabel ?? null,
  });

  if (error) {
    console.error("[activity-feedback]", error);
    return NextResponse.json({ error: "Failed to log" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
