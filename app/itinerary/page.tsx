"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Activity,
  ActivityCategory,
  Itinerary,
  ItineraryDay,
  TimeBlock,
} from "@/types/itinerary";

// ── Constants ─────────────────────────────────────────────────────────────────

const TIME_BLOCK_ORDER: Record<TimeBlock, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
};

const TIME_BLOCK_LABEL: Record<TimeBlock, { emoji: string; label: string }> = {
  morning: { emoji: "🌅", label: "Morning" },
  afternoon: { emoji: "☀️", label: "Afternoon" },
  evening: { emoji: "🌙", label: "Evening" },
};

const CATEGORY_ICON: Record<ActivityCategory, string> = {
  activity: "🎯",
  restaurant: "🍽️",
  transport: "🚌",
  note: "📝",
};

// Nav is h-14 = 56px sticky at top-0
const NAV_HEIGHT_PX = 56;

// ── Type for raw generate API response ────────────────────────────────────────

type RawItem = {
  id: string;
  title: string;
  description: string;
  type: ActivityCategory;
  time_block: TimeBlock;
};

type RawDay = {
  date: string;
  day_number: number;
  items: RawItem[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map from the /api/itinerary/generate response shape to our shared ItineraryDay type. */
function mapRawDays(rawDays: RawDay[]): ItineraryDay[] {
  return rawDays.map((d) => ({
    label: `Day ${d.day_number}`,
    date: d.date,
    day_number: d.day_number,
    activities: d.items.map((item, idx): Activity => ({
      id: item.id,
      name: item.title,
      description: item.description,
      time: item.time_block,
      sequence: idx,
      category: item.type,
    })),
  }));
}

/** Sort activities within a day by time block order, then by sequence. */
function sortActivities(activities: Activity[]): Activity[] {
  return [...activities].sort(
    (a, b) =>
      TIME_BLOCK_ORDER[a.time] - TIME_BLOCK_ORDER[b.time] ||
      a.sequence - b.sequence
  );
}

function dayAnchorId(dayNumber: number): string {
  return `day-${dayNumber}`;
}

// ── TripShapeBar ──────────────────────────────────────────────────────────────

type TripShapeBarProps = {
  days: ItineraryDay[];
  loading: boolean;
  onDayClick: (dayNumber: number) => void;
  barRef: React.RefObject<HTMLDivElement | null>;
};

function TripShapeBar({ days, loading, onDayClick, barRef }: TripShapeBarProps) {
  const maxActivities = Math.max(1, ...days.map((d) => d.activities.length));

  return (
    // Sticky below the nav (top-14 = 56px). z-40 keeps it below the nav's z-50.
    <div
      ref={barRef}
      className="sticky top-14 z-40 w-full bg-[#f8f6f1] border-b border-[#e8e4de]"
    >
      {loading ? (
        <div className="flex items-center gap-2 px-6 py-4">
          <div className="w-4 h-4 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin flex-shrink-0" />
          <span className="text-xs text-[#6a7f8f]">Building your itinerary…</span>
        </div>
      ) : (
        // overflow-x: auto only on the inner container — the sole permitted horizontal scroll
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          <div className="flex gap-1 px-4 py-3 min-w-max">
            {days.map((day) => {
              const fill = day.activities.length / maxActivities;
              const fillPct = Math.round(fill * 100);

              return (
                <button
                  key={day.day_number}
                  onClick={() => onDayClick(day.day_number)}
                  className="flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-[#f0ede8] transition-colors group flex-shrink-0 min-w-[56px]"
                  title={`${day.label} — ${day.activities.length} activities`}
                >
                  <span className="text-xs font-semibold text-[#4a6580] group-hover:text-[#0e2a47] transition-colors whitespace-nowrap">
                    {day.label}
                  </span>
                  {/* Density fill bar */}
                  <div className="w-full h-1.5 rounded-full bg-[#e8e4de] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#1a6b7f] transition-all"
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-[#6a7f8f] group-hover:text-[#6a7f8f] transition-colors whitespace-nowrap">
                    {day.activities.length} {day.activities.length === 1 ? "activity" : "activities"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ActivityCard ──────────────────────────────────────────────────────────────

type ActivityCardProps = {
  activity: Activity;
  onRemove?: () => void;
  onSwap?: () => void;
  swapping?: boolean;
  swapSuggestion?: { title: string; description: string; type: string; conflict: string | null } | null;
  onAcceptSwap?: () => void;
  onRejectSwap?: () => void;
};

function ActivityCard({ activity, onRemove, onSwap, swapping, swapSuggestion, onAcceptSwap, onRejectSwap }: ActivityCardProps) {
  const { emoji: timeEmoji, label: timeLabel } = TIME_BLOCK_LABEL[activity.time];
  const categoryIcon = CATEGORY_ICON[activity.category];

  return (
    <div className="group relative bg-white border border-[#e8e4de] rounded-2xl px-5 py-4">
      {/* Hover controls — hidden during swap */}
      {!swapping && !swapSuggestion && (onRemove || onSwap) && (
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onSwap && (
            <button
              onClick={onSwap}
              className="w-7 h-7 rounded-lg bg-[#f0ede8] border border-[#d4cfc5] text-[#6a7f8f] hover:text-[#0e2a47] hover:border-[#b8b3a9] transition-colors flex items-center justify-center text-xs"
              title="Swap"
            >
              ⇄
            </button>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              className="w-7 h-7 rounded-lg bg-[#f0ede8] border border-[#d4cfc5] text-[#6a7f8f] hover:text-red-400 hover:border-red-500/30 transition-colors flex items-center justify-center text-xs"
              title="Remove"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Loading overlay while swap is in progress */}
      {swapping && !swapSuggestion && (
        <div className="absolute inset-0 bg-white/80 rounded-2xl flex items-center justify-center z-10">
          <div className="flex items-center gap-2 text-[#4a6580] text-sm">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-500 border-t-transparent animate-spin" />
            <span>Finding an alternative...</span>
          </div>
        </div>
      )}

      {/* Swap suggestion overlay */}
      {swapSuggestion && (
        <div className="absolute inset-0 bg-white border border-[#1a6b7f]/30 rounded-2xl px-5 py-4 z-10 flex flex-col">
          <div className="flex items-start gap-3 flex-1">
            <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden>
              {CATEGORY_ICON[(swapSuggestion.type as ActivityCategory) || "activity"]}
            </span>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-[#1a6b7f] text-sm leading-snug">{swapSuggestion.title}</h3>
              <p className="text-sm text-[#4a6580] mt-1 leading-relaxed">{swapSuggestion.description}</p>
              {swapSuggestion.conflict && (
                <p className="text-xs text-amber-500/80 mt-2">{swapSuggestion.conflict}</p>
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
              className="text-xs font-semibold text-[#6a7f8f] hover:text-[#0e2a47] transition-colors"
            >
              Not quite, try again →
            </button>
          </div>
        </div>
      )}

      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden>
          {categoryIcon}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[#0e2a47] text-sm leading-snug">{activity.name}</h3>
          {activity.description && (
            <p className="text-sm text-[#4a6580] mt-1 leading-relaxed">{activity.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6a7f8f] bg-[#f0ede8] rounded-lg px-2 py-0.5">
              <span aria-hidden>{timeEmoji}</span>
              {timeLabel}
            </span>
            <span className="text-[11px] font-medium text-[#6a7f8f] capitalize">
              {activity.category}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── DaySection ────────────────────────────────────────────────────────────────

function DaySection({
  day,
  scrollMarginTop,
  onRemoveActivity,
  onSwapActivity,
  swappingId,
  swapSuggestion,
  onAcceptSwap,
  onRejectSwap,
}: {
  day: ItineraryDay;
  scrollMarginTop: number;
  onRemoveActivity: (dayNumber: number, activityId: string) => void;
  onSwapActivity: (dayNumber: number, activityId: string) => void;
  swappingId: string | null;
  swapSuggestion: { activityId: string; item: RawItem; conflict: string | null } | null;
  onAcceptSwap: () => void;
  onRejectSwap: () => void;
}) {
  const sorted = sortActivities(day.activities);

  return (
    <section
      id={dayAnchorId(day.day_number)}
      style={{ scrollMarginTop }}
      className="py-8 border-b border-[#e8e4de] last:border-0"
    >
      {/* Day header */}
      <div className="flex items-baseline gap-3 mb-5">
        <h2 className="text-xl font-extrabold tracking-tight text-[#0e2a47]">{day.label}</h2>
        {day.date && (
          <span className="text-sm text-[#6a7f8f]">
            {new Date(day.date).toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
          </span>
        )}
        <span className="text-xs text-[#6a7f8f] ml-auto">
          {day.activities.length === 0
            ? "No activities"
            : `${day.activities.length} ${day.activities.length === 1 ? "activity" : "activities"}`}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-[#6a7f8f] italic">Nothing planned for this day yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((activity) => {
            const isSwapping = swappingId === activity.id;
            const suggestion = swapSuggestion?.activityId === activity.id ? swapSuggestion : null;
            return (
              <ActivityCard
                key={activity.id}
                activity={activity}
                onRemove={() => onRemoveActivity(day.day_number, activity.id)}
                onSwap={() => onSwapActivity(day.day_number, activity.id)}
                swapping={isSwapping}
                swapSuggestion={suggestion ? { title: suggestion.item.title, description: suggestion.item.description, type: suggestion.item.type, conflict: suggestion.conflict } : null}
                onAcceptSwap={onAcceptSwap}
                onRejectSwap={onRejectSwap}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type StoredTraveler = {
  id?: string | null;
  name?: string;
  destination?: string;
  departureDate?: string;
  returnDate?: string;
  hotel?: string;
  travelCompany?: string;
  travelerTypes?: string[];
  budgetTier?: string;
  travelerCount?: number;
  childrenAges?: string[] | null;
};

export default function ItineraryViewPage() {
  const router = useRouter();
  const [days, setDays] = useState<ItineraryDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [swappingId, setSwappingId] = useState<string | null>(null);
  const [swapSuggestion, setSwapSuggestion] = useState<{
    activityId: string;
    dayNumber: number;
    item: RawItem;
    conflict: string | null;
  } | null>(null);
  const rejectedTitlesRef = useRef<string[]>([]);

  const shapeBarRef = useRef<HTMLDivElement | null>(null);
  const travelerRef = useRef<StoredTraveler | null>(null);

  // ── Load itinerary ───────────────────────────────────────────────────────

  useEffect(() => {
    const raw = localStorage.getItem("rise_traveler");
    if (!raw) {
      router.replace("/welcome");
      return;
    }

    let traveler: StoredTraveler;
    try {
      traveler = JSON.parse(raw) as StoredTraveler;
    } catch {
      router.replace("/welcome");
      return;
    }

    setDestination(traveler.destination ?? "");
    travelerRef.current = traveler;

    async function load() {
      try {
        // 1. Try Supabase first if we have a traveler ID
        if (traveler.id) {
          const res = await fetch(`/api/itinerary?traveler_id=${encodeURIComponent(traveler.id)}`);
          if (res.ok) {
            const json = await res.json() as { itinerary: Itinerary | null };
            if (json.itinerary?.days?.length) {
              setDays(json.itinerary.days as ItineraryDay[]);
              setLoading(false);
              return;
            }
          }
        }

        // 2. Fall back to localStorage cache
        const cached = localStorage.getItem("rise_itinerary");
        if (cached) {
          try {
            const parsed = JSON.parse(cached) as RawDay[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              const mapped = mapRawDays(parsed);
              setDays(mapped);
              // Save to Supabase in background if we have an ID
              if (traveler.id) {
                void saveToSupabase(traveler.id, traveler.destination ?? "", mapped);
              }
              setLoading(false);
              return;
            }
          } catch {}
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
          departureDate: t.departureDate,
          returnDate: t.returnDate,
          travelCompany: t.travelCompany ?? "",
          travelerTypes: t.travelerTypes ?? [],
          activityFeedback,
        }),
      });

      if (!res.ok) {
        setError("Couldn't generate your itinerary. Please try again.");
        setLoading(false);
        return;
      }

      const data = await res.json() as { days?: RawDay[] };
      if (!data.days?.length) {
        setError("Couldn't generate your itinerary. Please try again.");
        setLoading(false);
        return;
      }

      localStorage.setItem("rise_itinerary", JSON.stringify(data.days));
      const mapped = mapRawDays(data.days);
      setDays(mapped);

      if (t.id) {
        void saveToSupabase(t.id, t.destination ?? "", mapped);
      }

      setLoading(false);
    }

    void load();
  }, [router]);

  // ── Scroll to day ────────────────────────────────────────────────────────

  function scrollToDay(dayNumber: number) {
    const el = document.getElementById(dayAnchorId(dayNumber));
    if (!el) return;
    const barHeight = shapeBarRef.current?.getBoundingClientRect().height ?? 72;
    const offset = el.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT_PX - barHeight - 16;
    window.scrollTo({ top: offset, behavior: "smooth" });
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

  // ── Remove / swap handlers ──────────────────────────────────────────────

  function handleRemoveActivity(dayNumber: number, activityId: string) {
    setDays((prev) => {
      const updated = prev.map((d) =>
        d.day_number === dayNumber
          ? { ...d, activities: d.activities.filter((a) => a.id !== activityId) }
          : d
      );
      localStorage.setItem("rise_itinerary", JSON.stringify(updated));
      return updated;
    });
  }

  async function handleSwapActivity(dayNumber: number, activityId: string) {
    const day = days.find((d) => d.day_number === dayNumber);
    const activity = day?.activities.find((a) => a.id === activityId);
    if (!day || !activity) return;

    const t = travelerRef.current;
    setSwappingId(activityId);
    setSwapSuggestion(null);

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
        return;
      }

      const data = await res.json() as {
        item: RawItem;
        conflict: string | null;
      };

      setSwapSuggestion({ activityId, dayNumber, item: data.item, conflict: data.conflict });
    } catch {
      setSwappingId(null);
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
      localStorage.setItem("rise_itinerary", JSON.stringify(updated));
      return updated;
    });
    setSwapSuggestion(null);
    setSwappingId(null);
  }

  function rejectSwap() {
    if (!swapSuggestion) return;
    rejectedTitlesRef.current.push(swapSuggestion.item.title);
    const { dayNumber, activityId } = swapSuggestion;
    setSwapSuggestion(null);
    setSwappingId(null);
    handleSwapActivity(dayNumber, activityId);
  }

  // ── Error state ──────────────────────────────────────────────────────────

  if (error) {
    return (
      <main className="min-h-screen bg-[#f8f6f1] flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-[#0e2a47]">{error}</p>
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

  return (
    <div className="min-h-screen bg-[#f8f6f1]">
      {/* Sticky trip shape bar */}
      <TripShapeBar
        days={days}
        loading={loading}
        onDayClick={scrollToDay}
        barRef={shapeBarRef}
      />

      {/* Page content */}
      <main className="max-w-3xl mx-auto px-6">
        {/* Header — only shown once data is ready to avoid layout shift */}
        {!loading && days.length > 0 && (
          <div className="pt-10 pb-2">
            <h1 className="text-3xl font-extrabold tracking-tight text-[#0e2a47]">{destination}</h1>
            <p className="text-[#6a7f8f] text-sm mt-1">
              {days.length} {days.length === 1 ? "day" : "days"} ·{" "}
              {days.reduce((sum, d) => sum + d.activities.length, 0)} activities
            </p>
          </div>
        )}

        {/* Vertical day timeline */}
        {!loading && (
          <div className="mt-6">
            {days.map((day) => (
              <DaySection
                key={day.day_number}
                day={day}
                scrollMarginTop={scrollMarginTop}
                onRemoveActivity={handleRemoveActivity}
                onSwapActivity={handleSwapActivity}
                swappingId={swappingId}
                swapSuggestion={swapSuggestion?.dayNumber === day.day_number ? swapSuggestion : null}
                onAcceptSwap={acceptSwap}
                onRejectSwap={rejectSwap}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Supabase save (fire-and-forget) ───────────────────────────────────────────

async function saveToSupabase(
  traveler_id: string,
  destination: string,
  days: ItineraryDay[]
): Promise<void> {
  try {
    await fetch("/api/itinerary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ traveler_id, destination, days }),
    });
  } catch {
    // Non-fatal — data is still in localStorage
  }
}
