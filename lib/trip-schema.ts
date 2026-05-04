/**
 * PHI-33 / RISE-303 — Trip schema
 *
 * The trip is modelled as an ordered list of legs. Single-leg trips remain
 * the common case in v1; multi-leg arrives with PHI-34 (free-form input).
 *
 * Convenience helpers (`firstLeg`, `primaryDestinationName`, `tripDateRange`)
 * keep the migration off the welcome page and other consumers minimal —
 * they read trip data through these accessors instead of poking into legs[0]
 * directly.
 *
 * Per the May 2026 onboarding review and team sign-off:
 * - Per-leg cost + timezone fields included from day one
 * - UUID leg IDs
 * - Legacy DB columns (destination, hotel, departure_date, return_date)
 *   stay through this PR; dropped in a follow-up migration
 */

// ── Place reference (PHI-30 future-proofing) ─────────────────────────────

export type PlaceType = "place" | "region" | "country" | "locality" | "poi";

export type PlaceRef = {
  /** Display name as the user knows it. Always populated. */
  name: string;
  /** Mapbox / Google Places ID, when resolved via autocomplete. */
  id?: string;
  lat?: number;
  lng?: number;
  type?: PlaceType;
  /** True when the user took the PHI-30 "Use anyway" escape hatch. */
  unverified?: boolean;
};

// ── Trip leg ──────────────────────────────────────────────────────────────

export type TripLeg = {
  /** Stable UUID for UI keying + per-leg edits. */
  id: string;
  place: PlaceRef;
  /** Optional hotel — free-text or a future place ID. Null = not booked / skip. */
  hotel?: string | null;
  /** ISO date within the trip envelope. Absent = inferred from neighbours. */
  startDate?: string;
  endDate?: string;
  /** Optional rough cost estimate (USD) for budget rollups. */
  costEstimate?: number;
  /** IANA timezone (e.g. "Europe/Lisbon") — populated when known. */
  timezone?: string;
};

/**
 * The slice of trip data that pages and APIs need to read. The `travelers`
 * table backs this; legs JSONB is the source of truth.
 *
 * Legacy fields (destination, hotel, departureDate, returnDate) are kept
 * here for the transition window. Readers should prefer the leg-aware
 * accessors below.
 */
export type Trip = {
  legs: TripLeg[];
  /** Trip envelope dates. Optional; legs may carry their own. */
  departureDate?: string | null;
  returnDate?: string | null;
};

// ── Accessors ────────────────────────────────────────────────────────────

export function firstLeg(trip: Trip | null | undefined): TripLeg | null {
  return trip?.legs?.[0] ?? null;
}

/** Primary destination name — what the user is likely to call "the trip's destination" today. */
export function primaryDestinationName(trip: Trip | null | undefined): string {
  return firstLeg(trip)?.place?.name ?? "";
}

/** Concatenated destination string for prompts ("Lisbon, Portugal then Madrid, Spain"). */
export function destinationsForPrompt(trip: Trip | null | undefined): string {
  if (!trip?.legs?.length) return "";
  return trip.legs.map((l) => l.place?.name).filter(Boolean).join(" then ");
}

/** Effective trip envelope — leg-aware. */
export function tripDateRange(
  trip: Trip | null | undefined
): { departure: string | null; return: string | null } {
  if (!trip)
    return { departure: null, return: null };

  const legStarts = (trip.legs ?? [])
    .map((l) => l.startDate)
    .filter((d): d is string => !!d);
  const legEnds = (trip.legs ?? [])
    .map((l) => l.endDate)
    .filter((d): d is string => !!d);

  const departure =
    trip.departureDate ?? (legStarts.length > 0 ? legStarts.sort()[0] : null);
  const ret =
    trip.returnDate ??
    (legEnds.length > 0 ? legEnds.sort().slice(-1)[0] : null);

  return { departure: departure ?? null, return: ret ?? null };
}

/** Primary hotel for legs[0] — what existing single-destination consumers expect. */
export function primaryHotel(trip: Trip | null | undefined): string | null {
  return firstLeg(trip)?.hotel ?? null;
}

// ── Constructors / mutators ──────────────────────────────────────────────

export function newLegId(): string {
  // Use crypto.randomUUID where available; fall back to a manual v4 if not.
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback (rare — Node <19 etc.)
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[(Math.random() * 4) | (0x8 & 0xf)];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}

/**
 * Build a single-leg trip from the legacy welcome-page state.
 * This is the common case during the transition: we still collect a single
 * destination + dates + hotel from the structured form, and write it as
 * one leg. PHI-34's free-form parser will produce multi-leg trips later.
 */
export function buildSingleLegTrip(args: {
  destinationName: string;
  destinationVerified?: boolean;
  destinationLat?: number;
  destinationLng?: number;
  destinationPlaceId?: string;
  destinationPlaceType?: PlaceType;
  departureDate?: string;
  returnDate?: string;
  hotel?: string | null;
  costEstimate?: number;
  timezone?: string;
}): Trip {
  const place: PlaceRef = {
    name: args.destinationName,
    ...(args.destinationPlaceId && { id: args.destinationPlaceId }),
    ...(args.destinationLat != null && { lat: args.destinationLat }),
    ...(args.destinationLng != null && { lng: args.destinationLng }),
    ...(args.destinationPlaceType && { type: args.destinationPlaceType }),
    ...(args.destinationVerified === false && { unverified: true }),
  };
  const leg: TripLeg = {
    id: newLegId(),
    place,
    hotel: args.hotel ?? null,
    startDate: args.departureDate,
    endDate: args.returnDate,
    ...(args.costEstimate != null && { costEstimate: args.costEstimate }),
    ...(args.timezone && { timezone: args.timezone }),
  };
  return {
    legs: [leg],
    departureDate: args.departureDate ?? null,
    returnDate: args.returnDate ?? null,
  };
}

// ── Validators ───────────────────────────────────────────────────────────

export type ValidationError = { path: string; message: string };

export function validateTrip(trip: Trip): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!Array.isArray(trip.legs) || trip.legs.length === 0) {
    errors.push({ path: "legs", message: "Trip must have at least one leg." });
    return errors;
  }
  trip.legs.forEach((leg, i) => {
    if (!leg.id) errors.push({ path: `legs[${i}].id`, message: "Missing id." });
    if (!leg.place?.name)
      errors.push({ path: `legs[${i}].place.name`, message: "Missing place name." });
    if (leg.startDate && leg.endDate && leg.startDate > leg.endDate) {
      errors.push({
        path: `legs[${i}]`,
        message: "Leg startDate is after endDate.",
      });
    }
  });
  // Soft check — trip envelope wraps every leg
  const env = tripDateRange(trip);
  if (env.departure && env.return && env.departure > env.return) {
    errors.push({
      path: "envelope",
      message: "Trip envelope departureDate is after returnDate.",
    });
  }
  return errors;
}
