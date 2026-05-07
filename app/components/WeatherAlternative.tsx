"use client";

import { useState } from "react";

/**
 * PHI-53 — Inline wet-weather alternative under an outdoor activity.
 *
 * Default state is a single compact line with an umbrella icon and the
 * alternative title. Tap to expand for the description. Mobile-first;
 * works at 360px. Only render this when the parent has decided the day
 * is rainy (bad_day_dates contains the activity's date) AND the activity
 * is outdoor — never render universally.
 */
export type WeatherAlternativeData = {
  title: string;
  description: string;
  type: "activity" | "restaurant" | "transport" | "note";
};

export function WeatherAlternative({
  alternative,
  onEngage,
}: {
  alternative: WeatherAlternativeData;
  onEngage?: () => void;
}) {
  const [open, setOpen] = useState(false);

  function toggle() {
    if (!open && onEngage) onEngage();
    setOpen((v) => !v);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      className="mt-2 w-full text-left rounded-xl bg-[#f0ede8] hover:bg-[#e8e4de] px-3 py-2 transition-colors"
    >
      <div className="flex items-start gap-2 text-xs text-[var(--text-muted)]">
        <span aria-hidden="true">☔</span>
        <span className="flex-1">
          <span className="font-semibold text-[var(--text-secondary)]">
            If it rains:
          </span>{" "}
          <span>{alternative.title}</span>
        </span>
        <span aria-hidden="true" className="text-[10px] mt-0.5">
          {open ? "▲" : "▼"}
        </span>
      </div>
      {open && (
        <p className="mt-1.5 ml-5 text-xs text-[var(--text-muted)] leading-relaxed">
          {alternative.description}
        </p>
      )}
    </button>
  );
}
