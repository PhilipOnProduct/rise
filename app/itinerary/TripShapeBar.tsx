"use client";

import type { ItineraryDay } from "@/types/itinerary";

// ── TripShapeBar ──────────────────────────────────────────────────────────────

type TripShapeBarProps = {
  days: ItineraryDay[];
  loading: boolean;
  // PHI-79: when loading, render N skeleton pills so the shape bar keeps its
  // structure instead of collapsing to a single "Building…" line. 0 falls back
  // to the spinner-only state (used when traveler dates aren't known yet).
  skeletonDayCount: number;
  activeDayNumber: number | null;
  onDayClick: (dayNumber: number) => void;
  barRef: React.RefObject<HTMLDivElement | null>;
};

export function TripShapeBar({ days, loading, skeletonDayCount, activeDayNumber, onDayClick, barRef }: TripShapeBarProps) {
  const maxActivities = Math.max(1, ...days.map((d) => d.activities.length));
  const showSkeletonPills = loading && skeletonDayCount > 0;

  return (
    // Sticky below the nav (top-14 = 56px). z-40 keeps it below the nav's z-50.
    <div
      ref={barRef}
      className="sticky top-14 z-40 w-full bg-[#f8f6f1] border-b border-[#e8e4de]"
    >
      {showSkeletonPills ? (
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          <div className="flex gap-1 px-4 py-3 min-w-max" aria-busy="true" aria-label="Loading itinerary">
            {Array.from({ length: skeletonDayCount }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col items-center gap-1.5 px-3 py-2 min-w-[56px] flex-shrink-0 animate-pulse"
              >
                <div className="h-3 w-10 rounded bg-[#e8e4de]" />
                <div className="w-full h-1.5 rounded-full bg-[#e8e4de]" />
                <div className="h-2.5 w-12 rounded bg-[#f0ede8]" />
              </div>
            ))}
          </div>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 px-6 py-4">
          <div className="w-4 h-4 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin flex-shrink-0" />
          <span className="text-xs text-[var(--text-muted)]">Building your itinerary…</span>
        </div>
      ) : (
        // overflow-x: auto only on the inner container — the sole permitted horizontal scroll
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          <div className="flex gap-1 px-4 py-3 min-w-max">
            {days.map((day) => {
              const fill = day.activities.length / maxActivities;
              const fillPct = Math.round(fill * 100);
              const isActive = activeDayNumber === day.day_number;

              return (
                <button
                  key={day.day_number}
                  onClick={() => onDayClick(day.day_number)}
                  className={`flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl transition-colors group flex-shrink-0 min-w-[56px] ${
                    isActive
                      ? "bg-[#1a6b7f]/10"
                      : "hover:bg-[#f0ede8]"
                  }`}
                  title={`${day.label} — ${day.activities.length} activities`}
                >
                  <span className={`text-xs font-semibold transition-colors whitespace-nowrap ${
                    isActive ? "text-[#1a6b7f]" : "text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]"
                  }`}>
                    {day.label}
                  </span>
                  {/* Density fill bar */}
                  <div className="w-full h-1.5 rounded-full bg-[#e8e4de] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isActive ? "bg-[#1a6b7f]" : "bg-[#1a6b7f]/60"}`}
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                  <span className={`text-[10px] transition-colors whitespace-nowrap ${
                    isActive ? "text-[#1a6b7f] font-medium" : "text-[var(--text-muted)]"
                  }`}>
                    {day.activities.length} {day.activities.length === 1 ? "activity" : "activities"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
