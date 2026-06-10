"use client";

import PlacesAutocomplete from "@/app/components/PlacesAutocomplete";
import type { TripIntent } from "@/lib/trip-intent";
import { CHILD_AGE_RANGES } from "./welcome-constants";
import { tomorrow, nightsBetween, equalSplitNights } from "./welcome-helpers";

type LandingFreeFormProps = {
  parserPhase: "landing" | "parsing" | "confirming" | "structured";
  setParserPhase: (v: "landing" | "parsing" | "confirming" | "structured") => void;
  parsedIntent: TripIntent | null;
  setParsedIntent: (v: TripIntent | null) => void;
  animKey: number;
  editingChipKey: string | null;
  setEditingChipKey: (v: string | null) => void;
  destEditDraft: string;
  setDestEditDraft: (v: string) => void;
  resolveParsedDestinations: (
    destinations: { name: string; kind?: string }[]
  ) => Promise<void>;
  atlasSuggestedCities: Set<string>;
  legNightOverrides: number[];
  setLegNightOverrides: (v: number[]) => void;
  applyParsedIntentAndAdvance: () => void;
  parserText: string;
  setParserText: (v: string) => void;
  parserError: string | null;
  submitFreeForm: (textOverride?: string) => Promise<void>;
};

export function LandingFreeForm({
  parserPhase,
  setParserPhase,
  parsedIntent,
  setParsedIntent,
  animKey,
  editingChipKey,
  setEditingChipKey,
  destEditDraft,
  setDestEditDraft,
  resolveParsedDestinations,
  atlasSuggestedCities,
  legNightOverrides,
  setLegNightOverrides,
  applyParsedIntentAndAdvance,
  parserText,
  setParserText,
  parserError,
  submitFreeForm,
}: LandingFreeFormProps) {
    if (parserPhase === "confirming" && parsedIntent) {
      // PHI-34 + Follow-up #1: confirmation chips with inline editors for
      // the most-edited fields (destination, dates, adults). Other fields
      // (style, budget, occasion, constraints) remain read-only — users
      // can adjust those via the structured wizard after "Looks right →".
      // The chip editors update parsedIntent so re-rendering reflects edits.
      const intent = parsedIntent;
      const updateIntent = (patch: Partial<TripIntent>) =>
        setParsedIntent({ ...intent, ...patch });

      return (
        <main className="min-h-screen flex flex-col items-center justify-center px-6 py-10" style={{ backgroundColor: "#f8f6f1" }}>
          <div className="w-full max-w-xl animate-step" key={animKey}>
            <p className="font-extrabold text-xl tracking-tight mb-10" style={{ color: "#0e2a47" }}>Rise</p>
            <h1 className="text-3xl md:text-4xl font-extrabold text-[var(--text-primary)] mb-3">
              Got it. Anything to fix?
            </h1>
            <p className="text-base text-[var(--text-secondary)] mb-6">
              Here&apos;s what we picked up. Tap any chip to fix it; we&apos;ll
              walk through the rest after.
            </p>
            {/* PHI-46: chips that go into edit mode (destination/dates/adults)
                expand inline rather than triggering window.prompt(). One
                editor open at a time. Commit on Enter or "Done"; Cancel
                button discards. Read-only chips below render as before. */}
            <div className="flex flex-wrap gap-2 mb-6" data-testid="confirm-chips">
              {/* Destination(s) — editable inline */}
              {intent.destinations.length === 0 ? (
                editingChipKey === "destination-add" ? (
                  <div
                    className="w-full flex flex-col gap-2 rounded-xl border border-[#1a6b7f] bg-white p-3"
                    data-testid="destination-editor"
                  >
                    <PlacesAutocomplete
                      value={destEditDraft}
                      onChange={setDestEditDraft}
                      onSelect={(place) => {
                        const trimmed = place.split(",")[0].trim();
                        if (!trimmed) return;
                        updateIntent({
                          destinations: [{ name: trimmed }],
                        });
                        void resolveParsedDestinations([{ name: trimmed }]);
                        setEditingChipKey(null);
                        setDestEditDraft("");
                      }}
                      onEnter={() => {
                        const trimmed = destEditDraft.trim();
                        if (!trimmed) return;
                        updateIntent({
                          destinations: [{ name: trimmed }],
                        });
                        void resolveParsedDestinations([{ name: trimmed }]);
                        setEditingChipKey(null);
                        setDestEditDraft("");
                      }}
                      placeholder="e.g. Lisbon, Portugal"
                      types={["(cities)"]}
                      autoFocus
                      theme="light"
                      className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[#9ca3af] transition-colors"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const trimmed = destEditDraft.trim();
                          if (!trimmed) {
                            setEditingChipKey(null);
                            return;
                          }
                          updateIntent({
                            destinations: [{ name: trimmed }],
                          });
                          void resolveParsedDestinations([{ name: trimmed }]);
                          setEditingChipKey(null);
                          setDestEditDraft("");
                        }}
                        className="rounded-xl bg-[#1a6b7f] text-white text-xs font-semibold px-3 py-1.5 hover:bg-[#155a6b] transition-colors"
                      >
                        Done
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingChipKey(null);
                          setDestEditDraft("");
                        }}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setDestEditDraft("");
                      setEditingChipKey("destination-add");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-[#d4a94a]/60 bg-white px-3 py-1.5 text-sm text-[var(--text-primary)] hover:border-[#1a6b7f] transition-colors"
                    aria-label="Add destination"
                  >
                    <span>📍</span>
                    <span className="font-medium">Add a destination</span>
                  </button>
                )
              ) : (
                intent.destinations.map((d, i) => {
                  const editKey = `destination-${i}`;
                  if (editingChipKey === editKey) {
                    return (
                      <div
                        key={i}
                        className="w-full flex flex-col gap-2 rounded-xl border border-[#1a6b7f] bg-white p-3"
                        data-testid={`destination-editor-${i}`}
                      >
                        <PlacesAutocomplete
                          value={destEditDraft}
                          onChange={setDestEditDraft}
                          onSelect={(place) => {
                            const trimmed = place.split(",")[0].trim();
                            if (!trimmed) return;
                            const arr = [...intent.destinations];
                            arr[i] = { ...d, name: trimmed };
                            updateIntent({ destinations: arr });
                            void resolveParsedDestinations([{ name: trimmed, kind: d.kind }]);
                            setEditingChipKey(null);
                            setDestEditDraft("");
                          }}
                          onEnter={() => {
                            const trimmed = destEditDraft.trim();
                            if (!trimmed) return;
                            const arr = [...intent.destinations];
                            arr[i] = { ...d, name: trimmed };
                            updateIntent({ destinations: arr });
                            void resolveParsedDestinations([{ name: trimmed, kind: d.kind }]);
                            setEditingChipKey(null);
                            setDestEditDraft("");
                          }}
                          placeholder="e.g. Lisbon, Portugal"
                          types={["(cities)"]}
                          autoFocus
                          theme="light"
                          className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[#9ca3af] transition-colors"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const trimmed = destEditDraft.trim();
                              if (!trimmed) {
                                setEditingChipKey(null);
                                return;
                              }
                              const arr = [...intent.destinations];
                              arr[i] = { ...d, name: trimmed };
                              updateIntent({ destinations: arr });
                              void resolveParsedDestinations([{ name: trimmed, kind: d.kind }]);
                              setEditingChipKey(null);
                              setDestEditDraft("");
                            }}
                            className="rounded-xl bg-[#1a6b7f] text-white text-xs font-semibold px-3 py-1.5 hover:bg-[#155a6b] transition-colors"
                          >
                            Done
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingChipKey(null);
                              setDestEditDraft("");
                            }}
                            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }
                  // PHI-54: surface a "suggested" badge on chips that
                  // were seeded from the curated atlas (vs. user-typed).
                  const isAtlasSuggested = atlasSuggestedCities.has(d.name.toLowerCase());
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setDestEditDraft(d.name);
                        setEditingChipKey(editKey);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4cfc5] bg-white px-3 py-1.5 text-sm text-[var(--text-primary)] hover:border-[#1a6b7f] transition-colors"
                      aria-label={`Edit destination ${d.name}`}
                    >
                      <span>📍</span>
                      <span className="font-medium">
                        {d.name}
                        {d.kind ? ` (${d.kind})` : ""}
                      </span>
                      {isAtlasSuggested && (
                        <span className="ml-1 text-[10px] uppercase tracking-widest font-semibold text-[#1a6b7f] bg-[#1a6b7f]/10 px-1.5 py-0.5 rounded-full">
                          suggested
                        </span>
                      )}
                    </button>
                  );
                })
              )}

              {/* Dates — editable inline */}
              {editingChipKey === "dates" ? (
                <div
                  className="w-full flex flex-col gap-2 rounded-xl border border-[#1a6b7f] bg-white p-3"
                  data-testid="dates-editor"
                >
                  <div className="flex flex-col sm:flex-row gap-3">
                    <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] flex-1">
                      <span className="font-semibold uppercase tracking-widest">Departure</span>
                      <input
                        type="date"
                        value={intent.dates.departure ?? ""}
                        min={tomorrow()}
                        onChange={(e) =>
                          updateIntent({
                            dates: {
                              ...intent.dates,
                              departure: e.target.value || undefined,
                            },
                          })
                        }
                        className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] transition-colors"
                        autoFocus
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] flex-1">
                      <span className="font-semibold uppercase tracking-widest">Return</span>
                      <input
                        type="date"
                        value={intent.dates.return ?? ""}
                        min={intent.dates.departure || tomorrow()}
                        onChange={(e) =>
                          updateIntent({
                            dates: {
                              ...intent.dates,
                              return: e.target.value || undefined,
                            },
                          })
                        }
                        className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] transition-colors"
                      />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingChipKey(null)}
                      className="rounded-xl bg-[#1a6b7f] text-white text-xs font-semibold px-3 py-1.5 hover:bg-[#155a6b] transition-colors"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingChipKey("dates")}
                  className={`inline-flex items-center gap-1.5 rounded-xl border bg-white px-3 py-1.5 text-sm text-[var(--text-primary)] hover:border-[#1a6b7f] transition-colors ${
                    intent.dates.departure && intent.dates.return
                      ? "border-[#d4cfc5]"
                      : "border-dashed border-[#d4a94a]/60"
                  }`}
                  aria-label="Edit dates"
                >
                  <span>📅</span>
                  <span className="font-medium">
                    {intent.dates.departure && intent.dates.return
                      ? `${intent.dates.departure} → ${intent.dates.return}`
                      : intent.dates.durationNights
                      ? `${intent.dates.durationNights} nights — set dates`
                      : intent.dates.season
                      ? `${intent.dates.season} — set dates`
                      : "Set dates"}
                  </span>
                </button>
              )}

              {/* Adults — editable inline stepper */}
              {editingChipKey === "adults" ? (
                <div
                  className="inline-flex items-center gap-2 rounded-xl border border-[#1a6b7f] bg-white px-3 py-1.5"
                  data-testid="adults-editor"
                >
                  <span aria-hidden>👤</span>
                  <button
                    type="button"
                    onClick={() =>
                      updateIntent({
                        party: {
                          ...intent.party,
                          adults: Math.max(1, (intent.party.adults ?? 1) - 1),
                        },
                      })
                    }
                    aria-label="Decrease adults"
                    className="w-7 h-7 rounded-full border border-[#d4cfc5] text-[#1a6b7f] hover:border-[#1a6b7f] transition-colors"
                  >
                    −
                  </button>
                  <span className="text-sm font-semibold text-[var(--text-primary)] w-10 text-center">
                    {intent.party.adults ?? 1}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      updateIntent({
                        party: {
                          ...intent.party,
                          adults: (intent.party.adults ?? 1) + 1,
                        },
                      })
                    }
                    aria-label="Increase adults"
                    className="w-7 h-7 rounded-full border border-[#d4cfc5] text-[#1a6b7f] hover:border-[#1a6b7f] transition-colors"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingChipKey(null)}
                    className="ml-1 rounded-xl bg-[#1a6b7f] text-white text-xs font-semibold px-3 py-1 hover:bg-[#155a6b] transition-colors"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingChipKey("adults")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4cfc5] bg-white px-3 py-1.5 text-sm text-[var(--text-primary)] hover:border-[#1a6b7f] transition-colors"
                  aria-label="Edit adult count"
                >
                  <span>👤</span>
                  <span className="font-medium">
                    {intent.party.adults ?? 1} adult
                    {(intent.party.adults ?? 1) > 1 ? "s" : ""}
                  </span>
                </button>
              )}

              {/* PHI-63: children — editable inline chip with stepper +
                  per-child age selectors. Visible when children > 0 OR a
                  family-related style tag is present (Kid-friendly /
                  Teen-friendly), so families that the parser tagged as
                  "Kid-friendly" without a count can add children manually. */}
              {(() => {
                const childCount = intent.party.children?.length ?? 0;
                const hasFamilyTag = (intent.styleTags ?? []).some((t) =>
                  /kid-friendly|teen-friendly/i.test(t)
                );
                if (childCount === 0 && !hasFamilyTag) return null;

                const setChildren = (next: typeof intent.party.children) =>
                  updateIntent({ party: { ...intent.party, children: next } });
                const setCount = (next: number) => {
                  const cur = intent.party.children ?? [];
                  if (next > cur.length) {
                    setChildren([
                      ...cur,
                      ...Array.from({ length: next - cur.length }, () => ({})),
                    ]);
                  } else {
                    setChildren(cur.slice(0, next));
                  }
                };
                const setAge = (idx: number, range: string) => {
                  const cur = intent.party.children ?? [];
                  const updated = [...cur];
                  updated[idx] = {
                    ...updated[idx],
                    ageRange: range as typeof CHILD_AGE_RANGES[number],
                  };
                  setChildren(updated);
                };

                if (editingChipKey === "children") {
                  return (
                    <div
                      className="w-full flex flex-col gap-3 rounded-xl border border-[#1a6b7f] bg-white p-3"
                      data-testid="children-editor"
                    >
                      <div className="flex items-center gap-2">
                        <span aria-hidden>👶</span>
                        <button
                          type="button"
                          onClick={() => setCount(Math.max(0, childCount - 1))}
                          aria-label="Decrease children"
                          className="w-7 h-7 rounded-full border border-[#d4cfc5] text-[#1a6b7f] hover:border-[#1a6b7f] transition-colors"
                        >
                          −
                        </button>
                        <span className="text-sm font-semibold text-[var(--text-primary)] w-10 text-center">
                          {childCount}
                        </span>
                        <button
                          type="button"
                          onClick={() => setCount(childCount + 1)}
                          aria-label="Increase children"
                          className="w-7 h-7 rounded-full border border-[#d4cfc5] text-[#1a6b7f] hover:border-[#1a6b7f] transition-colors"
                        >
                          +
                        </button>
                        <span className="text-xs text-[var(--text-muted)] ml-1">
                          {childCount === 1 ? "child" : "children"}
                        </span>
                      </div>
                      {childCount > 0 && (
                        <div className="flex flex-col gap-2">
                          {(intent.party.children ?? []).map((c, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-2 flex-wrap"
                            >
                              <span className="text-xs font-semibold text-[var(--text-muted)] w-14 shrink-0">
                                Child {idx + 1}
                              </span>
                              <div className="flex gap-1.5 flex-wrap">
                                {CHILD_AGE_RANGES.map((range) => (
                                  <button
                                    key={range}
                                    type="button"
                                    onClick={() => setAge(idx, range)}
                                    className={`px-2.5 py-1 rounded-xl border text-xs font-semibold transition-all ${
                                      c.ageRange === range
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
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingChipKey(null)}
                          className="rounded-xl bg-[#1a6b7f] text-white text-xs font-semibold px-3 py-1.5 hover:bg-[#155a6b] transition-colors"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  );
                }

                if (childCount === 0) {
                  return (
                    <button
                      type="button"
                      onClick={() => setEditingChipKey("children")}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-[#d4a94a]/60 bg-white px-3 py-1.5 text-sm text-[var(--text-primary)] hover:border-[#1a6b7f] transition-colors"
                      aria-label="Add children"
                    >
                      <span>👶</span>
                      <span className="font-medium">0 children — tap to add</span>
                    </button>
                  );
                }

                const ageSummary = (intent.party.children ?? [])
                  .map((c) => c.ageRange)
                  .filter(Boolean)
                  .join(", ");
                return (
                  <button
                    type="button"
                    onClick={() => setEditingChipKey("children")}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4cfc5] bg-white px-3 py-1.5 text-sm text-[var(--text-primary)] hover:border-[#1a6b7f] transition-colors"
                    aria-label="Edit children"
                  >
                    <span>👶</span>
                    <span className="font-medium">
                      {childCount} {childCount === 1 ? "child" : "children"}
                      {ageSummary ? ` · ${ageSummary}` : ""}
                    </span>
                  </button>
                );
              })()}

              {/* Style — read-only chip; user can edit in the wizard */}
              {intent.styleTags?.length ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4cfc5] bg-white px-3 py-1.5 text-sm text-[var(--text-primary)]">
                  <span>🎯</span>
                  <span className="font-medium">{intent.styleTags.join(", ")}</span>
                </span>
              ) : null}

              {/* Budget — read-only */}
              {intent.budgetTier && (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4cfc5] bg-white px-3 py-1.5 text-sm text-[var(--text-primary)]">
                  <span>💼</span>
                  <span className="font-medium">{intent.budgetTier}</span>
                </span>
              )}

              {/* Occasion — read-only */}
              {intent.occasion && (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4cfc5] bg-white px-3 py-1.5 text-sm text-[var(--text-primary)]">
                  <span>✨</span>
                  <span className="font-medium">{intent.occasion}</span>
                </span>
              )}

              {/* Constraints — read-only with full text */}
              {(intent.constraintTags?.length || intent.constraintText) && (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4a94a]/40 bg-[#d4a94a]/5 px-3 py-1.5 text-sm text-[var(--text-primary)]">
                  <span>⚠</span>
                  <span className="font-medium">
                    {[
                      intent.constraintTags?.join(", "),
                      intent.constraintText,
                    ]
                      .filter(Boolean)
                      .join("; ")}
                  </span>
                </span>
              )}

              {/* PHI-51: inspiration chip — editable plain-text + remove.
                  Sits below constraint chips in visual hierarchy because
                  inspiration is mood-flavouring, constraints are
                  life-impacting. Neutral teal (not amber) by design. */}
              {intent.inspiration && (
                editingChipKey === "inspiration" ? (
                  <div
                    className="w-full flex flex-col gap-2 rounded-xl border border-[#1a6b7f] bg-white p-3"
                    data-testid="inspiration-editor"
                  >
                    <input
                      type="text"
                      autoFocus
                      defaultValue={intent.inspiration}
                      placeholder="e.g. Harry Potter, Amélie, Roman history"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const v = (e.target as HTMLInputElement).value.trim();
                          updateIntent({ inspiration: v || undefined });
                          setEditingChipKey(null);
                        } else if (e.key === "Escape") {
                          setEditingChipKey(null);
                        }
                      }}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        updateIntent({ inspiration: v || undefined });
                        setEditingChipKey(null);
                      }}
                      className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[#9ca3af] transition-colors"
                    />
                  </div>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4cfc5] bg-white px-3 py-1.5 text-sm text-[var(--text-primary)]"
                    data-testid="inspiration-chip"
                  >
                    <span>💡</span>
                    <span className="font-medium">Inspired by: {intent.inspiration}</span>
                    <button
                      type="button"
                      onClick={() => setEditingChipKey("inspiration")}
                      className="text-xs text-[#1a6b7f] hover:underline"
                      aria-label="Edit inspiration"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => updateIntent({ inspiration: undefined })}
                      className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs"
                      aria-label="Remove inspiration"
                    >
                      ×
                    </button>
                  </span>
                )
              )}
            </div>
            {/* PHI-37 slice 4: per-leg night allocator. Visible only when
                the parser returned 2+ destinations. Equal-split by default;
                +/- buttons reallocate from the longest leg so the total
                stays consistent with what the parser captured. */}
            {intent.destinations.length >= 2 && (() => {
              const legCount = intent.destinations.length;
              const totalNights =
                intent.dates.durationNights ??
                nightsBetween(intent.dates.departure, intent.dates.return) ??
                0;
              const split =
                legNightOverrides.length === legCount
                  ? legNightOverrides
                  : equalSplitNights(legCount, totalNights);
              const sum = split.reduce((s, n) => s + n, 0);
              const adjust = (i: number, delta: number) => {
                if (totalNights <= 0) {
                  // No total known — let user freely adjust each leg.
                  const next = [...split];
                  next[i] = Math.max(0, next[i] + delta);
                  setLegNightOverrides(next);
                  return;
                }
                // Reallocate from/to another leg so total stays pinned.
                // Each leg keeps >= 1 night.
                const next = [...split];
                if (delta > 0) {
                  let donor = -1;
                  let donorVal = 1;
                  for (let j = 0; j < legCount; j++) {
                    if (j === i) continue;
                    if (next[j] > donorVal) {
                      donor = j;
                      donorVal = next[j];
                    }
                  }
                  if (donor === -1 || next[donor] <= 1) return;
                  next[i] += 1;
                  next[donor] -= 1;
                } else {
                  if (next[i] <= 1) return;
                  let recipient = -1;
                  let recipientVal = Infinity;
                  for (let j = 0; j < legCount; j++) {
                    if (j === i) continue;
                    if (next[j] < recipientVal) {
                      recipient = j;
                      recipientVal = next[j];
                    }
                  }
                  if (recipient === -1) return;
                  next[i] -= 1;
                  next[recipient] += 1;
                }
                setLegNightOverrides(next);
              };
              return (
                <div
                  className="mb-6 rounded-2xl border border-[#d4cfc5] bg-white px-5 py-4"
                  data-testid="leg-allocator"
                >
                  <p className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-widest mb-1">
                    Nights per stop
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mb-3">
                    {totalNights > 0
                      ? `We've split ${totalNights} night${totalNights === 1 ? "" : "s"} evenly. Tap +/− to adjust.`
                      : "Set how many nights you'll spend at each stop."}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {intent.destinations.map((d, i) => (
                      <li
                        key={`${d.name}-${i}`}
                        className="flex items-center justify-between gap-3"
                        data-testid={`leg-allocator-row-${i}`}
                      >
                        <span className="text-sm text-[var(--text-primary)] font-medium truncate">
                          {d.name}
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => adjust(i, -1)}
                            disabled={split[i] <= 1}
                            className="w-7 h-7 rounded-full border border-[#d4cfc5] text-[#1a6b7f] hover:border-[#1a6b7f] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            aria-label={`Decrease nights in ${d.name}`}
                          >
                            −
                          </button>
                          <span
                            className="text-sm w-16 text-center font-medium text-[var(--text-primary)]"
                            data-testid={`leg-allocator-value-${i}`}
                          >
                            {split[i] ?? 0} night{(split[i] ?? 0) === 1 ? "" : "s"}
                          </span>
                          <button
                            type="button"
                            onClick={() => adjust(i, 1)}
                            className="w-7 h-7 rounded-full border border-[#d4cfc5] text-[#1a6b7f] hover:border-[#1a6b7f] transition-colors"
                            aria-label={`Increase nights in ${d.name}`}
                          >
                            +
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {totalNights > 0 && sum !== totalNights && (
                    <p className="text-xs text-[#d4a94a] mt-2">
                      Total: {sum} of {totalNights}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* PHI-63: drop clarifications about adults / children / ages —
                those are now editable as chips on this screen. */}
            {(() => {
              const visibleClarifications = intent.clarifications.filter(
                (c) => !/\b(adult|kid|child|age)/i.test(c)
              );
              if (visibleClarifications.length === 0) return null;
              return (
                <div className="mb-6 rounded-2xl border border-[#d4a94a]/40 bg-[#d4a94a]/5 px-5 py-4">
                  <p className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-widest mb-2">
                    A few things we&apos;ll ask in the next steps
                  </p>
                  <ul className="text-sm text-[var(--text-secondary)] flex flex-col gap-1.5">
                    {visibleClarifications.map((c, i) => (
                      <li key={i}>· {c}</li>
                    ))}
                  </ul>
                </div>
              );
            })()}
            <button
              onClick={applyParsedIntentAndAdvance}
              className="w-full rounded-2xl bg-[#1a6b7f] text-white font-bold text-base py-4 hover:bg-[#155a6b] transition-colors mb-3"
            >
              Looks right — keep going →
            </button>
            <button
              onClick={() => {
                setParserPhase("landing");
                setParsedIntent(null);
                // PHI-46: clear any open inline editor when bailing out.
                setEditingChipKey(null);
                setDestEditDraft("");
              }}
              className="w-full text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline-offset-4 hover:underline transition-colors"
            >
              Start over
            </button>
          </div>
        </main>
      );
    }

    // parserPhase === "landing" or "parsing": dual-CTA landing
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 py-10" style={{ backgroundColor: "#f8f6f1" }}>
        <div className="w-full max-w-xl animate-step" key={animKey}>
          <p className="font-extrabold text-xl tracking-tight mb-12" style={{ color: "#0e2a47" }}>Rise</p>
          <h1
            className="text-4xl md:text-5xl tracking-tight leading-tight mb-4"
            style={{ color: "#0e2a47", fontWeight: 300, letterSpacing: "-1px" }}
          >
            Tell us about your trip.
          </h1>
          <p className="text-base mb-6" style={{ color: "#4a6580" }}>
            Describe it the way you&apos;d tell a friend. We&apos;ll handle the rest.
          </p>
          <textarea
            value={parserText}
            onChange={(e) => setParserText(e.target.value)}
            disabled={parserPhase === "parsing"}
            placeholder="e.g. Two of us, Portugal and Spain for two weeks in June, love food and history, no hiking, my wife has a knee issue."
            rows={4}
            className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-2xl px-5 py-4 text-base text-[var(--text-primary)] placeholder-[#9ca3af] transition-colors mb-4"
            data-testid="parser-textarea"
            autoFocus
          />
          <div className="flex flex-wrap gap-2 mb-6">
            {[
              "4 nights solo in Lisbon, food-led, mid-budget",
              "Family Portugal trip, kids 7 and 11, beach + culture",
              "Two weeks Italy honeymoon, anniversary, no hiking",
            ].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setParserText(sample)}
                disabled={parserPhase === "parsing"}
                className="text-xs text-[#1a6b7f] hover:text-[var(--text-primary)] underline-offset-4 hover:underline transition-colors disabled:opacity-40"
              >
                · {sample}
              </button>
            ))}
          </div>
          {parserError && (
            <p className="text-sm text-red-500 mb-4" role="alert">
              {parserError}
            </p>
          )}
          <button
            onClick={() => submitFreeForm()}
            disabled={parserPhase === "parsing" || !parserText.trim()}
            className="w-full text-white font-semibold text-lg py-5 hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed mb-3"
            style={{ backgroundColor: "#1a6b7f", borderRadius: 50 }}
            data-testid="parser-submit"
          >
            {parserPhase === "parsing" ? "Reading your trip…" : "Plan my trip →"}
          </button>
          <button
            onClick={() => setParserPhase("structured")}
            disabled={parserPhase === "parsing"}
            className="w-full text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline-offset-4 hover:underline transition-colors py-2"
            data-testid="use-structured-form"
          >
            Or step by step →
          </button>
        </div>
      </main>
    );
}
