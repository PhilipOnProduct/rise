"use client";

import type { ActivityCategory } from "@/types/itinerary";
import { CATEGORY_ICON } from "./itinerary-constants";

// ── AddSuggestionCard (shown when the API returns a suggestion for an empty slot) ──

export function AddSuggestionCard({
  suggestion,
  conflict,
  onAccept,
  onReject,
}: {
  suggestion: { title: string; description: string; type: string };
  conflict: string | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="bg-white border border-[#1a6b7f]/30 rounded-2xl px-5 py-4 flex flex-col">
      <div className="flex items-start gap-3 flex-1">
        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden>
          {CATEGORY_ICON[(suggestion.type as ActivityCategory) || "activity"]}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[#1a6b7f] text-sm leading-snug">{suggestion.title}</h3>
          <p className="text-sm text-[var(--text-secondary)] mt-1 leading-relaxed">{suggestion.description}</p>
          {conflict && (
            <p className="text-xs text-amber-500/80 mt-2">{conflict}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={onAccept}
          className="text-xs font-semibold text-[#1a6b7f] hover:text-[#155a6b] transition-colors"
        >
          Looks good ✓
        </button>
        <button
          onClick={onReject}
          className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          Not quite, try again →
        </button>
      </div>
    </div>
  );
}
