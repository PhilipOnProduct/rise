"use client";

import type { Dispatch, SetStateAction } from "react";
import {
  COMPANY_OPTIONS,
  getStyleOptions,
  BUDGET_OPTIONS,
  CONSTRAINT_CHIPS,
  MAX_STYLE_SELECTIONS,
  CHILD_AGE_RANGES,
} from "../welcome-constants";
import { tripTypeLabel } from "../welcome-helpers";

type Step3PreferencesProps = {
  adultCount: number;
  setAdultCount: Dispatch<SetStateAction<number>>;
  childrenAges: string[];
  addChild: () => void;
  updateChildAge: (idx: number, age: string) => void;
  removeChild: (idx: number) => void;
  travelCompany: string;
  setTravelCompany: (v: string) => void;
  travelerTypes: string[];
  toggleStyle: (style: string) => void;
  budgetTier: string;
  setBudgetTier: (v: string) => void;
  constraintText: string;
  setConstraintText: (v: string) => void;
  constraintTags: string[];
  toggleConstraint: (tag: string) => void;
};

export function Step3Preferences({
  adultCount,
  setAdultCount,
  childrenAges,
  addChild,
  updateChildAge,
  removeChild,
  travelCompany,
  setTravelCompany,
  travelerTypes,
  toggleStyle,
  budgetTier,
  setBudgetTier,
  constraintText,
  setConstraintText,
  constraintTags,
  toggleConstraint,
}: Step3PreferencesProps) {
  return (
            <div className="flex flex-col gap-8">
              <div>
                <label className="block text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-4">
                  Who&apos;s coming?
                </label>

                {/* Adults + Children steppers side by side */}
                <div className="flex gap-8 mb-5">
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">Adults</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setAdultCount((c) => Math.max(1, c - 1))}
                        className="w-8 h-8 rounded-xl border border-[#d4cfc5] bg-white text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[#b8b3a9] transition-colors text-lg leading-none flex items-center justify-center"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-bold text-[var(--text-primary)] text-sm">{adultCount}</span>
                      <button
                        onClick={() => setAdultCount((c) => c + 1)}
                        className="w-8 h-8 rounded-xl border border-[#d4cfc5] bg-white text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[#b8b3a9] transition-colors text-lg leading-none flex items-center justify-center"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">Children</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { if (childrenAges.length > 0) removeChild(childrenAges.length - 1); }}
                        className="w-8 h-8 rounded-xl border border-[#d4cfc5] bg-white text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[#b8b3a9] transition-colors text-lg leading-none flex items-center justify-center"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-bold text-[var(--text-primary)] text-sm">{childrenAges.length}</span>
                      <button
                        onClick={addChild}
                        className="w-8 h-8 rounded-xl border border-[#d4cfc5] bg-white text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[#b8b3a9] transition-colors text-lg leading-none flex items-center justify-center"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {/* Child age selectors — one row per child */}
                {childrenAges.length > 0 && (
                  <div className="flex flex-col gap-3">
                    {childrenAges.map((age, idx) => (
                      <div key={idx} className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs font-semibold text-[var(--text-muted)] w-14 shrink-0">Child {idx + 1}</span>
                        <div className="flex gap-1.5 flex-wrap">
                          {CHILD_AGE_RANGES.map((range) => (
                            <button
                              key={range}
                              onClick={() => updateChildAge(idx, range)}
                              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                                age === range
                                  ? "border-[#1a6b7f] bg-[#1a6b7f]/10 text-[var(--text-primary)]"
                                  : "border-[#e8e4de] bg-white text-[var(--text-secondary)] hover:border-[#b8b3a9] hover:text-[var(--text-primary)]"
                              }`}
                            >
                              {range}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Persistent trip-type confirmation (PHI-26).
                  Always visible — closes the silent-confirmation gap for solo
                  and family travellers, where the chip section is hidden. */}
              <p
                aria-live="polite"
                className="text-[var(--text-primary)] text-base font-medium -mt-2"
                data-testid="trip-type-label"
              >
                {tripTypeLabel(adultCount, childrenAges, travelCompany)}
              </p>

              {/* Trip type — hidden when auto-set (children > 0 or only one option) */}
              {childrenAges.length === 0 && (() => {
                const validIds =
                  adultCount === 1 ? ["solo"] :
                  adultCount === 2 ? ["partner", "friends"] :
                  ["friends", "family"];
                if (validIds.length <= 1) return null;
                return (
                  <div>
                    <label className="block text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-4">
                      Trip type
                    </label>
                    <div className="flex flex-wrap gap-3">
                      {validIds.map((id) => {
                        const opt = COMPANY_OPTIONS[id];
                        return (
                          <button
                            key={id}
                            onClick={() => setTravelCompany(travelCompany === id ? "" : id)}
                            className={`flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm font-semibold transition-all ${
                              travelCompany === id
                                ? "border-[#1a6b7f] bg-[#1a6b7f]/10 text-[var(--text-primary)]"
                                : "border-[#e8e4de] bg-white text-[var(--text-secondary)] hover:border-[#b8b3a9] hover:text-[var(--text-primary)]"
                            }`}
                          >
                            <span>{opt.emoji}</span>
                            <span>{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-1">
                  What&apos;s your travel style?
                </label>
                <p className="text-[var(--text-muted)] text-sm mb-4">
                  Pick up to {MAX_STYLE_SELECTIONS}.
                </p>
                <div className="flex flex-wrap gap-2">
                  {getStyleOptions(travelCompany).map((style) => {
                    const selected = travelerTypes.includes(style);
                    const maxed = travelerTypes.length >= MAX_STYLE_SELECTIONS && !selected;
                    return (
                      <button
                        key={style}
                        onClick={() => toggleStyle(style)}
                        disabled={maxed}
                        className={`px-4 py-2 rounded-xl border text-sm font-semibold transition-all ${
                          selected
                            ? "border-[#1a6b7f] bg-[#1a6b7f]/10 text-[var(--text-primary)]"
                            : maxed
                            ? "border-[#e8e4de] bg-white text-[var(--text-muted)] cursor-not-allowed"
                            : "border-[#e8e4de] bg-white text-[var(--text-secondary)] hover:border-[#b8b3a9] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {style}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-4">
                  What&apos;s your budget?
                </label>
                <div className="flex flex-col gap-2">
                  {BUDGET_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setBudgetTier(budgetTier === opt.id ? "" : opt.id)}
                      className={`flex items-center justify-between px-5 py-4 rounded-2xl border text-left transition-all ${
                        budgetTier === opt.id
                          ? "border-[#1a6b7f] bg-[#1a6b7f]/10"
                          : "border-[#e8e4de] bg-white hover:border-[#b8b3a9]"
                      }`}
                    >
                      <span className={`text-sm font-bold ${budgetTier === opt.id ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
                        {opt.label}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">{opt.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* PHI-35: optional constraints — high-stakes for trust-sensitive
                  travellers (allergies, mobility, dietary, religious). Free-text
                  + chips for common cases. The model treats these as MUST respect
                  per the activities-stream prompt. */}
              <div>
                <label
                  htmlFor="trip-constraints"
                  className="block text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-1"
                >
                  Anything we should know?
                </label>
                <p className="text-[var(--text-muted)] text-sm mb-4">
                  Optional. Allergies, mobility, dietary, religious — anything we should respect.
                </p>
                <textarea
                  id="trip-constraints"
                  value={constraintText}
                  onChange={(e) => setConstraintText(e.target.value)}
                  placeholder="e.g. one of us has a knee issue, no long walks; severe peanut allergy"
                  rows={3}
                  className="w-full bg-white border border-[#b8b3a9] focus:border-[#1a6b7f] outline-none rounded-xl px-4 py-3 text-[var(--text-primary)] text-sm placeholder-[#9ca3af] transition-colors mb-3"
                  data-testid="constraint-textarea"
                />
                <div className="flex flex-wrap gap-2">
                  {CONSTRAINT_CHIPS.map((chip) => {
                    const selected = constraintTags.includes(chip);
                    return (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => toggleConstraint(chip)}
                        aria-pressed={selected}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                          selected
                            ? "border-[#1a6b7f] bg-[#1a6b7f]/10 text-[var(--text-primary)]"
                            : "border-[#e8e4de] bg-white text-[var(--text-secondary)] hover:border-[#b8b3a9] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {chip}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
  );
}
