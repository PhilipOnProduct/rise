"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type TimeBlock = "morning" | "afternoon" | "evening";

type ItineraryItem = {
  id: string;
  title: string;
  description: string;
  type: "activity" | "restaurant" | "transport" | "note";
  time_block: TimeBlock;
  status: "idea" | "confirmed" | "booked";
  source: "ai_generated" | "user_added" | "guide_tip";
};

type ItineraryDay = {
  date: string;
  day_number: number;
  items: ItineraryItem[];
};

type Traveler = {
  name: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  hotel: string;
  travelCompany?: string;
  travelerTypes?: string[];
};

const TIME_BLOCKS: { key: TimeBlock; label: string; emoji: string }[] = [
  { key: "morning", label: "Morning", emoji: "🌅" },
  { key: "afternoon", label: "Afternoon", emoji: "☀️" },
  { key: "evening", label: "Evening", emoji: "🌙" },
];

const TYPE_EMOJI: Record<ItineraryItem["type"], string> = {
  activity: "🎯",
  restaurant: "🍽️",
  transport: "🚌",
  note: "📝",
};

function formatDay(dateStr: string, dayNum: number) {
  const date = new Date(dateStr);
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return { weekday, day, label: `Day ${dayNum}` };
}

export default function ItineraryPage() {
  const router = useRouter();
  const [traveler, setTraveler] = useState<Traveler | null>(null);
  const [days, setDays] = useState<ItineraryDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState(0);

  // Drag state
  const dragItem = useRef<{ dayIdx: number; itemId: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Add item state
  const [addingSlot, setAddingSlot] = useState<{ dayIdx: number; block: TimeBlock } | null>(null);
  const [addTitle, setAddTitle] = useState("");

  const STORAGE_KEY = "rise_itinerary";

  // Load traveler and itinerary
  useEffect(() => {
    const raw = localStorage.getItem("rise_traveler");
    if (!raw) { router.replace("/welcome"); return; }
    let t: Traveler;
    try { t = JSON.parse(raw); } catch { router.replace("/welcome"); return; }
    setTraveler(t);

    // Try cached itinerary first
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setDays(parsed);
        setLoading(false);
        return;
      } catch {}
    }

    // Generate fresh
    fetch("/api/itinerary/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination: t.destination,
        departureDate: t.departureDate,
        returnDate: t.returnDate,
        travelCompany: t.travelCompany ?? "",
        travelerTypes: t.travelerTypes ?? [],
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.days) {
          setDays(data.days);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data.days));
        } else {
          setError("Couldn't generate your itinerary. Please try again.");
        }
      })
      .catch(() => setError("Network error. Please try again."))
      .finally(() => setLoading(false));
  }, [router]);

  const saveToStorage = useCallback((updated: ItineraryDay[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  // Dismiss an item
  function dismissItem(dayIdx: number, itemId: string) {
    setDays((prev) => {
      const next = prev.map((d, i) =>
        i === dayIdx ? { ...d, items: d.items.filter((it) => it.id !== itemId) } : d
      );
      saveToStorage(next);
      return next;
    });
  }

  // Drag handlers
  function handleDragStart(dayIdx: number, itemId: string) {
    dragItem.current = { dayIdx, itemId };
    setDraggingId(itemId);
  }

  function handleDragEnd() {
    dragItem.current = null;
    setDraggingId(null);
  }

  function handleDropOnBlock(targetDayIdx: number, targetBlock: TimeBlock) {
    if (!dragItem.current) return;
    const { dayIdx: srcDayIdx, itemId } = dragItem.current;

    setDays((prev) => {
      const next = prev.map((d) => ({ ...d, items: [...d.items] }));
      // Find item
      const srcDay = next[srcDayIdx];
      const itemIdx = srcDay.items.findIndex((it) => it.id === itemId);
      if (itemIdx === -1) return prev;
      const [item] = srcDay.items.splice(itemIdx, 1);
      // Drop into target
      const targetDay = next[targetDayIdx];
      targetDay.items.push({ ...item, time_block: targetBlock });
      saveToStorage(next);
      return next;
    });
  }

  // Add manual item
  function submitAddItem() {
    if (!addTitle.trim() || !addingSlot) return;
    const { dayIdx, block } = addingSlot;
    const newItem: ItineraryItem = {
      id: `user-${Date.now()}`,
      title: addTitle.trim(),
      description: "",
      type: "activity",
      time_block: block,
      status: "idea",
      source: "user_added",
    };
    setDays((prev) => {
      const next = prev.map((d, i) =>
        i === dayIdx ? { ...d, items: [...d.items, newItem] } : d
      );
      saveToStorage(next);
      return next;
    });
    setAddTitle("");
    setAddingSlot(null);
  }

  // Regenerate
  function regenerate() {
    if (!traveler) return;
    localStorage.removeItem(STORAGE_KEY);
    setDays([]);
    setLoading(true);
    setError(null);
    fetch("/api/itinerary/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination: traveler.destination,
        departureDate: traveler.departureDate,
        returnDate: traveler.returnDate,
        travelCompany: traveler.travelCompany ?? "",
        travelerTypes: traveler.travelerTypes ?? [],
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.days) {
          setDays(data.days);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data.days));
        } else {
          setError("Couldn't generate your itinerary.");
        }
      })
      .catch(() => setError("Network error."))
      .finally(() => setLoading(false));
  }

  if (!traveler) return null;

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center gap-4 px-6">
        <div className="w-8 h-8 rounded-full border-2 border-[#00D64F] border-t-transparent animate-spin" />
        <p className="text-gray-400">Building your {traveler.destination} itinerary…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-gray-300">{error}</p>
        <button
          onClick={regenerate}
          className="px-6 py-3 rounded-2xl bg-[#00D64F] text-black font-bold hover:bg-[#00c248] transition-colors"
        >
          Try again
        </button>
      </main>
    );
  }

  const currentDay = days[activeDay];

  return (
    <main className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <div className="px-6 pt-10 pb-6 border-b border-[#1a1a1a]">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-1">
            <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
              ← Dashboard
            </Link>
            <button
              onClick={regenerate}
              className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              Regenerate
            </button>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight mt-4">{traveler.destination}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {days.length} day itinerary · drag items to reschedule
          </p>
        </div>
      </div>

      {/* Day tabs */}
      <div className="border-b border-[#1a1a1a] overflow-x-auto">
        <div className="max-w-3xl mx-auto flex px-6 gap-1 py-2">
          {days.map((d, i) => {
            const { weekday, day, label } = formatDay(d.date, d.day_number);
            return (
              <button
                key={d.date}
                onClick={() => setActiveDay(i)}
                className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-center transition-all ${
                  i === activeDay
                    ? "bg-[#00D64F] text-black"
                    : "text-gray-400 hover:text-white hover:bg-[#1a1a1a]"
                }`}
              >
                <div className="text-xs font-semibold">{label}</div>
                <div className="text-xs opacity-75">{weekday} {day}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Day view */}
      {currentDay && (
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="flex flex-col gap-6">
            {TIME_BLOCKS.map(({ key: block, label, emoji }) => {
              const items = currentDay.items.filter((it) => it.time_block === block);
              const isAddingHere =
                addingSlot?.dayIdx === activeDay && addingSlot?.block === block;

              return (
                <div
                  key={block}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropOnBlock(activeDay, block)}
                  className="min-h-[80px]"
                >
                  {/* Block header */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">{emoji}</span>
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                      {label}
                    </span>
                  </div>

                  {/* Items */}
                  <div className="flex flex-col gap-2">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={() => handleDragStart(activeDay, item.id)}
                        onDragEnd={handleDragEnd}
                        className={`group flex items-start gap-3 bg-[#111] border rounded-2xl px-5 py-4 cursor-grab active:cursor-grabbing transition-all ${
                          draggingId === item.id
                            ? "opacity-40 border-[#00D64F]"
                            : item.source === "user_added"
                            ? "border-[#00D64F]/30 hover:border-[#00D64F]/60"
                            : "border-[#1e1e1e] hover:border-[#333]"
                        }`}
                      >
                        <span className="text-lg mt-0.5 flex-shrink-0">
                          {TYPE_EMOJI[item.type]}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-white">{item.title}</div>
                          {item.description && (
                            <div className="text-xs text-gray-500 mt-0.5">{item.description}</div>
                          )}
                          {item.source === "user_added" && (
                            <div className="text-xs text-[#00D64F]/60 mt-1">Added by you</div>
                          )}
                        </div>
                        <button
                          onClick={() => dismissItem(activeDay, item.id)}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-white text-lg leading-none -mt-0.5 ml-1"
                          title="Dismiss"
                        >
                          ×
                        </button>
                      </div>
                    ))}

                    {/* Add item inline */}
                    {isAddingHere ? (
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          type="text"
                          value={addTitle}
                          onChange={(e) => setAddTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitAddItem();
                            if (e.key === "Escape") { setAddingSlot(null); setAddTitle(""); }
                          }}
                          placeholder="What do you want to do?"
                          className="flex-1 bg-[#111] border border-[#00D64F] focus:outline-none rounded-xl px-4 py-3 text-white text-sm placeholder-[#555]"
                        />
                        <button
                          onClick={submitAddItem}
                          disabled={!addTitle.trim()}
                          className="px-4 py-3 rounded-xl bg-[#00D64F] text-black text-sm font-bold disabled:opacity-30 hover:bg-[#00c248] transition-colors"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => { setAddingSlot(null); setAddTitle(""); }}
                          className="px-4 py-3 rounded-xl bg-[#1a1a1a] text-gray-400 text-sm hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingSlot({ dayIdx: activeDay, block })}
                        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-400 transition-colors py-1"
                      >
                        <span className="text-lg leading-none">+</span>
                        <span>Add to {label.toLowerCase()}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
