/**
 * PHI-61: admin-gated read for api_usage rows.
 *
 * The /admin/usage page used to query api_usage directly from the browser
 * via the anon-keyed legacy client. Now it goes through this endpoint,
 * which uses the service-role admin client behind the ADMIN_PASSWORD gate.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminRequest, adminForbiddenResponse } from "@/lib/auth";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();
  const { data, error } = await getSupabaseAdminClient()
    .from("api_usage")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
