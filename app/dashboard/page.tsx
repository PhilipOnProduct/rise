"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  firstLeg,
  primaryDestinationName,
  tripDateRange,
  type Trip,
  type TripLeg,
} from "@/lib/trip-schema";
import { seasonHintFromFlexMonth } from "@/lib/trip-duration";

type Activity = { id: number; name: string; category: string; description: string; emoji: string };
type Traveler = {
  id: string | null;
  name: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  hotel: string;
  activities: Activity[];
  // PHI-99: flex-mode duration. Populated by welcome step 1 when the
  // traveller is still in exploring mode (no committed dates). The
  // dashboard date-lock nudge gates on `flexMonth && !departureDate`.
  flexMonth?: string | null;
  flexNights?: number | null;
};

type AccountTraveler = {
  id: string;
  name: string | null;
  email: string | null;
  legs: TripLeg[] | null;
  is_primary: boolean | null;
  claimed_at: string | null;
  created_at: string | null;
  activities: Activity[] | null;
};

function formatDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function nightCount(dep: string, ret: string) {
  if (!dep || !ret) return 0;
  return Math.round((new Date(ret).getTime() - new Date(dep).getTime()) / 86400000);
}

// PHI-99 — tomorrow as `YYYY-MM-DD` for the `min` attribute on the nudge
// date inputs. Mirrors welcome page semantics so a user can't pick a past
// date by accident.
function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// PHI-99 — fire-and-forget telemetry. Routed through the same activity-
// feedback endpoint other onboarding events use. Build-readiness only;
// the signal isn't acted on until real traffic exists.
function logDashboardEvent(event: string, extra?: Record<string, unknown>) {
  fetch("/api/activity-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, ...(extra ?? {}) }),
    keepalive: true,
  }).catch(() => {});
}

// PHI-60: convert an account row's legs[] into the flat shape the rest
// of the app reads from localStorage. Single-trip readers stay on the
// existing path; multi-trip switching writes the chosen row through
// here so the dashboard, itinerary, and other pages all stay consistent.
function accountToTraveler(t: AccountTraveler): Traveler {
  const trip: Trip = {
    legs: t.legs ?? [],
    departureDate: null,
    returnDate: null,
  };
  const range = tripDateRange(trip);
  const leg = firstLeg(trip);
  return {
    id: t.id,
    name: t.name ?? "",
    destination: leg?.place?.name ?? "",
    departureDate: range.departure ?? "",
    returnDate: range.return ?? "",
    hotel: leg?.hotel ?? "",
    activities: Array.isArray(t.activities) ? t.activities : [],
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const [traveler, setTraveler] = useState<Traveler | null>(null);
  const [accountTrips, setAccountTrips] = useState<AccountTraveler[]>([]);
  const [switching, setSwitching] = useState(false);

  // PHI-99: date-lock nudge state. Banner only renders for flex-mode
  // travellers. Three pieces of state:
  //   - `nudgeOpen`: the inline date picker is expanded
  //   - `nudgeDismissed`: this session, user hit ×
  //   - `nudgeDates`: locally controlled inputs for the inline form
  //   - `nudgeSaving`: PATCH in flight
  //   - `nudgeError`: server error message to show below the form
  // The shown-once-per-session guard uses a ref so re-renders don't
  // re-fire telemetry on every state change.
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [nudgeStart, setNudgeStart] = useState("");
  const [nudgeEnd, setNudgeEnd] = useState("");
  const [nudgeSaving, setNudgeSaving] = useState(false);
  const [nudgeError, setNudgeError] = useState<string | null>(null);
  const nudgeShownLoggedRef = useRef(false);

  useEffect(() => {
    const raw = localStorage.getItem("rise_traveler");
    if (!raw) {
      router.replace("/welcome");
      return;
    }
    try {
      setTraveler(JSON.parse(raw));
    } catch {
      router.replace("/welcome");
    }
  }, [router]);

  // PHI-99: hydrate the session-dismissal flag so the × is sticky for the
  // rest of the tab session but not across sessions.
  useEffect(() => {
    if (!traveler?.id) return;
    if (typeof window === "undefined") return;
    const flag = sessionStorage.getItem(`rise_dates_nudge_dismissed_${traveler.id}`);
    if (flag === "1") setNudgeDismissed(true);
  }, [traveler?.id]);

  // PHI-60: fetch the user's saved trips so we can offer a switcher when
  // there's more than one. 401s are silent — anonymous users keep the
  // legacy single-trip view.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/travelers/list", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && Array.isArray(json.travelers)) {
          setAccountTrips(json.travelers as AccountTraveler[]);
        }
      } catch {
        // Network or auth failure — non-fatal, dashboard still renders
        // from localStorage.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!traveler) {
    return (
      <main className="min-h-screen bg-[#f8f6f1] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin" />
      </main>
    );
  }

  const nights = nightCount(traveler.departureDate, traveler.returnDate);
  const hasSwitcher = accountTrips.length > 1;

  // PHI-99: the date-lock nudge gates on (a) traveller in flex mode AND
  // (b) not dismissed for this tab session AND (c) at most once per
  // dashboard mount (ref guard handles the latter). Always renders on a
  // fresh session.
  const isFlexMode =
    !!traveler.flexMonth &&
    !traveler.departureDate &&
    typeof traveler.flexNights === "number" &&
    traveler.flexNights >= 1;
  const showNudge = isFlexMode && !nudgeDismissed;
  if (showNudge && !nudgeShownLoggedRef.current) {
    nudgeShownLoggedRef.current = true;
    logDashboardEvent("dashboard_date_nudge_shown", {
      travelerId: traveler.id,
      flexMonth: traveler.flexMonth,
      flexNights: traveler.flexNights,
    });
  }

  async function handleDismissNudge() {
    if (!traveler?.id) return;
    setNudgeDismissed(true);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(`rise_dates_nudge_dismissed_${traveler.id}`, "1");
    }
    logDashboardEvent("dashboard_date_nudge_dismissed", { travelerId: traveler.id });
  }

  async function handleSaveDates() {
    if (!traveler?.id) return;
    if (!nudgeStart || !nudgeEnd) {
      setNudgeError("Both dates are required.");
      return;
    }
    if (nudgeEnd < nudgeStart) {
      setNudgeError("Return date must be on or after departure.");
      return;
    }
    setNudgeSaving(true);
    setNudgeError(null);
    try {
      // PATCH carries explicit nulls on the flex pair so the row never
      // ends up holding both a date range AND flex columns. The legs
      // JSONB acquires startDate/endDate via the existing trip-shape path.
      const res = await fetch("/api/travelers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: traveler.id,
          departureDate: nudgeStart,
          returnDate: nudgeEnd,
          flexMonth: null,
          flexNights: null,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        setNudgeError(err?.error ?? "Couldn't save. Try again.");
        setNudgeSaving(false);
        return;
      }
      // Mirror to localStorage so the rest of the app sees the new dates
      // without a server round-trip. Keep the cached itinerary in place
      // — /itinerary will relabel headers from "Day 1" to "Mon 5 Oct" on
      // next render (hard constraint: do not regenerate).
      const updated: Traveler = {
        ...traveler,
        departureDate: nudgeStart,
        returnDate: nudgeEnd,
        flexMonth: null,
        flexNights: null,
      };
      localStorage.setItem("rise_traveler", JSON.stringify(updated));
      setTraveler(updated);
      setNudgeOpen(false);
      setNudgeSaving(false);
      logDashboardEvent("dashboard_date_nudge_acted", {
        travelerId: traveler.id,
        start: nudgeStart,
        end: nudgeEnd,
      });
    } catch {
      setNudgeError("Network error. Try again.");
      setNudgeSaving(false);
    }
  }

  async function handleSwitch(newId: string) {
    if (newId === traveler?.id || switching) return;
    const next = accountTrips.find((t) => t.id === newId);
    if (!next) return;
    setSwitching(true);
    try {
      // Promote the selected trip to is_primary=true; demote the rest.
      // Idempotent — safe to retry.
      await fetch("/api/travelers/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "use_saved",
          accountTravelerId: newId,
        }),
      });
      const snapshot = accountToTraveler(next);
      localStorage.setItem("rise_traveler", JSON.stringify(snapshot));
      localStorage.setItem("rise_onboarded", "true");
      // Drop trip-scoped caches so /itinerary doesn't render the previous
      // trip's days under the new trip's header while Supabase loads.
      localStorage.removeItem("rise_itinerary");
      localStorage.removeItem("rise_itinerary_placement_notes");
      localStorage.removeItem("rise_bad_day_dates");
      // Other pages cache their own derivations of rise_traveler in
      // memory; reloading ensures they all see the new selection.
      window.location.reload();
    } catch (e) {
      console.error("[dashboard] switch failed:", e);
      setSwitching(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f8f6f1] px-6 py-14">
      <div className="max-w-2xl mx-auto">

        {hasSwitcher && (
          <div className="mb-6 flex items-center gap-3">
            <label
              htmlFor="trip-switcher"
              className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest"
            >
              Trip
            </label>
            <select
              id="trip-switcher"
              value={traveler.id ?? ""}
              onChange={(e) => handleSwitch(e.target.value)}
              disabled={switching}
              className="flex-1 bg-white border border-[#e8e4de] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:border-[#1a6b7f] outline-none disabled:opacity-50"
            >
              {accountTrips.map((t) => {
                const trip: Trip = {
                  legs: t.legs ?? [],
                  departureDate: null,
                  returnDate: null,
                };
                const range = tripDateRange(trip);
                const label = primaryDestinationName(trip) || "Untitled trip";
                const dates =
                  range.departure && range.return
                    ? ` · ${formatDate(range.departure)} → ${formatDate(range.return)}`
                    : "";
                return (
                  <option key={t.id} value={t.id}>
                    {label}
                    {dates}
                    {t.is_primary ? "  (primary)" : ""}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {/* Header */}
        <div className="mb-12">
          <p className="text-[#1a6b7f] text-sm font-semibold tracking-widest uppercase mb-3">Your trip</p>
          <h1 className="text-5xl font-extrabold tracking-tight mb-2">{traveler.destination}</h1>
          <p className="text-[var(--text-secondary)] text-lg">Hey {traveler.name}, here&apos;s what we&apos;ve got planned.</p>
        </div>

        {/* PHI-99 — Date-lock nudge for flex-mode travellers. Sits directly
            above the trip summary card. Single-row clickable banner with a
            small × dismiss button on the right; clicking the row expands
            an inline two-date picker + Save. Dismissal is session-scoped
            (sessionStorage). The banner is hidden once the traveller has
            locked in real dates. */}
        {showNudge && (
          <div
            data-testid="dashboard-date-nudge"
            className="mb-6 bg-[#fef3e2]/40 text-[#1a6b7f] rounded-2xl border border-[#f4d49e]"
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <button
                type="button"
                onClick={() => setNudgeOpen((open) => !open)}
                className="flex-1 text-left text-sm sm:text-base font-semibold hover:text-[var(--text-primary)] transition-colors"
                data-testid="dashboard-date-nudge-toggle"
              >
                Got your dates yet? Lock them in to sharpen your plan &rarr;
              </button>
              <button
                type="button"
                onClick={handleDismissNudge}
                aria-label="Dismiss"
                data-testid="dashboard-date-nudge-dismiss"
                className="w-7 h-7 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/50 transition-colors flex items-center justify-center text-base flex-shrink-0"
              >
                &times;
              </button>
            </div>
            {nudgeOpen && (
              <div className="border-t border-[#f4d49e] px-5 py-4 flex flex-col gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest">
                    Departure
                    <input
                      type="date"
                      value={nudgeStart}
                      min={tomorrowISO()}
                      onChange={(e) => setNudgeStart(e.target.value)}
                      data-testid="dashboard-date-nudge-start"
                      className="bg-white border border-[#d4cfc5] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[#1a6b7f] outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest">
                    Return
                    <input
                      type="date"
                      value={nudgeEnd}
                      min={nudgeStart || tomorrowISO()}
                      onChange={(e) => setNudgeEnd(e.target.value)}
                      data-testid="dashboard-date-nudge-end"
                      className="bg-white border border-[#d4cfc5] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[#1a6b7f] outline-none"
                    />
                  </label>
                </div>
                {nudgeError && (
                  <p className="text-xs text-red-600">{nudgeError}</p>
                )}
                <button
                  type="button"
                  onClick={handleSaveDates}
                  disabled={nudgeSaving || !nudgeStart || !nudgeEnd}
                  data-testid="dashboard-date-nudge-save"
                  className="self-start px-4 py-2 rounded-xl bg-[#1a6b7f] text-white text-sm font-bold hover:bg-[#155a6b] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {nudgeSaving ? "Saving…" : "Save dates"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Trip summary card */}
        <div className="bg-white border border-[#e8e4de] rounded-2xl p-7 mb-6">
          <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-5">Trip details</h2>
          <div className="grid grid-cols-2 gap-y-5">
            {isFlexMode ? (
              <>
                {/* PHI-99 — flex-mode card. The month string is the only
                    date-like artefact rendered (hard constraint: never
                    render a fabricated specific date). */}
                <div>
                  <p className="text-xs text-[var(--text-secondary)] mb-1">Month</p>
                  <p
                    data-testid="dashboard-flex-month"
                    className="font-bold text-[var(--text-primary)]"
                  >
                    {(traveler.flexMonth && seasonHintFromFlexMonth(traveler.flexMonth)) ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)] mb-1">Nights</p>
                  <p
                    data-testid="dashboard-flex-nights"
                    className="font-bold text-[var(--text-primary)]"
                  >
                    {traveler.flexNights ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)] mb-1">Dates</p>
                  <p className="font-bold text-[var(--text-muted)]">Not yet</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)] mb-1">Hotel</p>
                  <p className="font-bold text-[var(--text-primary)]">{traveler.hotel || "—"}</p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-xs text-[var(--text-secondary)] mb-1">Departure</p>
                  <p className="font-bold text-[var(--text-primary)]">{formatDate(traveler.departureDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)] mb-1">Return</p>
                  <p className="font-bold text-[var(--text-primary)]">{formatDate(traveler.returnDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)] mb-1">Duration</p>
                  <p className="font-bold text-[var(--text-primary)]">{nights > 0 ? `${nights} nights` : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)] mb-1">Hotel</p>
                  <p className="font-bold text-[var(--text-primary)]">{traveler.hotel || "—"}</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Activities */}
        {traveler.activities.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-4">
              Your activities · {traveler.activities.length} selected
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {traveler.activities.map((a) => (
                <div key={a.id} className="bg-white border border-[#e8e4de] rounded-2xl p-4">
                  <div className="text-2xl mb-2">{a.emoji}</div>
                  <div className="font-semibold text-sm text-[var(--text-primary)] mb-1">{a.name}</div>
                  <div className="text-xs text-[var(--text-muted)]">{a.category}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick links */}
        <div className="bg-white border border-[#e8e4de] rounded-2xl p-6">
          <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-5">Explore more</h2>
          <div className="flex flex-col gap-3">
            <a
              href="/itinerary"
              className="flex items-center justify-between rounded-xl bg-[#1a6b7f]/10 border border-[#1a6b7f]/30 px-5 py-4 hover:bg-[#1a6b7f]/20 transition-colors group"
            >
              <div>
                <div className="font-semibold text-[var(--text-primary)]">Day-by-day itinerary</div>
                <div className="text-xs text-[#1a6b7f]/70 mt-0.5">AI-planned · drag to reschedule</div>
              </div>
              <span className="text-[#1a6b7f] group-hover:text-[var(--text-primary)] transition-colors">→</span>
            </a>
            <a
              href="/profile"
              className="flex items-center justify-between rounded-xl bg-[#f0ede8] px-5 py-4 hover:bg-[#e8e4de] transition-colors group"
            >
              <div>
                <div className="font-semibold text-[var(--text-primary)]">Restaurant recommendations</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">AI picks based on your taste</div>
              </div>
              <span className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors">→</span>
            </a>
            <a
              href="/transport"
              className="flex items-center justify-between rounded-xl bg-[#f0ede8] px-5 py-4 hover:bg-[#e8e4de] transition-colors group"
            >
              <div>
                <div className="font-semibold text-[var(--text-primary)]">Airport → Hotel</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">Compare transport options</div>
              </div>
              <span className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors">→</span>
            </a>
            <a
              href={`/guides/${encodeURIComponent(traveler.destination.toLowerCase())}`}
              className="flex items-center justify-between rounded-xl bg-[#f0ede8] px-5 py-4 hover:bg-[#e8e4de] transition-colors group"
            >
              <div>
                <div className="font-semibold text-[var(--text-primary)]">Local guides</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">Insider tips for {traveler.destination}</div>
              </div>
              <span className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors">→</span>
            </a>
          </div>
        </div>

        <div className="mt-8 text-center">
          <button
            onClick={() => {
              localStorage.removeItem("rise_onboarded");
              localStorage.removeItem("rise_traveler");
              router.push("/welcome");
            }}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Plan a new trip
          </button>
        </div>

      </div>
    </main>
  );
}
