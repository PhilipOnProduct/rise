import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
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

  const { data, error } = await supabase
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
