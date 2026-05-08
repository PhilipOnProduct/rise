import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { supabase as legacyClient } from "@/lib/supabase";

/**
 * PHI-59: magic-link landing route.
 *
 * Supabase emails a link of the form
 *   `<emailRedirectTo>?code=<otp>&travelerId=<uuid?>`
 * (we set `emailRedirectTo` to point here). We exchange the code for a
 * session, then — if the link carries a travelerId — link the existing
 * `travelers` row to the new `auth.users.id` so the user's trip is
 * recoverable from their account.
 *
 * Allowlisted in `middleware.ts` so the callback works behind the site
 * password gate (the magic link itself is the auth credential; the site
 * password gate stays on for the rest of the app).
 *
 * Errors land back on `/signin` with a message — link expired, code
 * exchange failed, etc.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const travelerId = searchParams.get("travelerId");
  const next = searchParams.get("next") || "/dashboard";

  if (!code) {
    return NextResponse.redirect(
      new URL("/signin?error=missing_code", origin)
    );
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    console.error("[auth/callback] exchange failed:", error?.message);
    return NextResponse.redirect(
      new URL("/signin?error=expired", origin)
    );
  }

  // Link the onboarding traveler row to the new auth user, if we know
  // which row it was. Best-effort — the auth session is set either way,
  // so a failure here doesn't lock the user out of their account.
  if (travelerId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(travelerId)) {
    const { error: linkErr } = await legacyClient
      .from("travelers")
      .update({ auth_user_id: data.session.user.id })
      .eq("id", travelerId)
      .is("auth_user_id", null);
    if (linkErr) {
      console.error("[auth/callback] traveler link failed:", linkErr.message);
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}
