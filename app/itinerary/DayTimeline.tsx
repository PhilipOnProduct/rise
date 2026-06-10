"use client";

import type { ItineraryDay, TimeBlock } from "@/types/itinerary";
import { DaySection } from "./DaySection";
import type { RawItem, StoredTraveler, TravelConnector } from "./itinerary-types";

type DayTimelineProps = {
  days: ItineraryDay[];
  legs: NonNullable<StoredTraveler["legs"]>;
  badDayDates: string[] | null;
  departureDate: string;
  scrollMarginTop: number;
  connectors: TravelConnector[];
  swappingId: string | null;
  swapErrorId: string | null;
  swapSuggestion: {
    activityId: string;
    dayNumber: number;
    item: RawItem;
    conflict: string | null;
  } | null;
  addingSuggestion: boolean;
  addingDayNumber: number | null;
  addingBlock: TimeBlock | null;
  blockSuggestion: {
    dayNumber: number;
    block: TimeBlock;
    item: RawItem;
    conflict: string | null;
  } | null;
  handleRemoveActivity: (dayNumber: number, activityId: string) => void;
  handleSwapActivity: (dayNumber: number, activityId: string) => void;
  acceptSwap: () => void;
  rejectSwap: () => void;
  handleSuggestForBlock: (dayNumber: number, block: TimeBlock) => void;
  acceptAdd: () => void;
  rejectAdd: () => void;
  logWeatherAlternativeEngage: (activityId: string, alternativeTitle: string) => void;
};

export function DayTimeline({ days, legs, badDayDates, departureDate, scrollMarginTop, connectors, swappingId, swapErrorId, swapSuggestion, addingSuggestion, addingDayNumber, addingBlock, blockSuggestion, handleRemoveActivity, handleSwapActivity, acceptSwap, rejectSwap, handleSuggestForBlock, acceptAdd, rejectAdd, logWeatherAlternativeEngage }: DayTimelineProps) {
  return (
          <div className="mt-6">
            {(() => {
              const isMultiLeg =
                legs.length >= 2 &&
                days.some((d) => typeof d.leg_index === "number");
              // PHI-53: a day is "rainy" iff its date is in bad_day_dates.
              // null badDayDates = forecast unavailable → fail-open (show
              // alternatives universally on outdoor activities).
              const dayIsRainy = (date: string) =>
                badDayDates === null || badDayDates.includes(date);
              // PHI-99: compute the effective date for each day header.
              // Order of preference: (1) the model-emitted day.date (exact
              // path); (2) departureDate + (day_number - 1) when the user
              // later locked in dates after a flex-mode generate (dashboard
              // nudge); (3) "" if still flex.
              const effectiveDateFor = (day: ItineraryDay): string => {
                if (day.date) return day.date;
                if (!departureDate) return "";
                const d = new Date(departureDate);
                if (Number.isNaN(d.getTime())) return "";
                d.setDate(d.getDate() + (day.day_number - 1));
                return d.toISOString().slice(0, 10);
              };
              if (!isMultiLeg) {
                return days.map((day) => (
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
                    showWeatherAlternative={dayIsRainy(day.date)}
                    onAlternativeEngage={logWeatherAlternativeEngage}
                    effectiveDate={effectiveDateFor(day)}
                  />
                ));
              }
              // Multi-leg: emit a leg header before each leg's first day,
              // and a muted transition card for is_transition days.
              let lastLeg = -1;
              return days.map((day) => {
                const dayLegIdx =
                  typeof day.leg_index === "number" ? day.leg_index : lastLeg;
                const headerNeeded = dayLegIdx !== lastLeg && dayLegIdx >= 0;
                lastLeg = dayLegIdx;
                const leg = legs[dayLegIdx];
                const legName = leg?.place?.name ?? `Leg ${dayLegIdx + 1}`;

                return (
                  <div key={day.day_number}>
                    {headerNeeded && (
                      <div
                        className="sticky top-0 z-10 bg-[#f8f6f1] -mx-4 px-4 py-2 mb-2 border-b border-[#e8e4de]"
                        data-testid={`itinerary-leg-header-${dayLegIdx}`}
                      >
                        <p className="text-xs font-bold text-[#1a6b7f] uppercase tracking-widest">
                          Leg {dayLegIdx + 1} · {legName}
                        </p>
                      </div>
                    )}
                    {day.is_transition ? (
                      <div
                        data-testid={`itinerary-transition-day-${day.day_number}`}
                        className="rounded-2xl border border-dashed border-[#d4cfc5] bg-[#f5f2ec] p-5 mb-3"
                      >
                        <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-1">
                          Day {day.day_number}
                          {day.date ? ` · ${day.date}` : ""} · Travel day
                        </p>
                        <p className="text-sm text-[var(--text-secondary)]">
                          {day.activities?.[0]?.name ?? `Travel to ${legName}`}
                        </p>
                        {day.activities?.[0]?.description && (
                          <p className="text-xs text-[var(--text-muted)] mt-1">
                            {day.activities[0].description}
                          </p>
                        )}
                      </div>
                    ) : (
                      <DaySection
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
                        showWeatherAlternative={dayIsRainy(day.date)}
                        onAlternativeEngage={logWeatherAlternativeEngage}
                        effectiveDate={effectiveDateFor(day)}
                      />
                    )}
                  </div>
                );
              });
            })()}
          </div>
  );
}
