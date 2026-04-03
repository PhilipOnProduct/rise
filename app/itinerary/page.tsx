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

// ── Constants ─────────────────────────────────────────────────────────────────

const TIME_BLOCK_ORDER: Record<TimeBlock, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
};

const TIME_BLOCKS: TimeBlock[] = ["morning", "afternoon", "evening"];

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

const UNDO_TIMEOUT_MS = 5000;

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

type TravelConnector = {
  id: string;
  day_number: number;
  sequence_index: number;
  from_activity_id: string;
  to_activity_id: string;
  walk_seconds: number | null;
  walk_meters: number | null;
  walk_adjusted_seconds: number | null;
  transit_seconds: number | null;
  transit_fare: string | null;
  drive_seconds: number | null;
  drive_meters: number | null;
  gap_seconds: number;
  gap_flagged: boolean;
  flag_reason: string | null;
  error: string | null;
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

/** Group sorted activities by time block. */
function groupByBlock(activities: Activity[]): Record<TimeBlock, Activity[]> {
  const groups: Record<TimeBlock, Activity[]> = { morning: [], afternoon: [], evening: [] };
  for (const a of activities) {
    groups[a.time].push(a);
  }
  return groups;
}

/** Format a date range like "15–22 Apr 2026". */
function formatDateRange(departure: string, ret: string): string {
  const d = new Date(departure);
  const r = new Date(ret);
  const sameMonth = d.getMonth() === r.getMonth() && d.getFullYear() === r.getFullYear();
  if (sameMonth) {
    return `${d.getDate()}–${r.getDate()} ${d.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`;
  }
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${r.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

// ── UndoToast ─────────────────────────────────────────────────────────────────

type UndoEntry = {
  dayNumber: number;
  activity: Activity;
  timer: ReturnType<typeof setTimeout>;
};

function UndoToast({ activityName, onUndo, onDismiss }: { activityName: string; onUndo: () => void; onDismiss: () => void }) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / UNDO_TIMEOUT_MS) * 100);
      setProgress(pct);
      if (pct <= 0) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#0e2a47] text-white rounded-2xl shadow-lg px-5 py-3 flex items-center gap-3 min-w-[280px] max-w-[400px] animate-[fadeSlideUp_0.2s_ease-out]">
      <span className="text-sm flex-1 truncate">Removed &ldquo;{activityName}&rdquo;</span>
      <button
        onClick={onUndo}
        className="text-sm font-bold text-[#5ec4d4] hover:text-white transition-colors flex-shrink-0"
      >
        Undo
      </button>
      <button
        onClick={onDismiss}
        className="text-white/50 hover:text-white transition-colors text-xs flex-shrink-0"
        aria-label="Dismiss"
      >
        ×
      </button>
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-2xl overflow-hidden">
        <div
          className="h-full bg-[#5ec4d4] transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

// ── SuggestButton ─────────────────────────────────────────────────────────────

function SuggestButton({ onClick, loading, label }: { onClick: () => void; loading: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="text-xs font-semibold text-[#1a6b7f] hover:text-[#155a6b] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
    >
      {loading ? (
        <>
          <span className="w-3 h-3 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin" />
          <span>Finding a suggestion...</span>
        </>
      ) : (
        <span>{label}</span>
      )}
    </button>
  );
}

// ── AddSuggestionCard (shown when the API returns a suggestion for an empty slot) ──

function AddSuggestionCard({
  suggestion,
  conflict,
  onAccept,
  onReject,
}: {
  suggestion: { title: string; description: string; type: string };
  conflict: string | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="bg-white border border-[#1a6b7f]/30 rounded-2xl px-5 py-4 flex flex-col">
      <div className="flex items-start gap-3 flex-1">
        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden>
          {CATEGORY_ICON[(suggestion.type as ActivityCategory) || "activity"]}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[#1a6b7f] text-sm leading-snug">{suggestion.title}</h3>
          <p className="text-sm text-[#4a6580] mt-1 leading-relaxed">{suggestion.description}</p>
          {conflict && (
            <p className="text-xs text-amber-500/80 mt-2">{conflict}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={onAccept}
          className="text-xs font-semibold text-[#1a6b7f] hover:text-[#155a6b] transition-colors"
        >
          Looks good ✓
        </button>
        <button
          onClick={onReject}
          className="text-xs font-semibold text-[#6a7f8f] hover:text-[#0e2a47] transition-colors"
        >
          Not quite, try again →
        </button>
      </div>
    </div>
  );
}

// ── TripShapeBar ──────────────────────────────────────────────────────────────

type TripShapeBarProps = {
  days: ItineraryDay[];
  loading: boolean;
  activeDayNumber: number | null;
  onDayClick: (dayNumber: number) => void;
  barRef: React.RefObject<HTMLDivElement | null>;
};

function TripShapeBar({ days, loading, activeDayNumber, onDayClick, barRef }: TripShapeBarProps) {
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
              const isActive = activeDayNumber === day.day_number;

              return (
                <button
                  key={day.day_number}
                  onClick={() => onDayClick(day.day_number)}
                  className={`flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl transition-colors group flex-shrink-0 min-w-[56px] ${
                    isActive
                      ? "bg-[#1a6b7f]/10"
                      : "hover:bg-[#f0ede8]"
                  }`}
                  title={`${day.label} — ${day.activities.length} activities`}
                >
                  <span className={`text-xs font-semibold transition-colors whitespace-nowrap ${
                    isActive ? "text-[#1a6b7f]" : "text-[#4a6580] group-hover:text-[#0e2a47]"
                  }`}>
                    {day.label}
                  </span>
                  {/* Density fill bar */}
                  <div className="w-full h-1.5 rounded-full bg-[#e8e4de] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isActive ? "bg-[#1a6b7f]" : "bg-[#1a6b7f]/60"}`}
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                  <span className={`text-[10px] transition-colors whitespace-nowrap ${
                    isActive ? "text-[#1a6b7f] font-medium" : "text-[#6a7f8f]"
                  }`}>
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

// ── TravelConnectorRow ───────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function TravelConnectorRow({ connector }: { connector: TravelConnector }) {
  // Error state — no data at all
  if (connector.error && connector.walk_seconds == null && connector.transit_seconds == null && connector.drive_seconds == null) {
    return (
      <div className="mx-1 my-1 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-500 text-xs flex items-center gap-1.5">
        <span aria-hidden>⚠</span>
        <span>Travel data unavailable</span>
      </div>
    );
  }

  const walkSec = connector.walk_adjusted_seconds ?? connector.walk_seconds;
  const segments: string[] = [];

  // Filter out zero-duration modes — 0 means no viable route, not instant travel
  if (walkSec != null && walkSec > 0) {
    segments.push(`🚶 ${formatDuration(walkSec)}`);
  }
  if (connector.transit_seconds != null && connector.transit_seconds > 0) {
    let s = `🚇 ${formatDuration(connector.transit_seconds)}`;
    if (connector.transit_fare) s += ` ${connector.transit_fare}`;
    segments.push(s);
  }
  if (connector.drive_seconds != null && connector.drive_seconds > 0) {
    if (connector.drive_meters != null && connector.drive_meters > 0) {
      segments.push(`🚕 ~${formatDistance(connector.drive_meters)}`);
    } else {
      segments.push(`🚕 ${formatDuration(connector.drive_seconds)}`);
    }
  }

  if (segments.length === 0) return null;

  // Flagged state
  if (connector.gap_flagged) {
    return (
      <div className="mx-1 my-1.5 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span aria-hidden>⚠</span>
          <span className="font-semibold">Tight connection</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-amber-600">
          {segments.map((s, i) => (
            <span key={i}>
              {i > 0 && <span className="text-amber-300 mr-2">·</span>}
              {s}
            </span>
          ))}
        </div>
        {connector.flag_reason && (
          <p className="text-[10px] text-amber-500 mt-0.5">{connector.flag_reason}</p>
        )}
      </div>
    );
  }

  // Normal state
  return (
    <div className="mx-1 my-1.5 text-xs text-[#4a6580] flex items-center gap-2 flex-wrap px-2 py-1 border-l-2 border-[#e8e4de]">
      {segments.map((s, i) => (
        <span key={i}>
          {i > 0 && <span className="text-[#d4cfc5] mr-2">·</span>}
          {s}
        </span>
      ))}
    </div>
  );
}

// ── ActivityCard ──────────────────────────────────────────────────────────────

type ActivityCardProps = {
  activity: Activity;
  onRemove?: () => void;
  onSwap?: () => void;
  swapping?: boolean;
  swapError?: boolean;
  swapSuggestion?: { title: string; description: string; type: string; conflict: string | null } | null;
  onAcceptSwap?: () => void;
  onRejectSwap?: () => void;
};

function ActivityCard({ activity, onRemove, onSwap, swapping, swapError, swapSuggestion, onAcceptSwap, onRejectSwap }: ActivityCardProps) {
  const categoryIcon = CATEGORY_ICON[activity.category];

  return (
    <div className="group relative bg-white border border-[#e8e4de] rounded-2xl px-5 py-4">
      {/* Action controls — hover on desktop, always visible on touch */}
      {!swapping && !swapSuggestion && (onRemove || onSwap) && (
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
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

      {/* Swap error overlay */}
      {swapError && !swapping && !swapSuggestion && (
        <div className="absolute inset-x-0 -bottom-8 flex justify-center z-10">
          <span className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-1 border border-red-200">
            Couldn&apos;t find an alternative. Try again?
          </span>
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
  connectors,
  onRemoveActivity,
  onSwapActivity,
  swappingId,
  swapErrorId,
  swapSuggestion,
  onAcceptSwap,
  onRejectSwap,
  onSuggestForBlock,
  addingSuggestion,
  addingBlock,
  blockSuggestion,
  onAcceptAdd,
  onRejectAdd,
}: {
  day: ItineraryDay;
  scrollMarginTop: number;
  connectors: TravelConnector[];
  onRemoveActivity: (dayNumber: number, activityId: string) => void;
  onSwapActivity: (dayNumber: number, activityId: string) => void;
  swappingId: string | null;
  swapErrorId: string | null;
  swapSuggestion: { activityId: string; item: RawItem; conflict: string | null } | null;
  onAcceptSwap: () => void;
  onRejectSwap: () => void;
  onSuggestForBlock: (dayNumber: number, block: TimeBlock) => void;
  addingSuggestion: boolean;
  addingBlock: TimeBlock | null;
  blockSuggestion: { block: TimeBlock; item: RawItem; conflict: string | null } | null;
  onAcceptAdd: () => void;
  onRejectAdd: () => void;
}) {
  const sorted = sortActivities(day.activities);
  const grouped = groupByBlock(sorted);

  // Build a lookup: find connector where to_activity_id matches a given activity
  const connectorBefore = (activityId: string) =>
    connectors.find((c) => c.to_activity_id === activityId);

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

      {/* Time-block grouped layout */}
      <div className="flex flex-col gap-5">
        {TIME_BLOCKS.map((block, blockIdx) => {
          const activities = grouped[block];
          const { emoji, label } = TIME_BLOCK_LABEL[block];
          const isAddingThisBlock = addingBlock === block && addingSuggestion;
          const suggestionForBlock = blockSuggestion?.block === block ? blockSuggestion : null;
          const hasContent = activities.length > 0 || suggestionForBlock || isAddingThisBlock;

          // Cross-block connector: from last activity of previous block to first of this block
          const prevBlock = blockIdx > 0 ? TIME_BLOCKS[blockIdx - 1] : null;
          const prevBlockActivities = prevBlock ? grouped[prevBlock] : [];
          const firstHere = activities.length > 0 ? activities[0] : null;
          const crossBlockConn =
            prevBlockActivities.length > 0 && firstHere
              ? connectorBefore(firstHere.id)
              : undefined;

          return (
            <div key={block}>
              {/* Cross-block connector (between previous block and this one) */}
              {crossBlockConn && <TravelConnectorRow connector={crossBlockConn} />}

              {/* Block subheading */}
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-sm" aria-hidden>{emoji}</span>
                <span className="text-xs font-semibold text-[#4a6580] uppercase tracking-wider">{label}</span>
                <div className="flex-1 h-px bg-[#e8e4de] ml-1" />
              </div>

              {hasContent ? (
                <div className="flex flex-col gap-3">
                  {activities.map((activity, idx) => {
                    const isSwapping = swappingId === activity.id;
                    const suggestion = swapSuggestion?.activityId === activity.id ? swapSuggestion : null;
                    // Within-block connector (between sequential activities in same block)
                    const withinConn = idx > 0 ? connectorBefore(activity.id) : undefined;

                    return (
                      <div key={activity.id}>
                        {withinConn && <TravelConnectorRow connector={withinConn} />}
                        <ActivityCard
                          activity={activity}
                          onRemove={() => onRemoveActivity(day.day_number, activity.id)}
                          onSwap={() => onSwapActivity(day.day_number, activity.id)}
                          swapping={isSwapping}
                          swapError={swapErrorId === activity.id}
                          swapSuggestion={suggestion ? { title: suggestion.item.title, description: suggestion.item.description, type: suggestion.item.type, conflict: suggestion.conflict } : null}
                          onAcceptSwap={onAcceptSwap}
                          onRejectSwap={onRejectSwap}
                        />
                      </div>
                    );
                  })}

                  {/* Add suggestion card for this block */}
                  {suggestionForBlock && (
                    <AddSuggestionCard
                      suggestion={{ title: suggestionForBlock.item.title, description: suggestionForBlock.item.description, type: suggestionForBlock.item.type }}
                      conflict={suggestionForBlock.conflict}
                      onAccept={onAcceptAdd}
                      onReject={onRejectAdd}
                    />
                  )}

                  {/* Suggest button below existing activities */}
                  {!suggestionForBlock && (
                    <div className="pl-1">
                      <SuggestButton
                        onClick={() => onSuggestForBlock(day.day_number, block)}
                        loading={isAddingThisBlock}
                        label="+ Suggest something"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-[#6a7f8f] italic pl-1">Nothing planned yet.</p>
                  <div className="pl-1">
                    <SuggestButton
                      onClick={() => onSuggestForBlock(day.day_number, block)}
                      loading={isAddingThisBlock}
                      label="+ Suggest something"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [hotel, setHotel] = useState("");
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

  // ── Regenerate state ────────────────────────────────────────────────────
  const [regenerating, setRegenerating] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

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
    setDepartureDate(traveler.departureDate ?? "");
    setReturnDate(traveler.returnDate ?? "");
    setHotel(traveler.hotel ?? "");
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
          departureDate: t.departureDate,
          returnDate: t.returnDate,
          hotel: t.hotel ?? null,
          travelCompany: t.travelCompany ?? "",
          travelerTypes: t.travelerTypes ?? [],
          activityFeedback,
          travelerCount: t.travelerCount ?? null,
          childrenAges: t.childrenAges ?? null,
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

  // ── Load stored travel connectors ──────────────────────────────────────

  useEffect(() => {
    if (loading || days.length === 0) return;
    const t = travelerRef.current;
    if (!t?.id) return;

    fetch(`/api/itinerary/travel?traveler_id=${encodeURIComponent(t.id)}`)
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
        body: JSON.stringify({ traveler_id: t.id }),
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
        traveler_id: t.id,
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
      void saveToSupabase(t.id, t.destination ?? "", updated);
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

  function rejectAdd() {
    if (!blockSuggestion) return;
    addRejectedRef.current.push(blockSuggestion.item.title);
    const { dayNumber, block } = blockSuggestion;
    setBlockSuggestion(null);
    handleSuggestForBlock(dayNumber, block);
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
          departureDate: t.departureDate,
          returnDate: t.returnDate,
          hotel: t.hotel ?? null,
          travelCompany: t.travelCompany ?? "",
          travelerTypes: t.travelerTypes ?? [],
          activityFeedback,
          travelerCount: t.travelerCount ?? null,
          childrenAges: t.childrenAges ?? null,
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
        void saveToSupabase(t.id, t.destination ?? "", mapped);
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
        activeDayNumber={activeDayNumber}
        onDayClick={scrollToDay}
        barRef={shapeBarRef}
      />

      {/* Page content */}
      <main className="max-w-3xl mx-auto px-6">
        {/* Header — only shown once data is ready to avoid layout shift */}
        {!loading && days.length > 0 && (
          <div className="pt-10 pb-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-[#0e2a47]">{destination}</h1>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[#6a7f8f] text-sm mt-1">
                  {departureDate && returnDate && (
                    <span>{formatDateRange(departureDate, returnDate)}</span>
                  )}
                  {departureDate && returnDate && <span>·</span>}
                  <span>
                    {days.length} {days.length === 1 ? "day" : "days"} ·{" "}
                    {days.reduce((sum, d) => sum + d.activities.length, 0)} activities
                  </span>
                </div>
                {hotel && (
                  <p className="text-[#6a7f8f] text-sm mt-0.5">
                    Staying at {hotel}
                  </p>
                )}
              </div>

              {/* Regenerate button */}
              <div className="relative flex-shrink-0">
                {showRegenConfirm ? (
                  <div className="bg-white border border-[#e8e4de] rounded-xl shadow-sm p-3 text-sm">
                    <p className="text-[#0e2a47] font-medium mb-2">Regenerate entire itinerary?</p>
                    <p className="text-[#6a7f8f] text-xs mb-3">This replaces all your current plans.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleRegenerate}
                        className="px-3 py-1.5 rounded-lg bg-[#1a6b7f] text-white text-xs font-semibold hover:bg-[#155a6b] transition-colors"
                      >
                        Yes, regenerate
                      </button>
                      <button
                        onClick={() => setShowRegenConfirm(false)}
                        className="px-3 py-1.5 rounded-lg text-[#6a7f8f] text-xs font-semibold hover:text-[#0e2a47] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowRegenConfirm(true)}
                    disabled={regenerating}
                    className="text-xs font-semibold text-[#6a7f8f] hover:text-[#1a6b7f] transition-colors disabled:opacity-50 flex items-center gap-1.5 mt-2"
                    title="Regenerate itinerary"
                  >
                    {regenerating ? (
                      <>
                        <span className="w-3 h-3 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin" />
                        Regenerating...
                      </>
                    ) : (
                      <>↻ Regenerate</>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Calculate travel times / connector summary */}
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              {connectors.length === 0 ? (
                <button
                  onClick={handleComputeTravel}
                  disabled={computingTravel}
                  className="text-xs font-semibold text-[#1a6b7f] hover:text-[#155a6b] transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {computingTravel ? (
                    <>
                      <span className="w-3 h-3 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin" />
                      Calculating travel times...
                    </>
                  ) : (
                    <>🗺 Calculate travel times</>
                  )}
                </button>
              ) : (
                <span className="text-xs text-[#6a7f8f]">
                  Travel times calculated
                  {connectors.some((c) => c.gap_flagged) && (
                    <span className="text-amber-600 ml-1">
                      · {connectors.filter((c) => c.gap_flagged).length} tight connection{connectors.filter((c) => c.gap_flagged).length !== 1 ? "s" : ""}
                    </span>
                  )}
                </span>
              )}
              {travelError && (
                <span className="text-xs text-red-500">{travelError}</span>
              )}
            </div>
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
                connectors={connectors.filter((c) => c.day_number === day.day_number)}
                onRemoveActivity={handleRemoveActivity}
                onSwapActivity={handleSwapActivity}
                swappingId={swappingId}
                swapErrorId={swapErrorId}
                swapSuggestion={swapSuggestion?.dayNumber === day.day_number ? swapSuggestion : null}
                onAcceptSwap={acceptSwap}
                onRejectSwap={rejectSwap}
                onSuggestForBlock={handleSuggestForBlock}
                addingSuggestion={addingSuggestion && addingDayNumber === day.day_number}
                addingBlock={addingDayNumber === day.day_number ? addingBlock : null}
                blockSuggestion={blockSuggestion?.dayNumber === day.day_number ? blockSuggestion : null}
                onAcceptAdd={acceptAdd}
                onRejectAdd={rejectAdd}
              />
            ))}
          </div>
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
