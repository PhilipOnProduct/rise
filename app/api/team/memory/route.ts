/**
 * Sarah's rolling memory API — server-side wrapper around `agent_memory`.
 *
 * Replaces the /team page's direct browser access on the anon client now
 * that RLS is enabled with no policies (migration 0020).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET() {
  const { data, error } = await getSupabaseAdminClient()
    .from("agent_memory")
    .select("content")
    .eq("id", "sarah")
    .single();

  // Missing row (first run) is not an error worth surfacing — return "".
  if (error) return NextResponse.json({ content: "" });
  return NextResponse.json({ content: (data?.content as string) ?? "" });
}

export async function PUT(req: NextRequest) {
  const { content } = await req.json();
  if (typeof content !== "string") {
    return NextResponse.json({ error: "content string is required." }, { status: 400 });
  }

  const { error } = await getSupabaseAdminClient()
    .from("agent_memory")
    .upsert({ id: "sarah", content });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
