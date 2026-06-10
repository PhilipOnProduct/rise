"use client";

import { ActivityCard } from "../ActivityCard";
import { logActivityEvent, previewLoadingLabel } from "../welcome-helpers";
import type {
  ActivityFeedbackEntry,
  Chip,
  ChipsEntry,
  ParsedActivity,
} from "../welcome-types";

type Step5PreviewProps = {
  inspiration: string;
  parsedActivities: ParsedActivity[];
  previewBadDays: string[] | null;
  streamRefreshNote: boolean;
  previewLoading: boolean;
  destination: string;
  travelCompany: string;
  activityFeedback: Record<string, ActivityFeedbackEntry>;
  activityChips: Record<string, ChipsEntry>;
  openChipId: string | null;
  setOpenChipId: (id: string | null) => void;
  handleThumbsUp: (activity: ParsedActivity) => void;
  handleThumbsDown: (activity: ParsedActivity) => void;
  handleChipSelect: (activity: ParsedActivity, chip: Chip) => void;
  handleSkip: (activity: ParsedActivity) => void;
  email: string;
};

export function Step5Preview({
  inspiration,
  parsedActivities,
  previewBadDays,
  streamRefreshNote,
  previewLoading,
  destination,
  travelCompany,
  activityFeedback,
  activityChips,
  openChipId,
  setOpenChipId,
  handleThumbsUp,
  handleThumbsDown,
  handleChipSelect,
  handleSkip,
  email,
}: Step5PreviewProps) {
  return (
            <div className="flex flex-col gap-4">
              {/* PHI-51: inspiration trust signal. Shown only when an
                  inspiration is set AND fewer than half of the rendered
                  cards visibly reference the theme — that's the case
                  where the soft bias didn't land hard enough for the
                  user to notice on their own. Theme-reference detection
                  is a substring check on title + description, not a
                  parser pass (deliberate simplicity per PRD). */}
              {(() => {
                const trimmed = inspiration.trim();
                if (!trimmed) return null;
                if (parsedActivities.length === 0) return null;
                const needle = trimmed.toLowerCase();
                const themed = parsedActivities.filter((a) => {
                  const haystack = `${a.name} ${a.description ?? ""}`.toLowerCase();
                  return haystack.includes(needle);
                }).length;
                const fewerThanHalf = themed * 2 < parsedActivities.length;
                if (!fewerThanHalf) return null;
                return (
                  <p
                    className="text-sm text-[var(--text-secondary)] italic px-2"
                    data-testid="inspiration-empty-state"
                  >
                    We heard &lsquo;{trimmed}&rsquo; — leaning into it where we can.
                  </p>
                );
              })()}
              {/* PHI-53: rainy-day hint. Shown when the trip-date forecast
                  flagged at least one bad day. The 6-card preview isn't
                  day-bound, so the message is trip-level — per-card
                  alternatives surface on the saved itinerary page. */}
              {previewBadDays && previewBadDays.length > 0 && (
                <div
                  data-testid="preview-rainy-hint"
                  className="rounded-xl border border-[#f4d49e] bg-[#fef3e2] px-4 py-2.5 text-sm text-[var(--text-primary)]"
                >
                  <span aria-hidden="true">☔</span>{" "}
                  <span className="font-semibold">
                    {previewBadDays.length} day
                    {previewBadDays.length === 1 ? "" : "s"} look
                    {previewBadDays.length === 1 ? "s" : ""} wet
                  </span>{" "}
                  <span className="text-[var(--text-secondary)]">
                    — your saved itinerary will surface indoor backups for
                    those.
                  </span>
                </div>
              )}
              {/* PHI-44: stream restarted after the user rated cards.
                  Explains why their ratings just disappeared. Auto-dismisses. */}
              {streamRefreshNote && (
                <div
                  role="status"
                  aria-live="polite"
                  data-testid="stream-refresh-note"
                  className="rounded-xl border border-[#1a6b7f]/25 bg-[#1a6b7f]/5 px-4 py-2.5 text-sm text-[var(--text-primary)]"
                >
                  Updated preferences — refreshing your picks.
                </div>
              )}
              {/* Initial loading state — before any cards arrive */}
              {previewLoading && parsedActivities.length === 0 && (
                <div className="rounded-2xl border border-[#e8e4de] bg-white p-6 min-h-[140px] flex items-center">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                      <div className="w-4 h-4 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin flex-shrink-0" />
                      <span>{previewLoadingLabel(destination, travelCompany)}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] ml-7">Activities will appear as we find them — rate each one as it arrives.</p>
                  </div>
                </div>
              )}

              {/* Rating progress counter */}
              {!previewLoading && parsedActivities.length > 0 && Object.keys(activityFeedback).length > 0 && (
                <p className="text-xs text-[var(--text-muted)] text-right">
                  {Object.keys(activityFeedback).length} of {parsedActivities.length} rated
                </p>
              )}

              {/* Progressive card reveal — cards appear as they complete */}
              {parsedActivities.map((activity) => (
                <ActivityCard
                  key={activity.id}
                  activity={activity}
                  chipsEntry={activityChips[activity.id]}
                  feedback={activityFeedback[activity.id]}
                  chipsOpen={openChipId === activity.id}
                  disabled={false}
                  onThumbsUp={() => handleThumbsUp(activity)}
                  onThumbsDown={() => handleThumbsDown(activity)}
                  onChipSelect={(chip) => handleChipSelect(activity, chip)}
                  onUndo={() => setOpenChipId(null)}
                  onSkip={() => handleSkip(activity)}
                  onRationaleExpand={() =>
                    logActivityEvent({
                      event: "rationale_expanded",
                      activityId: activity.id,
                      activityName: activity.name,
                      activityCategory: activity.category,
                    })
                  }
                />
              ))}

              {/* Inline loading indicator while more cards are incoming */}
              {previewLoading && parsedActivities.length > 0 && (
                <div className="flex items-center gap-3 px-2 py-3 text-[var(--text-muted)] text-sm">
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-[#6a7f8f] border-t-transparent animate-spin flex-shrink-0" />
                  <span>Found {parsedActivities.length} of ~6 activities...</span>
                </div>
              )}

              {/* Prompt to rate — shown after loading until user rates something */}
              {!previewLoading && parsedActivities.length > 0 && Object.keys(activityFeedback).length === 0 && (
                <p className="px-2 py-3 text-[#1a6b7f] text-sm font-medium">
                  Rate each activity to shape your itinerary.
                </p>
              )}

              {/* Follow-up #2 — Maya's Tier-2 inline prompt. Shown once the
                  user has rated 2+ activities (real engagement signal) but
                  before they advance to step 5. Soft, non-blocking, sits
                  inline with the cards — not a modal. */}
              {!previewLoading &&
                Object.keys(activityFeedback).length >= 2 &&
                !email && (
                  <div
                    data-testid="signup-tier2-prompt"
                    className="rounded-xl border border-[#1a6b7f]/25 bg-[#1a6b7f]/5 px-4 py-3 text-sm text-[var(--text-primary)]"
                  >
                    <span className="font-semibold">Loving these picks?</span>{" "}
                    <span className="text-[var(--text-secondary)]">
                      Save your email at the end so this trip doesn&apos;t
                      vanish when you close the tab.
                    </span>
                  </div>
                )}
            </div>
  );
}
