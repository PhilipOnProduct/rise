"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Activity,
  ActivityCategory,
  Itinerary,
  ItineraryDay,
  TimeBlock,
} from "@/types/itinerary";
import { DaySectionSkeleton } from "./DaySection";
import { DayTimeline } from "./DayTimeline";
import { ItineraryHeader } from "./ItineraryHeader";
import { TripShapeBar } from "./TripShapeBar";
import { UndoToast } from "./UndoToast";
import { NAV_HEIGHT_PX, UNDO_TIMEOUT_MS } from "./itinerary-constants";
import {
  dayAnchorId,
  mapRawDays,
  skeletonDayDate,
  sortActivities,
  tripDayCount,
} from "./itinerary-helpers";
import type {
  ItineraryItem,
  RawDay,
  RawItem,
  StoredTraveler,
  TravelConnector,
  UndoEntry,
} from "./itinerary-types";

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ItineraryViewPage() {
  const router = useRouter();
  const [days, setDays] = useState<ItineraryDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [hotel, setHotel] = useState("");
  // PHI-99: flex-mode duration. Populated only when the traveller has not
  // (yet) committed to dates. Used as a fallback for the skeleton day
  // count when departureDate is empty so the loading shell still reflects
  // the right number of cards.
  const [flexNights, setFlexNights] = useState<number | null>(null);
  // PHI-37: leg metadata for the trip — populated from the StoredTraveler
  // snapshot. Empty for single-leg trips, in which case the page renders
  // the day list flat (existing behaviour).
  const [legs, setLegs] = useState<NonNullable<StoredTraveler["legs"]>>([]);
  // PHI-53: trip-date forecast result. null = forecast unavailable
  // (fail-open: render alternatives universally for outdoor activities).
  // [] = forecast available, no bad days. ["YYYY-MM-DD", ...] = these
  // days meet the rain threshold and outdoor activities should surface
  // their alternative inline.
  const [badDayDates, setBadDayDates] = useState<string[] | null>(null);
  // PHI-90: top-level "placement_notes" from /api/itinerary/generate when
  // an anchor was filtered out (wrong-city) or couldn't be fitted. null =
  // nothing to surface. Persisted to localStorage so the callout survives a
  // reload alongside the cached itinerary.
  const [placementNotes, setPlacementNotes] = useState<string | null>(null);
  // PHI-114: top-level "time_sensitive_alerts" — one-sentence facts the
  // traveller must verify or act on (closures, pre-booking, seasonal
  // cutoffs, peak-time advice, transport quirks). Rendered as a "Before
  // you go" amber block ABOVE the placement_notes callout. Persisted as
  // JSON-encoded string[] in localStorage so the alerts survive a reload
  // alongside the cached itinerary. Null = nothing actionable to flag.
  const [timeSensitiveAlerts, setTimeSensitiveAlerts] = useState<string[] | null>(null);
  const [swappingId, setSwappingId] = useState<string | null>(null);
  const [swapErrorId, setSwapErrorId] = useState<string | null>(null);
  const [swapSuggestion, setSwapSuggestion] = useState<{
    activityId: string;
    dayNumber: number;
    item: RawItem;
    conflict: string | null;
  } | null>(null);
  const rejectedTitlesRef = useRef<string[]>([]);

  // ── Undo state ──────────────────────────────────────────────────────────
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null);

  // ── Add suggestion state ────────────────────────────────────────────────
  const [addingSuggestion, setAddingSuggestion] = useState(false);
  const [addingDayNumber, setAddingDayNumber] = useState<number | null>(null);
  const [addingBlock, setAddingBlock] = useState<TimeBlock | null>(null);
  const [blockSuggestion, setBlockSuggestion] = useState<{
    dayNumber: number;
    block: TimeBlock;
    item: RawItem;
    conflict: string | null;
  } | null>(null);
  const addRejectedRef = useRef<string[]>([]);

  // ── Travel connector state ─────────────────────────────────────────────
  const [connectors, setConnectors] = useState<TravelConnector[]>([]);
  const [computingTravel, setComputingTravel] = useState(false);
  const [travelError, setTravelError] = useState<string | null>(null);

  // ── Active day tracking (IntersectionObserver) ──────────────────────────
  const [activeDayNumber, setActiveDayNumber] = useState<number | null>(null);

  const [swapError, setSwapError] = useState<string | null>(null);

  // ── Regenerate state ────────────────────────────────────────────────────
  const [regenerating, setRegenerating] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

  const shapeBarRef = useRef<HTMLDivElement | null>(null);
  const travelerRef = useRef<StoredTraveler | null>(null);

  // ── Load itinerary ───────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    /**
     * Follow-up #3 — anon-session fallback.
     *
     * If the user has signed up, rise_traveler is in localStorage and we
     * use it directly. If they haven't (returning anon visitor inside the
     * 14-day TTL window from PHI-31), fall back to /api/anonymous-session.
     * The anon row shape carries the same fields we need; we synthesise a
     * StoredTraveler from it so the rest of this page works unchanged.
     *
     * Only redirect to /welcome if both paths are empty — that's a true
     * "no trip in progress" state.
     */
    async function resolveTraveler(): Promise<StoredTraveler | null> {
      const raw = localStorage.getItem("rise_traveler");
      if (raw) {
        try {
          return JSON.parse(raw) as StoredTraveler;
        } catch {
          // fall through to anon session
        }
      }
      try {
        const res = await fetch("/api/anonymous-session");
        if (res.status === 204) return null;
        if (!res.ok) return null;
        const row = (await res.json()) as Record<string, unknown>;
        // Extract trip context from legs JSONB if present, else fall back
        // to the (deprecated but still on the row) flat fields.
        const legs = (row.legs as Array<Record<string, unknown>>) ?? [];
        const leg0 = legs[0] ?? {};
        const place =
          ((leg0 as Record<string, unknown>).place as Record<string, unknown>) ?? {};
        const synthesised: StoredTraveler = {
          id: null, // unsigned-up — no traveler row yet
          name: "",
          email: "",
          destination: (place.name as string) ?? (row.destination as string) ?? "",
          departureDate:
            (leg0 as Record<string, unknown>).startDate as string ??
            (row.departure_date as string) ??
            "",
          returnDate:
            (leg0 as Record<string, unknown>).endDate as string ??
            (row.return_date as string) ??
            "",
          hotel:
            ((leg0 as Record<string, unknown>).hotel as string) ??
            (row.hotel as string) ??
            "",
          travelCompany: (row.travel_company as string) ?? "",
          travelerTypes: (row.style_tags as string[]) ?? [],
          travelerCount: (row.traveler_count as number) ?? null,
          childrenAges: (row.children_ages as string[]) ?? null,
          activities: [],
        };
        return synthesised;
      } catch {
        return null;
      }
    }

    // A cached/stored itinerary is only valid if its first day's date
    // matches the current trip's departure date. Otherwise the days come
    // from a previous trip (e.g. an Amsterdam itinerary lingering when the
    // user has just created a Málaga trip) and rendering them would show
    // wrong-destination content under the new trip's header. Returning
    // false here also prevents the stale days from being written into
    // Supabase under the new traveler_id by the cache-rehydration path.
    //
    // PHI-99 — flex mode: a flex trip's cached days have date: "". The
    // match passes when the cached first-day's date is empty, even if
    // the traveller has since locked in real dates via the dashboard
    // date-lock nudge (the PRD requires the cache to survive that
    // transition and the headers to be relabelled in place). Trip
    // switching (PHI-60) explicitly clears `rise_itinerary` so empty-
    // date cache from trip A can't bleed into trip B.
    function itineraryMatchesTrip(days: unknown, departureDate: string): boolean {
      if (!Array.isArray(days) || days.length === 0) return false;
      const firstDate = (days[0] as { date?: unknown })?.date;
      if (typeof firstDate !== "string") return false;
      if (firstDate === "") return true; // flex-shape cache — survive flex→exact transition
      if (!departureDate) return false;
      return firstDate === departureDate;
    }

    async function load(traveler: StoredTraveler) {
      try {
        // 1. Try Supabase first if we have a traveler ID
        if (traveler.id) {
          const res = await fetch(`/api/itinerary`);
          if (res.ok) {
            const json = await res.json() as { itinerary: Itinerary | null };
            const storedDays = json.itinerary?.days;
            if (storedDays?.length) {
              if (itineraryMatchesTrip(storedDays, traveler.departureDate ?? "")) {
                setDays(storedDays as ItineraryDay[]);
                setLoading(false);
                return;
              }
              // Stored itinerary is from a different trip (cascading
              // pollution from a prior buggy cache rehydration). Fall
              // through to regenerate fresh for this trip.
            }
          }
        }

        // 2. Fall back to localStorage cache
        const cached = localStorage.getItem("rise_itinerary");
        // PHI-53: restore the bad-day forecast cache too. null = fail-open.
        try {
          const cachedBad = localStorage.getItem("rise_bad_day_dates");
          if (cachedBad !== null) {
            setBadDayDates(JSON.parse(cachedBad));
          }
        } catch { /* ignore */ }
        // PHI-90: restore the placement_notes callout if it was persisted on
        // last generate. Plain string in localStorage (not JSON) — keep it
        // simple. Missing key = no callout.
        try {
          const cachedNotes = localStorage.getItem("rise_itinerary_placement_notes");
          if (cachedNotes && cachedNotes.trim().length > 0) {
            setPlacementNotes(cachedNotes);
          }
        } catch { /* ignore */ }
        // PHI-114: restore the "Before you go" alerts on cache hydration so
        // a /itinerary reload (without regenerate) keeps the block visible.
        // JSON-encoded string[]; ignore on parse failure to fail safe.
        try {
          const cachedAlerts = localStorage.getItem("rise_itinerary_time_sensitive_alerts");
          if (cachedAlerts) {
            const parsed = JSON.parse(cachedAlerts);
            if (Array.isArray(parsed)) {
              const cleaned = parsed
                .filter((a): a is string => typeof a === "string")
                .map((a) => a.trim())
                .filter((a) => a.length > 0)
                .slice(0, 4);
              if (cleaned.length > 0) setTimeSensitiveAlerts(cleaned);
            }
          }
        } catch { /* ignore */ }
        if (cached) {
          try {
            const parsed = JSON.parse(cached) as RawDay[];
            if (itineraryMatchesTrip(parsed, traveler.departureDate ?? "")) {
              const mapped = mapRawDays(parsed);
              setDays(mapped);
              // Save to Supabase in background if we have an ID
              if (traveler.id) {
                void saveToSupabase(traveler.destination ?? "", mapped);
              }
              setLoading(false);
              return;
            }
            // Cache is from a previous trip — drop the trip-scoped keys
            // so a Regenerate or re-render doesn't repopulate from them.
            localStorage.removeItem("rise_itinerary");
            localStorage.removeItem("rise_itinerary_placement_notes");
            // PHI-114: alerts are trip-scoped too — wipe alongside notes.
            localStorage.removeItem("rise_itinerary_time_sensitive_alerts");
            localStorage.removeItem("rise_bad_day_dates");
            setPlacementNotes(null);
            setTimeSensitiveAlerts(null);
            setBadDayDates(null);
          } catch { /* ignore invalid cache */ }
        }

        // 3. Generate fresh
        await generate(traveler);
      } catch {
        setError("Couldn't load your itinerary. Please try again.");
        setLoading(false);
      }
    }

    async function generate(t: StoredTraveler) {
      const feedbackRaw = localStorage.getItem("rise_activity_feedback");
      const activityFeedback = feedbackRaw ? (JSON.parse(feedbackRaw) as unknown[]) : [];

      const res = await fetch("/api/itinerary/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: t.destination,
          // PHI-99: dates vs. flex columns. Flex-mode trips have no
          // concrete dates; the route's resolveTripDuration uses the
          // flex pair instead. Mirror the welcome-page payload shape.
          ...(t.flexMonth && t.flexNights
            ? { flexMonth: t.flexMonth, flexNights: t.flexNights }
            : { departureDate: t.departureDate, returnDate: t.returnDate }),
          hotel: t.hotel ?? null,
          // PHI-105: thread rich hotel coords through on regenerate so the
          // anchor-resolution prompt has the same hotel-context signal it
          // had on the welcome-flow first generate. Omitted when the
          // snapshot doesn't carry them (legacy or skipped-hotel) — the
          // prompt falls back to the no-context PHI-103 path.
          ...(t.hotelPlaceId ? { hotelPlaceId: t.hotelPlaceId } : {}),
          ...(typeof t.hotelLat === "number" ? { hotelLat: t.hotelLat } : {}),
          ...(typeof t.hotelLng === "number" ? { hotelLng: t.hotelLng } : {}),
          ...(t.hotelNeighborhood !== undefined && t.hotelNeighborhood !== null
            ? { hotelNeighborhood: t.hotelNeighborhood }
            : {}),
          travelCompany: t.travelCompany ?? "",
          travelerTypes: t.travelerTypes ?? [],
          activityFeedback,
          travelerCount: t.travelerCount ?? null,
          childrenAges: t.childrenAges ?? null,
          // PHI-90: pass through anchors on regenerate. The welcome flow
          // already drove this on first generate; on subsequent generate
          // calls (Regenerate, fresh cache miss after signup) we still need
          // to hand the prompt the must-dos so they don't silently drop.
          ...(Array.isArray(t.userSeededActivities) &&
          t.userSeededActivities.length > 0
            ? { userSeededActivities: t.userSeededActivities }
            : {}),
        }),
      });

      if (!res.ok) {
        setError("Couldn't generate your itinerary. Please try again.");
        setLoading(false);
        return;
      }

      const data = await res.json() as {
        days?: RawDay[];
        bad_day_dates?: string[] | null;
        placement_notes?: string | null;
        time_sensitive_alerts?: string[] | null;
      };
      if (!data.days?.length) {
        setError("Couldn't generate your itinerary. Please try again.");
        setLoading(false);
        return;
      }

      localStorage.setItem("rise_itinerary", JSON.stringify(data.days));
      // PHI-53: bad_day_dates is null when forecast is unavailable (fail-open
      // — show alternatives universally) or an array of "YYYY-MM-DD" strings
      // for the days that meet the rain threshold.
      if (data.bad_day_dates !== undefined) {
        localStorage.setItem(
          "rise_bad_day_dates",
          JSON.stringify(data.bad_day_dates),
        );
        setBadDayDates(data.bad_day_dates);
      }
      // PHI-90: cache the placement_notes string so a reload of /itinerary
      // (without a regenerate) still shows the callout. Clear the key on
      // empty so a fresh clean generate wipes a stale note from the
      // previous run.
      if (
        typeof data.placement_notes === "string" &&
        data.placement_notes.trim().length > 0
      ) {
        localStorage.setItem(
          "rise_itinerary_placement_notes",
          data.placement_notes.trim(),
        );
        setPlacementNotes(data.placement_notes.trim());
      } else {
        localStorage.removeItem("rise_itinerary_placement_notes");
        setPlacementNotes(null);
      }
      // PHI-114: cache time_sensitive_alerts alongside placement_notes so
      // the "Before you go" block survives a reload. Clean + cap at 4
      // client-side; empty/null clears the key so a clean generate wipes
      // stale alerts from the previous run.
      const cleanedAlerts = Array.isArray(data.time_sensitive_alerts)
        ? data.time_sensitive_alerts
            .filter((a): a is string => typeof a === "string")
            .map((a) => a.trim())
            .filter((a) => a.length > 0)
            .slice(0, 4)
        : [];
      if (cleanedAlerts.length > 0) {
        localStorage.setItem(
          "rise_itinerary_time_sensitive_alerts",
          JSON.stringify(cleanedAlerts),
        );
        setTimeSensitiveAlerts(cleanedAlerts);
      } else {
        localStorage.removeItem("rise_itinerary_time_sensitive_alerts");
        setTimeSensitiveAlerts(null);
      }
      const mapped = mapRawDays(data.days);
      setDays(mapped);

      if (t.id) {
        void saveToSupabase(t.destination ?? "", mapped);
      }

      setLoading(false);
    }

    void (async () => {
      const traveler = await resolveTraveler();
      if (cancelled) return;
      if (!traveler || !traveler.destination) {
        router.replace("/welcome");
        return;
      }

      setDestination(traveler.destination ?? "");
      setDepartureDate(traveler.departureDate ?? "");
      setReturnDate(traveler.returnDate ?? "");
      setHotel(traveler.hotel ?? "");
      // PHI-37: hydrate leg metadata for the leg-aware day timeline.
      setLegs(Array.isArray(traveler.legs) ? traveler.legs : []);
      // PHI-99: flex pair drives the skeleton fallback in flex mode.
      setFlexNights(
        typeof traveler.flexNights === "number" && traveler.flexNights >= 1
          ? traveler.flexNights
          : null,
      );
      travelerRef.current = traveler;
      void load(traveler);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // ── Load stored travel connectors ──────────────────────────────────────

  useEffect(() => {
    if (loading || days.length === 0) return;
    const t = travelerRef.current;
    if (!t?.id) return;

    fetch(`/api/itinerary/travel`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.connectors?.length) setConnectors(json.connectors as TravelConnector[]);
      })
      .catch(() => {}); // non-fatal
  }, [loading, days.length]);

  // ── Active day IntersectionObserver ──────────────────────────────────────

  useEffect(() => {
    if (loading || days.length === 0) return;

    const elements = days.map((d) => document.getElementById(dayAnchorId(d.day_number))).filter(Boolean) as HTMLElement[];
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible day section
        let topEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!topEntry || entry.boundingClientRect.top < topEntry.boundingClientRect.top) {
              topEntry = entry;
            }
          }
        }
        if (topEntry) {
          const id = topEntry.target.id; // "day-N"
          const num = parseInt(id.replace("day-", ""), 10);
          if (!isNaN(num)) setActiveDayNumber(num);
        }
      },
      {
        rootMargin: `-${NAV_HEIGHT_PX + 80}px 0px -60% 0px`,
        threshold: 0,
      }
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [loading, days]);

  // ── Scroll to day ────────────────────────────────────────────────────────

  function scrollToDay(dayNumber: number) {
    const el = document.getElementById(dayAnchorId(dayNumber));
    if (!el) return;
    const barHeight = shapeBarRef.current?.getBoundingClientRect().height ?? 72;
    const offset = el.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT_PX - barHeight - 16;
    window.scrollTo({ top: offset, behavior: "smooth" });
  }

  // ── Travel connector compute ────────────────────────────────────────────

  async function handleComputeTravel() {
    const t = travelerRef.current;
    if (!t?.id) return;

    setComputingTravel(true);
    setTravelError(null);

    try {
      const res = await fetch("/api/itinerary/travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setTravelError(err.error ?? "Failed to compute travel times");
        return;
      }

      const data = await res.json() as { connectors: TravelConnector[] };
      setConnectors(data.connectors ?? []);
    } catch {
      setTravelError("Failed to compute travel times");
    } finally {
      setComputingTravel(false);
    }
  }

  function refreshConnectorsAfterEdit(dayNumber: number, activityId: string) {
    const t = travelerRef.current;
    if (!t?.id || connectors.length === 0) return;

    fetch("/api/itinerary/travel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh: { day_number: dayNumber, swapped_activity_id: activityId },
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.connectors) setConnectors(data.connectors as TravelConnector[]);
      })
      .catch(() => {}); // non-fatal
  }

  // ── Scroll margin for day sections (nav + shape bar) ────────────────────

  const [scrollMarginTop, setScrollMarginTop] = useState(NAV_HEIGHT_PX + 72 + 16);

  useEffect(() => {
    if (!shapeBarRef.current) return;
    const observer = new ResizeObserver(() => {
      const barHeight = shapeBarRef.current?.getBoundingClientRect().height ?? 72;
      setScrollMarginTop(NAV_HEIGHT_PX + barHeight + 16);
    });
    observer.observe(shapeBarRef.current);
    return () => observer.disconnect();
  }, []);

  // ── Persist days helper ─────────────────────────────────────────────────

  const persistDays = useCallback((updated: ItineraryDay[]) => {
    localStorage.setItem("rise_itinerary", JSON.stringify(updated));
    const t = travelerRef.current;
    if (t?.id) {
      void saveToSupabase(t.destination ?? "", updated);
    }
  }, []);

  // ── Remove with undo ────────────────────────────────────────────────────

  function handleRemoveActivity(dayNumber: number, activityId: string) {
    // Find the activity before removing
    const day = days.find((d) => d.day_number === dayNumber);
    const activity = day?.activities.find((a) => a.id === activityId);
    if (!activity) return;

    // Clear any existing undo
    if (undoEntry) {
      clearTimeout(undoEntry.timer);
    }

    // Remove from state
    setDays((prev) => {
      const updated = prev.map((d) =>
        d.day_number === dayNumber
          ? { ...d, activities: d.activities.filter((a) => a.id !== activityId) }
          : d
      );
      persistDays(updated);
      return updated;
    });

    // Set undo entry with auto-dismiss timer
    const timer = setTimeout(() => {
      setUndoEntry(null);
    }, UNDO_TIMEOUT_MS);

    setUndoEntry({ dayNumber, activity, timer });
  }

  function handleUndo() {
    if (!undoEntry) return;
    clearTimeout(undoEntry.timer);
    const { dayNumber, activity } = undoEntry;

    setDays((prev) => {
      const updated = prev.map((d) => {
        if (d.day_number !== dayNumber) return d;
        // Re-insert at original sequence position
        const activities = [...d.activities, activity];
        return { ...d, activities: sortActivities(activities) };
      });
      persistDays(updated);
      return updated;
    });

    setUndoEntry(null);
  }

  function dismissUndo() {
    if (!undoEntry) return;
    clearTimeout(undoEntry.timer);
    setUndoEntry(null);
  }

  // ── Swap handlers ──────────────────────────────────────────────────────

  async function handleSwapActivity(dayNumber: number, activityId: string) {
    const day = days.find((d) => d.day_number === dayNumber);
    const activity = day?.activities.find((a) => a.id === activityId);
    if (!day || !activity) return;

    const t = travelerRef.current;
    setSwappingId(activityId);
    setSwapSuggestion(null);
    setSwapErrorId(null);

    try {
      const dayItems = day.activities
        .filter((a) => a.id !== activityId)
        .map((a) => ({ title: a.name, description: a.description, time_block: a.time }));

      const res = await fetch("/api/itinerary/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "swap",
          destination,
          dayNumber,
          date: day.date,
          block: activity.time,
          dayItems,
          replacingItem: { title: activity.name, description: activity.description },
          rejectedTitles: rejectedTitlesRef.current,
          travelCompany: t?.travelCompany ?? null,
          travelerTypes: t?.travelerTypes ?? [],
          budgetTier: t?.budgetTier ?? null,
          travelerCount: t?.travelerCount ?? null,
          childrenAges: t?.childrenAges ?? null,
        }),
      });

      if (!res.ok) {
        setSwappingId(null);
        setSwapErrorId(activityId);
        // Auto-clear error after 3 seconds
        setTimeout(() => setSwapErrorId((prev) => prev === activityId ? null : prev), 3000);
        return;
      }

      const data = await res.json() as {
        item: RawItem;
        conflict: string | null;
      };

      setSwapSuggestion({ activityId, dayNumber, item: data.item, conflict: data.conflict });
    } catch {
      setSwappingId(null);
      setSwapErrorId(activityId);
      setTimeout(() => setSwapErrorId((prev) => prev === activityId ? null : prev), 3000);
    }
  }

  function acceptSwap() {
    if (!swapSuggestion) return;
    const { activityId, dayNumber, item } = swapSuggestion;
    rejectedTitlesRef.current = [];
    setDays((prev) => {
      const updated = prev.map((d) => {
        if (d.day_number !== dayNumber) return d;
        return {
          ...d,
          activities: d.activities.map((a) =>
            a.id === activityId
              ? {
                  id: item.id,
                  name: item.title,
                  description: item.description,
                  time: item.time_block as TimeBlock,
                  sequence: a.sequence,
                  category: item.type as ActivityCategory,
                }
              : a
          ),
        };
      });
      persistDays(updated);
      return updated;
    });
    setSwapSuggestion(null);
    setSwappingId(null);
    refreshConnectorsAfterEdit(dayNumber, item.id);
  }

  function rejectSwap() {
    if (!swapSuggestion) return;
    rejectedTitlesRef.current.push(swapSuggestion.item.title);
    const { dayNumber, activityId } = swapSuggestion;
    setSwapSuggestion(null);
    setSwappingId(null);
    handleSwapActivity(dayNumber, activityId);
  }

  // ── Add suggestion handlers ────────────────────────────────────────────

  async function handleSuggestForBlock(dayNumber: number, block: TimeBlock) {
    const day = days.find((d) => d.day_number === dayNumber);
    if (!day) return;

    const t = travelerRef.current;
    setAddingSuggestion(true);
    setAddingDayNumber(dayNumber);
    setAddingBlock(block);
    setBlockSuggestion(null);

    try {
      const dayItems = day.activities.map((a) => ({
        title: a.name,
        description: a.description,
        time_block: a.time,
      }));

      const res = await fetch("/api/itinerary/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "add",
          destination,
          dayNumber,
          date: day.date,
          block,
          dayItems,
          rejectedTitles: addRejectedRef.current,
          travelCompany: t?.travelCompany ?? null,
          travelerTypes: t?.travelerTypes ?? [],
          budgetTier: t?.budgetTier ?? null,
          travelerCount: t?.travelerCount ?? null,
          childrenAges: t?.childrenAges ?? null,
        }),
      });

      if (!res.ok) {
        setAddingSuggestion(false);
        setAddingBlock(null);
        return;
      }

      const data = await res.json() as { item: RawItem; conflict: string | null };
      setBlockSuggestion({ dayNumber, block, item: data.item, conflict: data.conflict });
      setAddingSuggestion(false);
    } catch {
      setAddingSuggestion(false);
      setAddingBlock(null);
    }
  }

  function acceptAdd() {
    if (!blockSuggestion) return;
    const { dayNumber, item, block } = blockSuggestion;
    addRejectedRef.current = [];
    setDays((prev) => {
      const updated = prev.map((d) => {
        if (d.day_number !== dayNumber) return d;
        const newActivity: Activity = {
          id: item.id,
          name: item.title,
          description: item.description,
          time: block,
          sequence: d.activities.filter((a) => a.time === block).length,
          category: item.type as ActivityCategory,
        };
        return { ...d, activities: [...d.activities, newActivity] };
      });
      persistDays(updated);
      return updated;
    });
    setBlockSuggestion(null);
    setAddingBlock(null);
    setAddingDayNumber(null);
    refreshConnectorsAfterEdit(dayNumber, item.id);
  }

  // Swap restaurant: generate alternative, replace in-place, persist to DB
  async function swapRestaurant(dayIdx: number, item: ItineraryItem) {
    const traveler = travelerRef.current;
    if (!traveler || swappingId) return;
    const day = days[dayIdx];
    setSwappingId(item.id);
    setSwapError(null);

    try {
      const res = await fetch("/api/itinerary/alternative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: traveler.destination,
          departureDate: traveler.departureDate,
          returnDate: traveler.returnDate,
          travelCompany: traveler.travelCompany ?? "",
          travelerTypes: traveler.travelerTypes ?? [],
          budgetTier: traveler.budgetTier ?? "",
          replacingRestaurant: item.title,
          cuisine: item.cuisine,
          vibe: item.vibe,
          timeBlock: item.time_block,
          date: day.date,
          dayNumber: day.day_number,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.alternative) {
        setSwapError("Couldn't find an alternative. Try again?");
        return;
      }

      const alt = data.alternative as ItineraryItem;
      // Preserve the same time_block as the original
      alt.time_block = item.time_block;

      setDays((prev) => {
        const updated = prev.map((d, i) => {
          if (i !== dayIdx) return d;
          return {
            ...d,
            activities: d.activities.map((a) =>
              a.id === item.id
                ? {
                    id: alt.id,
                    name: alt.title,
                    description: alt.description,
                    time: alt.time_block as TimeBlock,
                    sequence: a.sequence,
                    category: alt.type as ActivityCategory,
                  }
                : a
            ),
          };
        });
        persistDays(updated);
        return updated;
      });
    } catch {
      setSwapError("Network error. Try again?");
    } finally {
      setSwappingId(null);
    }
  }

  function rejectAdd() {
    if (!blockSuggestion) return;
    addRejectedRef.current.push(blockSuggestion.item.title);
    const { dayNumber, block } = blockSuggestion;
    setBlockSuggestion(null);
    handleSuggestForBlock(dayNumber, block);
  }

  // PHI-53: track when the user expands a wet-weather alternative card.
  // Logs to activity_feedback.metadata via the existing route's auto-bucket.
  function logWeatherAlternativeEngage(activityId: string, alternativeTitle: string) {
    void fetch("/api/activity-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "weather_alternative_engaged",
        activityId,
        activityName: alternativeTitle,
        activityCategory: "alternative",
      }),
    }).catch(() => {});
  }

  // ── Regenerate handler ──────────────────────────────────────────────────

  async function handleRegenerate() {
    setShowRegenConfirm(false);
    setRegenerating(true);
    setLoading(true);
    setConnectors([]);

    const t = travelerRef.current;
    if (!t) return;

    const feedbackRaw = localStorage.getItem("rise_activity_feedback");
    const activityFeedback = feedbackRaw ? (JSON.parse(feedbackRaw) as unknown[]) : [];

    try {
      const res = await fetch("/api/itinerary/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: t.destination,
          // PHI-99: mirror the load-time generate payload — flex columns
          // when the trip is in flex mode, exact dates otherwise.
          ...(t.flexMonth && t.flexNights
            ? { flexMonth: t.flexMonth, flexNights: t.flexNights }
            : { departureDate: t.departureDate, returnDate: t.returnDate }),
          hotel: t.hotel ?? null,
          // PHI-105: thread rich hotel coords on regenerate too.
          ...(t.hotelPlaceId ? { hotelPlaceId: t.hotelPlaceId } : {}),
          ...(typeof t.hotelLat === "number" ? { hotelLat: t.hotelLat } : {}),
          ...(typeof t.hotelLng === "number" ? { hotelLng: t.hotelLng } : {}),
          ...(t.hotelNeighborhood !== undefined && t.hotelNeighborhood !== null
            ? { hotelNeighborhood: t.hotelNeighborhood }
            : {}),
          travelCompany: t.travelCompany ?? "",
          travelerTypes: t.travelerTypes ?? [],
          activityFeedback,
          travelerCount: t.travelerCount ?? null,
          childrenAges: t.childrenAges ?? null,
          ...(Array.isArray(t.userSeededActivities) &&
          t.userSeededActivities.length > 0
            ? { userSeededActivities: t.userSeededActivities }
            : {}),
        }),
      });

      if (!res.ok) {
        setError("Couldn't regenerate your itinerary. Please try again.");
        setLoading(false);
        setRegenerating(false);
        return;
      }

      const data = await res.json() as { days?: RawDay[] };
      if (!data.days?.length) {
        setError("Couldn't regenerate your itinerary. Please try again.");
        setLoading(false);
        setRegenerating(false);
        return;
      }

      localStorage.setItem("rise_itinerary", JSON.stringify(data.days));
      const mapped = mapRawDays(data.days);
      setDays(mapped);

      if (t.id) {
        void saveToSupabase(t.destination ?? "", mapped);
      }
    } catch {
      setError("Couldn't regenerate your itinerary. Please try again.");
    }

    setLoading(false);
    setRegenerating(false);
  }

  // ── Error state ──────────────────────────────────────────────────────────

  if (error) {
    return (
      <main className="min-h-screen bg-[#f8f6f1] flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-[var(--text-primary)]">{error}</p>
        <button
          onClick={() => {
            setError(null);
            setLoading(true);
            localStorage.removeItem("rise_itinerary");
            router.replace("/itinerary");
          }}
          className="px-6 py-3 rounded-2xl bg-[#1a6b7f] text-white font-bold hover:bg-[#155a6b] transition-colors"
        >
          Try again
        </button>
      </main>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  // PHI-79: number of skeleton day cards to render during loading/regenerate.
  // Derived from the traveler's date range so first load (after traveler
  // hydrates) and Regenerate both keep the page structure visible.
  // PHI-99: flex-mode trips have no concrete date range; fall back to
  // flex_nights so the skeleton still reflects the right card count.
  const skeletonDayCount =
    departureDate && returnDate
      ? tripDayCount(departureDate, returnDate)
      : flexNights ?? 0;

  return (
    <div className="min-h-screen bg-[#f8f6f1]">
      {/* Sticky trip shape bar */}
      <TripShapeBar
        days={days}
        loading={loading}
        skeletonDayCount={skeletonDayCount}
        activeDayNumber={activeDayNumber}
        onDayClick={scrollToDay}
        barRef={shapeBarRef}
      />

      {/* Page content */}
      <main className="max-w-3xl mx-auto px-6">
        {/* Header — render once we have traveler context (destination), so it
            stays visible during first-load and Regenerate (PHI-79). */}
        {(destination || days.length > 0) && (
          <ItineraryHeader
            destination={destination}
            departureDate={departureDate}
            returnDate={returnDate}
            hotel={hotel}
            loading={loading}
            skeletonDayCount={skeletonDayCount}
            days={days}
            regenerating={regenerating}
            showRegenConfirm={showRegenConfirm}
            setShowRegenConfirm={setShowRegenConfirm}
            handleRegenerate={handleRegenerate}
            connectors={connectors}
            computingTravel={computingTravel}
            travelError={travelError}
            handleComputeTravel={handleComputeTravel}
          />
        )}

        {/* Swap error toast */}
        {swapError && (
          <div className="pt-4">
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
              <span>{swapError}</span>
              <button onClick={() => setSwapError(null)} className="text-red-500 hover:text-red-700 ml-3">&times;</button>
            </div>
          </div>
        )}

        {/* Vertical day timeline. PHI-37: when the trip is multi-leg, days
            are grouped under leg headers and transition days are rendered
            without the full day-section chrome. Single-leg trips render
            identically to before. PHI-79: while loading/regenerating, render
            skeleton day cards from the date range so the page keeps its
            structure instead of going blank. */}
        {loading && skeletonDayCount > 0 && (
          <div className="mt-6">
            {Array.from({ length: skeletonDayCount }).map((_, i) => (
              <DaySectionSkeleton
                key={i}
                dayNumber={i + 1}
                date={skeletonDayDate(departureDate, i)}
                scrollMarginTop={scrollMarginTop}
              />
            ))}
          </div>
        )}
        {/* PHI-114: time-sensitive alerts callout — "Before you go" block
            stacked ABOVE the placement_notes note so action-items
            (closures, pre-booking, peak-time advice) lead. Same amber
            palette so it reads as one continuous attention surface above
            Day 1. Null/empty = no block. */}
        {!loading && timeSensitiveAlerts && timeSensitiveAlerts.length > 0 && (
          <div
            data-testid="itinerary-time-sensitive-alerts"
            className="mt-6 rounded-xl border border-[#f4d49e] bg-[#fef3e2] px-4 py-3 text-sm text-[var(--text-primary)]"
          >
            <span className="font-semibold">Before you go</span>
            <ul className="mt-2 space-y-1.5 text-[var(--text-secondary)]">
              {timeSensitiveAlerts.map((alert, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden>⚠</span>
                  <span>{alert}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* PHI-90: placement_notes callout — above Day 1 so the user sees
            it before scrolling into the itinerary. Soft amber styling
            (same palette as other "needs attention" notes). null = no
            callout. Hard constraint: anchors are never silently dropped;
            the generator surfaces a note here when it had to omit one. */}
        {!loading && placementNotes && (
          <div
            data-testid="itinerary-placement-notes"
            className="mt-6 rounded-xl border border-[#f4d49e] bg-[#fef3e2] px-4 py-3 text-sm text-[var(--text-primary)]"
          >
            <span className="font-semibold">A note on your must-dos:</span>{" "}
            <span className="text-[var(--text-secondary)]">{placementNotes}</span>
          </div>
        )}
        {!loading && (
          <DayTimeline
            days={days}
            legs={legs}
            badDayDates={badDayDates}
            departureDate={departureDate}
            scrollMarginTop={scrollMarginTop}
            connectors={connectors}
            swappingId={swappingId}
            swapErrorId={swapErrorId}
            swapSuggestion={swapSuggestion}
            addingSuggestion={addingSuggestion}
            addingDayNumber={addingDayNumber}
            addingBlock={addingBlock}
            blockSuggestion={blockSuggestion}
            handleRemoveActivity={handleRemoveActivity}
            handleSwapActivity={handleSwapActivity}
            acceptSwap={acceptSwap}
            rejectSwap={rejectSwap}
            handleSuggestForBlock={handleSuggestForBlock}
            acceptAdd={acceptAdd}
            rejectAdd={rejectAdd}
            logWeatherAlternativeEngage={logWeatherAlternativeEngage}
          />
        )}
      </main>

      {/* Undo toast */}
      {undoEntry && (
        <UndoToast
          activityName={undoEntry.activity.name}
          onUndo={handleUndo}
          onDismiss={dismissUndo}
        />
      )}
    </div>
  );
}

// ── Supabase save (fire-and-forget) ───────────────────────────────────────────

async function saveToSupabase(
  destination: string,
  days: ItineraryDay[]
): Promise<void> {
  try {
    await fetch("/api/itinerary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination, days }),
    });
  } catch {
    // Non-fatal — data is still in localStorage
  }
}
