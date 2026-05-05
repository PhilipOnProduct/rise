export type ActivityCategory = "activity" | "restaurant" | "transport" | "note";

export type TimeBlock = "morning" | "afternoon" | "evening";

export type Activity = {
  id: string;
  name: string;
  description: string;
  /** Time of day slot: morning / afternoon / evening */
  time: TimeBlock;
  /** Position within the time block, 0-indexed */
  sequence: number;
  category: ActivityCategory;
};

export type ItineraryDay = {
  /** Human-readable label, e.g. "Day 1" or "Mon 15 Mar" */
  label: string;
  /** ISO date string, e.g. "2024-03-15" */
  date: string;
  day_number: number;
  activities: Activity[];
  /** PHI-37: index into the trip's legs[] (0-based). Absent on single-leg trips. */
  leg_index?: number;
  /** PHI-37: true on travel days between legs — rendered as a muted card. */
  is_transition?: boolean;
};

export type Itinerary = {
  id: string;
  traveler_id: string;
  destination: string;
  days: ItineraryDay[];
  created_at: string;
};
