"use client";

import { useState } from "react";
import type { Activity, ActivityCategory } from "@/types/itinerary";
import { WeatherAlternative } from "@/app/components/WeatherAlternative";
import { FROM_YOUR_LIST } from "@/lib/copy";
import { CATEGORY_ICON } from "./itinerary-constants";

// ── ActivityCard ──────────────────────────────────────────────────────────────

type ActivityCardProps = {
  activity: Activity;
  onRemove?: () => void;
  onSwap?: () => void;
  swapping?: boolean;
  swapError?: boolean;
  swapSuggestion?: { title: string; description: string; type: string; conflict: string | null } | null;
  onAcceptSwap?: () => void;
  onRejectSwap?: () => void;
  /** PHI-53: when true, render the AI's wet-weather alternative inline. */
  showWeatherAlternative?: boolean;
  onAlternativeEngage?: () => void;
};

export function ActivityCard({ activity, onRemove, onSwap, swapping, swapError, swapSuggestion, onAcceptSwap, onRejectSwap, showWeatherAlternative, onAlternativeEngage }: ActivityCardProps) {
  const categoryIcon = CATEGORY_ICON[activity.category];

  // PHI-104: resolve which seeded-anchor flavour to render.
  // - Verbatim-as-title (badge only): seededByUser true + (no verbatim OR
  //   verbatim equals the title case-insensitively). Legacy localStorage
  //   caches without `seededVerbatim` land here cleanly.
  // - Resolved-from-verbatim (badge + verbatim subtitle): seededByUser true
  //   + non-empty verbatim that differs from the title case-insensitively.
  // Flagged anchors don't get a day card at all — that's the placement_notes
  // banner's job (PHI-90 / PHI-103).
  const verbatim = activity.seededVerbatim?.trim();
  const showVerbatimSubtitle =
    activity.seededByUser === true &&
    !!verbatim &&
    verbatim.toLowerCase() !== activity.name.trim().toLowerCase();
  // Tap-to-expand for the truncated verbatim. Off by default — the subtitle
  // renders with `truncate` so long entries ellipsise on a 360px viewport;
  // tapping toggles to wrapped, tapping again re-truncates. No modal/toast.
  const [verbatimExpanded, setVerbatimExpanded] = useState(false);

  // PHI-75: render the swap suggestion as the card's content (not an absolute
  // overlay) so the card grows vertically with long conflict-warning text
  // instead of bleeding onto the next time block.
  if (swapSuggestion) {
    return (
      <div className="bg-white border border-[#1a6b7f]/30 rounded-2xl px-5 py-4 flex flex-col">
        <div className="flex items-start gap-3">
          <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden>
            {CATEGORY_ICON[(swapSuggestion.type as ActivityCategory) || "activity"]}
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-[#1a6b7f] text-sm leading-snug">{swapSuggestion.title}</h3>
            <p className="text-sm text-[var(--text-secondary)] mt-1 leading-relaxed">{swapSuggestion.description}</p>
            {swapSuggestion.conflict && (
              <p className="text-xs text-amber-500/80 mt-2 leading-relaxed">{swapSuggestion.conflict}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={onAcceptSwap}
            className="text-xs font-semibold text-[#1a6b7f] hover:text-[#155a6b] transition-colors"
          >
            Looks good ✓
          </button>
          <button
            onClick={onRejectSwap}
            className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            Not quite, try again →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative bg-white border border-[#e8e4de] rounded-2xl px-5 py-4">
      {/* Action controls — hover on desktop, always visible on touch */}
      {!swapping && (onRemove || onSwap) && (
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
          {onSwap && (
            <button
              onClick={onSwap}
              className="w-7 h-7 rounded-lg bg-[#f0ede8] border border-[#d4cfc5] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[#b8b3a9] transition-colors flex items-center justify-center text-xs"
              title="Swap"
            >
              ⇄
            </button>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              className="w-7 h-7 rounded-lg bg-[#f0ede8] border border-[#d4cfc5] text-[var(--text-muted)] hover:text-red-400 hover:border-red-500/30 transition-colors flex items-center justify-center text-xs"
              title="Remove"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Loading overlay while swap is in progress */}
      {swapping && (
        <div className="absolute inset-0 bg-white/80 rounded-2xl flex items-center justify-center z-10">
          <div className="flex items-center gap-2 text-[var(--text-secondary)] text-sm">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-500 border-t-transparent animate-spin" />
            <span>Finding an alternative...</span>
          </div>
        </div>
      )}

      {/* Swap error overlay */}
      {swapError && !swapping && (
        <div className="absolute inset-x-0 -bottom-8 flex justify-center z-10">
          <span className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-1 border border-red-200">
            Couldn&apos;t find an alternative. Try again?
          </span>
        </div>
      )}

      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden>
          {categoryIcon}
        </span>
        <div className="flex-1 min-w-0">
          {/* PHI-104: title + "from your list" badge sit in a single
              flex-wrap row. On a short title the badge sits to the right
              of the title (desktop and mobile); on a long title that fills
              the row the badge wraps to its own line below the title —
              never inline with title text. `pr-16` reserves space for the
              absolute-positioned swap/remove buttons in the top-right of
              the card so the badge doesn't slide under them. */}
          <div className="flex items-baseline flex-wrap gap-x-2 gap-y-1 pr-16">
            <h3 className="font-semibold text-[var(--text-primary)] text-sm leading-snug">
              {activity.name}
            </h3>
            {activity.seededByUser && (
              <span
                data-testid="seeded-by-user-badge"
                className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#f0ede8] text-[var(--text-muted)] text-xs font-medium"
              >
                {FROM_YOUR_LIST}
              </span>
            )}
          </div>
          {/* PHI-104: verbatim subtitle for the resolved-from-verbatim
              flavour. Tap toggles the truncation so long entries
              ("that ramen place from that one episode where Bourdain
              went to Shinjuku") expand inline without a modal. */}
          {showVerbatimSubtitle && (
            <button
              type="button"
              onClick={() => setVerbatimExpanded((v) => !v)}
              aria-label={
                verbatimExpanded
                  ? "Collapse the original must-do entry you typed"
                  : "Expand the original must-do entry you typed"
              }
              aria-expanded={verbatimExpanded}
              className={`block w-full text-left text-xs italic text-[var(--text-muted)] mt-1 ${
                verbatimExpanded ? "" : "truncate"
              }`}
            >
              {FROM_YOUR_LIST}: &ldquo;{verbatim}&rdquo;
            </button>
          )}
          {activity.description && (
            <p className="text-sm text-[var(--text-secondary)] mt-1 leading-relaxed">{activity.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2.5">
            <span className="text-[11px] font-medium text-[var(--text-muted)] capitalize">
              {activity.category}
            </span>
          </div>
          {/* PHI-53: wet-weather alternative — only on outdoor activities
              when the parent has decided this day is rainy. */}
          {showWeatherAlternative && activity.is_outdoor && activity.alternative && (
            <WeatherAlternative
              alternative={activity.alternative}
              onEngage={onAlternativeEngage}
            />
          )}
        </div>
      </div>
    </div>
  );
}
