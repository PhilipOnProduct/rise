import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import {
  buildSingleLegTrip,
  type PlaceType,
  type Trip,
  type TripLeg,
  validateTrip,
} from "@/lib/trip-schema";
import { cleanUserSeededActivities } from "@/lib/itinerary-gen-prompt";

// PHI-61: the welcome flow creates and updates traveler rows BEFORE the
// magic link is clicked, so neither POST nor PATCH can rely on a Supabase
// session. We use the service-role admin client to bypass RLS, then enforce
// ownership in code: PATCH refuses to touch a row whose `auth_user_id` is
// set to a different user than the caller (or to anyone, if the caller is
// anonymous).
const supabaseAdmin = () => getSupabaseAdminClient();

function dbErr(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  return [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") || JSON.stringify(err);
}

// PHI-47: same regex as the client-side check in app/welcome/page.tsx.
// Belt-and-braces — if a non-wizard client ever POSTs/PATCHes here, the
// server still enforces format.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value: unknown): boolean {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

/**
 * PHI-33: derive the legs array for the insert/update.
 *
 * The welcome page currently sends the legacy single-destination shape
 * (destination + departureDate + returnDate + hotel). We turn that into a
 * one-leg trip on write so the row's `legs` JSONB is the source of truth
 * going forward. PHI-34's free-form parser will send the multi-leg shape
 * directly via the `legs` field instead.
 */
function deriveLegs(body: {
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
}): { legs: TripLeg[]; trip: Trip } | null {
  // PHI-34 path: caller already sent a leg-aware shape — use it as-is.
  if (Array.isArray(body.legs) && body.legs.length > 0) {
    const trip: Trip = {
      legs: body.legs,
      departureDate: body.departureDate ?? null,
      returnDate: body.returnDate ?? null,
    };
    return { legs: trip.legs, trip };
  }
  // Legacy path: synthesise a one-leg trip from the flat fields.
  if (!body.destination) return null;
  const trip = buildSingleLegTrip({
    destinationName: body.destination,
    destinationVerified: body.destinationVerified,
    destinationLat: body.destinationLat,
    destinationLng: body.destinationLng,
    destinationPlaceId: body.destinationPlaceId,
    destinationPlaceType: body.destinationPlaceType,
    departureDate: body.departureDate,
    returnDate: body.returnDate,
    hotel: body.hotel ?? null,
  });
  return { legs: trip.legs, trip };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    name,
    email,
    destination,
    departureDate,
    returnDate,
    hotel,
    activities,
    travelCompany,
    styleTags,
    budgetTier,
    travelerCount,
    childrenAges,
    constraintTags,
    constraintText,
    // PHI-90: optional traveller-supplied must-dos (free-text, one per line).
    // Persisted as text[] so the itinerary generator can fetch them at
    // build time and inject them as anchors. Backward compatible — null/
    // empty means existing behaviour unchanged.
    userSeededActivities,
    // PHI-100: optional neighbourhood the traveller picked from the soft
    // neighbourhood picker on welcome step 2 when they had no booked hotel.
    // Used downstream as a soft location anchor in activity-gen / itinerary-
    // gen prompts. Null = picker not used; the existing hotel path still owns
    // the location signal.
    anchorNeighborhood,
  } = body;

  const derived = deriveLegs(body);
  if (!derived) {
    return NextResponse.json({ error: "destination is required." }, { status: 400 });
  }
  const validationErrors = validateTrip(derived.trip);
  if (validationErrors.length > 0) {
    return NextResponse.json(
      { error: "trip schema invalid", details: validationErrors },
      { status: 400 }
    );
  }

  // PHI-47: if email is supplied (signup-time POST), require valid format.
  // Pre-signup partial writes (steps 3/4) omit email — those still pass.
  if (email !== undefined && email !== null && email !== "" && !isValidEmail(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("travelers")
    .insert({
      name: name || null,
      email: email ? email.toLowerCase().trim() : null,
      // PHI-33 PR2: legs is now the only place trip shape lives. Legacy
      // destination/hotel/departure_date/return_date columns dropped.
      legs: derived.legs,
      activities: activities ?? [],
      travel_company: travelCompany || null,
      style_tags: styleTags || null,
      budget_tier: budgetTier || null,
      traveler_count: travelerCount ?? null,
      children_ages: childrenAges?.length > 0 ? childrenAges : null,
      // PHI-35 — constraints (columns added in migration 0003).
      ...(Array.isArray(constraintTags) && constraintTags.length > 0
        ? { constraint_tags: constraintTags }
        : {}),
      ...(typeof constraintText === "string" && constraintText.trim().length > 0
        ? { constraint_text: constraintText.trim() }
        : {}),
      // PHI-90 — only include the column when the client sent a non-empty
      // list, so legacy callers and grandfathered POSTs don't write null
      // arrays into the new column. PHI-97: use the canonical cleaner so
      // direct API callers get the same 20 × 200-char cap the wizard does.
      ...((): Record<string, unknown> => {
        const cleaned = cleanUserSeededActivities(userSeededActivities);
        return cleaned.length > 0 ? { user_seeded_activities: cleaned } : {};
      })(),
      // PHI-100 — only persist when supplied as a non-empty trimmed string.
      ...(typeof anchorNeighborhood === "string" && anchorNeighborhood.trim().length > 0
        ? { anchor_neighborhood: anchorNeighborhood.trim() }
        : {}),
    })
    .select()
    .single();

  if (error) {
    console.error("[travelers] POST:", dbErr(error));
    return NextResponse.json({ error: dbErr(error) }, { status: 500 });
  }

  // PHI-31 Part 2 slice 3: claim the anonymous session, if the visitor
  // had one. The traveler row was just created from the same data the
  // anon session was carrying, so we mark the session as claimed by
  // this new traveler. Best-effort — failure here doesn't fail signup.
  const sessionId = req.cookies.get("rise_session_id")?.value;
  if (sessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    const { error: claimErr } = await supabaseAdmin()
      .from("anonymous_sessions")
      .update({ claimed_at: new Date().toISOString() })
      .eq("id", sessionId)
      .is("claimed_at", null);
    if (claimErr) {
      console.error("[travelers] claim anon session:", dbErr(claimErr));
      // Don't fail signup — the traveler row exists.
    }
  }

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const {
    id,
    name,
    email,
    travelCompany,
    styleTags,
    budgetTier,
    travelerCount,
    childrenAges,
    legs,
    destination,
    departureDate,
    returnDate,
    hotel,
    constraintTags,
    constraintText,
    // PHI-57: when the user starts country-level (e.g. "we want to go to
    // the UK") we persist the country alongside the resolved city for
    // cohort analysis. Optional — flat-string fields don't break legs.
    country,
    // PHI-90: partial update path. When the user advances past the
    // must-dos step we PATCH the array onto the existing row.
    userSeededActivities,
    // PHI-100: PATCH the chosen neighbourhood when the soft picker is used
    // on welcome step 2. Explicit null clears the field; undefined skips it.
    anchorNeighborhood,
  } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  // PHI-47: validate email format on update too, when caller is changing it.
  // Allow null (clearing) but reject malformed strings.
  if (email !== undefined && email !== null && email !== "" && !isValidEmail(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email ? email.toLowerCase().trim() : null;
  if (travelCompany !== undefined) updates.travel_company = travelCompany;
  if (styleTags !== undefined) updates.style_tags = styleTags;
  if (budgetTier !== undefined) updates.budget_tier = budgetTier;
  if (travelerCount !== undefined) updates.traveler_count = travelerCount ?? null;
  if (childrenAges !== undefined)
    updates.children_ages = childrenAges?.length > 0 ? childrenAges : null;
  if (constraintTags !== undefined)
    updates.constraint_tags =
      Array.isArray(constraintTags) && constraintTags.length > 0
        ? constraintTags
        : null;
  if (constraintText !== undefined)
    updates.constraint_text =
      typeof constraintText === "string" && constraintText.trim().length > 0
        ? constraintText.trim()
        : null;
  // PHI-57: persisted alongside legs[] for cohort analysis. Soft-store as
  // a string column; not part of the trip schema and not validated.
  if (country !== undefined)
    updates.country =
      typeof country === "string" && country.trim().length > 0
        ? country.trim()
        : null;
  // PHI-90: normalise to a clean string array on the way in. Empty list →
  // null so we don't leave an empty array sitting on the row. Caller
  // doesn't need to send the field if they aren't changing it; undefined
  // skips the assignment entirely.
  // PHI-97: canonical cleaner enforces the 20 × 200-char cap for direct
  // API callers, matching the wizard textarea.
  if (userSeededActivities !== undefined) {
    const cleaned = cleanUserSeededActivities(userSeededActivities);
    updates.user_seeded_activities = cleaned.length > 0 ? cleaned : null;
  }
  // PHI-100: explicit null clears the anchor; a trimmed string sets it.
  // undefined skips the column entirely so re-saves of unrelated fields
  // never overwrite the anchor.
  if (anchorNeighborhood !== undefined) {
    updates.anchor_neighborhood =
      typeof anchorNeighborhood === "string" && anchorNeighborhood.trim().length > 0
        ? anchorNeighborhood.trim()
        : null;
  }

  // PHI-33 PR2: trip-shape updates go through deriveLegs so we always end
  // up with a valid legs JSONB. Either the caller sent `legs` directly,
  // or they sent the legacy flat fields and we synthesise a single leg.
  // No more legacy mirror writes — those columns are dropped.
  const tripChange =
    legs !== undefined ||
    destination !== undefined ||
    departureDate !== undefined ||
    returnDate !== undefined ||
    hotel !== undefined;
  if (tripChange) {
    const derived = deriveLegs(body);
    if (derived) {
      const errs = validateTrip(derived.trip);
      if (errs.length > 0) {
        return NextResponse.json(
          { error: "trip schema invalid", details: errs },
          { status: 400 }
        );
      }
      updates.legs = derived.legs;
    }
  }

  // PHI-61: ownership check. Refuse the PATCH if the row is already linked
  // to a different signed-in user. Pre-signup rows (auth_user_id IS NULL)
  // remain editable by anyone holding the row id — this is the same
  // capability-token model the welcome flow has always relied on.
  const { data: existing, error: fetchErr } = await supabaseAdmin()
    .from("travelers")
    .select("auth_user_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    console.error("[travelers] PATCH fetch:", dbErr(fetchErr));
    return NextResponse.json({ error: dbErr(fetchErr) }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing.auth_user_id) {
    const ssr = await getSupabaseServerClient();
    const {
      data: { user },
    } = await ssr.auth.getUser();
    if (!user || user.id !== existing.auth_user_id) {
      return NextResponse.json({ error: "not_owner" }, { status: 403 });
    }
  }

  const { data, error } = await supabaseAdmin()
    .from("travelers")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[travelers] PATCH:", dbErr(error));
    return NextResponse.json({ error: dbErr(error) }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}
