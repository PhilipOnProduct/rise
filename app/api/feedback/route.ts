import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const { page, feedback } = await req.json();
  if (!feedback?.trim()) {
    return NextResponse.json({ error: "Feedback is required" }, { status: 400 });
  }

  const { error } = await supabase.from("user_feedback").insert({
    page: page ?? "unknown",
    feedback: feedback.trim(),
  });

  if (error) {
    console.error("[feedback] Supabase insert error:", error);
    return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const { data, error } = await supabase
    .from("user_feedback")
    .select("id, page, feedback, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[feedback] Supabase select error:", error);
    return NextResponse.json({ error: "Failed to load feedback" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
