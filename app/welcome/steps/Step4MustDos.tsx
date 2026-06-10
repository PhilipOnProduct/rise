"use client";

import type { MutableRefObject } from "react";

type PopularPickRow = {
  name: string;
  context_note: string;
  category: "friction" | "fit" | "pro_tip";
};

type Step4MustDosProps = {
  userSeededText: string;
  setUserSeededText: (v: string) => void;
  destination: string;
  popularPicksDisabledForDest: string | null;
  countryRecommendations: { name: string; kind: "city" | "region"; why: string; lat?: number; lng?: number }[];
  popularPicksOpen: boolean;
  setPopularPicksOpen: (v: boolean) => void;
  popularPicksAddedCount: number;
  popularPicksNudgeFiredRef: MutableRefObject<boolean>;
  openPopularPicks: () => Promise<void>;
  popularPicksLoading: boolean;
  popularPicksError: string | null;
  setPopularPicks: (v: PopularPickRow[]) => void;
  popularPicks: PopularPickRow[];
  isPickAdded: (pickName: string) => boolean;
  addPick: (pick: { name: string; category: string }) => void;
  removePick: (pick: { name: string; category: string }) => void;
  handleContinue: () => Promise<void>;
};

export function Step4MustDos({
  userSeededText,
  setUserSeededText,
  destination,
  popularPicksDisabledForDest,
  countryRecommendations,
  popularPicksOpen,
  setPopularPicksOpen,
  popularPicksAddedCount,
  popularPicksNudgeFiredRef,
  openPopularPicks,
  popularPicksLoading,
  popularPicksError,
  setPopularPicks,
  popularPicks,
  isPickAdded,
  addPick,
  removePick,
  handleContinue,
}: Step4MustDosProps) {
  return (() => {
            // PHI-93 — disclose silent filtering. splitSeededActivities()
            // drops lines >200 chars and caps the list at 20; the user
            // gets zero signal today. Compute the raw-vs-kept deltas
            // inline and surface an amber hint when anything was dropped.
            // The filter still runs (it's the safety net); the hint is
            // disclosure only, and Continue stays enabled per PHI-90's
            // "step must never block forward progress" invariant.
            const rawLines = userSeededText
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean);
            const tooLong = rawLines.filter((l) => l.length > 200).length;
            const overCount = Math.max(0, rawLines.length - 20);
            const filteredAny = tooLong > 0 || overCount > 0;
            // PHI-102 — show the popular-picks trigger ABOVE the textarea so
            // the soft keyboard on mobile doesn't push it below the fold.
            // The expanded panel renders below the textarea (also per spec).
            // Hide the trigger entirely when this destination's been
            // disabled (sub-minimum fallback) or when a country-level
            // destination is selected (country flow has its own discovery).
            //
            // PHI-102 — Haiku first ship hallucinated ~25% of venue names
            // (Tsukiji on Kyoto, "Mizuki Shikibu Museum", etc.) and the
            // eval failed at 3.72/4.0. Swapped to Sonnet 4.6 and the eval
            // passed cleanly at 4.06/5 (no fixture below 4.0). UI is now
            // live on this destination. The Haiku/Sonnet cost delta is
            // ~5× per uncached call (`$0.001` → `$0.005`); the cache
            // covers >70% of expected production traffic per the PRD's
            // own cost posture, so net production-cost impact is small.
            const POPULAR_PICKS_ENABLED = true;
            const dest = destination.trim();
            const showPopularPicksTrigger =
              POPULAR_PICKS_ENABLED &&
              dest.length > 0 &&
              popularPicksDisabledForDest !== dest &&
              countryRecommendations.length === 0;
            const showSoftCapNudge =
              popularPicksOpen &&
              popularPicksAddedCount >= 5 &&
              !popularPicksNudgeFiredRef.current &&
              ((popularPicksNudgeFiredRef.current = true) || true);

            return (
              <div className="flex flex-col gap-4" data-testid="welcome-must-dos-step">
                {showPopularPicksTrigger && !popularPicksOpen && (
                  <button
                    type="button"
                    onClick={() => void openPopularPicks()}
                    className="self-start text-sm text-[#1a6b7f] hover:text-[var(--text-primary)] underline-offset-4 hover:underline transition-colors"
                    data-testid="open-popular-picks"
                  >
                    Need ideas? See popular picks ▾
                  </button>
                )}
                {showPopularPicksTrigger && popularPicksOpen && (
                  <button
                    type="button"
                    onClick={() => setPopularPicksOpen(false)}
                    className="self-start text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    Hide picks ▴
                  </button>
                )}
                <label className="block">
                  <span className="block text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-3">
                    Your must-dos (optional)
                  </span>
                  <textarea
                    value={userSeededText}
                    onChange={(e) => setUserSeededText(e.target.value)}
                    placeholder={`e.g.\nCervejaria Ramiro\nSunset at Miradouro da Senhora do Monte\nTime Out Market`}
                    rows={6}
                    className="w-full min-h-[160px] bg-white border border-[#b8b3a9] focus:border-[#1a6b7f] outline-none rounded-xl px-4 py-3 text-[var(--text-primary)] text-base placeholder-[#9ca3af] transition-colors resize-y"
                  />
                </label>
                {/* PHI-102 — popular picks panel renders BELOW the textarea
                    so the textarea stays anchored where the user is typing
                    on mobile. */}
                {popularPicksOpen && (
                  <div
                    className="flex flex-col gap-3 rounded-2xl border border-[#e8e4de] bg-white p-4"
                    data-testid="popular-picks-panel"
                  >
                    <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">
                      Popular picks
                    </p>
                    {popularPicksLoading && (
                      <p className="text-sm text-[var(--text-muted)]">
                        Loading popular picks…
                      </p>
                    )}
                    {popularPicksError && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start justify-between gap-3">
                        <span>{popularPicksError}</span>
                        <button
                          onClick={() => {
                            setPopularPicks([]);
                            void openPopularPicks();
                          }}
                          className="underline shrink-0"
                        >
                          Try again
                        </button>
                      </div>
                    )}
                    {!popularPicksLoading &&
                      !popularPicksError &&
                      popularPicks.length === 0 &&
                      popularPicksDisabledForDest === dest && (
                        <p className="text-sm text-[var(--text-muted)]">
                          No popular picks for this destination yet — type your own ↓
                        </p>
                      )}
                    {popularPicks.length > 0 && (
                      <ul className="flex flex-col divide-y divide-[#e8e4de]">
                        {popularPicks.map((pick) => {
                          const added = isPickAdded(pick.name);
                          return (
                            <li
                              key={pick.name}
                              className="flex items-start justify-between gap-3 py-2.5"
                              data-testid={`popular-pick-${pick.name}`}
                            >
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <span className="text-sm font-semibold text-[var(--text-primary)]">
                                  {pick.name}
                                </span>
                                <span className="text-xs text-[var(--text-muted)] leading-snug">
                                  {pick.context_note}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  added ? removePick(pick) : addPick(pick)
                                }
                                aria-label={added ? `Remove ${pick.name}` : `Add ${pick.name}`}
                                className={`shrink-0 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl text-sm font-bold transition-colors ${
                                  added
                                    ? "bg-[#1a6b7f]/10 text-[#1a6b7f]"
                                    : "text-[#1a6b7f] hover:bg-[#1a6b7f]/5"
                                }`}
                              >
                                {added ? "✓" : "+ Add"}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {showSoftCapNudge && (
                      <p
                        className="text-xs text-[var(--text-muted)] mt-1"
                        data-testid="popular-picks-soft-cap"
                      >
                        Add anything else? ↓
                      </p>
                    )}
                  </div>
                )}
                {filteredAny && (
                  <p
                    data-testid="must-dos-filter-hint"
                    className="rounded-xl border border-[#f4d49e] bg-[#fef3e2] px-3 py-2 text-xs text-[var(--text-primary)] leading-relaxed"
                  >
                    {tooLong > 0 && (
                      <>
                        {tooLong} {tooLong === 1 ? "line was" : "lines were"} too long to use — keep each one under 200 characters.
                        {overCount > 0 ? " " : ""}
                      </>
                    )}
                    {overCount > 0 && (
                      <>Using your first 20 entries — remove one to add another.</>
                    )}
                  </p>
                )}
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  One per line. We&apos;ll place each one on a sensible day and
                  build the rest of your trip around it. You can adjust your
                  itinerary later from the trip page.
                </p>
                <p
                  data-testid="must-dos-pii-hint"
                  className="text-xs text-[var(--text-muted)] leading-relaxed"
                >
                  Heads up — what you type here goes to our AI planner. Skip
                  personal details (phone numbers, addresses) you wouldn&apos;t
                  share with a travel agent.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setUserSeededText("");
                    void handleContinue();
                  }}
                  className="self-start text-sm font-medium text-[#1a6b7f] hover:text-[#155a6b] transition-colors"
                >
                  Nothing yet — skip →
                </button>
              </div>
            );
          })();
}
