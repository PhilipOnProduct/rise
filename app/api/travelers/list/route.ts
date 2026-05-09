import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * PHI-60: list every `travelers` row owned by the signed-in user.
 *
 * Used by:
 *   - /auth/claim — to detect a conflict between the localStorage trip
 *     and trips already saved on the account.
 *   - /dashboard — to render the trip switcher when a user has more
 *     than one saved trip.
 *
 * Auth: 401 if no session. RLS is deferred to PHI-C, so we filter
 * server-side on `auth_user_id` ourselves.
 */
export async function GET() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("travelers")
    .select("*")
    .eq("auth_user_id", user.id)
    .order("is_primary", { ascending: false })
    .order("claimed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[travelers/list] GET:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ travelers: data ?? [] }, { status: 200 });
}
