"use client";

import type { Dispatch, SetStateAction } from "react";
import PlacesAutocomplete from "@/app/components/PlacesAutocomplete";
import { tomorrow, buildFlexMonthOptions } from "../welcome-helpers";

type Step1DestinationProps = {
  destination: string;
  handleDestinationChange: (text: string) => void;
  handleDestinationSelect: (place: string) => void;
  destinationVerified: boolean;
  useDestinationAsTyped: () => void;
  darkInput: string;
  flexMode: boolean;
  setFlexMode: (v: boolean) => void;
  departureDate: string;
  setDepartureDate: (v: string) => void;
  returnDate: string;
  setReturnDate: (v: string) => void;
  setUserTypedReturn: (v: boolean) => void;
  flexMonth: string;
  setFlexMonth: (v: string) => void;
  flexNights: number;
  setFlexNights: Dispatch<SetStateAction<number>>;
};

export function Step1Destination({
  destination,
  handleDestinationChange,
  handleDestinationSelect,
  destinationVerified,
  useDestinationAsTyped,
  darkInput,
  flexMode,
  setFlexMode,
  departureDate,
  setDepartureDate,
  returnDate,
  setReturnDate,
  setUserTypedReturn,
  flexMonth,
  setFlexMonth,
  flexNights,
  setFlexNights,
}: Step1DestinationProps) {
  return (
            <div className="flex flex-col gap-6">
              <div>
                <label className="block text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-3">
                  Destination
                </label>
                <PlacesAutocomplete
                  value={destination}
                  onChange={handleDestinationChange}
                  onSelect={handleDestinationSelect}
                  placeholder="e.g. Tokyo, Japan"
                  types={["(cities)"]}
                  className={darkInput}
                />
                {/* PHI-30: same escape hatch on step 1 if the user re-edits
                    the destination here without re-selecting. */}
                {destination.trim().length >= 2 && !destinationVerified && (
                  <button
                    type="button"
                    onClick={useDestinationAsTyped}
                    className="mt-2 text-sm text-[#1a6b7f] hover:text-[var(--text-primary)] underline-offset-4 hover:underline transition-colors"
                  >
                    Use &ldquo;{destination.trim()}&rdquo; anyway →
                  </button>
                )}
              </div>
              {/* PHI-99: dual mode entry. Default is the exact-date pair;
                  clicking "Not sure yet — I'm just exploring →" swaps in
                  a month dropdown + nights stepper without clearing
                  destination/hotel state. Toggling back reuses the same
                  date values when the user already typed them. */}
              {!flexMode ? (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-3">
                      Departure
                    </label>
                    <input
                      type="date"
                      value={departureDate}
                      min={tomorrow()}
                      onChange={(e) => setDepartureDate(e.target.value)}
                      className={darkInput}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-3">
                      Return
                    </label>
                    <input
                      type="date"
                      value={returnDate}
                      min={departureDate || tomorrow()}
                      onChange={(e) => {
                        const v = e.target.value;
                        setReturnDate(v);
                        // PHI-109 regression fix: any user edit on the
                        // Return input marks the value as explicitly user-
                        // set so subsequent Departure changes don't re-
                        // derive Return = Departure + N. Clearing Return
                        // flips the flag back off so a future Departure
                        // edit will re-auto-fill.
                        setUserTypedReturn(!!v);
                      }}
                      className={darkInput}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      // Pre-fill the month dropdown the first time the user
                      // enters flex mode. Default = current month + 2.
                      if (!flexMonth) {
                        const opts = buildFlexMonthOptions();
                        setFlexMonth(opts[2]?.value ?? opts[0]?.value ?? "");
                      }
                      setFlexMode(true);
                    }}
                    data-testid="enter-flex-mode"
                    className="self-start text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    Not sure yet — I&apos;m just exploring &rarr;
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label
                      htmlFor="flex-month"
                      className="block text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-3"
                    >
                      Month
                    </label>
                    <select
                      id="flex-month"
                      value={flexMonth}
                      onChange={(e) => setFlexMonth(e.target.value)}
                      className={darkInput}
                      data-testid="flex-month-select"
                    >
                      {buildFlexMonthOptions().map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-3">
                      Nights
                    </label>
                    <div className="flex items-center gap-3" data-testid="flex-nights-stepper">
                      <button
                        type="button"
                        onClick={() => setFlexNights((n) => Math.max(1, n - 1))}
                        className="w-10 h-10 rounded-xl border border-[#d4cfc5] bg-white text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[#b8b3a9] transition-colors text-lg leading-none flex items-center justify-center"
                        aria-label="Decrease nights"
                      >
                        &minus;
                      </button>
                      <span
                        data-testid="flex-nights-value"
                        className="min-w-[3rem] text-center font-bold text-[var(--text-primary)] text-2xl"
                      >
                        {flexNights}
                      </span>
                      <button
                        type="button"
                        onClick={() => setFlexNights((n) => Math.min(30, n + 1))}
                        className="w-10 h-10 rounded-xl border border-[#d4cfc5] bg-white text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[#b8b3a9] transition-colors text-lg leading-none flex items-center justify-center"
                        aria-label="Increase nights"
                      >
                        +
                      </button>
                      <span className="text-sm text-[var(--text-muted)] ml-1">
                        {flexNights === 1 ? "night" : "nights"}
                      </span>
                    </div>
                  </div>
                  {flexMonth.length > 0 && (
                    <p
                      data-testid="flex-summary"
                      className="text-sm text-[var(--text-secondary)]"
                    >
                      We&apos;ll plan around{" "}
                      <span className="font-semibold text-[var(--text-primary)]">
                        {buildFlexMonthOptions().find((o) => o.value === flexMonth)?.label ??
                          flexMonth}
                      </span>
                      , {flexNights} {flexNights === 1 ? "night" : "nights"}.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setFlexMode(false)}
                    data-testid="exit-flex-mode"
                    className="self-start text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    Got dates after all? &rarr;
                  </button>
                </>
              )}
            </div>
  );
}
