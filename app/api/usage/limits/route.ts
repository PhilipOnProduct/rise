import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function PATCH(req: NextRequest) {
  const { provider, monthly_limit_usd, warning_threshold_pct, hard_limit_enabled } = await req.json();

  if (!provider) {
    return NextResponse.json({ error: "Missing provider" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (monthly_limit_usd !== undefined) updates.monthly_limit_usd = monthly_limit_usd;
  if (warning_threshold_pct !== undefined) updates.warning_threshold_pct = warning_threshold_pct;
  if (hard_limit_enabled !== undefined) updates.hard_limit_enabled = hard_limit_enabled;

  const { error } = await supabase
    .from("api_limits")
    .update(updates)
    .eq("provider", provider);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
