"use client";

import type { ItineraryDay, TimeBlock } from "@/types/itinerary";
import { ActivityCard } from "./ActivityCard";
import { AddSuggestionCard } from "./AddSuggestionCard";
import { SuggestButton } from "./SuggestButton";
import { TravelConnectorRow } from "./TravelConnectorRow";
import { TIME_BLOCKS, TIME_BLOCK_LABEL } from "./itinerary-constants";
import { dayAnchorId, groupByBlock, sortActivities } from "./itinerary-helpers";
import type { RawItem, TravelConnector } from "./itinerary-types";

// ── DaySection ────────────────────────────────────────────────────────────────

// ── Skeleton placeholders (loading + regenerate) ─────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[#e8e4de] bg-white p-4 animate-pulse">
      <div className="h-4 w-2/3 rounded bg-[#e8e4de] mb-3" />
      <div className="h-3 w-full rounded bg-[#f0ede8] mb-1.5" />
      <div className="h-3 w-5/6 rounded bg-[#f0ede8]" />
    </div>
  );
}

export function DaySectionSkeleton({
  dayNumber,
  date,
  scrollMarginTop,
}: {
  dayNumber: number;
  date: string;
  scrollMarginTop: number;
}) {
  return (
    <section
      style={{ scrollMarginTop }}
      className="py-8 border-b border-[#e8e4de] last:border-0"
      aria-busy="true"
      aria-label={`Day ${dayNumber} loading`}
    >
      <div className="flex items-baseline gap-3 mb-5">
        <h2 className="text-xl font-extrabold tracking-tight text-[var(--text-primary)]">
          Day {dayNumber}
        </h2>
        {date && (
          <span className="text-sm text-[var(--text-muted)]">
            {new Date(date).toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-5">
        {TIME_BLOCKS.map((block) => {
          const { emoji, label } = TIME_BLOCK_LABEL[block];
          return (
            <div key={block}>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-sm" aria-hidden>{emoji}</span>
                <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{label}</span>
                <div className="flex-1 h-px bg-[#e8e4de] ml-1" />
              </div>
              <div className="flex flex-col gap-3">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DaySection({
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
  showWeatherAlternative,
  onAlternativeEngage,
  effectiveDate,
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
  // PHI-53: pre-computed by parent — true when this day's date is in
  // bad_day_dates, OR null forecast (fail-open). When true, ActivityCard
  // surfaces the AI's alternative for outdoor items inline.
  showWeatherAlternative: boolean;
  onAlternativeEngage: (activityId: string, alternativeTitle: string) => void;
  // PHI-99: parent-computed date string for the header. Either:
  //   - day.date as it arrived from the model (exact-date trip), OR
  //   - departureDate + (day_number - 1) when the user later locked in
  //     real dates after a flex-mode generate (dashboard nudge), OR
  //   - "" in true flex mode (no date suffix rendered).
  // Computed in the parent so the same shape is used for /itinerary,
  // the trip-shape bar, and any other consumer.
  effectiveDate: string;
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
        <h2 className="text-xl font-extrabold tracking-tight text-[var(--text-primary)]">{day.label}</h2>
        {effectiveDate && (
          <span className="text-sm text-[var(--text-muted)]">
            {new Date(effectiveDate).toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
          </span>
        )}
        <span className="text-xs text-[var(--text-muted)] ml-auto">
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
                <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{label}</span>
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
                          showWeatherAlternative={showWeatherAlternative}
                          onAlternativeEngage={
                            activity.alternative
                              ? () => onAlternativeEngage(activity.id, activity.alternative!.title)
                              : undefined
                          }
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
                  <p className="text-sm text-[var(--text-muted)] italic pl-1">Nothing planned yet.</p>
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
