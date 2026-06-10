import type { Activity, ItineraryDay, TimeBlock } from "@/types/itinerary";
import { TIME_BLOCK_ORDER } from "./itinerary-constants";
import type { RawDay } from "./itinerary-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map from the /api/itinerary/generate response shape to our shared ItineraryDay type. */
export function mapRawDays(rawDays: RawDay[]): ItineraryDay[] {
  return rawDays.map((d) => ({
    label: `Day ${d.day_number}`,
    date: d.date,
    day_number: d.day_number,
    activities: d.items.map((item, idx): Activity => ({
      id: item.id,
      name: item.title,
      description: item.description,
      time: item.time_block,
      sequence: idx,
      category: item.type,
      ...(typeof item.is_outdoor === "boolean" && { is_outdoor: item.is_outdoor }),
      ...(item.alternative && {
        alternative: {
          title: item.alternative.title,
          description: item.alternative.description,
          type: item.alternative.type,
        },
      }),
      // PHI-90 / PHI-104: forward the anchor flag and the optional
      // verbatim must-do text to the rendering layer so the "from your
      // list" badge + verbatim subtitle surface on the card.
      ...(item.seededByUser === true && { seededByUser: true }),
      ...(typeof item.seededVerbatim === "string" && item.seededVerbatim.trim().length > 0
        ? { seededVerbatim: item.seededVerbatim }
        : {}),
    })),
    // PHI-37: pass through leg metadata so the UI can render leg headers
    // and transition days. Absent on single-leg trips.
    ...(typeof d.leg_index === "number" && { leg_index: d.leg_index }),
    ...(d.is_transition && { is_transition: d.is_transition }),
  }));
}

/** Sort activities within a day by time block order, then by sequence. */
export function sortActivities(activities: Activity[]): Activity[] {
  return [...activities].sort(
    (a, b) =>
      TIME_BLOCK_ORDER[a.time] - TIME_BLOCK_ORDER[b.time] ||
      a.sequence - b.sequence
  );
}

export function dayAnchorId(dayNumber: number): string {
  return `day-${dayNumber}`;
}

/** Group sorted activities by time block. */
export function groupByBlock(activities: Activity[]): Record<TimeBlock, Activity[]> {
  const groups: Record<TimeBlock, Activity[]> = { morning: [], afternoon: [], evening: [] };
  for (const a of activities) {
    groups[a.time].push(a);
  }
  return groups;
}

/** Format a date range like "15–22 Apr 2026". */
export function formatDateRange(departure: string, ret: string): string {
  const d = new Date(departure);
  const r = new Date(ret);
  const sameMonth = d.getMonth() === r.getMonth() && d.getFullYear() === r.getFullYear();
  if (sameMonth) {
    return `${d.getDate()}–${r.getDate()} ${d.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`;
  }
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${r.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Inclusive trip-day count from departure → return; 0 if either date is invalid. */
export function tripDayCount(departure: string, ret: string): number {
  if (!departure || !ret) return 0;
  const d = new Date(departure);
  const r = new Date(ret);
  const ms = r.getTime() - d.getTime();
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
}

/** ISO date string for departure + dayIndex (0-based); empty string if invalid. */
export function skeletonDayDate(departure: string, dayIndex: number): string {
  if (!departure) return "";
  const d = new Date(departure);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + dayIndex);
  return d.toISOString().slice(0, 10);
}

export function formatDuration(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
