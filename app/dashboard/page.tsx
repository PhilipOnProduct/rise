"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  firstLeg,
  primaryDestinationName,
  tripDateRange,
  type Trip,
  type TripLeg,
} from "@/lib/trip-schema";

type Activity = { id: number; name: string; category: string; description: string; emoji: string };
type Traveler = {
  id: string | null;
  name: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  hotel: string;
  activities: Activity[];
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

        {/* Trip summary card */}
        <div className="bg-white border border-[#e8e4de] rounded-2xl p-7 mb-6">
          <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-5">Trip details</h2>
          <div className="grid grid-cols-2 gap-y-5">
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
