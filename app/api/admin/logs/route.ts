import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isAdminRequest, adminForbiddenResponse } from "@/lib/auth";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return adminForbiddenResponse();
  const { data, error } = await supabase
    .from("ai_logs")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
