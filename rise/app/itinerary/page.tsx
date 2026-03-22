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
  budgetTier?: string;
};

type PendingEdit = {
  dayIdx: number;
  block: TimeBlock;
  replacingId: string | null; // null = add mode
  item: ItineraryItem;
  rationale: string;
  rejectedTitles: string[];
};

type LoadingEdit = {
  dayIdx: number;
  block: TimeBlock;
  replacingId: string | null;
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

  // Editing state
  const [loadingEdit, setLoadingEdit] = useState<LoadingEdit | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

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

    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        setDays(JSON.parse(cached));
        setLoading(false);
        return;
      } catch {}
    }

    const feedbackRaw = localStorage.getItem("rise_activity_feedback");
    const activityFeedback = feedbackRaw ? JSON.parse(feedbackRaw) : [];
    fetch("/api/itinerary/generate", {
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

  // Remove an item
  function handleRemove(dayIdx: number, itemId: string) {
    // Clear any pending/loading edit for this item
    if (pendingEdit?.replacingId === itemId) setPendingEdit(null);
    if (loadingEdit?.replacingId === itemId) setLoadingEdit(null);
    setDays((prev) => {
      const next = prev.map((d, i) =>
        i === dayIdx ? { ...d, items: d.items.filter((it) => it.id !== itemId) } : d
      );
      saveToStorage(next);
      return next;
    });
  }

  // AI edit: swap or add
  async function triggerEdit(
    dayIdx: number,
    block: TimeBlock,
    replacingItem: ItineraryItem | null,
    rejectedTitles: string[] = []
  ) {
    if (!traveler) return;

    setLoadingEdit({ dayIdx, block, replacingId: replacingItem?.id ?? null });
    setPendingEdit(null);
    setConflict(null);

    const day = days[dayIdx];
    const dayItems = day.items.filter((it) =>
      replacingItem ? it.id !== replacingItem.id : true
    );

    try {
      const res = await fetch("/api/itinerary/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: replacingItem ? "swap" : "add",
          destination: traveler.destination,
          dayNumber: day.day_number,
          date: day.date,
          block,
          dayItems,
          replacingItem: replacingItem
            ? { title: replacingItem.title, description: replacingItem.description }
            : null,
          rejectedTitles,
          travelCompany: traveler.travelCompany,
          travelerTypes: traveler.travelerTypes,
          budgetTier: traveler.budgetTier,
        }),
      });
      const data = await res.json();
      if (data.item) {
        setPendingEdit({
          dayIdx,
          block,
          replacingId: replacingItem?.id ?? null,
          item: data.item,
          rationale: data.rationale ?? "",
          rejectedTitles,
        });
        if (data.conflict) setConflict(data.conflict);
      } else {
        setError("Couldn't generate a suggestion. Please try again.");
      }
    } catch {
      setError("Network error generating suggestion.");
    } finally {
      setLoadingEdit(null);
    }
  }

  // Commit a pending edit to state
  function commitEdit(pending: PendingEdit) {
    setDays((prev) => {
      const next = prev.map((d, i) => {
        if (i !== pending.dayIdx) return d;
        let items = d.items;
        if (pending.replacingId) {
          items = items.map((it) =>
            it.id === pending.replacingId ? { ...pending.item, status: "idea" as const } : it
          );
        } else {
          items = [...items, { ...pending.item, status: "idea" as const }];
        }
        return { ...d, items };
      });
      saveToStorage(next);
      return next;
    });
    setPendingEdit(null);
  }

  // Reject pending edit → retry
  function rejectEdit(pending: PendingEdit) {
    const newRejected = [...pending.rejectedTitles, pending.item.title];
    const replacingItem = pending.replacingId
      ? days[pending.dayIdx]?.items.find((it) => it.id === pending.replacingId) ?? null
      : null;
    setPendingEdit(null);
    triggerEdit(pending.dayIdx, pending.block, replacingItem, newRejected);
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
      const srcDay = next[srcDayIdx];
      const itemIdx = srcDay.items.findIndex((it) => it.id === itemId);
      if (itemIdx === -1) return prev;
      const [item] = srcDay.items.splice(itemIdx, 1);
      next[targetDayIdx].items.push({ ...item, time_block: targetBlock });
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
    setPendingEdit(null);
    setLoadingEdit(null);
    setConflict(null);
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
          onClick={() => { setError(null); regenerate(); }}
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
          {/* Conflict banner */}
          {conflict && (
            <div className="mb-6 flex items-start gap-3 bg-amber-950/40 border border-amber-700/40 rounded-2xl px-5 py-4">
              <span className="text-amber-400 text-sm flex-1">{conflict}</span>
              <button
                onClick={() => setConflict(null)}
                className="text-amber-600 hover:text-amber-400 text-lg leading-none flex-shrink-0"
              >
                ×
              </button>
            </div>
          )}

          <div className="flex flex-col gap-6">
            {TIME_BLOCKS.map(({ key: block, label, emoji }) => {
              const items = currentDay.items.filter((it) => it.time_block === block);
              const isAddingHere =
                addingSlot?.dayIdx === activeDay && addingSlot?.block === block;

              const isLoadingAdd =
                loadingEdit?.dayIdx === activeDay &&
                loadingEdit?.block === block &&
                loadingEdit?.replacingId === null;

              const isPendingAdd =
                pendingEdit?.dayIdx === activeDay &&
                pendingEdit?.block === block &&
                pendingEdit?.replacingId === null;

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
                    {items.map((item) => {
                      const isLoadingSwap =
                        loadingEdit?.dayIdx === activeDay &&
                        loadingEdit?.replacingId === item.id;
                      const isPendingSwap =
                        pendingEdit?.dayIdx === activeDay &&
                        pendingEdit?.replacingId === item.id;

                      // Show pending suggestion in place of this item
                      if (isPendingSwap && pendingEdit) {
                        return (
                          <PendingCard
                            key={item.id}
                            pending={pendingEdit}
                            onCommit={() => commitEdit(pendingEdit)}
                            onReject={() => rejectEdit(pendingEdit)}
                          />
                        );
                      }

                      return (
                        <div
                          key={item.id}
                          draggable={!isLoadingSwap}
                          onDragStart={() => handleDragStart(activeDay, item.id)}
                          onDragEnd={handleDragEnd}
                          className={`group relative flex items-start gap-3 bg-[#111] border rounded-2xl px-5 py-4 transition-all ${
                            isLoadingSwap
                              ? "opacity-50 cursor-default border-[#333]"
                              : draggingId === item.id
                              ? "opacity-40 border-[#00D64F] cursor-grab"
                              : item.source === "user_added"
                              ? "border-[#00D64F]/30 hover:border-[#00D64F]/60 cursor-grab active:cursor-grabbing"
                              : "border-[#1e1e1e] hover:border-[#333] cursor-grab active:cursor-grabbing"
                          }`}
                        >
                          {/* Loading overlay for swap */}
                          {isLoadingSwap && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[#111]/60">
                              <div className="w-5 h-5 rounded-full border-2 border-[#00D64F] border-t-transparent animate-spin" />
                            </div>
                          )}

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
                          {!isLoadingSwap && (
                            <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                              {/* Swap button */}
                              <button
                                onClick={() => triggerEdit(activeDay, block, item)}
                                disabled={!!loadingEdit}
                                className="text-gray-600 hover:text-gray-300 text-sm px-1.5 py-0.5 rounded-lg hover:bg-[#1a1a1a] transition-colors disabled:opacity-30"
                                title="Swap for something different"
                              >
                                ⇄
                              </button>
                              {/* Remove button */}
                              <button
                                onClick={() => handleRemove(activeDay, item.id)}
                                className="text-gray-600 hover:text-white text-lg leading-none px-0.5"
                                title="Remove"
                              >
                                ×
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Loading placeholder for AI add */}
                    {isLoadingAdd && (
                      <div className="flex items-center gap-3 bg-[#111] border border-[#1e1e1e] rounded-2xl px-5 py-4">
                        <div className="w-5 h-5 rounded-full border-2 border-[#00D64F] border-t-transparent animate-spin flex-shrink-0" />
                        <span className="text-sm text-gray-500">Finding something for your {label.toLowerCase()}…</span>
                      </div>
                    )}

                    {/* Pending add suggestion */}
                    {isPendingAdd && pendingEdit && (
                      <PendingCard
                        pending={pendingEdit}
                        onCommit={() => commitEdit(pendingEdit)}
                        onReject={() => rejectEdit(pendingEdit)}
                      />
                    )}

                    {/* Add controls */}
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
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setAddingSlot({ dayIdx: activeDay, block })}
                          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-400 transition-colors py-1"
                        >
                          <span className="text-lg leading-none">+</span>
                          <span>Add to {label.toLowerCase()}</span>
                        </button>
                        {/* AI add button — shown when block is empty and not already loading/pending */}
                        {items.length === 0 && !isLoadingAdd && !isPendingAdd && (
                          <>
                            <span className="text-gray-700 text-xs">·</span>
                            <button
                              onClick={() => triggerEdit(activeDay, block, null)}
                              disabled={!!loadingEdit}
                              className="text-sm text-gray-600 hover:text-gray-400 transition-colors py-1 disabled:opacity-30"
                            >
                              Suggest something →
                            </button>
                          </>
                        )}
                      </div>
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

function PendingCard({
  pending,
  onCommit,
  onReject,
}: {
  pending: PendingEdit;
  onCommit: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 bg-[#111] border border-amber-700/50 rounded-2xl px-5 py-4">
      <div className="flex items-start gap-3">
        <span className="text-lg mt-0.5 flex-shrink-0">{TYPE_EMOJI[pending.item.type]}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-white">{pending.item.title}</div>
          {pending.item.description && (
            <div className="text-xs text-gray-500 mt-0.5">{pending.item.description}</div>
          )}
          {pending.rationale && (
            <div className="text-xs text-gray-600 mt-1 italic">{pending.rationale}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onCommit}
          className="text-xs font-semibold text-[#00D64F] hover:text-[#00c248] transition-colors"
        >
          Looks good ✓
        </button>
        <span className="text-gray-700 text-xs">·</span>
        <button
          onClick={onReject}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Not quite, try again →
        </button>
      </div>
    </div>
  );
}
