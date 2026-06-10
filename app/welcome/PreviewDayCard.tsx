"use client";

import type { PreviewDay } from "./welcome-types";

/**
 * PHI-37 slice 3: reusable day card for the step-5 itinerary preview.
 * Single-leg trips render the same markup as before. Multi-leg trips
 * use the same component but the parent wraps groups of days with a
 * sticky leg header. Transition days (`is_transition: true`) render as
 * muted travel-only cards with no item list.
 */
export function PreviewDayCard({ day }: { day: PreviewDay }) {
  if (day.is_transition) {
    const transitionItem = day.items?.[0];
    return (
      <div
        data-testid={`transition-day-${day.day_number}`}
        className="rounded-2xl border border-dashed border-[#d4cfc5] bg-[#f5f2ec] p-5"
      >
        <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-1">
          Day {day.day_number}
          {day.date ? ` · ${day.date}` : ""} · Travel day
        </p>
        <p className="text-sm text-[var(--text-secondary)]">
          {transitionItem?.title ?? "Travel between legs."}
        </p>
        {transitionItem?.description && (
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {transitionItem.description}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-[#e8e4de] bg-white p-5">
      <p className="text-xs font-bold text-[#1a6b7f] uppercase tracking-widest mb-1">
        Day {day.day_number}
        {day.date ? ` · ${day.date}` : ""}
      </p>
      <ul className="flex flex-col gap-2.5 mt-2">
        {day.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] w-16 shrink-0">
                {item.time_block}
              </span>
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {item.title}
              </span>
            </div>
            {/* PHI-92 — render the anchor badge on the welcome preview, not
                just on /itinerary, so the traveller gets the "Rise heard
                me" confirmation before they decide whether to save the
                trip. `self-start` keeps the badge from stretching across
                the flex-column <li>; the rest of the chip is byte-identical
                to the /itinerary badge so the two surfaces match. */}
            {item.seededByUser && (
              <span
                data-testid="seeded-by-user-badge-preview"
                className="self-start inline-flex items-center gap-1 mt-1 ml-[72px] px-2 py-0.5 rounded-md bg-[#1a6b7f]/10 text-[#1a6b7f] text-[10px] font-semibold uppercase tracking-widest"
              >
                ★ You added this
              </span>
            )}
            {item.description && (
              <p className="text-xs text-[var(--text-secondary)] ml-[72px] leading-relaxed">
                {item.description}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
