import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { buildSingleLegTrip, type PlaceType, type TripLeg } from "@/lib/trip-schema";

/**
 * PHI-31 / RISE-202 — anonymous session API
 *
 * Backs the pre-signup itinerary view. The middleware already sets the
 * rise_session_id cookie on every visit; this endpoint lazily creates
 * the database row on first PATCH and merges partial trip state on
 * subsequent calls.
 *
 * 14-day TTL (set by the schema default in 0002_anonymous_sessions.sql).
 * Privacy disclosure is policy-only per user sign-off — no banner.
 *
 * Endpoints:
 * - GET    — return current session row (or 204 if no row exists yet)
 * - PATCH  — merge partial trip state into the row (creating it if needed)
 *
 * The claim-on-signup transition lives in the auth route (or wherever
 * user creation lands) and uses the `claim_anonymous_session(...)`
 * Postgres function from migration 0002.
 */

const COOKIE = "rise_session_id";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dbErr(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  return [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") || JSON.stringify(err);
}

function getSessionId(req: NextRequest): string | null {
  const id = req.cookies.get(COOKIE)?.value;
  return id && UUID_RE.test(id) ? id : null;
}

export async function GET(req: NextRequest) {
  const sessionId = getSessionId(req);
  if (!sessionId) return new NextResponse(null, { status: 204 });

  const { data, error } = await supabase
    .from("anonymous_sessions")
    .select("*")
    .eq("id", sessionId)
    .is("claimed_at", null)
    .maybeSingle();

  if (error) {
    console.error("[anonymous-session] GET:", dbErr(error));
    return NextResponse.json({ error: dbErr(error) }, { status: 500 });
  }
  if (!data) return new NextResponse(null, { status: 204 });
  return NextResponse.json(data, { status: 200 });
}

type PatchBody = {
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
  travelCompany?: string | null;
  styleTags?: string[] | null;
  budgetTier?: string | null;
  travelerCount?: number | null;
  childrenAges?: string[] | null;
  constraintTags?: string[] | null;
  constraintText?: string | null;
  activities?: unknown;
  activityFeedback?: unknown;
  itinerary?: unknown;
};

export async function PATCH(req: NextRequest) {
  const sessionId = getSessionId(req);
  if (!sessionId) {
    return NextResponse.json(
      { error: "no rise_session_id cookie — middleware should have set one" },
      { status: 400 }
    );
  }
  const body = (await req.json()) as PatchBody;

  // Resolve legs: caller can send legs[] directly (PHI-34 path), or send
  // the legacy flat fields and we synthesise a one-leg trip.
  const legs: TripLeg[] | undefined = (() => {
    if (Array.isArray(body.legs) && body.legs.length > 0) return body.legs;
    if (body.destination) {
      return buildSingleLegTrip({
        destinationName: body.destination,
        destinationVerified: body.destinationVerified,
        destinationLat: body.destinationLat,
        destinationLng: body.destinationLng,
        destinationPlaceId: body.destinationPlaceId,
        destinationPlaceType: body.destinationPlaceType,
        departureDate: body.departureDate,
        returnDate: body.returnDate,
        hotel: body.hotel ?? null,
      }).legs;
    }
    return undefined;
  })();

  // Build the row payload — only include fields the client actually sent.
  const payload: Record<string, unknown> = { id: sessionId };
  if (legs !== undefined) payload.legs = legs;
  if (body.destination !== undefined) payload.destination = body.destination;
  if (body.destinationVerified !== undefined)
    payload.destination_verified = !!body.destinationVerified;
  if (body.departureDate !== undefined)
    payload.departure_date = body.departureDate || null;
  if (body.returnDate !== undefined) payload.return_date = body.returnDate || null;
  if (body.hotel !== undefined) payload.hotel = body.hotel ?? null;
  if (body.travelCompany !== undefined)
    payload.travel_company = body.travelCompany || null;
  if (body.styleTags !== undefined)
    payload.style_tags =
      Array.isArray(body.styleTags) && body.styleTags.length > 0
        ? body.styleTags
        : null;
  if (body.budgetTier !== undefined) payload.budget_tier = body.budgetTier || null;
  if (body.travelerCount !== undefined)
    payload.traveler_count = body.travelerCount ?? null;
  if (body.childrenAges !== undefined)
    payload.children_ages =
      Array.isArray(body.childrenAges) && body.childrenAges.length > 0
        ? body.childrenAges
        : null;
  if (body.constraintTags !== undefined)
    payload.constraint_tags =
      Array.isArray(body.constraintTags) && body.constraintTags.length > 0
        ? body.constraintTags
        : null;
  if (body.constraintText !== undefined)
    payload.constraint_text =
      typeof body.constraintText === "string" && body.constraintText.trim().length > 0
        ? body.constraintText.trim()
        : null;
  if (body.activities !== undefined) payload.activities = body.activities ?? null;
  if (body.activityFeedback !== undefined)
    payload.activity_feedback = body.activityFeedback ?? null;
  if (body.itinerary !== undefined) payload.itinerary = body.itinerary ?? null;

  // Upsert — creates the row on first PATCH; merges on subsequent ones.
  const { data, error } = await supabase
    .from("anonymous_sessions")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    console.error("[anonymous-session] PATCH:", dbErr(error));
    return NextResponse.json({ error: dbErr(error) }, { status: 500 });
  }
  return NextResponse.json(data, { status: 200 });
}
