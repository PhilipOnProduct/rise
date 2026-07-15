/**
 * PRD feedback API — server-side wrapper around `prd_feedback`.
 *
 * Replaces the /team page's direct browser access on the anon client now
 * that RLS is enabled with no policies (migration 0020).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { isUuid } from "@/lib/db-utils";

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!isUuid(conversationId)) {
    return NextResponse.json({ error: "Valid conversationId is required." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("prd_feedback")
    .select("id, conversation_id, feedback, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { conversationId, feedback } = await req.json();
  if (!isUuid(conversationId) || typeof feedback !== "string" || !feedback.trim()) {
    return NextResponse.json(
      { error: "conversationId and feedback are required." },
      { status: 400 }
    );
  }

  const { error } = await getSupabaseAdminClient()
    .from("prd_feedback")
    .insert({ conversation_id: conversationId, feedback });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true }, { status: 201 });
}
