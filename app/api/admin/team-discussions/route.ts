/**
 * PHI-61: admin-gated read for team_conversations.
 *
 * The /admin page used to call `supabase.from("team_conversations").select(...)`
 * directly from the browser. Now it goes through this endpoint, which uses
 * the service-role admin client behind the ADMIN_PASSWORD gate.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminRequest, adminForbiddenResponse } from "@/lib/auth";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();
  const { data, error } = await getSupabaseAdminClient()
    .from("team_conversations")
    .select("id, title, created_at, prd, messages")
    .eq("type", "team")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
