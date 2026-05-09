/**
 * PHI-61: admin-gated CRUD for eval_test_cases.
 *
 * Wraps the service-role admin client so the /admin/evals page no longer
 * needs to talk to Supabase directly from the browser.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminRequest, adminForbiddenResponse } from "@/lib/auth";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();
  const { data, error } = await getSupabaseAdminClient()
    .from("eval_test_cases")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
