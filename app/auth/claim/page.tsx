"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  firstLeg,
  primaryDestinationName,
  primaryHotel,
  tripDateRange,
  type Trip,
  type TripLeg,
} from "@/lib/trip-schema";

type LocalTraveler = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  destination?: string;
  departureDate?: string;
  returnDate?: string;
  hotel?: string | null;
  travelCompany?: string | null;
  travelerCount?: number | null;
  childrenAges?: string[] | null;
  travelerTypes?: string[] | null;
  budgetTier?: string | null;
  constraintTags?: string[] | null;
  constraintText?: string | null;
  activities?: unknown[];
  legs?: TripLeg[];
};

type AccountTraveler = {
  id: string;
  name: string | null;
  email: string | null;
  legs: TripLeg[] | null;
  is_primary: boolean | null;
  claimed_at: string | null;
  created_at: string | null;
};

type ClaimAction = "keep_local" | "use_saved" | "save_both";

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return "Dates not set";
  if (start && !end) return formatDate(start);
  if (!start && end) return formatDate(end);
  return `${formatDate(start)} → ${formatDate(end)}`;
}

function describeAccountTrip(t: AccountTraveler) {
  const trip: Trip = {
    legs: t.legs ?? [],
    departureDate: null,
    returnDate: null,
  };
  const range = tripDateRange(trip);
  return {
    title: primaryDestinationName(trip) || "Untitled trip",
    dates: formatDateRange(range.departure, range.return),
    hotel: primaryHotel(trip),
  };
}

function describeLocalTrip(t: LocalTraveler) {
  // Prefer leg-aware data when present; fall back to the legacy flat
  // fields the welcome wizard still writes.
  if (Array.isArray(t.legs) && t.legs.length > 0) {
    const trip: Trip = {
      legs: t.legs,
      departureDate: t.departureDate ?? null,
      returnDate: t.returnDate ?? null,
    };
    const range = tripDateRange(trip);
    return {
      title: primaryDestinationName(trip) || t.destination || "Untitled trip",
      dates: formatDateRange(range.departure, range.return),
      hotel: firstLeg(trip)?.hotel ?? t.hotel ?? null,
    };
  }
  return {
    title: t.destination || "Untitled trip",
    dates: formatDateRange(t.departureDate ?? null, t.returnDate ?? null),
    hotel: t.hotel ?? null,
  };
}

function ClaimInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<ClaimAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalTraveler | null>(null);
  const [accountTrips, setAccountTrips] = useState<AccountTraveler[]>([]);

  // Read once on mount. We intentionally don't react to localStorage
  // changes mid-flow — the snapshot we read at the start is the trip
  // the user came in with.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let parsedLocal: LocalTraveler | null = null;
      try {
        const raw = localStorage.getItem("rise_traveler");
        if (raw) parsedLocal = JSON.parse(raw) as LocalTraveler;
      } catch {
        parsedLocal = null;
      }

      let trips: AccountTraveler[] = [];
      try {
        const res = await fetch("/api/travelers/list", { cache: "no-store" });
        if (res.status === 401) {
          if (!cancelled) router.replace("/signin");
          return;
        }
        if (res.ok) {
          const json = await res.json();
          trips = Array.isArray(json.travelers) ? json.travelers : [];
        }
      } catch (e) {
        console.error("[claim] list failed:", e);
      }

      if (cancelled) return;

      // Short-circuit: if there's no genuine conflict, just go.
      const localId = parsedLocal?.id ?? null;
      const otherAccountTrips = localId
        ? trips.filter((t) => t.id !== localId)
        : trips;

      const hasLocal = !!parsedLocal && !!parsedLocal.destination;
      const hasOther = otherAccountTrips.length > 0;

      // No localStorage trip and at most one account trip → nothing to
      // resolve. Fall through to the next destination, ensuring the
      // single account trip is marked primary if it isn't already.
      if (!hasLocal) {
        if (trips.length === 0) {
          // Brand new account with no trip yet — back to /welcome.
          router.replace("/welcome");
          return;
        }
        // Pick the most relevant trip (already ordered by primary then
        // claimed_at on the server) and write it to localStorage so the
        // dashboard renders without a fetch.
        await ensurePrimary(trips[0].id);
        await writeLocalFromAccount(trips[0]);
        router.replace(next);
        return;
      }

      // Local trip exists. If the account has no other trip, claim
      // local silently — no conflict.
      if (!hasOther) {
        const res = await fetch("/api/travelers/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "keep_local",
            localTravelerId: parsedLocal!.id ?? null,
            localTrip: parsedLocal,
          }),
        });
        if (!res.ok) {
          // If silent claim fails, fall through to the dialog so the
          // user can retry rather than landing on a broken dashboard.
          if (!cancelled) {
            setLocal(parsedLocal);
            setAccountTrips(trips);
            setError("Couldn't save your trip. Try again?");
            setLoading(false);
          }
          return;
        }
        router.replace(next);
        return;
      }

      // Genuine conflict. Show the dialog.
      if (!cancelled) {
        setLocal(parsedLocal);
        setAccountTrips(otherAccountTrips);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, next]);

  const accountChoice = useMemo(
    () => (accountTrips.length > 0 ? accountTrips[0] : null),
    [accountTrips]
  );

  async function ensurePrimary(id: string) {
    try {
      await fetch("/api/travelers/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "use_saved", accountTravelerId: id }),
      });
    } catch {
      // Best-effort — the dashboard tie-breaks on claimed_at when the
      // primary flag isn't set on any row.
    }
  }

  async function writeLocalFromAccount(t: AccountTraveler) {
    const trip: Trip = {
      legs: t.legs ?? [],
      departureDate: null,
      returnDate: null,
    };
    const range = tripDateRange(trip);
    const leg = firstLeg(trip);
    const snapshot = {
      id: t.id,
      name: t.name ?? "",
      email: t.email ?? "",
      destination: leg?.place?.name ?? "",
      departureDate: range.departure ?? "",
      returnDate: range.return ?? "",
      hotel: leg?.hotel ?? null,
      travelCompany: null,
      travelerCount: null,
      childrenAges: null,
      travelerTypes: [],
      budgetTier: null,
      constraintTags: null,
      constraintText: null,
      activities: [],
      legs: t.legs ?? undefined,
    };
    try {
      localStorage.setItem("rise_traveler", JSON.stringify(snapshot));
      localStorage.setItem("rise_onboarded", "true");
    } catch {
      // Storage quota or private mode — dashboard will fetch from the
      // API in that case.
    }
  }

  async function commit(action: ClaimAction) {
    if (acting) return;
    setActing(action);
    setError(null);
    try {
      const body: Record<string, unknown> = { action };
      if (action === "use_saved") {
        if (!accountChoice) {
          setError("Couldn't save your trip. Try again?");
          setActing(null);
          return;
        }
        body.accountTravelerId = accountChoice.id;
      } else {
        body.localTravelerId = local?.id ?? null;
        body.localTrip = local;
      }
      const res = await fetch("/api/travelers/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError("Couldn't save your trip. Try again?");
        setActing(null);
        return;
      }
      // Only mutate localStorage AFTER we know the chosen trip is in
      // the DB — that way a refresh during the request doesn't lose
      // the local trip.
      if (action === "use_saved" && accountChoice) {
        await writeLocalFromAccount(accountChoice);
      }
      // For keep_local + save_both the existing localStorage snapshot
      // already reflects the chosen trip.
      router.replace(next);
    } catch (e) {
      console.error("[claim] commit failed:", e);
      setError("Couldn't save your trip. Try again?");
      setActing(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f8f6f1] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin" />
      </main>
    );
  }

  const localView = local ? describeLocalTrip(local) : null;
  const accountView = accountChoice ? describeAccountTrip(accountChoice) : null;

  return (
    <main className="min-h-screen bg-[#f8f6f1] sm:flex sm:items-center sm:justify-center">
      <div className="min-h-screen w-full bg-white sm:min-h-0 sm:w-full sm:max-w-md sm:rounded-2xl sm:border sm:border-[#e8e4de] sm:shadow-xl">
        <div className="px-6 py-10 sm:px-8 sm:py-10">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--text-primary)] mb-2">
            You have a trip in progress.
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mb-7">
            We found another saved trip on your account. Which one would you
            like to use?
          </p>

          <div className="flex flex-col gap-3">
            {localView && (
              <button
                onClick={() => commit("keep_local")}
                disabled={!!acting}
                className="w-full text-left rounded-2xl border border-[#1a6b7f] bg-[#1a6b7f]/5 px-5 py-4 hover:bg-[#1a6b7f]/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="text-xs font-semibold text-[#1a6b7f] uppercase tracking-widest mb-1">
                  Keep this trip
                </div>
                <div className="font-bold text-[var(--text-primary)]">
                  {localView.title}
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {localView.dates}
                  {localView.hotel ? ` · ${localView.hotel}` : ""}
                </div>
                {acting === "keep_local" && (
                  <div className="text-xs text-[#1a6b7f] mt-2">Saving…</div>
                )}
              </button>
            )}

            {accountView && (
              <button
                onClick={() => commit("use_saved")}
                disabled={!!acting}
                className="w-full text-left rounded-2xl border border-[#e8e4de] bg-white px-5 py-4 hover:bg-[#f0ede8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-1">
                  Use saved trip
                </div>
                <div className="font-bold text-[var(--text-primary)]">
                  {accountView.title}
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {accountView.dates}
                  {accountView.hotel ? ` · ${accountView.hotel}` : ""}
                </div>
                {acting === "use_saved" && (
                  <div className="text-xs text-[#1a6b7f] mt-2">Saving…</div>
                )}
              </button>
            )}

            {localView && accountView && (
              <button
                onClick={() => commit("save_both")}
                disabled={!!acting}
                className="w-full text-left rounded-2xl border border-[#e8e4de] bg-white px-5 py-4 hover:bg-[#f0ede8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-1">
                  Save both
                </div>
                <div className="text-sm text-[var(--text-secondary)]">
                  Keep both trips — you can switch from the dashboard.
                </div>
                {acting === "save_both" && (
                  <div className="text-xs text-[#1a6b7f] mt-2">Saving…</div>
                )}
              </button>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between"
            >
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                className="text-xs font-semibold text-red-700 hover:underline ml-3 shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ClaimPage() {
  return (
    <Suspense fallback={null}>
      <ClaimInner />
    </Suspense>
  );
}
