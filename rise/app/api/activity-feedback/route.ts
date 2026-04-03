import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function dbErr(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  return [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") || JSON.stringify(err);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    event,
    activityId,
    activityName,
    activityCategory,
    chipLabel,
    chipType,
    firstChipLabel,
  } = body;

  if (!event) {
    return NextResponse.json({ error: "event is required" }, { status: 400 });
  }

  const { error } = await supabase.from("activity_feedback").insert({
    event,
    activity_id: activityId ?? null,
    activity_name: activityName ?? null,
    activity_category: activityCategory ?? null,
    chip_label: chipLabel ?? null,
    chip_type: chipType ?? null,
    first_chip_label: firstChipLabel ?? null,
  });

  if (error) {
    console.error("[activity-feedback]", dbErr(error));
    return NextResponse.json({ error: dbErr(error) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
