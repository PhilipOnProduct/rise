import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isAdminRequest, adminForbiddenResponse } from "@/lib/auth";

const MAX_FEEDBACK_LEN = 4000;
const MAX_PAGE_LEN = 500;

export async function POST(req: NextRequest) {
  const { page, feedback } = await req.json();
  if (typeof feedback !== "string" || !feedback.trim()) {
    return NextResponse.json({ error: "Feedback is required" }, { status: 400 });
  }

  const trimmedFeedback = feedback.trim().slice(0, MAX_FEEDBACK_LEN);
  const trimmedPage = typeof page === "string" ? page.slice(0, MAX_PAGE_LEN) : "unknown";

  const { error } = await supabase.from("user_feedback").insert({
    page: trimmedPage,
    feedback: trimmedFeedback,
  });

  if (error) {
    console.error("[feedback] Supabase insert error:", error);
    return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();
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
