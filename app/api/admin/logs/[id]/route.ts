import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminRequest, adminForbiddenResponse } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();
  const { id } = await params;
  const body = await req.json();

  const updates: Record<string, unknown> = {};
  if ("rating" in body) updates.rating = body.rating;
  if ("notes" in body) updates.notes = body.notes;

  // PHI-61: ai_logs is admin-only — bypass RLS via the service-role client.
  const { data, error } = await getSupabaseAdminClient()
    .from("ai_logs")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
