"use client";

import { useState } from "react";
import type { ActivityFeedbackEntry, Chip, ChipsEntry, ParsedActivity } from "./welcome-types";

// ── Activity card component ────────────────────────────────────────────────

type ActivityCardProps = {
  activity: ParsedActivity;
  chipsEntry: ChipsEntry | undefined;
  feedback: ActivityFeedbackEntry | undefined;
  chipsOpen: boolean;
  disabled?: boolean;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  onChipSelect: (chip: Chip) => void;
  onUndo: () => void;
  onSkip: () => void;
  onRationaleExpand: () => void;
};

export function ActivityCard({
  activity,
  chipsEntry,
  feedback,
  chipsOpen,
  disabled,
  onThumbsUp,
  onThumbsDown,
  onChipSelect,
  onUndo,
  onSkip,
  onRationaleExpand,
}: ActivityCardProps) {
  // PHI-32: rationale is collapsed by default to avoid visual noise.
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const isHardExcluded =
    feedback?.feedbackType === "chip_selected" && feedback.chip?.type === "hard_exclusion";
  const isNoted =
    feedback?.feedbackType === "chip_selected" && feedback.chip?.type === "soft_signal" ||
    feedback?.feedbackType === "thumbs_down_no_chip";
  const isThumbsUp = feedback?.feedbackType === "thumbs_up";
  const isSkipped = feedback?.feedbackType === "skipped";

  return (
    <div
      className={`rounded-2xl border p-5 transition-all ${
        isHardExcluded
          ? "border-[#e8e4de] bg-[#f0ede8] opacity-50"
          : isNoted
          ? "border-[#e8e4de] border-l-[#d4a94a] border-l-[3px] bg-white"
          : "border-[#e8e4de] bg-white"
      }`}
    >
      <div className="mb-3">
        <div className="font-bold text-[var(--text-primary)] text-base leading-snug">{activity.name}</div>
        <div className="text-xs text-[#1a6b7f] font-semibold mt-0.5">{activity.category}</div>
      </div>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">{activity.description}</p>

      {/* PHI-32: "Why this" rationale — collapsed by default. Trust signal
          without visual noise. Hidden if the model didn't return one. */}
      {activity.rationale && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => {
              const next = !rationaleOpen;
              setRationaleOpen(next);
              if (next) onRationaleExpand();
            }}
            aria-expanded={rationaleOpen}
            aria-controls={`rationale-${activity.id}`}
            className="text-xs text-[#1a6b7f] hover:text-[var(--text-primary)] underline-offset-4 hover:underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a6b7f] focus-visible:ring-offset-2 rounded"
            data-testid={`why-this-${activity.id}`}
          >
            {rationaleOpen ? "Hide why ↑" : "Why this →"}
          </button>
          {rationaleOpen && (
            <div
              id={`rationale-${activity.id}`}
              role="region"
              aria-live="polite"
              className="mt-2 px-3 py-2.5 rounded-xl bg-[#f0ede8] text-xs text-[var(--text-secondary)] leading-relaxed"
            >
              {activity.rationale}
            </div>
          )}
        </div>
      )}

      {/* Thumbs buttons — hidden while streaming or when chips are open.
          PHI-28: 48×48 (w-12 h-12) to clear WCAG / Apple HIG 44px minimum
          comfortably on mobile. Skip is a tertiary text affordance below. */}
      {!chipsOpen && !disabled && !isHardExcluded && !isNoted && !isSkipped && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <button
              onClick={onThumbsUp}
              className={`flex items-center justify-center w-12 h-12 rounded-xl border text-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a6b7f] focus-visible:ring-offset-2 ${
                isThumbsUp
                  ? "border-[#1a6b7f] bg-[#1a6b7f] text-white shadow-sm"
                  : "border-[#d4cfc5] text-[var(--text-muted)] hover:border-[#1a6b7f]/40 hover:text-[#1a6b7f]"
              }`}
              title="Interested"
              aria-label={`Interested in ${activity.name}`}
            >
              👍
            </button>
            <button
              onClick={onThumbsDown}
              className="flex items-center justify-center w-12 h-12 rounded-xl border border-[#d4cfc5] text-lg text-[var(--text-muted)] hover:border-red-500/40 hover:text-red-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              title="Not for me"
              aria-label={`Not for me: ${activity.name}`}
            >
              👎
            </button>
            <button
              onClick={onSkip}
              className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline-offset-4 hover:underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a6b7f] focus-visible:ring-offset-2 rounded px-2 py-1"
              title="Skip — not sure"
              aria-label={`Skip ${activity.name} — not sure`}
            >
              Not sure — skip
            </button>
          </div>
        </div>
      )}

      {/* Chips layer — always present immediately (fallback → dynamic swap happens silently) */}
      {chipsOpen && chipsEntry && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {chipsEntry.chips.map((chip) => (
              <button
                key={chip.label}
                onClick={() => onChipSelect(chip)}
                className="rounded-xl border border-[#d4cfc5] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[#b8b3a9] hover:text-[var(--text-primary)] transition-colors"
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-muted)]">Pick one to help us plan better.</p>
            <button
              onClick={onUndo}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              ← Undo
            </button>
          </div>
        </div>
      )}

      {/* Chip selected — hard exclusion */}
      {isHardExcluded && <p className="text-xs text-orange-400">We&apos;ll skip this.</p>}

      {/* Soft signal or no-chip submission */}
      {isNoted && <p className="text-xs text-[var(--text-muted)]">👎 Noted — we&apos;ll adjust.</p>}

      {/* PHI-28: skipped — distinct visual from thumbs-down so users see
          their conscious "not sure" was registered */}
      {isSkipped && (
        <p className="text-xs text-[var(--text-muted)]">Skipped — no preference recorded.</p>
      )}
    </div>
  );
}
