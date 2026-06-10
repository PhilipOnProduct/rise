import type { Activity, ActivityCategory, TimeBlock } from "@/types/itinerary";

export type BookingMeta = {
  preferred_platform: "opentable" | "resy" | "thefork";
  confidence: "high" | "medium" | "low";
  search_query: string;
};

// ── Type for raw generate API response ────────────────────────────────────────

export type RawItem = {
  id: string;
  title: string;
  description: string;
  type: ActivityCategory;
  time_block: TimeBlock;
  status: "idea" | "confirmed" | "booked";
  source: "ai_generated" | "user_added" | "guide_tip";
  booking_meta?: BookingMeta;
  cuisine?: string;
  vibe?: string;
  price_tier?: string;
  // PHI-53: outdoor flag and paired wet-weather alternative.
  is_outdoor?: boolean;
  alternative?: { title: string; description: string; type: ActivityCategory } | null;
  // PHI-90: anchor flag — true when the model placed this item in
  // response to a traveller-seeded must-do entry. Persisted across the
  // generate → cache → render hop so the badge survives a reload.
  seededByUser?: boolean;
  // PHI-104: verbatim must-do text the user typed when the model resolved
  // it to a different specific venue. Optional on read — legacy caches
  // (pre-PHI-104) won't have it and the renderer falls back to badge-only.
  seededVerbatim?: string;
};

export type RawDay = {
  date: string;
  day_number: number;
  items: RawItem[];
  // PHI-37: multi-leg trips — leg index per day, transition flag.
  leg_index?: number;
  is_transition?: boolean;
};

export type Traveler = {
  name: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  hotel: string;
  travelCompany?: string;
  travelerTypes?: string[];
  budgetTier?: string;
};

export type ItineraryItem = RawItem;

export type TravelConnector = {
  id: string;
  day_number: number;
  sequence_index: number;
  from_activity_id: string;
  to_activity_id: string;
  walk_seconds: number | null;
  walk_meters: number | null;
  walk_adjusted_seconds: number | null;
  transit_seconds: number | null;
  transit_fare: string | null;
  drive_seconds: number | null;
  drive_meters: number | null;
  gap_seconds: number;
  gap_flagged: boolean;
  flag_reason: string | null;
  error: string | null;
};

export type UndoEntry = {
  dayNumber: number;
  activity: Activity;
  timer: ReturnType<typeof setTimeout>;
};

export type StoredTraveler = {
  id?: string | null;
  name?: string;
  email?: string; // followup #3: anon-session fallback synthesises this
  destination?: string;
  departureDate?: string;
  returnDate?: string;
  hotel?: string;
  travelCompany?: string;
  travelerTypes?: string[];
  budgetTier?: string;
  travelerCount?: number | null;
  childrenAges?: string[] | null;
  activities?: unknown[];
  // PHI-37: full legs[] when the trip is multi-leg. Persisted by the
  // welcome page on save so /itinerary can render leg headers and the
  // transition-day chrome without an extra fetch.
  legs?: { id?: string; place?: { name?: string }; startDate?: string; endDate?: string; nights?: number }[];
  // PHI-90: traveller-seeded must-dos, captured at welcome step 4. Stored
  // on the local snapshot so a Regenerate (which calls generate() fresh)
  // still passes the anchors through to the prompt.
  userSeededActivities?: string[];
  // PHI-99: flex-mode duration. Populated when the traveller took the
  // "Not sure yet" path on welcome step 1. The dashboard date-lock nudge
  // clears these and writes departureDate/returnDate instead; the cached
  // itinerary survives the transition and is relabelled in place.
  flexMonth?: string | null;
  flexNights?: number | null;
  // PHI-111 / PHI-105: rich hotel coordinates captured at welcome step 2.
  // Optional everywhere — legacy snapshots without these fields stay valid
  // and the anchor-resolution prompt falls back to its no-hotel-context
  // behaviour. Threaded through to /api/itinerary/generate on regenerate.
  hotelPlaceId?: string | null;
  hotelLat?: number | null;
  hotelLng?: number | null;
  hotelNeighborhood?: string | null;
};
