"use client";

import type { ItineraryDay } from "@/types/itinerary";
import { cityLabel } from "@/lib/destination-label";
import { formatDateRange } from "./itinerary-helpers";
import type { TravelConnector } from "./itinerary-types";

type ItineraryHeaderProps = {
  destination: string;
  departureDate: string;
  returnDate: string;
  hotel: string;
  loading: boolean;
  skeletonDayCount: number;
  days: ItineraryDay[];
  regenerating: boolean;
  showRegenConfirm: boolean;
  setShowRegenConfirm: (show: boolean) => void;
  handleRegenerate: () => void;
  connectors: TravelConnector[];
  computingTravel: boolean;
  travelError: string | null;
  handleComputeTravel: () => void;
};

export function ItineraryHeader({ destination, departureDate, returnDate, hotel, loading, skeletonDayCount, days, regenerating, showRegenConfirm, setShowRegenConfirm, handleRegenerate, connectors, computingTravel, travelError, handleComputeTravel }: ItineraryHeaderProps) {
  return (
          <div className="pt-10 pb-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-[var(--text-primary)]">{cityLabel(destination)}</h1>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[var(--text-muted)] text-sm mt-1">
                  {departureDate && returnDate && (
                    <span>{formatDateRange(departureDate, returnDate)}</span>
                  )}
                  {departureDate && returnDate && <span>·</span>}
                  {loading ? (
                    skeletonDayCount > 0 ? (
                      <span>
                        {skeletonDayCount} {skeletonDayCount === 1 ? "day" : "days"} · Building your itinerary…
                      </span>
                    ) : (
                      <span>Building your itinerary…</span>
                    )
                  ) : (
                    <span>
                      {days.length} {days.length === 1 ? "day" : "days"} ·{" "}
                      {days.reduce((sum, d) => sum + d.activities.length, 0)} activities
                    </span>
                  )}
                </div>
                {hotel && (
                  <p className="text-[var(--text-muted)] text-sm mt-0.5">
                    Staying at {hotel}
                  </p>
                )}
              </div>

              {/* Regenerate button */}
              <div className="relative flex-shrink-0">
                {showRegenConfirm ? (
                  <div className="bg-white border border-[#e8e4de] rounded-xl shadow-sm p-3 text-sm">
                    <p className="text-[var(--text-primary)] font-medium mb-2">Regenerate entire itinerary?</p>
                    <p className="text-[var(--text-muted)] text-xs mb-3">This replaces all your current plans.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleRegenerate}
                        className="px-3 py-1.5 rounded-lg bg-[#1a6b7f] text-white text-xs font-semibold hover:bg-[#155a6b] transition-colors"
                      >
                        Yes, regenerate
                      </button>
                      <button
                        onClick={() => setShowRegenConfirm(false)}
                        className="px-3 py-1.5 rounded-lg text-[var(--text-muted)] text-xs font-semibold hover:text-[var(--text-primary)] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowRegenConfirm(true)}
                    disabled={regenerating}
                    className="text-xs font-semibold text-[var(--text-muted)] hover:text-[#1a6b7f] transition-colors disabled:opacity-50 flex items-center gap-1.5 mt-2"
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

            {/* Calculate travel times / connector summary — hidden while
                loading/regenerating since connectors are cleared on Regenerate
                and recomputing during the build is meaningless (PHI-79). */}
            {!loading && (
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
                <>
                  <span className="text-xs text-[var(--text-muted)]">
                    Travel times calculated
                    {connectors.some((c) => c.gap_flagged) && (
                      <span className="text-amber-600 ml-1">
                        · {connectors.filter((c) => c.gap_flagged).length} tight connection{connectors.filter((c) => c.gap_flagged).length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                  {/* PHI-81: inline legend so mobile users (no hover tooltip) can still
                      decode the icons used in connector rows below. */}
                  <span className="text-[11px] text-[var(--text-muted)]">
                    🚶 walk · 🚇 transit · 🚕 drive
                  </span>
                </>
              )}
              {travelError && (
                <span className="text-xs text-red-500">{travelError}</span>
              )}
            </div>
            )}
          </div>
  );
}
