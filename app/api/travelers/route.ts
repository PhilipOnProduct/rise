import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  buildSingleLegTrip,
  type Trip,
  type TripLeg,
  validateTrip,
} from "@/lib/trip-schema";

function dbErr(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  return [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") || JSON.stringify(err);
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

  const { data, error } = await supabase
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
    })
    .select()
    .single();

  if (error) {
    console.error("[travelers] POST:", dbErr(error));
    return NextResponse.json({ error: dbErr(error) }, { status: 500 });
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
  } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email.toLowerCase().trim();
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

  const { data, error } = await supabase
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
