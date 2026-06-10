"use client";

import type { Dispatch, SetStateAction } from "react";
import PlacesAutocomplete from "@/app/components/PlacesAutocomplete";
import { getHotelPlaceholder } from "@/lib/hotel-placeholders";
import type { NeighborhoodCard } from "@/lib/neighborhood-gen-prompt";
import type { PlaceRef } from "@/lib/trip-schema";

type HotelRich = {
  placeId: string;
  lat: number;
  lng: number;
  neighborhood: string | null;
};

type Step2HotelSingleProps = {
  hotel: string;
  setHotel: (v: string) => void;
  hotelRich: HotelRich | null;
  setHotelRich: (v: HotelRich | null) => void;
  destination: string;
  destinationBias: { lat: number; lng: number } | null;
  handleContinue: () => Promise<void>;
  openNeighborhoodPicker: () => Promise<void>;
  anchorNeighborhood: string;
  setAnchorNeighborhood: (v: string) => void;
  underlineInput: string;
};

export function Step2HotelSingle({
  hotel,
  setHotel,
  hotelRich,
  setHotelRich,
  destination,
  destinationBias,
  handleContinue,
  openNeighborhoodPicker,
  anchorNeighborhood,
  setAnchorNeighborhood,
  underlineInput,
}: Step2HotelSingleProps) {
  return (
            <div className="flex flex-col gap-4">
              <PlacesAutocomplete
                value={hotel}
                onChange={(v) => {
                  setHotel(v);
                  // Typed edit invalidates a previous rich capture — the
                  // user is now describing a different place than the one
                  // they previously selected.
                  if (hotelRich) setHotelRich(null);
                }}
                onSelect={(v) => setHotel(v.split(",")[0].trim())}
                onSelectRich={(rich) =>
                  setHotelRich({
                    placeId: rich.placeId,
                    lat: rich.lat,
                    lng: rich.lng,
                    neighborhood: rich.neighborhood,
                  })
                }
                placeholder={getHotelPlaceholder(destination)}
                types={["establishment"]}
                locationBias={destinationBias}
                autoFocus
                onEnter={() => handleContinue()}
                className={underlineInput}
                theme="light"
                inlineSuggestions
              />
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => { setHotel(""); setHotelRich(null); handleContinue(); }}
                  className="self-start text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  I haven&apos;t booked yet — skip &rarr;
                </button>
                <button
                  onClick={openNeighborhoodPicker}
                  className="self-start text-sm text-[#1a6b7f] hover:text-[var(--text-primary)] underline-offset-4 hover:underline transition-colors"
                  data-testid="open-neighborhood-picker"
                >
                  Don&apos;t know yet — help me pick a neighbourhood &rarr;
                </button>
              </div>
              {anchorNeighborhood && (
                <p className="text-sm text-[var(--text-secondary)]">
                  Saved area:{" "}
                  <span className="font-semibold text-[var(--text-primary)]">{anchorNeighborhood}</span>
                  {" · "}
                  <button
                    onClick={() => setAnchorNeighborhood("")}
                    className="text-[#1a6b7f] hover:underline"
                  >
                    clear
                  </button>
                </p>
              )}
            </div>
  );
}

type Step2NeighborhoodPickerProps = {
  destination: string;
  neighborhoodsLoading: boolean;
  neighborhoodsError: string | null;
  setNeighborhoodCards: (v: NeighborhoodCard[]) => void;
  openNeighborhoodPicker: () => Promise<void>;
  neighborhoodCards: NeighborhoodCard[];
  pickNeighborhood: (name: string) => void;
  setNeighborhoodPickerOpen: (v: boolean) => void;
};

export function Step2NeighborhoodPicker({
  destination,
  neighborhoodsLoading,
  neighborhoodsError,
  setNeighborhoodCards,
  openNeighborhoodPicker,
  neighborhoodCards,
  pickNeighborhood,
  setNeighborhoodPickerOpen,
}: Step2NeighborhoodPickerProps) {
  return (
            <div className="flex flex-col gap-5" data-testid="neighborhood-picker">
              <p className="text-[var(--text-secondary)]">
                Pick where to base yourself in {destination}. Each card shows
                the trade-off a local would tell a friend — pick what fits.
              </p>
              {neighborhoodsLoading && (
                <div className="text-sm text-[var(--text-muted)]">
                  Generating neighbourhoods…
                </div>
              )}
              {neighborhoodsError && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex items-start justify-between gap-3">
                  <span>{neighborhoodsError}</span>
                  <button
                    onClick={() => {
                      setNeighborhoodCards([]);
                      void openNeighborhoodPicker();
                    }}
                    className="underline shrink-0"
                  >
                    Try again
                  </button>
                </div>
              )}
              {!neighborhoodsLoading && neighborhoodCards.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {neighborhoodCards.map((card) => (
                    <button
                      key={card.name}
                      onClick={() => pickNeighborhood(card.name)}
                      className="text-left bg-white rounded-2xl border border-[#e8e4de] hover:border-[#1a6b7f] hover:shadow-md transition p-4 flex flex-col gap-2"
                      data-testid={`neighborhood-card-${card.name}`}
                    >
                      <span className="text-lg font-bold text-[var(--text-primary)]">
                        {card.name}
                      </span>
                      <span className="text-sm text-[var(--text-secondary)]">
                        {card.blurb}
                      </span>
                      <span className="text-xs font-semibold text-[#1a6b7f] uppercase tracking-wider">
                        {card.best_for}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setNeighborhoodPickerOpen(false)}
                className="self-start text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                data-testid="back-to-hotel-search"
              >
                &larr; Back to hotel search
              </button>
            </div>
  );
}

type Step2HotelMultiLegProps = {
  parsedLegs: { place: PlaceRef; nights: number }[];
  legHotels: string[];
  setLegHotels: Dispatch<SetStateAction<string[]>>;
  setLegHotelsRich: Dispatch<SetStateAction<(HotelRich | null)[]>>;
  destinationBias: { lat: number; lng: number } | null;
  handleContinue: () => Promise<void>;
  underlineInput: string;
};

export function Step2HotelMultiLeg({
  parsedLegs,
  legHotels,
  setLegHotels,
  setLegHotelsRich,
  destinationBias,
  handleContinue,
  underlineInput,
}: Step2HotelMultiLegProps) {
  return (
            <div
              className="flex flex-col gap-6"
              data-testid="multi-leg-hotels"
            >
              {parsedLegs.map((leg, i) => (
                <div
                  key={`hotel-${i}`}
                  className="flex flex-col gap-2"
                  data-testid={`leg-hotel-${i}`}
                >
                  <label
                    className="text-xs font-bold text-[#1a6b7f] uppercase tracking-widest"
                  >
                    Leg {i + 1} · {leg.place.name}
                    {leg.nights ? ` · ${leg.nights} night${leg.nights === 1 ? "" : "s"}` : ""}
                  </label>
                  <PlacesAutocomplete
                    value={legHotels[i] ?? ""}
                    onChange={(v) => {
                      setLegHotels((prev) => {
                        const next = [...prev];
                        next[i] = v;
                        return next;
                      });
                      // PHI-111: invalidate any prior rich payload for this
                      // leg when the user keeps typing — the captured
                      // place no longer matches the typed text.
                      setLegHotelsRich((prev) => {
                        if (!prev[i]) return prev;
                        const next = [...prev];
                        next[i] = null;
                        return next;
                      });
                    }}
                    onSelect={(v) =>
                      setLegHotels((prev) => {
                        const next = [...prev];
                        next[i] = v.split(",")[0].trim();
                        return next;
                      })
                    }
                    onSelectRich={(rich) =>
                      setLegHotelsRich((prev) => {
                        const next = [...prev];
                        // Make sure the array is long enough — initial
                        // sizing already pads to parsedLegs.length, but
                        // be defensive in case of re-render races.
                        while (next.length <= i) next.push(null);
                        next[i] = {
                          placeId: rich.placeId,
                          lat: rich.lat,
                          lng: rich.lng,
                          neighborhood: rich.neighborhood,
                        };
                        return next;
                      })
                    }
                    placeholder={`e.g. Hotel in ${leg.place.name}`}
                    types={["establishment"]}
                    locationBias={
                      leg.place.lat != null && leg.place.lng != null
                        ? { lat: leg.place.lat, lng: leg.place.lng }
                        : destinationBias
                    }
                    autoFocus={i === 0}
                    className={underlineInput}
                    theme="light"
                    inlineSuggestions
                  />
                </div>
              ))}
              <button
                onClick={() => {
                  // Skip-all: clear every leg's hotel and any rich coords.
                  setLegHotels(new Array(parsedLegs.length).fill(""));
                  setLegHotelsRich(new Array(parsedLegs.length).fill(null));
                  handleContinue();
                }}
                className="self-start text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                I haven&apos;t booked any of these — skip →
              </button>
            </div>
  );
}
