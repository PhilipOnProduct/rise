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
      className="sticky top-14 z-40 w-full bg-[#0a0a0a] border-b border-[#1a1a1a]"
    >
      {loading ? (
        <div className="flex items-center gap-2 px-6 py-4">
          <div className="w-4 h-4 rounded-full border-2 border-[#00D64F] border-t-transparent animate-spin flex-shrink-0" />
          <span className="text-xs text-gray-600">Building your itinerary…</span>
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
                  className="flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-[#1a1a1a] transition-colors group flex-shrink-0 min-w-[56px]"
                  title={`${day.label} — ${day.activities.length} activities`}
                >
                  <span className="text-xs font-semibold text-gray-400 group-hover:text-white transition-colors whitespace-nowrap">
                    {day.label}
                  </span>
                  {/* Density fill bar */}
                  <div className="w-full h-1.5 rounded-full bg-[#1e1e1e] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#00D64F] transition-all"
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-600 group-hover:text-gray-500 transition-colors whitespace-nowrap">
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
};

function ActivityCard({ activity, onRemove, onSwap }: ActivityCardProps) {
  const { emoji: timeEmoji, label: timeLabel } = TIME_BLOCK_LABEL[activity.time];
  const categoryIcon = CATEGORY_ICON[activity.category];

  return (
    <div className="group relative bg-[#111] border border-[#1e1e1e] rounded-2xl px-5 py-4">
      {/* Hover controls */}
      {(onRemove || onSwap) && (
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onSwap && (
            <button
              onClick={onSwap}
              className="w-7 h-7 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-gray-500 hover:text-white hover:border-[#444] transition-colors flex items-center justify-center text-xs"
              title="Swap"
            >
              ⇄
            </button>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              className="w-7 h-7 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-gray-500 hover:text-red-400 hover:border-red-500/30 transition-colors flex items-center justify-center text-xs"
              title="Remove"
            >
              ×
            </button>
          )}
        </div>
      )}
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden>
          {categoryIcon}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white text-sm leading-snug">{activity.name}</h3>
          {activity.description && (
            <p className="text-sm text-gray-400 mt-1 leading-relaxed">{activity.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-[#1a1a1a] rounded-lg px-2 py-0.5">
              <span aria-hidden>{timeEmoji}</span>
              {timeLabel}
            </span>
            <span className="text-[11px] font-medium text-gray-600 capitalize">
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
}: {
  day: ItineraryDay;
  scrollMarginTop: number;
  onRemoveActivity: (dayNumber: number, activityId: string) => void;
  onSwapActivity: (dayNumber: number, activityId: string) => void;
}) {
  const sorted = sortActivities(day.activities);

  return (
    <section
      id={dayAnchorId(day.day_number)}
      style={{ scrollMarginTop }}
      className="py-8 border-b border-[#111] last:border-0"
    >
      {/* Day header */}
      <div className="flex items-baseline gap-3 mb-5">
        <h2 className="text-xl font-extrabold tracking-tight text-white">{day.label}</h2>
        {day.date && (
          <span className="text-sm text-gray-600">
            {new Date(day.date).toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
          </span>
        )}
        <span className="text-xs text-gray-700 ml-auto">
          {day.activities.length === 0
            ? "No activities"
            : `${day.activities.length} ${day.activities.length === 1 ? "activity" : "activities"}`}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-gray-600 italic">Nothing planned for this day yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((activity) => (
            <ActivityCard
              key={activity.id}
              activity={activity}
              onRemove={() => onRemoveActivity(day.day_number, activity.id)}
              onSwap={() => onSwapActivity(day.day_number, activity.id)}
            />
          ))}
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
};

export default function ItineraryViewPage() {
  const router = useRouter();
  const [days, setDays] = useState<ItineraryDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState("");

  const shapeBarRef = useRef<HTMLDivElement | null>(null);

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

  function handleSwapActivity(_dayNumber: number, _activityId: string) {
    // TODO: call /api/itinerary/edit with mode=swap
  }

  // ── Error state ──────────────────────────────────────────────────────────

  if (error) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-gray-300">{error}</p>
        <button
          onClick={() => {
            setError(null);
            setLoading(true);
            localStorage.removeItem("rise_itinerary");
            router.replace("/itinerary");
          }}
          className="px-6 py-3 rounded-2xl bg-[#00D64F] text-black font-bold hover:bg-[#00c248] transition-colors"
        >
          Try again
        </button>
      </main>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
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
            <h1 className="text-3xl font-extrabold tracking-tight text-white">{destination}</h1>
            <p className="text-gray-500 text-sm mt-1">
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
