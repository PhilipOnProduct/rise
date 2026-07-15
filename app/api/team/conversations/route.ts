/**
 * Team conversations API — server-side wrapper around `team_conversations`.
 *
 * The /team page used to read/write this table directly from the browser
 * with the anon client. RLS is now enabled with no policies (migration
 * 0020), so all access goes through the service-role admin client here,
 * behind the site-password middleware perimeter.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { isUuid } from "@/lib/db-utils";

const TYPES = ["team", "coach", "pm"] as const;
type ConversationType = (typeof TYPES)[number];

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type");
  if (!TYPES.includes(type as ConversationType)) {
    return NextResponse.json({ error: "type must be team, coach or pm." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("team_conversations")
    .select("id, type, title, messages, prd, created_at")
    .eq("type", type)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { type, title, messages } = await req.json();
  if (!TYPES.includes(type as ConversationType) || typeof title !== "string") {
    return NextResponse.json({ error: "type and title are required." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("team_conversations")
    .insert({ type, title, messages: messages ?? null })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { id, prd, messages } = await req.json();
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Valid id is required." }, { status: 400 });
  }

  const fields: Record<string, unknown> = {};
  if (typeof prd === "string") fields.prd = prd;
  if (messages !== undefined) fields.messages = messages;
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await getSupabaseAdminClient()
    .from("team_conversations")
    .update(fields)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Valid id is required." }, { status: 400 });
  }

  const { error } = await getSupabaseAdminClient()
    .from("team_conversations")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
