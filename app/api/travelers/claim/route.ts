import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildSingleLegTrip,
  type PlaceType,
  type TripLeg,
  validateTrip,
} from "@/lib/trip-schema";

/**
 * PHI-60: trip claim resolution.
 *
 * Three actions, all idempotent:
 *  - keep_local : claim the row that backs the localStorage trip; flip
 *                 every other row owned by this user to is_primary=false
 *                 (rows are kept, not deleted, so they're recoverable).
 *  - use_saved  : promote the chosen account row to is_primary=true; flip
 *                 every other row to is_primary=false. Caller clears
 *                 localStorage once we've returned 200.
 *  - save_both  : same DB effect as keep_local, but the UI keeps both
 *                 trips visible in the switcher rather than treating the
 *                 displaced one as discarded.
 *
 * Idempotency: every step is a conditional update so re-running the same
 * request after a refresh or back-button is a no-op.
 */

type ClaimAction = "keep_local" | "use_saved" | "save_both";

type LocalLegInput = {
  legs?: TripLeg[];
  destination?: string;
  destinationVerified?: boolean;
  destinationLat?: number;
  destinationLng?: number;
  destinationPlaceId?: string;
  destinationPlaceType?: PlaceType;
  departureDate?: string;
  returnDate?: string;
  hotel?: string | null;
};

function deriveLegs(local: LocalLegInput): TripLeg[] | null {
  if (Array.isArray(local.legs) && local.legs.length > 0) return local.legs;
  if (!local.destination) return null;
  const trip = buildSingleLegTrip({
    destinationName: local.destination,
    destinationVerified: local.destinationVerified,
    destinationLat: local.destinationLat,
    destinationLng: local.destinationLng,
    destinationPlaceId: local.destinationPlaceId,
    destinationPlaceType: local.destinationPlaceType,
    departureDate: local.departureDate,
    returnDate: local.returnDate,
    hotel: local.hotel ?? null,
  });
  return trip.legs;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const action = body.action as ClaimAction | undefined;
  const localTravelerId = body.localTravelerId as string | undefined;
  const accountTravelerId = body.accountTravelerId as string | undefined;
  const localTrip = (body.localTrip ?? null) as
    | (LocalLegInput & {
        name?: string | null;
        email?: string | null;
        travelCompany?: string | null;
        styleTags?: string[] | null;
        budgetTier?: string | null;
        travelerCount?: number | null;
        childrenAges?: string[] | null;
        constraintTags?: string[] | null;
        constraintText?: string | null;
        activities?: unknown[] | null;
      })
    | null;

  if (action !== "keep_local" && action !== "use_saved" && action !== "save_both") {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  const ssr = await getSupabaseServerClient();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  // PHI-61: claim has to read/write rows whose auth_user_id may still be
  // NULL (pre-signup welcome rows). Those rows are invisible/uneditable
  // through RLS, so we use the service-role admin client and enforce
  // ownership in code (auth.uid() comes from the SSR auth check above).
  const supabase = getSupabaseAdminClient();

  // The id that should end up primary after this request.
  let primaryId: string | null = null;

  if (action === "use_saved") {
    if (!accountTravelerId) {
      return NextResponse.json(
        { error: "accountTravelerId required" },
        { status: 400 }
      );
    }
    const { data: row, error: fetchErr } = await supabase
      .from("travelers")
      .select("id, auth_user_id, claimed_at")
      .eq("id", accountTravelerId)
      .maybeSingle();
    if (fetchErr) {
      console.error("[travelers/claim] use_saved fetch:", fetchErr.message);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!row || row.auth_user_id !== user.id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const updates: Record<string, unknown> = { is_primary: true };
    if (!row.claimed_at) updates.claimed_at = new Date().toISOString();
    const { error: upErr } = await supabase
      .from("travelers")
      .update(updates)
      .eq("id", accountTravelerId);
    if (upErr) {
      console.error("[travelers/claim] use_saved update:", upErr.message);
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
    primaryId = accountTravelerId;
  } else {
    // keep_local + save_both share the same DB outcome: the row backing
    // the localStorage trip becomes primary. The action label only
    // controls how the dashboard treats the displaced rows in the
    // switcher.
    let targetId = localTravelerId ?? null;

    if (targetId) {
      // Existing welcome-flow row. Link it to this user if it isn't
      // already, and stamp claimed_at the first time we touch it.
      const { data: row, error: fetchErr } = await supabase
        .from("travelers")
        .select("id, auth_user_id, claimed_at")
        .eq("id", targetId)
        .maybeSingle();
      if (fetchErr) {
        console.error("[travelers/claim] local fetch:", fetchErr.message);
        return NextResponse.json({ error: fetchErr.message }, { status: 500 });
      }
      if (!row) {
        // Row was deleted between welcome and claim. Fall through to the
        // create branch below by clearing targetId.
        targetId = null;
      } else if (row.auth_user_id && row.auth_user_id !== user.id) {
        return NextResponse.json({ error: "not_owner" }, { status: 403 });
      } else {
        const updates: Record<string, unknown> = { is_primary: true };
        if (!row.auth_user_id) updates.auth_user_id = user.id;
        if (!row.claimed_at) updates.claimed_at = new Date().toISOString();
        const { error: upErr } = await supabase
          .from("travelers")
          .update(updates)
          .eq("id", targetId);
        if (upErr) {
          console.error("[travelers/claim] local update:", upErr.message);
          return NextResponse.json({ error: upErr.message }, { status: 500 });
        }
      }
    }

    if (!targetId) {
      // No backing row yet — create one from the localStorage payload so
      // we don't silently drop the user's trip.
      if (!localTrip) {
        return NextResponse.json({ error: "localTrip required" }, { status: 400 });
      }
      const legs = deriveLegs(localTrip);
      if (!legs) {
        return NextResponse.json(
          { error: "destination is required." },
          { status: 400 }
        );
      }
      const errs = validateTrip({
        legs,
        departureDate: localTrip.departureDate ?? null,
        returnDate: localTrip.returnDate ?? null,
      });
      if (errs.length > 0) {
        return NextResponse.json(
          { error: "trip schema invalid", details: errs },
          { status: 400 }
        );
      }
      const { data: inserted, error: insErr } = await supabase
        .from("travelers")
        .insert({
          name: localTrip.name ?? null,
          email: localTrip.email ? localTrip.email.toLowerCase().trim() : null,
          legs,
          activities: localTrip.activities ?? [],
          travel_company: localTrip.travelCompany ?? null,
          style_tags: localTrip.styleTags ?? null,
          budget_tier: localTrip.budgetTier ?? null,
          traveler_count: localTrip.travelerCount ?? null,
          children_ages:
            localTrip.childrenAges && localTrip.childrenAges.length > 0
              ? localTrip.childrenAges
              : null,
          ...(Array.isArray(localTrip.constraintTags) &&
          localTrip.constraintTags.length > 0
            ? { constraint_tags: localTrip.constraintTags }
            : {}),
          ...(typeof localTrip.constraintText === "string" &&
          localTrip.constraintText.trim().length > 0
            ? { constraint_text: localTrip.constraintText.trim() }
            : {}),
          auth_user_id: user.id,
          is_primary: true,
          claimed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insErr || !inserted) {
        console.error("[travelers/claim] insert:", insErr?.message);
        return NextResponse.json(
          { error: insErr?.message ?? "insert failed" },
          { status: 500 }
        );
      }
      targetId = inserted.id;
    }

    primaryId = targetId;
  }

  // Flip every other row owned by this user to is_primary=false. We do
  // this for all three actions so the dashboard always has exactly one
  // primary trip after a successful claim.
  if (primaryId) {
    const { error: demoteErr } = await supabase
      .from("travelers")
      .update({ is_primary: false })
      .eq("auth_user_id", user.id)
      .neq("id", primaryId);
    if (demoteErr) {
      console.error("[travelers/claim] demote others:", demoteErr.message);
      // Non-fatal — primary is still set on the chosen row, and the
      // dashboard tie-breaks on claimed_at when more than one row has
      // is_primary=true.
    }
  }

  return NextResponse.json({ primaryId }, { status: 200 });
}
