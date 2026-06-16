"use client";

import type { PlaceRef } from "@/lib/trip-schema";
import { cityLabel } from "@/lib/destination-label";
import { PreviewDayCard } from "../PreviewDayCard";
import type { ActivityFeedbackEntry, PreviewDay } from "../welcome-types";

type Step6AccountProps = {
  hardExcludedActivities: ActivityFeedbackEntry[];
  handleRemoveExclusion: (activityId: string) => void;
  itineraryTimeSensitiveAlerts: string[] | null;
  itineraryPlacementNotes: string | null;
  itineraryPreviewLoading: boolean;
  itineraryPreview: PreviewDay[] | null;
  itineraryPreviewError: string | null;
  destination: string;
  parsedLegs: { place: PlaceRef; nights: number }[];
  authedUser: { id: string; email: string; existingName: string | null } | null;
  name: string;
  setName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  emailTouched: boolean;
  setEmailTouched: (v: boolean) => void;
  emailValid: boolean;
  darkInput: string;
};

export function Step6Account({
  hardExcludedActivities,
  handleRemoveExclusion,
  itineraryTimeSensitiveAlerts,
  itineraryPlacementNotes,
  itineraryPreviewLoading,
  itineraryPreview,
  itineraryPreviewError,
  destination,
  parsedLegs,
  authedUser,
  name,
  setName,
  email,
  setEmail,
  emailTouched,
  setEmailTouched,
  emailValid,
  darkInput,
}: Step6AccountProps) {
  return (
            <div className="flex flex-col gap-6">
              {/* Hard exclusions edit affordance — kept at top because
                  users are still in "trip-shaping" mode here. */}
              {hardExcludedActivities.length > 0 && (
                <div className="rounded-2xl border border-[#e8e4de] bg-white px-5 py-4">
                  <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">
                    Skipped activities
                  </p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {hardExcludedActivities.map((entry) => (
                      <button
                        key={entry.activityId}
                        onClick={() => handleRemoveExclusion(entry.activityId)}
                        className="flex items-center gap-2 rounded-xl border border-[#d4cfc5] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:border-red-500/30 hover:text-red-400 transition-colors"
                      >
                        {entry.activityName}
                        <span className="text-[var(--text-muted)] text-xs">×</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">Tap to restore an activity.</p>
                </div>
              )}

              {/* Itinerary preview — read-only, day-by-day. Loading state
                  while /api/itinerary/generate streams the response. */}
              <div data-testid="itinerary-preview">
                <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-3">
                  Your trip plan
                </h2>
                {/* PHI-114: time-sensitive alerts — "Before you go" amber
                    block stacked ABOVE the placement_notes callout so the
                    action-items (Keukenhof closure, Anne Frank pre-booking
                    etc.) lead, with anchor surfacing below. Null/empty =
                    no block. */}
                {itineraryTimeSensitiveAlerts && itineraryTimeSensitiveAlerts.length > 0 && (
                  <div
                    data-testid="welcome-time-sensitive-alerts"
                    className="rounded-xl border border-[#f4d49e] bg-[#fef3e2] px-4 py-3 text-sm text-[var(--text-primary)] mb-3"
                  >
                    <span className="font-semibold">Before you go</span>
                    <ul className="mt-2 space-y-1.5 text-[var(--text-secondary)]">
                      {itineraryTimeSensitiveAlerts.map((alert, i) => (
                        <li key={i} className="flex gap-2">
                          <span aria-hidden>⚠</span>
                          <span>{alert}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* PHI-90: placement_notes — surface in the preview the same
                    way /itinerary does, so the user finds out about a
                    misspecified anchor or unfittable item BEFORE they
                    commit email. Hard constraint: anchors are never
                    silently dropped. */}
                {itineraryPlacementNotes && (
                  <div
                    data-testid="welcome-placement-notes"
                    className="rounded-xl border border-[#f4d49e] bg-[#fef3e2] px-4 py-3 text-sm text-[var(--text-primary)] mb-3"
                  >
                    <span className="font-semibold">A note on your must-dos:</span>{" "}
                    <span className="text-[var(--text-secondary)]">{itineraryPlacementNotes}</span>
                  </div>
                )}
                {itineraryPreviewLoading && !itineraryPreview && (
                  <div className="rounded-2xl border border-[#e8e4de] bg-white p-6 flex items-center gap-3 text-[var(--text-secondary)]">
                    <div className="w-4 h-4 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin" />
                    <span>
                      Building your day-by-day itinerary for {cityLabel(destination)}…
                    </span>
                  </div>
                )}
                {itineraryPreviewError && !itineraryPreview && (
                  <div className="rounded-2xl border border-[#e8e4de] bg-[#f0ede8] p-5 text-sm text-[var(--text-secondary)]">
                    Couldn&apos;t load your trip preview. You can still save
                    your trip below — we&apos;ll generate the itinerary
                    after you sign in.
                  </div>
                )}
                {itineraryPreview && itineraryPreview.length > 0 && (
                  <div
                    className="flex flex-col gap-3"
                    data-testid="itinerary-preview-days"
                  >
                    {/* PHI-37 slice 3: group days by leg_index when the
                        plan is multi-leg. Single-leg renders identically
                        to before — the multiLegPreview wrapper kicks in
                        only when at least one day has a leg_index AND
                        parsedLegs has 2+ entries. */}
                    {(() => {
                      const isMultiLeg =
                        parsedLegs.length >= 2 &&
                        itineraryPreview.some((d) => typeof d.leg_index === "number");
                      if (!isMultiLeg) {
                        // Single-leg: existing flat day list.
                        return itineraryPreview.map((day) => (
                          <PreviewDayCard key={day.day_number} day={day} />
                        ));
                      }
                      // Multi-leg: group days by leg_index, with a leg
                      // header per group and transition days styled
                      // differently. Days without a leg_index fall into
                      // the previous leg (or leg 0 if at the start).
                      const groups: { legIndex: number; days: PreviewDay[] }[] = [];
                      let currentLeg = -1;
                      for (const day of itineraryPreview) {
                        const idx =
                          typeof day.leg_index === "number"
                            ? day.leg_index
                            : Math.max(0, currentLeg);
                        if (idx !== currentLeg) {
                          groups.push({ legIndex: idx, days: [day] });
                          currentLeg = idx;
                        } else {
                          groups[groups.length - 1].days.push(day);
                        }
                      }
                      return groups.map((g, gi) => {
                        const leg = parsedLegs[g.legIndex];
                        const legName = leg?.place?.name ?? `Leg ${g.legIndex + 1}`;
                        return (
                          <div
                            key={`leg-${gi}`}
                            data-testid={`leg-section-${g.legIndex}`}
                            className="flex flex-col gap-2"
                          >
                            <div className="sticky top-0 z-10 bg-[#f8f6f1] py-2 -mx-1 px-1">
                              <p
                                className="text-xs font-bold text-[#1a6b7f] uppercase tracking-widest"
                                data-testid={`leg-header-${g.legIndex}`}
                              >
                                Leg {g.legIndex + 1} · {legName}
                                {leg?.nights
                                  ? ` · ${leg.nights} night${leg.nights === 1 ? "" : "s"}`
                                  : ""}
                              </p>
                            </div>
                            {g.days.map((day) => (
                              <PreviewDayCard
                                key={day.day_number}
                                day={day}
                              />
                            ))}
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>

              {/* Save Trip section — signup form, framed as the persistent
                  banner from Maya's escalation pattern. Sits BELOW the
                  preview so the user has already seen the value.
                  PHI-64: signed-in users skip the form. If we already
                  have their name, the auto-finish effect handles save +
                  redirect; otherwise we show only a name input. */}
              {authedUser ? (
                authedUser.existingName ? (
                  <div
                    className="rounded-2xl border border-[#1a6b7f]/30 bg-[#1a6b7f]/5 p-5 flex items-center gap-3"
                    data-testid="signed-in-saving"
                  >
                    <div className="w-4 h-4 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin shrink-0" />
                    <p className="text-sm text-[var(--text-secondary)]">
                      Saving your trip to {authedUser.email}…
                    </p>
                  </div>
                ) : (
                  <div
                    className="rounded-2xl border border-[#1a6b7f]/30 bg-[#1a6b7f]/5 p-5"
                    data-testid="signed-in-name-only"
                  >
                    <p className="text-sm font-bold text-[var(--text-primary)] mb-1">
                      What should we call you?
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] mb-4">
                      You&apos;re signed in as {authedUser.email}. We just
                      need a display name to finish saving your trip.
                    </p>
                    <input
                      type="text"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      name="name"
                      className={darkInput}
                      data-testid="signup-name"
                    />
                  </div>
                )
              ) : (
                <div className="rounded-2xl border border-[#1a6b7f]/30 bg-[#1a6b7f]/5 p-5">
                  <p className="text-sm font-bold text-[var(--text-primary)] mb-1">
                    Save your trip to keep it.
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mb-4">
                    We&apos;ll save your itinerary, transport advice, and trip
                    summary to your account.
                  </p>
                  <div className="flex flex-col gap-3">
                    <input
                      type="text"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      name="name"
                      className={darkInput}
                    />
                    <div className="flex flex-col gap-1">
                      <input
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => setEmailTouched(true)}
                        autoComplete="email"
                        name="email"
                        aria-invalid={emailTouched && !emailValid}
                        aria-describedby={
                          emailTouched && !emailValid ? "email-error" : undefined
                        }
                        className={darkInput}
                        data-testid="signup-email"
                      />
                      {/* PHI-47: only show after field has been blurred,
                          so typing "p" doesn't immediately read as wrong. */}
                      {emailTouched && email.trim().length > 0 && !emailValid && (
                        <p
                          id="email-error"
                          role="alert"
                          className="text-xs text-red-500"
                        >
                          That doesn&apos;t look like a valid email.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
  );
}
