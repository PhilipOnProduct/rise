export type ActivityCategory = "activity" | "restaurant" | "transport" | "note";

export type TimeBlock = "morning" | "afternoon" | "evening";

export type WeatherAlternativeData = {
  title: string;
  description: string;
  type: ActivityCategory;
};

export type Activity = {
  id: string;
  name: string;
  description: string;
  /** Time of day slot: morning / afternoon / evening */
  time: TimeBlock;
  /** Position within the time block, 0-indexed */
  sequence: number;
  category: ActivityCategory;
  /** PHI-53: AI-classified outdoor flag — wet-weather alternative is rendered
   *  only when this is true AND the day's date is in bad_day_dates. */
  is_outdoor?: boolean;
  /** PHI-53: paired wet-weather indoor/covered alternative. Only populated
   *  when is_outdoor is true and the AI found a real in-destination option. */
  alternative?: WeatherAlternativeData;
  /** PHI-90 / PHI-104: true on items the generator placed in response to a
   *  user-seeded must-do entry. The /itinerary view renders an inline
   *  "from your list" badge (canonical copy in `lib/copy.ts`) so the
   *  traveller can confirm their picks landed. */
  seededByUser?: boolean;
  /** PHI-104: the verbatim must-do entry the user typed, threaded through
   *  by the generate route when Claude resolved a vague entry to a specific
   *  venue (e.g. "that famous pastéis place" → "Pastéis de Belém"). When
   *  present AND the title differs (case-insensitive), `/itinerary` renders
   *  a muted italic subtitle under the title. Optional on read — legacy
   *  localStorage caches from before PHI-104 won't have it; treat absence
   *  as the verbatim-as-title flavour (badge only). */
  seededVerbatim?: string;
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
