"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { track } from "@vercel/analytics";
import PlacesAutocomplete from "@/app/components/PlacesAutocomplete";
import type { TripIntent } from "@/lib/trip-intent";
import { newLegId, type PlaceRef, type TripLeg } from "@/lib/trip-schema";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getHotelPlaceholder } from "@/lib/hotel-placeholders";
import type { NeighborhoodCard } from "@/lib/neighborhood-gen-prompt";
import { cleanUserSeededActivities } from "@/lib/itinerary-gen-prompt";

// PHI-90: Step 4 ("Anything you already want to do?") sits between
// preferences (3) and the AI activity preview (now 5). Account creation
// moves from 5 to 6. Step 3.5 (country recs, sentinel value 35) is
// unchanged and now hands off to step 4 (must-dos) when picked.
const TOTAL_WIZARD_STEPS = 6; // steps 1–6

const COMPANY_OPTIONS: Record<string, { label: string; emoji: string }> = {
  solo: { label: "Just me", emoji: "🧳" },
  partner: { label: "Couple", emoji: "💑" },
  friends: { label: "Friend group", emoji: "👯" },
  family: { label: "Family", emoji: "👨‍👩‍👧" },
};

const STYLE_OPTIONS_BASE = [
  "Cultural",
  "Food-led",
  "Relaxed",
  "Adventure",
  "Off the beaten track",
  "History",
];

const STYLE_OPTIONS_BY_COMPANY: Record<string, string[]> = {
  solo:    ["Budget-savvy", "Slow travel", "Wellness", "Photography", "Nightlife", "Art & Design"],
  partner: ["Romantic", "Wellness", "Nightlife", "Art & Design", "Photography"],
  friends: ["Nightlife", "Active", "Festivals", "Art & Design", "Photography"],
  // Per Elena's input on PHI-27: split family chips so users can signal
  // whether they're travelling with kids, teens, or both. The model uses
  // these to bias activity selection (toddler-friendly vs. near-adult).
  family:  ["Kid-friendly", "Teen-friendly", "Beach", "Educational", "Wellness", "Photography"],
};

function getStyleOptions(company: string): string[] {
  const extra = STYLE_OPTIONS_BY_COMPANY[company] ?? ["Nightlife", "Wellness", "Art & Design", "Photography"];
  return [...STYLE_OPTIONS_BASE, ...extra];
}

const BUDGET_OPTIONS = [
  { id: "budget", label: "Savvy", description: "Great value, local finds" },
  { id: "comfortable", label: "Comfortable", description: "Quality without excess" },
  { id: "luxury", label: "Flexible", description: "Spend where it matters" },
];

// PHI-35 / RISE-302: high-stakes constraint chips, prioritised per Elena.
// Six chips spanning the highest-stakes categories: mobility, dietary,
// religious/cultural, family. The free-text box catches everything else.
// Severe allergy is flagged for the model as life-impacting in the prompt.
const CONSTRAINT_CHIPS = [
  "Wheelchair access",
  "No long walks",
  "Vegetarian",
  "Halal/Kosher",
  "Severe allergy",
  "Stroller-friendly",
] as const;

const MAX_STYLE_SELECTIONS = 3;

// PHI-27: added "13–17" so teen families aren't silently excluded.
const CHILD_AGE_RANGES = ["Under 2", "2–4", "5–8", "9–12", "13–17"] as const;

// PHI-47: permissive email format check. Rejects "x", "abc", "@", "user@",
// while accepting plus-addressing, subdomains, and country TLDs. Server-
// side check in /api/travelers mirrors this regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Chip = {
  label: string;
  type: "hard_exclusion" | "soft_signal";
};

// Shown immediately on thumbs-down; replaced silently by dynamic chips once they arrive
const FALLBACK_CHIPS: Chip[] = [
  { label: "Done it before", type: "hard_exclusion" },
  { label: "Doesn't fit my itinerary", type: "soft_signal" },
  { label: "Not really my thing", type: "soft_signal" },
  { label: "Not for me", type: "soft_signal" },
];

type ChipsEntry = {
  chips: Chip[];
  source: "fallback" | "dynamic";
};

// PHI-31 Part 2 slice 2: minimal shape for the inline itinerary preview
// rendered on step 5 BEFORE the signup form. Mirrors the /api/itinerary/generate
// response. We don't reuse the full /itinerary page render because it
// includes drag-to-reschedule, travel connectors, etc. — out of scope for
// the pre-signup preview, which is read-only.
type PreviewItem = {
  id: string;
  title: string;
  description: string;
  type: string;
  time_block: "morning" | "afternoon" | "evening";
  // PHI-90: true on items the generator placed in response to a user
  // anchor. Surfaced inline on the preview + the saved /itinerary view
  // so the traveller can confirm "yes, my picks landed".
  seededByUser?: boolean;
};
type PreviewDay = {
  date: string;
  day_number: number;
  items: PreviewItem[];
  // PHI-37: multi-leg trips — index into legs[] (0-based). Absent on
  // single-leg trips. `is_transition: true` flags a travel day between
  // two legs and is rendered as a muted transport-only card.
  leg_index?: number;
  is_transition?: boolean;
};

type ParsedActivity = {
  id: string;
  name: string;
  category: string;
  description: string;
  when: string;
  // PHI-32: optional because older streams may not include it; the UI
  // hides the "Why this" affordance when missing.
  rationale?: string;
  // PHI-37: leg index this activity belongs to. Absent on single-leg
  // streams; populated when the upstream emits "LEG: <index>" markers.
  legIndex?: number;
};

export type ActivityFeedbackEntry = {
  activityId: string;
  activityName: string;
  activityCategory: string;
  // PHI-28: "skipped" is distinct from "no feedback at all". It tells the
  // model the user *consciously* declined to commit either way — useful
  // signal for downstream personalization.
  feedbackType:
    | "thumbs_up"
    | "chip_selected"
    | "thumbs_down_no_chip"
    | "skipped";
  chip?: Chip;
};

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

// PHI-99: build the 18-month dropdown options for flex-date entry. Returns
// `[{ value: "2026-10", label: "October 2026" }, ...]` starting from the
// current month. Default is current month + 2 (handled at state-init time
// inside the wizard).
function buildFlexMonthOptions(today: Date = new Date()): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  for (let i = 0; i < 18; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    out.push({
      value: `${d.getFullYear()}-${m}`,
      label: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
    });
  }
  return out;
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

/**
 * PHI-90 — split the free-text must-dos textarea into a clean string array.
 * PHI-97 — now a thin wrapper around the canonical `cleanUserSeededActivities`
 * helper so the wizard, the three server routes, and any future client share
 * one implementation of the 20 × 200-char cap.
 */
function splitSeededActivities(raw: string): string[] {
  return cleanUserSeededActivities(raw ? raw.split(/\r?\n/) : []);
}

/**
 * PHI-37 slice 1: nights between two ISO dates (return - departure, in
 * whole nights). Returns null when either side is missing or unparseable.
 */
function nightsBetween(
  departure: string | undefined,
  ret: string | undefined
): number | null {
  if (!departure || !ret) return null;
  const a = Date.parse(departure);
  const b = Date.parse(ret);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/**
 * PHI-37 slice 1: equal-split a total night count across N legs.
 *
 * Default is even distribution; remainder loaded into earlier legs. A
 * 7-night, 3-leg trip splits 3 / 2 / 2. A 5-night, 2-leg trip splits
 * 3 / 2. Returns an array of length `legCount` summing to `totalNights`.
 * If totalNights is 0 or unknown, returns zeros so callers can decide
 * the fallback (e.g. "ask the user" or "default 1 per leg").
 */
function equalSplitNights(legCount: number, totalNights: number): number[] {
  if (legCount <= 0) return [];
  if (totalNights <= 0) return new Array(legCount).fill(0);
  const base = Math.floor(totalNights / legCount);
  const remainder = totalNights - base * legCount;
  return Array.from({ length: legCount }, (_, i) =>
    i < remainder ? base + 1 : base
  );
}

/**
 * Persistent trip-type confirmation label (PHI-26 / RISE-102).
 *
 * Two of five personas in the May 2026 onboarding review (solo and family
 * travellers) got NO confirmation that the system understood who's
 * traveling because the Trip Type chip section was hidden in their cases.
 * This function derives a human label from the same inputs so the user
 * always sees their composition reflected back.
 *
 * Pure derived state — no new fields, no side effects.
 */
function tripTypeLabel(
  adultCount: number,
  childrenAges: string[],
  travelCompany: string,
): string {
  // Family — any children present
  if (childrenAges.length > 0) {
    const kidWord = childrenAges.length === 1 ? "child" : "children";
    // PHI-27: if any age is unset, prompt the user before showing detail.
    if (childrenAges.some((a) => a.length === 0)) {
      return `Planning a family trip with ${childrenAges.length} ${kidWord} — pick an age range for each`;
    }
    // Truncate the age list at 2 entries for legibility
    const ageDisplay =
      childrenAges.length <= 2
        ? childrenAges.join(", ")
        : `${childrenAges[0]}, ${childrenAges[1]} +${childrenAges.length - 2} more`;
    return `Planning a family trip with ${childrenAges.length} ${kidWord} (${ageDisplay})`;
  }
  // Solo
  if (adultCount === 1) return "Planning a solo trip";
  // 2 adults — depends on chip choice (chip stays visible to resolve the ambiguity)
  if (adultCount === 2) {
    if (travelCompany === "partner") return "Planning a couple's trip";
    if (travelCompany === "friends") return "Planning a trip for two friends";
    return "Planning a trip for two"; // neutral prompt while user picks
  }
  // 3+ adults
  if (travelCompany === "family") return `Planning a family trip with ${adultCount} adults`;
  return `Planning a trip for ${adultCount} friends`;
}

function previewLoadingLabel(destination: string, travelCompany: string): string {
  const companyLabel: Record<string, string> = {
    solo: "solo",
    partner: "couple",
    family: "family",
    friends: "friends",
  };
  const label = companyLabel[travelCompany];
  if (label) return `Planning your ${label} trip to ${destination}…`;
  return `Planning your trip to ${destination}…`;
}

function parseActivities(text: string): ParsedActivity[] {
  // Matches: **Name** — Category\nDescription\n*When: timing*\n[*Why: rationale*]
  // PHI-32: Why line is optional — old streams without rationale still parse.
  const regex =
    /\*\*([^*\n]+)\*\*\s*[—–\-]\s*([^\n]+)\n([^\n*][^\n]*)\n\*When:\s*([^*\n]+)\*(?:\s*\n\*Why:\s*([^*\n]+)\*)?/g;
  // PHI-37: scan for "LEG: <index>" markers so multi-leg streams tag each
  // activity with its leg. Single-leg streams have no markers and the
  // legIndex stays undefined, which is fine for downstream renderers.
  const legMarker = /LEG:\s*(\d+)/g;
  const legAt: { offset: number; index: number }[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = legMarker.exec(text)) !== null) {
    legAt.push({ offset: mm.index, index: Number(mm[1]) });
  }

  const results: ParsedActivity[] = [];
  let match;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    // Find the most recent LEG marker that appeared before this card.
    let legIndex: number | undefined;
    for (const m of legAt) {
      if (m.offset < match.index) legIndex = m.index;
      else break;
    }
    results.push({
      id: `act-${idx++}`,
      name: match[1].trim(),
      category: match[2].trim(),
      description: match[3].trim(),
      when: match[4].trim(),
      rationale: match[5]?.trim() || undefined,
      ...(legIndex !== undefined && { legIndex }),
    });
  }
  return results;
}

/**
 * PHI-37 slice 3: reusable day card for the step-5 itinerary preview.
 * Single-leg trips render the same markup as before. Multi-leg trips
 * use the same component but the parent wraps groups of days with a
 * sticky leg header. Transition days (`is_transition: true`) render as
 * muted travel-only cards with no item list.
 */
function PreviewDayCard({ day }: { day: PreviewDay }) {
  if (day.is_transition) {
    const transitionItem = day.items?.[0];
    return (
      <div
        data-testid={`transition-day-${day.day_number}`}
        className="rounded-2xl border border-dashed border-[#d4cfc5] bg-[#f5f2ec] p-5"
      >
        <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-1">
          Day {day.day_number}
          {day.date ? ` · ${day.date}` : ""} · Travel day
        </p>
        <p className="text-sm text-[var(--text-secondary)]">
          {transitionItem?.title ?? "Travel between legs."}
        </p>
        {transitionItem?.description && (
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {transitionItem.description}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-[#e8e4de] bg-white p-5">
      <p className="text-xs font-bold text-[#1a6b7f] uppercase tracking-widest mb-1">
        Day {day.day_number}
        {day.date ? ` · ${day.date}` : ""}
      </p>
      <ul className="flex flex-col gap-2.5 mt-2">
        {day.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] w-16 shrink-0">
                {item.time_block}
              </span>
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {item.title}
              </span>
            </div>
            {/* PHI-92 — render the anchor badge on the welcome preview, not
                just on /itinerary, so the traveller gets the "Rise heard
                me" confirmation before they decide whether to save the
                trip. `self-start` keeps the badge from stretching across
                the flex-column <li>; the rest of the chip is byte-identical
                to the /itinerary badge so the two surfaces match. */}
            {item.seededByUser && (
              <span
                data-testid="seeded-by-user-badge-preview"
                className="self-start inline-flex items-center gap-1 mt-1 ml-[72px] px-2 py-0.5 rounded-md bg-[#1a6b7f]/10 text-[#1a6b7f] text-[10px] font-semibold uppercase tracking-widest"
              >
                ★ You added this
              </span>
            )}
            {item.description && (
              <p className="text-xs text-[var(--text-secondary)] ml-[72px] leading-relaxed">
                {item.description}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function logActivityEvent(payload: {
  event: string;
  activityId: string;
  activityName: string;
  activityCategory: string;
  chipLabel?: string;
  chipType?: string;
  chipsSource?: string;
  firstChipLabel?: string;
  // PHI-51: optional creative-inspiration; lands in activity_feedback.metadata
  // because the route auto-buckets unknown fields into the jsonb column.
  // The success-metric query joins thumbs_up rate against this field.
  inspiration?: string | null;
  // PHI-52: which strength branch the prompt took for this trip's activity-gen.
  // "family" if any child in party, else "adult". Null when no inspiration.
  inspirationStrength?: "adult" | "family" | null;
}) {
  fetch("/api/activity-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

// ── Activity card component ────────────────────────────────────────────────

type ActivityCardProps = {
  activity: ParsedActivity;
  chipsEntry: ChipsEntry | undefined;
  feedback: ActivityFeedbackEntry | undefined;
  chipsOpen: boolean;
  disabled?: boolean;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  onChipSelect: (chip: Chip) => void;
  onUndo: () => void;
  onSkip: () => void;
  onRationaleExpand: () => void;
};

function ActivityCard({
  activity,
  chipsEntry,
  feedback,
  chipsOpen,
  disabled,
  onThumbsUp,
  onThumbsDown,
  onChipSelect,
  onUndo,
  onSkip,
  onRationaleExpand,
}: ActivityCardProps) {
  // PHI-32: rationale is collapsed by default to avoid visual noise.
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const isHardExcluded =
    feedback?.feedbackType === "chip_selected" && feedback.chip?.type === "hard_exclusion";
  const isNoted =
    feedback?.feedbackType === "chip_selected" && feedback.chip?.type === "soft_signal" ||
    feedback?.feedbackType === "thumbs_down_no_chip";
  const isThumbsUp = feedback?.feedbackType === "thumbs_up";
  const isSkipped = feedback?.feedbackType === "skipped";

  return (
    <div
      className={`rounded-2xl border p-5 transition-all ${
        isHardExcluded
          ? "border-[#e8e4de] bg-[#f0ede8] opacity-50"
          : isNoted
          ? "border-[#e8e4de] border-l-[#d4a94a] border-l-[3px] bg-white"
          : "border-[#e8e4de] bg-white"
      }`}
    >
      <div className="mb-3">
        <div className="font-bold text-[var(--text-primary)] text-base leading-snug">{activity.name}</div>
        <div className="text-xs text-[#1a6b7f] font-semibold mt-0.5">{activity.category}</div>
      </div>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">{activity.description}</p>

      {/* PHI-32: "Why this" rationale — collapsed by default. Trust signal
          without visual noise. Hidden if the model didn't return one. */}
      {activity.rationale && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => {
              const next = !rationaleOpen;
              setRationaleOpen(next);
              if (next) onRationaleExpand();
            }}
            aria-expanded={rationaleOpen}
            aria-controls={`rationale-${activity.id}`}
            className="text-xs text-[#1a6b7f] hover:text-[var(--text-primary)] underline-offset-4 hover:underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a6b7f] focus-visible:ring-offset-2 rounded"
            data-testid={`why-this-${activity.id}`}
          >
            {rationaleOpen ? "Hide why ↑" : "Why this →"}
          </button>
          {rationaleOpen && (
            <div
              id={`rationale-${activity.id}`}
              role="region"
              aria-live="polite"
              className="mt-2 px-3 py-2.5 rounded-xl bg-[#f0ede8] text-xs text-[var(--text-secondary)] leading-relaxed"
            >
              {activity.rationale}
            </div>
          )}
        </div>
      )}

      {/* Thumbs buttons — hidden while streaming or when chips are open.
          PHI-28: 48×48 (w-12 h-12) to clear WCAG / Apple HIG 44px minimum
          comfortably on mobile. Skip is a tertiary text affordance below. */}
      {!chipsOpen && !disabled && !isHardExcluded && !isNoted && !isSkipped && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <button
              onClick={onThumbsUp}
              className={`flex items-center justify-center w-12 h-12 rounded-xl border text-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a6b7f] focus-visible:ring-offset-2 ${
                isThumbsUp
                  ? "border-[#1a6b7f] bg-[#1a6b7f] text-white shadow-sm"
                  : "border-[#d4cfc5] text-[var(--text-muted)] hover:border-[#1a6b7f]/40 hover:text-[#1a6b7f]"
              }`}
              title="Interested"
              aria-label={`Interested in ${activity.name}`}
            >
              👍
            </button>
            <button
              onClick={onThumbsDown}
              className="flex items-center justify-center w-12 h-12 rounded-xl border border-[#d4cfc5] text-lg text-[var(--text-muted)] hover:border-red-500/40 hover:text-red-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              title="Not for me"
              aria-label={`Not for me: ${activity.name}`}
            >
              👎
            </button>
            <button
              onClick={onSkip}
              className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline-offset-4 hover:underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a6b7f] focus-visible:ring-offset-2 rounded px-2 py-1"
              title="Skip — not sure"
              aria-label={`Skip ${activity.name} — not sure`}
            >
              Not sure — skip
            </button>
          </div>
        </div>
      )}

      {/* Chips layer — always present immediately (fallback → dynamic swap happens silently) */}
      {chipsOpen && chipsEntry && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {chipsEntry.chips.map((chip) => (
              <button
                key={chip.label}
                onClick={() => onChipSelect(chip)}
                className="rounded-xl border border-[#d4cfc5] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[#b8b3a9] hover:text-[var(--text-primary)] transition-colors"
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-muted)]">Pick one to help us plan better.</p>
            <button
              onClick={onUndo}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              ← Undo
            </button>
          </div>
        </div>
      )}

      {/* Chip selected — hard exclusion */}
      {isHardExcluded && <p className="text-xs text-orange-400">We&apos;ll skip this.</p>}

      {/* Soft signal or no-chip submission */}
      {isNoted && <p className="text-xs text-[var(--text-muted)]">👎 Noted — we&apos;ll adjust.</p>}

      {/* PHI-28: skipped — distinct visual from thumbs-down so users see
          their conscious "not sure" was registered */}
      {isSkipped && (
        <p className="text-xs text-[var(--text-muted)]">Skipped — no preference recorded.</p>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

// PHI-48: useSearchParams() requires a Suspense boundary at build time.
// The default export below wraps this inner component in Suspense so the
// production prerender doesn't bail out. Local dev was forgiving — this
// only surfaced on Vercel build.
function WelcomePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  // PHI-48: one-time seed from `?destination=` query param sent by the
  // landing-page CTA. Treated as initial state, not a controlled value —
  // the user's edits to the destination input win after the seed fires.
  const seededFromUrlRef = useRef(false);

  // Trip data
  const [destination, setDestination] = useState("");
  const [destinationBias, setDestinationBias] = useState<{ lat: number; lng: number } | null>(null);
  // PHI-30: destinationVerified is true only when the user explicitly
  // selected a place from the autocomplete dropdown OR clicked the
  // "Use anyway" escape. Free-form typed text is *unverified* — Continue
  // is gated until the user resolves it. Closes the trust gap from the
  // May 2026 onboarding review where typing "Lisbon, Portugal" silently
  // resolved to a different place.
  const [destinationVerified, setDestinationVerified] = useState(false);
  // Follow-up #4: resolved PlaceRef for the primary destination — populated
  // either by the parser flow (via /api/resolve-place) or by future
  // PHI-30-aware autocomplete wiring. Persisted on save so the leg carries
  // lat/lng/id, not just a name.
  const [destinationPlace, setDestinationPlace] = useState<PlaceRef | null>(null);
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [hotel, setHotel] = useState("");
  // PHI-111: rich hotel payload captured when the user picks a Places
  // suggestion in step 2 (single-leg path). null when the user typed a
  // hotel name without picking a suggestion, or skipped the step entirely.
  // Flows to the API on save so the row's flat hotel_lat/lng columns and
  // legs[0]'s rich fields land in one shot.
  type HotelRich = {
    placeId: string;
    lat: number;
    lng: number;
    neighborhood: string | null;
  };
  const [hotelRich, setHotelRich] = useState<HotelRich | null>(null);

  // PHI-99: flex-date entry. When the user clicks "Not sure yet — I'm just
  // exploring →" below the Return field on step 1, we swap the two date
  // inputs for a month dropdown + nights stepper. Toggling between modes
  // preserves destination + hotel state — only the date/flex pair flips.
  // flexMonth carries an ISO month string (e.g. "2026-10") so the server
  // can parse it unambiguously regardless of locale.
  const [flexMode, setFlexMode] = useState(false);
  const [flexMonth, setFlexMonth] = useState("");
  const [flexNights, setFlexNights] = useState(5);

  // PHI-109: when the free-form parser inferred a duration ("5 days late
  // September") without explicit dates, capture that here so the
  // departure-date default effect uses the parser's number instead of the
  // hardcoded 7. Null on the structured-wizard path so the 7 fallback holds.
  const [parserInferredNights, setParserInferredNights] = useState<number | null>(null);

  // PHI-109 (regression fix): explicit "user has set Return" flag. The
  // previous empty-guard misfires on Chrome's `<input type="date">` —
  // when the user types `01/10/2026` keystroke-by-keystroke, the input
  // emits `onChange` after each year-segment completion (`0001-10-01`,
  // `0010-10-01`, `0102-10-01`, `2026-10-01`). With an empty-guard, the
  // FIRST emit (year 0001) lands the auto-default at year 0002, and
  // subsequent Departure-year emits don't update Return any more. The
  // flag lets the effect re-fire on every Departure change as long as
  // the user hasn't explicitly set Return — both the parser-typed-both-
  // dates case (flag flips true in applyParsedIntentAndAdvance) and the
  // user-typed-Return-on-step-1 case (flag flips true in the Return
  // input's onChange) keep their explicit value, while the keyboard-
  // typing-Departure-only case re-derives Return until Departure
  // stabilises. Cleared when Return is wiped so a future Departure edit
  // re-auto-fills.
  const [userTypedReturn, setUserTypedReturn] = useState(false);

  // PHI-100: soft neighbourhood picker on step 2. When the traveller hasn't
  // booked a hotel they can opt into picking a neighbourhood instead.
  // `neighborhoodPickerOpen` swaps the hotel input area for the cards.
  // Selecting one fills `anchorNeighborhood` and continues to step 3 —
  // downstream activity-gen / itinerary-gen receive it as a soft area
  // anchor when no hotel is set. No Anthropic call fires until the user
  // explicitly opens the picker; cards are cached per visit so reopening
  // doesn't re-bill.
  const [neighborhoodPickerOpen, setNeighborhoodPickerOpen] = useState(false);
  const [neighborhoodCards, setNeighborhoodCards] = useState<NeighborhoodCard[]>([]);
  const [neighborhoodsLoading, setNeighborhoodsLoading] = useState(false);
  const [neighborhoodsError, setNeighborhoodsError] = useState<string | null>(null);
  const [anchorNeighborhood, setAnchorNeighborhood] = useState("");

  // Preferences (Step 3)
  const [travelCompany, setTravelCompany] = useState("");
  const [adultCount, setAdultCount] = useState(2);
  const [childrenAges, setChildrenAges] = useState<string[]>([]);
  const [travelerTypes, setTravelerTypes] = useState<string[]>([]);
  const [budgetTier, setBudgetTier] = useState("");

  // PHI-35: optional constraints. tags are chip-toggleable; freeText is a
  // textarea for anything not covered by chips.
  const [constraintTags, setConstraintTags] = useState<string[]>([]);
  const [constraintText, setConstraintText] = useState("");

  // PHI-51: optional creative inspiration captured by the free-form parser.
  // Sits below constraint chips on the chip-confirm screen as an editable
  // chip ("Inspired by: Harry Potter"). Threaded into activity-gen and
  // itinerary-gen calls when set.
  const [inspiration, setInspiration] = useState("");

  // PHI-90: traveller-seeded must-dos. The new Step 4 collects a free-text
  // list (one item per line). Stored as a single string in component
  // state so the textarea round-trips naturally; we split + trim at save
  // time and at API-call time. Empty / whitespace-only = no anchors and
  // the existing prompt path runs unchanged.
  const [userSeededText, setUserSeededText] = useState("");

  // PHI-102 — popular picks panel state. Local to step 4; reset on
  // destination change because the cache key includes city. The panel is
  // collapsed by default so users who already have anchors aren't tempted
  // to skip their own typing. picksDisabled stays true for a destination
  // when Haiku returns <3 picks (sub-minimum fallback), so the affordance
  // hides for the rest of the session.
  type PopularPickRow = {
    name: string;
    context_note: string;
    category: "friction" | "fit" | "pro_tip";
  };
  const [popularPicksOpen, setPopularPicksOpen] = useState(false);
  const [popularPicks, setPopularPicks] = useState<PopularPickRow[]>([]);
  const [popularPicksLoading, setPopularPicksLoading] = useState(false);
  const [popularPicksError, setPopularPicksError] = useState<string | null>(null);
  // Per-destination disable — when Haiku returned <3 picks for this city,
  // hide the affordance for the rest of the session so the user isn't
  // staring at a dead button.
  const [popularPicksDisabledForDest, setPopularPicksDisabledForDest] = useState<string | null>(null);
  // Soft-cap nudge — once the user has added 5 picks via the panel in
  // this session, surface a one-time "Add anything else?" line. Fires
  // once per session regardless of which destination.
  const [popularPicksAddedCount, setPopularPicksAddedCount] = useState(0);
  const popularPicksNudgeFiredRef = useRef(false);

  // Account
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // PHI-47: only show the inline email error after the field has been
  // blurred at least once — typing "p" shouldn't immediately read as wrong.
  const [emailTouched, setEmailTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  // Partial traveler ID written to DB at step 3 advance
  const [travelerId, setTravelerId] = useState<string | null>(null);

  // AI Preview (step 4)
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  // PHI-53: trip-date forecast on the activity preview. null = forecast
  // unavailable, slow, or no bad days — render nothing. Non-empty array =
  // bad-day count for the rainy-day hint banner above the cards.
  const [previewBadDays, setPreviewBadDays] = useState<string[] | null>(null);

  // PHI-31 Part 2 slice 2: itinerary preview rendered on step 5 BEFORE
  // signup. Generated by /api/itinerary/generate using the full state we
  // already have (destination, dates, party, styles, activity feedback).
  const [itineraryPreview, setItineraryPreview] = useState<PreviewDay[] | null>(null);
  const [itineraryPreviewLoading, setItineraryPreviewLoading] = useState(false);
  const [itineraryPreviewError, setItineraryPreviewError] = useState<string | null>(null);
  // PHI-90: top-level "placement_notes" from /api/itinerary/generate when
  // an anchor was filtered out (wrong city) or couldn't be fitted. Mirrors
  // the response shape returned to /itinerary so the preview surfaces it
  // here too rather than swallowing it silently.
  const [itineraryPlacementNotes, setItineraryPlacementNotes] = useState<string | null>(null);
  const itineraryAbortRef = useRef<AbortController | null>(null);
  const itineraryViewedFiredRef = useRef(false);

  // PHI-34 UI: parser-mode landing. Per Sarah's PRD, the dual-CTA hero is
  // the default first impression — free-form textarea is primary, the
  // structured form is the fallback. parserPhase drives which view step 0
  // renders; once we leave step 0 the existing structured wizard runs.
  const [parserPhase, setParserPhase] = useState<
    "landing" | "parsing" | "confirming" | "structured"
  >("landing");
  const [parserText, setParserText] = useState("");
  const [parsedIntent, setParsedIntent] = useState<TripIntent | null>(null);
  const [parserError, setParserError] = useState<string | null>(null);
  // PHI-54: cities seeded from the curated atlas (case-insensitive). Used
  // to render a "suggested" tag on those destination chips so the user
  // knows they were proposed by Rise rather than typed.
  const [atlasSuggestedCities, setAtlasSuggestedCities] = useState<Set<string>>(
    new Set(),
  );
  // PHI-57: country-level destination state. When the user types a
  // country (Places result type === "country"), step 3.5 surfaces 4
  // AI-recommended cities/regions personalised to their preferences.
  const [countryRecommendations, setCountryRecommendations] = useState<
    { name: string; kind: "city" | "region"; why: string; lat?: number; lng?: number }[]
  >([]);
  const [countryRecsLoading, setCountryRecsLoading] = useState(false);
  const [countryRecsError, setCountryRecsError] = useState<string | null>(null);
  // Follow-up #4: resolved places for parser output. Keyed by destination
  // name as the parser returned it. Populated in the background while the
  // user is reviewing chips, so when they accept we already have lat/lng/id
  // for the structured form + persisted leg.
  const [resolvedPlaces, setResolvedPlaces] = useState<Record<string, PlaceRef>>({});
  // PHI-37 slice 4: per-leg night overrides edited on the chip-confirm
  // screen via the date allocator. Default empty — applyParsedIntentAndAdvance
  // falls back to equal-split when no override exists. Cleared on parse
  // start and on chip-screen "Start over".
  const [legNightOverrides, setLegNightOverrides] = useState<number[]>([]);
  // PHI-46: which chip on the chip-confirm screen is currently in edit
  // mode. Values: null | "destination-add" | "destination-N" | "dates"
  // | "adults". Replaces window.prompt() for these three chip types.
  const [editingChipKey, setEditingChipKey] = useState<string | null>(null);
  // PHI-46: live-typed value for the destination autocomplete during
  // inline edit. Snapshot taken when editing begins; the underlying
  // parsedIntent only updates on commit.
  const [destEditDraft, setDestEditDraft] = useState("");
  // PHI-37 slice 1: per-leg snapshot taken at chip-accept time. Holds the
  // parser's destinations (with resolved PlaceRefs where available) and a
  // per-leg night allocation. Empty / single-entry means single-leg path
  // and the existing `destination` field is the source of truth. 2+ entries
  // means the trip is multi-leg and we send `legs[]` to the API at save
  // time. Date allocation is equal-split for v1 (slice 4 will add a UI
  // for the user to override).
  const [parsedLegs, setParsedLegs] = useState<
    { place: PlaceRef; nights: number }[]
  >([]);
  // PHI-39: per-leg hotels for multi-leg trips. Indexed by leg, each
  // entry is the hotel name (free text via PlacesAutocomplete) or "" if
  // the user skipped that leg. For single-leg trips this stays empty
  // and the existing `hotel` state is the source of truth. Sized in
  // applyParsedIntentAndAdvance + chip-edit handlers to match parsedLegs.
  const [legHotels, setLegHotels] = useState<string[]>([]);
  // PHI-111: per-leg rich hotel payloads — parallel array to legHotels.
  // null entries = no rich data for that leg (user typed without picking,
  // or skipped). Persisted into legs[i] before save so each leg carries
  // its own coords; leg 0's coords additionally mirror to the flat
  // hotel_* columns for single-leg-aware consumers.
  const [legHotelsRich, setLegHotelsRich] = useState<(HotelRich | null)[]>([]);

  // Activity cards + feedback
  const [parsedActivities, setParsedActivities] = useState<ParsedActivity[]>([]);
  const [activityChips, setActivityChips] = useState<Record<string, ChipsEntry>>({});
  const [activityFeedback, setActivityFeedback] = useState<
    Record<string, ActivityFeedbackEntry>
  >({});
  const [openChipId, setOpenChipId] = useState<string | null>(null);
  const chipsFetchedRef = useRef<Set<string>>(new Set());
  // Tracks submitted activities so dynamic chip swaps don't disrupt in-flight interactions
  const submittedActivitiesRef = useRef<Set<string>>(new Set());
  // PHI-44: shown briefly when a step-4 stream restarts after the user
  // had prior ratings — explains why the rated cards just disappeared.
  // Cleared once the new stream finishes, or after a 4s timeout fallback.
  const [streamRefreshNote, setStreamRefreshNote] = useState(false);
  // PHI-44: ref-mirrored count of activityFeedback so the stream useEffect
  // can detect "had prior ratings" without subscribing to feedback updates
  // (which would re-fire the stream on every thumbs-up).
  const activityFeedbackCountRef = useRef(0);

  // PHI-64: detect an existing Supabase session so we can skip the
  // "Send magic link" form on step 5. authedUser carries the signed-in
  // user's id + email + a best-effort name (from auth metadata or a prior
  // traveler row). When non-null, step 5 saves the trip and routes
  // straight to /dashboard instead of mailing a magic link.
  type AuthedUser = { id: string; email: string; existingName: string | null };
  const [authedUser, setAuthedUser] = useState<AuthedUser | null>(null);
  // Guard so the auto-finish on step 5 only fires once per session.
  const autoFinishedRef = useRef(false);
  // PHI-88: Vercel Analytics — guard against double-firing magic_link_sent
  // for the same click (e.g. React strict-mode double-invocation in dev).
  const magicLinkSentRef = useRef(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session?.user) return;

      const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
      const metaName =
        (typeof meta.full_name === "string" && meta.full_name.trim()) ||
        (typeof meta.name === "string" && meta.name.trim()) ||
        null;

      let existingName: string | null = metaName || null;
      if (!existingName) {
        // Best-effort: a returning user who signed up earlier will have
        // their name on a previous traveler row linked by auth_user_id.
        const { data } = await supabase
          .from("travelers")
          .select("name")
          .eq("auth_user_id", session.user.id)
          .not("name", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data && typeof (data as { name?: unknown }).name === "string") {
          const n = (data as { name: string }).name.trim();
          if (n) existingName = n;
        }
      }
      if (cancelled) return;

      const sessionEmail = session.user.email ?? "";
      setAuthedUser({ id: session.user.id, email: sessionEmail, existingName });
      // Pre-fill name/email if the user hasn't typed anything yet. Functional
      // setState avoids overwriting an in-progress edit.
      if (existingName) setName((prev) => (prev.trim().length > 0 ? prev : existingName!));
      if (sessionEmail) setEmail((prev) => (prev.trim().length > 0 ? prev : sessionEmail));
    })();

    // If the session expires mid-flow we drop authedUser and the standard
    // anonymous step-5 form takes over.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session?.user) {
          setAuthedUser(null);
          autoFinishedRef.current = false;
        }
      },
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // PHI-109: re-derive Return from Departure ONLY when the user hasn't
  // explicitly set Return yet. `userTypedReturn` is the source of truth —
  // see the state definition above for why the original empty-guard
  // misfired on Chrome keyboard typing. When the parser supplies an
  // inferred duration (`parserInferredNights`), that's the preferred
  // offset over the hardcoded 7. The effect re-fires on every Departure
  // change so structured-wizard keyboard typing — which emits partial
  // dates per year-segment — eventually lands on the correct full year.
  useEffect(() => {
    if (!departureDate) return;
    if (userTypedReturn) return;
    setReturnDate(addDays(departureDate, parserInferredNights ?? 7));
  }, [departureDate, parserInferredNights, userTypedReturn]);

  // PHI-48 / PHI-58: seed once from query params sent by the landing page.
  // `?parser_text=` (PHI-58) takes precedence — when the homepage detects
  // free-form input it forwards the raw text here and we hand off straight
  // to the parser flow. Otherwise `?destination=` (PHI-48) drops the user
  // into Step 1 with the structured wizard pre-filled. The ref guard
  // prevents re-seeding when the user navigates back from later steps.
  useEffect(() => {
    if (seededFromUrlRef.current) return;
    const parserSeed = searchParams.get("parser_text")?.trim();
    if (parserSeed) {
      seededFromUrlRef.current = true;
      setParserText(parserSeed);
      // Strip the param from the URL so a refresh doesn't re-fire the
      // parser. replaceState skips the Next.js router on purpose — the
      // useSearchParams snapshot can stay stale, the ref guard already
      // prevents re-entry.
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("parser_text");
        window.history.replaceState(null, "", url.toString());
      }
      void submitFreeForm(parserSeed);
      return;
    }
    const seed = searchParams.get("destination")?.trim();
    if (!seed) return;
    seededFromUrlRef.current = true;
    handleDestinationSelect(seed);
    setStep(1);
    // PHI-88: URL-seed advance is still a step transition. SessionStorage
    // key matches the goTo() path so we don't double-fire if the user
    // re-enters /welcome with the same seed in the same tab.
    if (typeof window !== "undefined" && !sessionStorage.getItem("rise_va_step_1_fired")) {
      sessionStorage.setItem("rise_va_step_1_fired", "1");
      track("welcome_step_advanced", { step: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Derive valid trip type options from composition and auto-set/clear travelCompany
  useEffect(() => {
    if (childrenAges.length > 0) {
      setTravelCompany("family");
      return;
    }
    const validIds =
      adultCount === 1 ? ["solo"] :
      adultCount === 2 ? ["partner", "friends"] :
      ["friends", "family"];
    if (validIds.length === 1) {
      setTravelCompany(validIds[0]);
    } else {
      setTravelCompany((prev) => validIds.includes(prev) ? prev : "");
    }
  }, [adultCount, childrenAges.length]);

  // Clear style selections that are no longer available when company changes
  useEffect(() => {
    if (!travelCompany) return;
    const available = getStyleOptions(travelCompany);
    setTravelerTypes((prev) => prev.filter((t) => available.includes(t)));
  }, [travelCompany]);

  // PHI-44: auto-dismiss the "refreshing your picks" note after 4s so it
  // doesn't linger past the new stream's first cards arriving.
  useEffect(() => {
    if (!streamRefreshNote) return;
    const t = setTimeout(() => setStreamRefreshNote(false), 4000);
    return () => clearTimeout(t);
  }, [streamRefreshNote]);

  // PHI-44: keep activityFeedbackCountRef in sync without making the
  // stream useEffect depend on the full feedback object.
  useEffect(() => {
    activityFeedbackCountRef.current = Object.keys(activityFeedback).length;
  }, [activityFeedback]);

  // Follow-up #2 — Maya's Tier-3 escalation: modal-on-leave.
  // Once the user has invested real time (step 4+) and we don't yet have an
  // email, attach a beforeunload listener. Modern browsers ignore the custom
  // string and show their generic "Leave site? Changes you made may not be
  // saved" prompt — that's by design and is exactly what we want here.
  // The anonymous-session row keeps the trip alive on the server side; this
  // prompt just makes sure the user doesn't lose access by closing the tab
  // before they realise the trip is unsaved.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // PHI-90: previously step 4 (AI preview). Now step 5 — guard moved
    // along with the step renumber so the prompt fires at the same point
    // in the flow (after the AI preview has streamed in).
    const guarded = step >= 5 && !email && parsedActivities.length > 0;
    if (!guarded) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Required for legacy browsers; modern ones ignore the string.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [step, email, parsedActivities.length]);

  // Fire streaming preview when entering the AI-preview step — parse cards
  // incrementally. PHI-90 renumber: AI preview was step 4, now step 5.
  useEffect(() => {
    if (step !== 5) return;

    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewLoading(true);
    setParsedActivities([]);
    setPreviewBadDays(null);
    chipsFetchedRef.current = new Set();
    submittedActivitiesRef.current = new Set();
    // PHI-44: a stream restart after the user already rated cards would
    // leave their feedback attached to ID slots (act-0, act-1...) that
    // a new stream re-uses for different activities. Reset every piece
    // of feedback/chip state, and surface a one-line note explaining
    // why their ratings just disappeared. We read prior count from a
    // ref so the stream effect doesn't depend on the feedback object.
    const hadPriorFeedback = activityFeedbackCountRef.current > 0;
    setActivityFeedback({});
    setActivityChips({});
    setOpenChipId(null);
    if (hadPriorFeedback) setStreamRefreshNote(true);

    (async () => {
      let accumulated = "";
      let emittedCount = 0;
      try {
        // PHI-37 slice 2: include legs[] when multi-leg so the activity
        // stream is generated per-leg with LEG: <index> markers.
        const legsForApi = buildLegsForApi();
        const res = await fetch("/api/activities-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            destination,
            // PHI-99: dates only on the exact path; flex columns instead
            // when the user took the "I'm just exploring" route.
            ...(flexMode
              ? { flexMonth, flexNights }
              : {
                  departureDate: departureDate || "",
                  returnDate: returnDate || "",
                }),
            travelCompany: travelCompany || null,
            styleTags: travelerTypes.length > 0 ? travelerTypes : null,
            budgetTier: budgetTier || null,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
            // PHI-35: optional constraints. Empty fields are dropped server-side.
            constraintTags: constraintTags.length > 0 ? constraintTags : null,
            constraintText: constraintText.trim() || null,
            // PHI-51: optional creative-inspiration soft bias.
            inspiration: inspiration.trim() || null,
            // PHI-100: soft area anchor when no hotel is set.
            anchorNeighborhood: anchorNeighborhood || null,
            ...(legsForApi && { legs: legsForApi }),
          }),
        });
        if (!res.body) return;
        // PHI-53: forecast result is attached as a response header
        // (server runs Open-Meteo in parallel with the Anthropic stream).
        // Header is only set when bad days were detected — absence means
        // either no bad days, forecast unavailable, or out-of-horizon.
        // Treat absence as "no banner".
        try {
          const badDayHeader = res.headers.get("X-Bad-Day-Dates");
          if (badDayHeader) {
            const days: unknown = JSON.parse(badDayHeader);
            if (Array.isArray(days) && days.every((d) => typeof d === "string")) {
              setPreviewBadDays(days as string[]);
            }
          }
        } catch {
          // Malformed header — ignore.
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          // Parse all complete cards so far
          const all = parseActivities(accumulated);
          // A card is "complete" if there's a subsequent ** delimiter or we can count
          // that more text follows after the card's *When:...* line. We detect this
          // by checking if there's a next ** header after the current card's match.
          // Since parseActivities uses a greedy regex that only matches fully-formed
          // cards, we emit all parsed cards except the last one (which might still be
          // streaming) unless a new ** header follows it.
          const hasTrailingHeader = /\*When:[^*]+\*[^]*?\*\*/.test(
            accumulated.slice(accumulated.lastIndexOf("*When:"))
          );
          const safeCount = all.length > 0 && !hasTrailingHeader ? all.length - 1 : all.length;
          if (safeCount > emittedCount) {
            const newCards = all.slice(0, safeCount);
            emittedCount = safeCount;
            setParsedActivities(newCards);
          }
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== "AbortError") {
          console.error("[preview]", e);
        }
      }
      // Final parse — emit all remaining cards. PHI-32: always re-emit so
      // any rationales that arrived after a card was first emitted get
      // applied to the rendered cards.
      const final = parseActivities(accumulated);
      if (final.length > 0) {
        setParsedActivities(final);
      }
      setPreviewLoading(false);
    })();

    return () => {
      controller.abort();
    };
  }, [step, destination, departureDate, returnDate, flexMode, flexMonth, flexNights, travelCompany, travelerTypes, budgetTier]);

  // PHI-31 Part 2 slice 2: generate the itinerary preview when entering
  // the account step, so the user sees the actual product output BEFORE
  // the signup form. This is the activation lever: 4 of 5 personas in the
  // May 2026 review flagged forced-signup as drop-off; showing payoff
  // first should close most of that gap. PHI-90 renumber: account step
  // was 5, now 6.
  useEffect(() => {
    if (step !== 6) return;
    if (itineraryPreview || itineraryPreviewLoading) return; // already loaded / loading
    const controller = new AbortController();
    itineraryAbortRef.current = controller;
    setItineraryPreviewLoading(true);
    setItineraryPreviewError(null);

    (async () => {
      try {
        const feedbackArray = Object.values(activityFeedback);
        // PHI-37 slice 2: include legs[] when multi-leg so the day-by-day
        // plan covers every leg with transition days flagged.
        const legsForApi = buildLegsForApi();
        const res = await fetch("/api/itinerary/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            destination,
            // PHI-99: dates vs. flex columns per wizard mode.
            ...(flexMode
              ? { flexMonth, flexNights }
              : { departureDate, returnDate }),
            hotel: hotel || null,
            ...buildRichHotelFields(),
            travelCompany: travelCompany || null,
            travelerTypes,
            activityFeedback: feedbackArray,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
            // PHI-51: optional creative-inspiration soft bias.
            inspiration: inspiration.trim() || null,
            // PHI-90: traveller-seeded must-dos. Split + trimmed at the
            // boundary so the server sees a clean string[] regardless of
            // how the textarea was filled in. Empty list = no anchors,
            // generator behaves as before.
            userSeededActivities: splitSeededActivities(userSeededText),
            // PHI-100: soft area anchor when no hotel is set.
            anchorNeighborhood: anchorNeighborhood || null,
            ...(legsForApi && { legs: legsForApi }),
          }),
        });
        if (!res.ok) {
          const err = await res.text();
          setItineraryPreviewError(err || "Couldn't load your trip preview.");
          setItineraryPreviewLoading(false);
          return;
        }
        const data = (await res.json()) as {
          days?: PreviewDay[];
          placement_notes?: string | null;
        };
        if (Array.isArray(data.days) && data.days.length > 0) {
          setItineraryPreview(data.days);
          // PHI-90: hold onto placement_notes so the preview banner can
          // explain to the user when an anchor was filtered out (wrong
          // city) or couldn't be fitted.
          if (typeof data.placement_notes === "string" && data.placement_notes.trim().length > 0) {
            setItineraryPlacementNotes(data.placement_notes.trim());
          } else {
            setItineraryPlacementNotes(null);
          }
          // Cache for /itinerary so we don't regenerate after signup
          if (typeof window !== "undefined") {
            localStorage.setItem("rise_itinerary", JSON.stringify(data.days));
            if (typeof data.placement_notes === "string" && data.placement_notes.trim().length > 0) {
              localStorage.setItem(
                "rise_itinerary_placement_notes",
                data.placement_notes.trim(),
              );
            } else {
              localStorage.removeItem("rise_itinerary_placement_notes");
            }
          }
          // Telemetry — fire once per session
          if (!itineraryViewedFiredRef.current) {
            itineraryViewedFiredRef.current = true;
            logOnboardingEvent("itinerary_viewed", {
              dayCount: data.days.length,
              activityCount: data.days.reduce(
                (n: number, d) => n + (d.items?.length ?? 0),
                0
              ),
            });
          }
        } else {
          setItineraryPreviewError("Couldn't load your trip preview.");
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== "AbortError") {
          setItineraryPreviewError(e.message);
        }
      } finally {
        setItineraryPreviewLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // PHI-64: auto-finish on the account step when the user is already
  // signed in AND we already know their name (from auth metadata or a
  // prior traveler row). Fires once per session — the ref guard prevents
  // loops if the PATCH/redirect hasn't completed before a re-render. If
  // the session expires mid-flow the guard is reset by onAuthStateChange.
  // PHI-90 renumber: account step was 5, now 6.
  useEffect(() => {
    if (step !== 6) return;
    if (!authedUser?.existingName) return;
    if (autoFinishedRef.current) return;
    if (saving) return;
    autoFinishedRef.current = true;
    void handleFinish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, authedUser]);

  // Generate dynamic chips for each card in the background as soon as they're parsed.
  // On thumbs-down, fallback chips are shown immediately; dynamic chips replace them
  // silently when they arrive, unless the user has already submitted for that card.
  useEffect(() => {
    if (parsedActivities.length === 0) return;
    parsedActivities.forEach((activity) => {
      if (chipsFetchedRef.current.has(activity.id)) return;
      chipsFetchedRef.current.add(activity.id);
      fetch("/api/activity-chips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityName: activity.name,
          activityCategory: activity.category,
          travelCompany: travelCompany || null,
          styleTags: travelerTypes.length > 0 ? travelerTypes : null,
          budgetTier: budgetTier || null,
        }),
      })
        .then((r) => r.json())
        .then((data: { chips?: Chip[] }) => {
          if (!data.chips) return;
          setActivityChips((prev) => {
            // Don't swap if the user has already submitted feedback for this card
            if (submittedActivitiesRef.current.has(activity.id)) return prev;
            return { ...prev, [activity.id]: { chips: data.chips!, source: "dynamic" } };
          });
        })
        .catch(() => {});
    });
  }, [parsedActivities, travelCompany, travelerTypes, budgetTier]);

  // PHI-31 Part 2: write the partial trip state to the anonymous session
  // on every step advance. Fire-and-forget — client-side state remains the
  // primary source of truth during onboarding. Failures are silent (the
  // happy path doesn't depend on it; the row will catch up on next advance).
  // PHI-37 slice 1: build the TripLeg[] that we send to the API at save
  // time. Returns null when the trip is single-leg (parsedLegs.length <= 1)
  // — callers fall back to the existing flat-fields path. When multi-leg,
  // the leg list reflects parsedLegs (places + per-leg nights) anchored
  // on the current departureDate when one is set, so subsequent date
  // edits on the wizard flow through naturally. PHI-39 adds per-leg
  // hotels from legHotels — empty strings become null so the prompt knows
  // not to anchor on a hotel for that leg.
  // PHI-111: emit the four rich hotel fields onto the POST/PATCH body when
  // (a) the user picked a real Places suggestion and (b) the visible hotel
  // string is non-empty (skipping the step or clearing the typed text
  // invalidates a captured payload). Single-leg path only — multi-leg
  // routes the rich fields inside legs[i] via buildLegsForApi above.
  function buildRichHotelFields(): Record<string, unknown> {
    if (!hotelRich || !hotel.trim()) return {};
    return {
      hotelPlaceId: hotelRich.placeId,
      hotelLat: hotelRich.lat,
      hotelLng: hotelRich.lng,
      hotelNeighborhood: hotelRich.neighborhood,
    };
  }

  function buildLegsForApi(): TripLeg[] | null {
    if (parsedLegs.length < 2) return null;
    // PHI-99: when the wizard is in flex mode the leg list has no concrete
    // dates — leg.nights still carries the per-leg duration the parser
    // produced (or equalSplitNights against flex_nights when the user
    // edited it). The downstream prompt builders fall back to leg.nights
    // when startDate/endDate are absent.
    const start = !flexMode && departureDate ? departureDate : undefined;
    let cursor = start;
    return parsedLegs.map((leg, i) => {
      const startDate = cursor;
      const endDate = cursor ? addDays(cursor, leg.nights) : undefined;
      cursor = endDate;
      const legHotel = legHotels[i]?.trim() || null;
      // PHI-111: only attach rich coords when (a) the user picked a real
      // suggestion (legHotelsRich[i] is set) AND (b) the visible hotel
      // string still matches that selection. The onChange handler clears
      // the rich entry on free-text edits, so this guard is belt-and-
      // braces against an edge race where the typed string drifts.
      const rich = legHotelsRich[i];
      const richValid = !!rich && !!legHotel;
      return {
        id: newLegId(),
        place: leg.place,
        hotel: legHotel,
        ...(richValid && rich.placeId ? { hotelPlaceId: rich.placeId } : {}),
        ...(richValid && typeof rich.lat === "number" ? { hotelLat: rich.lat } : {}),
        ...(richValid && typeof rich.lng === "number" ? { hotelLng: rich.lng } : {}),
        ...(richValid && rich.neighborhood !== undefined
          ? { hotelNeighborhood: rich.neighborhood }
          : {}),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        // Always include the leg.nights so the prompt builder can render
        // per-leg night counts in flex mode. Cheap and harmless in
        // exact-date mode (startDate/endDate already win).
        ...(typeof leg.nights === "number" && leg.nights > 0
          ? { nights: leg.nights }
          : {}),
      };
    });
  }

  function patchAnonymousSession() {
    if (typeof window === "undefined") return;
    // PHI-37 slice 1: when the parser produced a multi-leg trip, send the
    // full legs[] array so all destinations are persisted (not just legs[0]).
    const legs = buildLegsForApi();
    const body = {
      destination,
      destinationVerified,
      // Follow-up #4: persist resolved place fields when available so the
      // anon session row can be claimed into a leg with lat/lng/id intact.
      ...(destinationPlace?.id && { destinationPlaceId: destinationPlace.id }),
      ...(destinationPlace?.lat != null && { destinationLat: destinationPlace.lat }),
      ...(destinationPlace?.lng != null && { destinationLng: destinationPlace.lng }),
      ...(destinationPlace?.type && { destinationPlaceType: destinationPlace.type }),
      ...(legs && { legs }),
      // PHI-99: dates only on the exact path; the anonymous-session row
      // mirrors the same shape so a /api/travelers/claim later doesn't
      // clobber the flex mode.
      ...(flexMode
        ? { flexMonth, flexNights }
        : { departureDate, returnDate }),
      hotel: hotel || null,
      ...buildRichHotelFields(),
      travelCompany: travelCompany || null,
      styleTags: travelerTypes,
      budgetTier: budgetTier || null,
      travelerCount: adultCount + childrenAges.length,
      childrenAges: childrenAges.length > 0 ? childrenAges : null,
      constraintTags: constraintTags.length > 0 ? constraintTags : null,
      constraintText: constraintText.trim() || null,
      activityFeedback: Object.values(activityFeedback),
    };
    fetch("/api/anonymous-session", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true, // tolerate page-unload mid-flight
    }).catch(() => {});
  }

  // PHI-31 Part 2: lightweight telemetry — fire-and-forget to the existing
  // activity-feedback endpoint which already accepts arbitrary event payloads.
  function logOnboardingEvent(event: string, extra?: Record<string, unknown>) {
    fetch("/api/activity-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        ...(extra ?? {}),
      }),
      keepalive: true,
    }).catch(() => {});
  }

  function goTo(next: number) {
    // Persist before navigating so the session row reflects what the user
    // saw. Skip on the very first advance from step 0 (we may not even
    // have a destination yet — and the API rejects empty trips).
    if (step > 0) patchAnonymousSession();
    setStep(next);
    setAnimKey((k) => k + 1);
    // PHI-88: fire welcome_step_advanced once per (tab session, target step).
    // Per-tab idempotency only — a fresh tab is a new walk and re-fires.
    if (typeof window !== "undefined") {
      const key = `rise_va_step_${next}_fired`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        track("welcome_step_advanced", { step: next });
      }
    }
  }

  function handleDestinationSelect(place: string) {
    setDestination(place);
    // PHI-30: confirmed selection from the autocomplete dropdown — the
    // user explicitly saw and accepted this place.
    setDestinationVerified(true);
    if (typeof window === "undefined" || !window.google?.maps) return;
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: place }, (results, status) => {
      if (status === "OK" && results?.[0]) {
        const loc = results[0].geometry.location;
        setDestinationBias({ lat: loc.lat(), lng: loc.lng() });
        // Follow-up #4: capture the autocomplete-confirmed place into the
        // PlaceRef so the saved leg has lat/lng (and place_id when the
        // geocoder returns one).
        const r = results[0] as google.maps.GeocoderResult & { place_id?: string };
        setDestinationPlace({
          name: place,
          ...(r.place_id && { id: r.place_id }),
          lat: loc.lat(),
          lng: loc.lng(),
        });
      }
    });
  }

  // PHI-30: typing into the destination input always invalidates the
  // verified state — the user is editing, so any prior selection is stale.
  function handleDestinationChange(text: string) {
    setDestination(text);
    setDestinationVerified(false);
    // Follow-up #4: clear the resolved PlaceRef when the user types, so
    // a stale lat/lng/id doesn't accompany the new name.
    setDestinationPlace(null);
  }

  // PHI-30: user explicitly chose to proceed with their typed text without
  // selecting from the dropdown (e.g. a region or unusual spelling). We
  // mark verified=true so they can continue, and the downstream payload
  // could carry an "unverified" flag if we wanted to tell the model to
  // be cautious. For Sprint 2 minimum, we just unblock Continue.
  function useDestinationAsTyped() {
    if (!destination.trim()) return;
    setDestinationVerified(true);
  }

  function toggleStyle(style: string) {
    setTravelerTypes((prev) => {
      if (prev.includes(style)) return prev.filter((s) => s !== style);
      if (prev.length >= MAX_STYLE_SELECTIONS) return prev;
      return [...prev, style];
    });
  }

  // PHI-35: constraint chips toggle on/off. No upper bound — users may
  // have several real constraints that all need respecting.
  function toggleConstraint(tag: string) {
    setConstraintTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function addChild() {
    // PHI-27: empty default so users must consciously pick an age range.
    // Pre-selecting "Under 2" was a trap — inattentive parents got
    // toddler-itineraries by default.
    setChildrenAges((prev) => [...prev, ""]);
  }

  function updateChildAge(idx: number, age: string) {
    setChildrenAges((prev) => prev.map((a, i) => (i === idx ? age : a)));
  }

  function removeChild(idx: number) {
    setChildrenAges((prev) => prev.filter((_, i) => i !== idx));
  }

  // Activity feedback handlers
  function handleThumbsUp(activity: ParsedActivity) {
    const current = activityFeedback[activity.id];
    if (current?.feedbackType === "thumbs_up") {
      // Deselect — return to neutral
      setActivityFeedback((prev) => {
        const next = { ...prev };
        delete next[activity.id];
        return next;
      });
      return;
    }
    setActivityFeedback((prev) => ({
      ...prev,
      [activity.id]: {
        activityId: activity.id,
        activityName: activity.name,
        activityCategory: activity.category,
        feedbackType: "thumbs_up",
      },
    }));
    logActivityEvent({
      event: "thumbs_up",
      activityId: activity.id,
      activityName: activity.name,
      activityCategory: activity.category,
      inspiration: inspiration.trim() || null,
      inspirationStrength: inspiration.trim() ? (childrenAges.length > 0 ? "family" : "adult") : null,
    });
  }

  function handleThumbsDown(activity: ParsedActivity) {
    const current = activityFeedback[activity.id];
    // Clear any existing feedback (e.g. thumbs-up) before opening chips
    if (current) {
      setActivityFeedback((prev) => {
        const next = { ...prev };
        delete next[activity.id];
        return next;
      });
    }
    // Set fallback chips immediately so they're present the instant the layer opens.
    // If dynamic chips are already loaded, they take precedence.
    setActivityChips((prev) => {
      if (prev[activity.id]) return prev;
      return { ...prev, [activity.id]: { chips: FALLBACK_CHIPS, source: "fallback" } };
    });
    setOpenChipId(activity.id);
    logActivityEvent({
      event: "chips_shown",
      activityId: activity.id,
      activityName: activity.name,
      activityCategory: activity.category,
      inspiration: inspiration.trim() || null,
      inspirationStrength: inspiration.trim() ? (childrenAges.length > 0 ? "family" : "adult") : null,
    });
  }

  function handleChipSelect(activity: ParsedActivity, chip: Chip) {
    const chipsEntry = activityChips[activity.id];
    submittedActivitiesRef.current.add(activity.id);
    setActivityFeedback((prev) => ({
      ...prev,
      [activity.id]: {
        activityId: activity.id,
        activityName: activity.name,
        activityCategory: activity.category,
        feedbackType: "chip_selected",
        chip,
      },
    }));
    setOpenChipId(null);
    logActivityEvent({
      event: "chip_selected",
      activityId: activity.id,
      activityName: activity.name,
      activityCategory: activity.category,
      chipLabel: chip.label,
      chipType: chip.type,
      chipsSource: chipsEntry?.source ?? "fallback",
      firstChipLabel: chipsEntry?.chips[0]?.label ?? "",
      inspiration: inspiration.trim() || null,
      inspirationStrength: inspiration.trim() ? (childrenAges.length > 0 ? "family" : "adult") : null,
    });
  }

  // PHI-28: skipping is a *distinct* signal from "no rating yet" — the user
  // saw the card and consciously chose not to commit. Track separately so
  // the model can use it (or not) downstream without confusing it with the
  // unrated cards.
  function handleSkip(activity: ParsedActivity) {
    setActivityFeedback((prev) => ({
      ...prev,
      [activity.id]: {
        activityId: activity.id,
        activityName: activity.name,
        activityCategory: activity.category,
        feedbackType: "skipped",
      },
    }));
    logActivityEvent({
      event: "skipped",
      activityId: activity.id,
      activityName: activity.name,
      activityCategory: activity.category,
      inspiration: inspiration.trim() || null,
      inspirationStrength: inspiration.trim() ? (childrenAges.length > 0 ? "family" : "adult") : null,
    });
  }

  function handleRemoveExclusion(activityId: string) {
    const entry = activityFeedback[activityId];
    if (!entry) return;
    setActivityFeedback((prev) => {
      const next = { ...prev };
      delete next[activityId];
      return next;
    });
    logActivityEvent({
      event: "exclusion_removed",
      activityId,
      activityName: entry.activityName,
      activityCategory: entry.activityCategory,
      inspiration: inspiration.trim() || null,
      inspirationStrength: inspiration.trim() ? (childrenAges.length > 0 ? "family" : "adult") : null,
    });
  }

  const hardExcludedActivities = Object.values(activityFeedback).filter(
    (f) => f.feedbackType === "chip_selected" && f.chip?.type === "hard_exclusion"
  );

  // PHI-57: derived — destination resolved to a country (vs city/region).
  // Prefer the parser's resolvedPlaces lookup (free-form path); fall back
  // to the structured-form destinationPlace state when the user came in
  // via the autocomplete on /welcome step 0.
  const resolvedDestinationKind =
    resolvedPlaces[destination]?.type ?? destinationPlace?.type;
  const isCountryDestination = resolvedDestinationKind === "country";
  // Persist country alongside resolved city. Best-effort, fire-and-forget.
  function patchCountry(country: string) {
    if (!travelerId) return;
    void fetch("/api/travelers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: travelerId, country }),
    }).catch(() => {});
  }
  // PHI-57: load 4 AI city recommendations for the current country.
  async function fetchCountryRecommendations() {
    setCountryRecsLoading(true);
    setCountryRecsError(null);
    try {
      const res = await fetch("/api/destinations/cities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: destination,
          preferences: {
            travelCompany,
            styleTags: travelerTypes,
            budgetTier,
            travelerCount: adultCount + childrenAges.length,
            childrenAges,
          },
        }),
      });
      if (!res.ok) {
        setCountryRecsError("Couldn't load suggestions — try a city directly.");
        setCountryRecommendations([]);
        return;
      }
      const data = (await res.json()) as {
        recommendations?: { name: string; kind: "city" | "region"; why: string; lat?: number; lng?: number }[];
      };
      setCountryRecommendations(data.recommendations ?? []);
    } catch {
      setCountryRecsError("Couldn't load suggestions — try a city directly.");
      setCountryRecommendations([]);
    } finally {
      setCountryRecsLoading(false);
    }
  }
  // PHI-57: pick a recommended city → resolve it, set destination, advance.
  function pickRecommendedCity(name: string) {
    patchCountry(destination);
    setDestination(name);
    setDestinationVerified(true);
    void resolveParsedDestinations([{ name }]);
    setCountryRecommendations([]);
    goTo(4);
  }

  // PHI-100: open the soft neighbourhood picker. No Anthropic call on
  // mount of step 2 — only here, on explicit user click. Idempotent: if
  // we already have cards for the current destination we skip the fetch.
  async function openNeighborhoodPicker() {
    const dest = destination.trim();
    if (!dest) return;
    setNeighborhoodPickerOpen(true);
    setNeighborhoodsError(null);
    if (neighborhoodCards.length > 0) return;
    setNeighborhoodsLoading(true);
    try {
      // PHI-107: thread childrenAges so the route shards the cache and
      // engages the system prompt's family-mode rules. Empty/null array
      // hits the non-family cache row, byte-identical to pre-PHI-107.
      const res = await fetch("/api/neighborhoods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: dest, childrenAges }),
      });
      if (!res.ok) {
        setNeighborhoodsError("Couldn't load neighbourhoods. Try again?");
        return;
      }
      const data = (await res.json()) as { neighborhoods?: NeighborhoodCard[] };
      if (Array.isArray(data.neighborhoods) && data.neighborhoods.length > 0) {
        setNeighborhoodCards(data.neighborhoods);
      } else {
        setNeighborhoodsError("No neighbourhoods returned. Try again?");
      }
    } catch {
      setNeighborhoodsError("Couldn't load neighbourhoods. Try again?");
    } finally {
      setNeighborhoodsLoading(false);
    }
  }

  // PHI-100: pick a neighbourhood card. Hotel and anchor are mutually
  // exclusive — choosing a neighbourhood clears any half-typed hotel,
  // mirroring the skip link's behaviour.
  function pickNeighborhood(name: string) {
    setAnchorNeighborhood(name);
    setHotel("");
    // PHI-111: picking a neighbourhood is mutually exclusive with a booked
    // hotel — drop any rich payload we captured before the user pivoted.
    setHotelRich(null);
    setNeighborhoodPickerOpen(false);
    void handleContinue();
  }

  // PHI-102 — fetch popular picks. Lazy; only fires on explicit "See popular
  // picks" click. Idempotent for the same (destination, profile) — if we
  // already have picks loaded for the current destination we don't refetch.
  async function openPopularPicks() {
    const dest = destination.trim();
    if (!dest) return;
    setPopularPicksOpen(true);
    setPopularPicksError(null);
    if (popularPicks.length > 0) return;
    if (popularPicksDisabledForDest === dest) return;
    setPopularPicksLoading(true);
    try {
      const res = await fetch("/api/destination/popular-picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: dest,
          travelCompany: travelCompany || null,
          childrenAges: childrenAges.length > 0 ? childrenAges : null,
          styleTags: travelerTypes,
        }),
      });
      if (!res.ok) {
        setPopularPicksError("Couldn't load popular picks. Try again?");
        return;
      }
      const data = (await res.json()) as { picks?: PopularPickRow[] };
      const picks = Array.isArray(data.picks) ? data.picks : [];
      if (picks.length === 0) {
        // Sub-minimum fallback — disable the affordance for this dest.
        setPopularPicksDisabledForDest(dest);
        setPopularPicks([]);
      } else {
        setPopularPicks(picks);
        // Telemetry — fire one pick_shown event per surfaced row, in the
        // shape extended by the route's metadata-harvest path (PHI-45).
        for (const pick of picks) {
          void fetch("/api/activity-feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "pick_shown",
              activityName: pick.name,
              activityCategory: pick.category,
              city: dest,
              travelCompany: travelCompany || null,
              picks_source: "popular-picks",
            }),
          }).catch(() => {});
        }
      }
    } catch {
      setPopularPicksError("Couldn't load popular picks. Try again?");
    } finally {
      setPopularPicksLoading(false);
    }
  }

  // PHI-102 — derive added/not-added state from the textarea on every
  // render. Textarea is the single source of truth (hard constraint).
  // Match case-insensitive on the trimmed pick name appearing on its own
  // line in the textarea.
  function isPickAdded(pickName: string): boolean {
    const target = pickName.trim().toLowerCase();
    if (!target) return false;
    const lines = userSeededText.split(/\r?\n/);
    return lines.some((line) => line.trim().toLowerCase() === target);
  }

  function addPick(pick: { name: string; category: string }) {
    if (isPickAdded(pick.name)) return;
    const current = userSeededText;
    const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
    setUserSeededText(current + sep + pick.name);
    const nextCount = popularPicksAddedCount + 1;
    setPopularPicksAddedCount(nextCount);
    void fetch("/api/activity-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "pick_added",
        activityName: pick.name,
        activityCategory: pick.category,
        city: destination.trim(),
        travelCompany: travelCompany || null,
        picks_source: "popular-picks",
      }),
    }).catch(() => {});
  }

  function removePick(pick: { name: string; category: string }) {
    const target = pick.name.trim().toLowerCase();
    if (!target) return;
    const next = userSeededText
      .split(/\r?\n/)
      .filter((line) => line.trim().toLowerCase() !== target)
      .join("\n");
    setUserSeededText(next);
    void fetch("/api/activity-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "pick_removed",
        activityName: pick.name,
        activityCategory: pick.category,
        city: destination.trim(),
        travelCompany: travelCompany || null,
        picks_source: "popular-picks",
      }),
    }).catch(() => {});
  }

  // PHI-90: PATCH the must-dos onto the traveler row when leaving step 4.
  // Best-effort partial write — if the row isn't created yet (rare —
  // savePreferencesToDb at step 3 creates it), we silently skip and the
  // localStorage payload still carries the seeded list. handleFinish PATCHes
  // again at sign-up so nothing is lost.
  async function saveSeededActivitiesToDb() {
    if (!travelerId) return;
    try {
      await fetch("/api/travelers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: travelerId,
          userSeededActivities: splitSeededActivities(userSeededText),
        }),
      });
    } catch {
      // Non-fatal — list is in component state and localStorage.
    }
  }

  // Write preferences to DB when advancing from step 3 to step 4
  async function savePreferencesToDb() {
    try {
      if (travelerId) {
        await fetch("/api/travelers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: travelerId,
            travelCompany: travelCompany || null,
            styleTags: travelerTypes.length > 0 ? travelerTypes : null,
            budgetTier: budgetTier || null,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
            // PHI-100: persist the soft neighbourhood anchor if picked on
            // step 2. Empty string is a valid "no anchor" signal — the
            // server treats it as null.
            anchorNeighborhood: anchorNeighborhood || null,
            // PHI-99: keep the row coherent with the wizard mode. When the
            // user later changes mind on step 1 (or jumps back) the patch
            // explicitly clears the unused pair so the row never carries
            // both an exact-date leg and flex columns.
            ...(flexMode
              ? { flexMonth, flexNights }
              : { flexMonth: null, flexNights: null }),
          }),
        });
      } else {
        // PHI-37 slice 1: send full legs[] when multi-leg.
        const legs = buildLegsForApi();
        const res = await fetch("/api/travelers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination,
            // Follow-up #4: include resolved place data when available so
            // the leg's place_id / lat / lng land in the JSONB on first write.
            ...(destinationPlace?.id && { destinationPlaceId: destinationPlace.id }),
            ...(destinationPlace?.lat != null && { destinationLat: destinationPlace.lat }),
            ...(destinationPlace?.lng != null && { destinationLng: destinationPlace.lng }),
            ...(destinationPlace?.type && { destinationPlaceType: destinationPlace.type }),
            ...(legs && { legs }),
            // PHI-99: omit date fields entirely in flex mode so the leg's
            // startDate/endDate stay undefined. The flex columns carry the
            // duration signal instead.
            ...(flexMode
              ? { flexMonth, flexNights }
              : { departureDate, returnDate }),
            hotel: hotel || null,
            ...buildRichHotelFields(),
            travelCompany: travelCompany || null,
            styleTags: travelerTypes.length > 0 ? travelerTypes : null,
            budgetTier: budgetTier || null,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
            activities: [],
            // PHI-100: include on first write so the row carries the anchor.
            ...(anchorNeighborhood && { anchorNeighborhood }),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setTravelerId(data.id ?? null);
        }
      }
    } catch {
      // Non-fatal: preferences are in state; partial write is best-effort
    }
  }

  async function handleFinish() {
    setSaving(true);
    // PHI-31 Part 2: fire signup-after-itinerary telemetry. Today this
    // event is emitted *before* the user has actually viewed the itinerary
    // (because the itinerary-pre-signup view is a follow-up). Once that
    // ships, the event meaning aligns with the design — for now, it
    // captures every welcome → signup transition.
    logOnboardingEvent("signup_initiated_after_itinerary", {
      hasActivityFeedback: Object.keys(activityFeedback).length,
    });
    // PHI-64: when the visitor is already signed in, the canonical email
    // is the session email — never overwrite it with whatever sits in
    // the (hidden) email state. Name comes from the form when collected,
    // else from auth metadata / a prior traveler row.
    const finalEmail = authedUser?.email || email;
    const finalName = name.trim().length > 0 ? name : (authedUser?.existingName ?? "");
    // PHI-59: Step 5 no longer creates the account directly. We persist
    // name + email on the existing traveler row, save the local snapshot,
    // then send a magic link. The /auth/callback handler links the row
    // to auth.users.id once the user clicks the email.
    // PHI-74: when the user is already signed in we skip the magic link
    // entirely and hand off to /auth/claim so the PHI-60 conflict UI
    // can reconcile the new trip against any existing primary trip.
    let resolvedTravelerId = travelerId;
    // PHI-90: seeded list at finish-time — covers both happy path (already
    // patched onto the row from step 4) and the fallback POST below where
    // the row didn't exist yet.
    const seededAtFinish = splitSeededActivities(userSeededText);
    try {
      if (travelerId) {
        await fetch("/api/travelers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: travelerId,
            name: finalName,
            email: finalEmail,
            // Re-PATCH the must-dos so they reach the row even if the
            // step-4 partial write failed.
            userSeededActivities: seededAtFinish,
            // PHI-100: re-PATCH the neighbourhood anchor for the same
            // reason — guards against a step-3 partial-write that
            // silently dropped the column.
            anchorNeighborhood: anchorNeighborhood || null,
            // PHI-99: re-assert the date-or-flex mode on finish too. If
            // the step-3 partial PATCH already set this, the second write
            // is idempotent.
            ...(flexMode
              ? { flexMonth, flexNights }
              : { flexMonth: null, flexNights: null }),
          }),
        });
      } else {
        // Fallback: partial-write at step 3 didn't land. Create the row
        // now with full payload so we have something to link to.
        const legs = buildLegsForApi();
        const res = await fetch("/api/travelers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: finalName,
            email: finalEmail,
            destination,
            ...(destinationPlace?.id && { destinationPlaceId: destinationPlace.id }),
            ...(destinationPlace?.lat != null && { destinationLat: destinationPlace.lat }),
            ...(destinationPlace?.lng != null && { destinationLng: destinationPlace.lng }),
            ...(destinationPlace?.type && { destinationPlaceType: destinationPlace.type }),
            ...(legs && { legs }),
            // PHI-99: omit date fields in flex mode (same shape as
            // savePreferencesToDb's POST).
            ...(flexMode
              ? { flexMonth, flexNights }
              : { departureDate, returnDate }),
            hotel: hotel || null,
            ...buildRichHotelFields(),
            travelCompany: travelCompany || null,
            styleTags: travelerTypes.length > 0 ? travelerTypes : null,
            budgetTier: budgetTier || null,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
            activities: [],
            // PHI-90: include the must-dos in the fallback POST too, so the
            // row carries the field on first write.
            ...(seededAtFinish.length > 0 && {
              userSeededActivities: seededAtFinish,
            }),
            // PHI-100: same shape as the must-dos — only include the
            // anchor when set so legacy callers stay clean.
            ...(anchorNeighborhood && { anchorNeighborhood }),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          resolvedTravelerId = data.id ?? null;
          setTravelerId(resolvedTravelerId);
        }
      }
    } catch {}
    // PHI-37 slice 3: persist legs[] in the local snapshot so /itinerary
    // can render leg headers + transition-day chrome without a refetch.
    const legsForStorage = buildLegsForApi();
    // PHI-90: cache the user-seeded must-dos on the local snapshot so the
    // /itinerary page can pass them through to /api/itinerary/generate on
    // a fresh-cache regenerate. Empty list = undefined → key is omitted
    // (`...(seeded.length && { ... })`) so legacy travelers stay clean.
    const seededForStorage = splitSeededActivities(userSeededText);
    const travelerData = {
      id: resolvedTravelerId,
      name: finalName,
      email: finalEmail,
      destination,
      // PHI-99: in flex mode the dates are empty strings — leave them
      // empty in the snapshot. The flex pair carries the duration signal
      // and downstream readers (dashboard, /itinerary) check flexMonth
      // first.
      departureDate: flexMode ? "" : departureDate,
      returnDate: flexMode ? "" : returnDate,
      hotel: hotel || null,
      ...buildRichHotelFields(),
      travelCompany,
      travelerCount: adultCount + childrenAges.length,
      childrenAges: childrenAges.length > 0 ? childrenAges : null,
      travelerTypes,
      budgetTier,
      constraintTags: constraintTags.length > 0 ? constraintTags : null,
      constraintText: constraintText.trim() || null,
      activities: [],
      ...(legsForStorage && { legs: legsForStorage }),
      ...(seededForStorage.length > 0 && { userSeededActivities: seededForStorage }),
      // PHI-100: persist the soft neighbourhood anchor so /itinerary and
      // any later regenerate path can pass it back to the AI prompts when
      // no hotel is set. Omitted when empty so legacy snapshots stay clean.
      ...(anchorNeighborhood && { anchorNeighborhood }),
      // PHI-99: persist the flex pair so the dashboard date-lock nudge
      // can detect that the user is in flex mode on a return visit, and
      // so /itinerary can pass it back to /api/itinerary/generate on a
      // regenerate without needing to refetch from Supabase.
      ...(flexMode ? { flexMonth, flexNights } : {}),
    };
    localStorage.setItem("rise_traveler", JSON.stringify(travelerData));
    localStorage.setItem("rise_onboarded", "true");
    const feedbackArray = Object.values(activityFeedback);
    localStorage.setItem("rise_activity_feedback", JSON.stringify(feedbackArray));

    // PHI-74: signed-in path — hand off to /auth/claim so the PHI-60
    // conflict UI can resolve the new trip against any existing primary
    // trip on this account. We deliberately do NOT pre-link auth_user_id
    // here: the claim API owns linking as part of the chosen action
    // (keep_local / use_saved / save_both), and pre-linking would leave
    // an orphaned linked row if the user picks "Use saved trip".
    // localStorage.rise_traveler stays — /auth/claim reads it.
    if (authedUser) {
      setSaving(false);
      // PHI-88: signed-in completion. Fire-and-forget; sessionStorage guard
      // covers both the explicit submit and the auto-finish useEffect.
      if (typeof window !== "undefined" && !sessionStorage.getItem("rise_va_completed_fired")) {
        sessionStorage.setItem("rise_va_completed_fired", "1");
        track("welcome_completed", { signedIn: true });
      }
      router.push("/auth/claim?next=/dashboard");
      return;
    }

    // PHI-59: send magic link, then route to the check-email interstitial.
    // emailRedirectTo points at /auth/callback (allowlisted in middleware
    // so the email link works behind the SITE_PASSWORD gate). travelerId
    // is preserved through the link so the callback can write it onto
    // travelers.auth_user_id once the session is established.
    const supabaseAuth = getSupabaseBrowserClient();
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", "/dashboard");
    if (resolvedTravelerId) {
      callbackUrl.searchParams.set("travelerId", resolvedTravelerId);
    }
    const { error: otpErr } = await supabaseAuth.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: callbackUrl.toString() },
    });
    setSaving(false);
    if (otpErr) {
      console.error("[welcome] magic link failed:", otpErr.message);
      // Don't strand the user — fall back to the legacy local-only path
      // so they still see their itinerary. Account-link can happen later
      // from the homepage Sign in CTA.
      router.push("/itinerary");
      return;
    }
    // PHI-88: magic_link_sent — useRef-guarded so a stray double-invocation
    // in dev / strict-mode doesn't double-fire for the same click.
    if (!magicLinkSentRef.current) {
      magicLinkSentRef.current = true;
      track("magic_link_sent", { source: "welcome" });
    }
    // PHI-88: welcome_completed for the magic-link path.
    if (typeof window !== "undefined" && !sessionStorage.getItem("rise_va_completed_fired")) {
      sessionStorage.setItem("rise_va_completed_fired", "1");
      track("welcome_completed", { signedIn: false });
    }
    const checkEmailParams = new URLSearchParams();
    checkEmailParams.set("email", email.trim());
    if (resolvedTravelerId) checkEmailParams.set("travelerId", resolvedTravelerId);
    router.push(`/auth/check-email?${checkEmailParams.toString()}`);
  }

  // ── Step 0: Full-screen landing ────────────────────────────────────────────

  // ── PHI-34 UI: dual-CTA landing ────────────────────────────────────────
  // Default first impression. Free-form textarea → /api/parse-trip → chips
  // confirmation → pre-fill state and advance. Structured form remains
  // available via the "Or step by step →" link.
  // PHI-58: accepts an optional text override so the homepage handoff can
  // submit before parserText state has been committed in React.
  async function submitFreeForm(textOverride?: string) {
    const text = textOverride ?? parserText;
    if (!text.trim()) return;
    setParserPhase("parsing");
    setParserError(null);
    // PHI-37 slice 4: clear stale per-leg night overrides when the user
    // re-parses; the allocator initialises again on the new chip screen.
    setLegNightOverrides([]);
    // PHI-46: drop any open inline editor before showing fresh chips.
    setEditingChipKey(null);
    setDestEditDraft("");
    logOnboardingEvent("freeform_initiated", { length: text.length });
    try {
      const res = await fetch("/api/parse-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const err = await res.text();
        setParserError(err || "Couldn't read that — try the structured form below.");
        setParserPhase("landing");
        return;
      }
      const data = (await res.json()) as {
        intent: TripIntent;
        suggestedLegs?: { city: string; country: string; nights: number; source: "atlas" }[];
      };
      // PHI-54: if the atlas matched the inspiration AND the parser
      // didn't already extract destinations the user mentioned, fold the
      // suggested legs into intent.destinations so they render on the
      // chip-confirm screen with a "suggested" tag. User can remove
      // freely. Never overwrite user-typed destinations.
      let intent = data.intent;
      if (
        data.suggestedLegs &&
        data.suggestedLegs.length > 0 &&
        intent.destinations.length === 0
      ) {
        intent = {
          ...intent,
          destinations: data.suggestedLegs.map((l) => ({
            name: l.city,
            kind: "place" as const,
          })),
        };
        setAtlasSuggestedCities(
          new Set(data.suggestedLegs.map((l) => l.city.toLowerCase())),
        );
      } else {
        setAtlasSuggestedCities(new Set());
      }
      setParsedIntent(intent);
      setParserPhase("confirming");
      logOnboardingEvent(
        intent.clarifications.length > 0
          ? "freeform_required_clarification"
          : "freeform_parsed_clean",
        {
          clarifications: intent.clarifications.length,
          atlasMatched: !!data.suggestedLegs,
        }
      );
      // Follow-up #4: kick off place resolution in the background while the
      // user reviews the chips. Parallel + fire-and-forget; failures fall
      // through to the unverified-name path on accept.
      void resolveParsedDestinations(intent.destinations);
    } catch (e: unknown) {
      setParserError(e instanceof Error ? e.message : "Network error.");
      setParserPhase("landing");
    }
  }

  // Follow-up #4: resolve a list of parser-produced destinations to PlaceRefs.
  // Runs in parallel; merges results into resolvedPlaces as each one returns.
  // Skips entries already resolved (covers chip-edits where most destinations
  // are unchanged).
  async function resolveParsedDestinations(
    destinations: { name: string; kind?: string }[]
  ) {
    const work = destinations
      .filter((d) => d.name && !resolvedPlaces[d.name])
      .map(async (d) => {
        try {
          const r = await fetch("/api/resolve-place", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: d.name, hint: d.kind ?? null }),
          });
          if (!r.ok) return null;
          const body = (await r.json()) as { resolved: PlaceRef | null };
          return body.resolved ? ([d.name, body.resolved] as const) : null;
        } catch {
          return null;
        }
      });
    const settled = await Promise.all(work);
    const next: Record<string, PlaceRef> = {};
    for (const entry of settled) {
      if (entry) next[entry[0]] = entry[1];
    }
    if (Object.keys(next).length) {
      setResolvedPlaces((prev) => ({ ...prev, ...next }));
    }
  }

  function applyParsedIntentAndAdvance() {
    if (!parsedIntent) return;
    // Pre-fill structured state from the parsed intent. The user already
    // approved the chips, so we trust the parse output going forward.
    const first = parsedIntent.destinations[0];
    if (first?.name) {
      setDestination(first.name);
      setDestinationVerified(true);
      // Follow-up #4: pull the resolved PlaceRef (if the background
      // resolution finished). Fall back to a name-only PlaceRef marked
      // unverified so downstream readers can tell the difference.
      const resolved = resolvedPlaces[first.name];
      setDestinationPlace(
        resolved ?? { name: first.name, unverified: true }
      );
      // Capture lat/lng for the autocomplete bias on the structured form,
      // matching what handleDestinationSelect would do.
      if (resolved?.lat != null && resolved?.lng != null) {
        setDestinationBias({ lat: resolved.lat, lng: resolved.lng });
      }
    }
    // PHI-37 slice 1+4: snapshot all parsed destinations into parsedLegs
    // so we can persist a full TripLeg[] when the user saves. We don't
    // persist legs (only legs[0] gets used) when there's a single
    // destination — that's the current single-leg path.
    const dests = parsedIntent.destinations.filter((d) => d.name);
    if (dests.length >= 2) {
      const totalNights =
        parsedIntent.dates.durationNights ??
        nightsBetween(parsedIntent.dates.departure, parsedIntent.dates.return) ??
        0;
      // Slice 4: prefer the user's allocator overrides when they edited
      // them on the chip-confirm screen; fall back to equal-split.
      const split =
        legNightOverrides.length === dests.length
          ? legNightOverrides
          : equalSplitNights(dests.length, totalNights);
      setParsedLegs(
        dests.map((d, i) => ({
          place:
            resolvedPlaces[d.name] ?? { name: d.name, unverified: true },
          nights: split[i] ?? 0,
        }))
      );
      // PHI-39: initialise per-leg hotel slots (one empty string per leg).
      // The user fills these in step 2.
      setLegHotels(new Array(dests.length).fill(""));
      // PHI-111: parallel rich-payload array, same length as legHotels.
      setLegHotelsRich(new Array(dests.length).fill(null));
    } else {
      // Single-leg: keep parsedLegs empty so persistence falls through
      // to the existing single-leg path.
      setParsedLegs([]);
      setLegHotels([]);
      setLegHotelsRich([]);
    }
    // PHI-109: capture the parser's nights inference so the date-default
    // effect uses it (instead of the hardcoded 7) when the user only set a
    // duration on the chip screen and picks a departure on step 1.
    if (
      typeof parsedIntent.dates.durationNights === "number" &&
      parsedIntent.dates.durationNights > 0
    ) {
      setParserInferredNights(parsedIntent.dates.durationNights);
    }
    if (parsedIntent.dates.departure) setDepartureDate(parsedIntent.dates.departure);
    if (parsedIntent.dates.return) {
      setReturnDate(parsedIntent.dates.return);
      // PHI-109 regression fix: when the parser hands off an explicit
      // return date (the user typed it on the confirmation page's inline
      // editor, or the parser captured both endpoints from the free
      // text), mark it as user-typed so the date-default effect doesn't
      // re-derive Return = Departure + N on the wizard step.
      setUserTypedReturn(true);
    }
    if (parsedIntent.party.adults) setAdultCount(parsedIntent.party.adults);
    if (parsedIntent.party.children?.length) {
      setChildrenAges(
        parsedIntent.party.children
          .map((c) => c.ageRange ?? "")
          .filter((a, i, arr) => arr[i] || true) // keep all, even empties
      );
    }
    if (parsedIntent.styleTags?.length)
      setTravelerTypes(parsedIntent.styleTags.slice(0, MAX_STYLE_SELECTIONS));
    if (parsedIntent.budgetTier) setBudgetTier(parsedIntent.budgetTier);
    if (parsedIntent.constraintTags?.length) setConstraintTags(parsedIntent.constraintTags);
    if (parsedIntent.constraintText) setConstraintText(parsedIntent.constraintText);
    // PHI-51: thread inspiration into the wizard state if the user kept the chip.
    if (parsedIntent.inspiration) setInspiration(parsedIntent.inspiration);

    logOnboardingEvent("freeform_completed", {
      destinationCount: parsedIntent.destinations.length,
      hadConstraints:
        parsedIntent.constraintTags.length + (parsedIntent.constraintText ? 1 : 0),
      hadInspiration: !!parsedIntent.inspiration,
      inspiration: parsedIntent.inspiration ?? null,
    });

    // Skip to step 1 (dates) — destination is now pre-filled. The user
    // walks the rest of the flow, but skipping step 0 means the parsed
    // text gave us the foundational input.
    setParserPhase("structured");
    goTo(1);
  }

  if (step === 0 && parserPhase !== "structured") {
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

  if (step === 0) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: "#f8f6f1" }}>
        <div className="w-full max-w-xl animate-step" key={animKey}>
          <p className="font-extrabold text-xl tracking-tight mb-16" style={{ color: "#0e2a47" }}>Rise</p>
          <h1
            className="text-5xl md:text-6xl tracking-tight leading-tight mb-4"
            style={{ color: "#0e2a47", fontWeight: 300, letterSpacing: "-1px" }}
          >
            Where to?
          </h1>
          <p className="text-lg mb-10" style={{ color: "#4a6580" }}>
            Tell us your destination and we&apos;ll build your trip.
          </p>
          <PlacesAutocomplete
            value={destination}
            onChange={handleDestinationChange}
            onSelect={(place) => handleDestinationSelect(place)}
            placeholder="e.g. Tokyo, Japan"
            types={["(cities)"]}
            autoFocus
            theme="light"
            onEnter={() => {
              // PHI-30: Enter only advances when the user has explicitly
              // verified the destination. Otherwise nothing — the dropdown
              // and "Use anyway" link below give them a clear path.
              if (destination.trim() && destinationVerified) goTo(1);
            }}
            className="w-full bg-white border-b-2 border-[#d4cfc5] focus:border-[#1a6b7f] outline-none text-3xl font-medium py-3 transition-colors placeholder-[#b8b0a4]"
            style={{ color: "#0e2a47" }}
          />

          {/* PHI-30: escape hatch — explicit "Use anyway" affordance for
              free-form input that doesn't match an autocomplete suggestion
              (regions, unusual spellings, fictional places, etc.) */}
          {destination.trim().length >= 2 && !destinationVerified && (
            <button
              type="button"
              onClick={useDestinationAsTyped}
              className="mt-3 text-sm text-[#1a6b7f] hover:text-[var(--text-primary)] underline-offset-4 hover:underline transition-colors"
              data-testid="use-destination-anyway"
            >
              Use &ldquo;{destination.trim()}&rdquo; anyway →
            </button>
          )}

          <button
            onClick={() => goTo(1)}
            disabled={!destination.trim() || !destinationVerified}
            className="mt-10 w-full text-white font-semibold text-lg py-5 hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ backgroundColor: "#1a6b7f", borderRadius: 50 }}
          >
            Start planning &rarr;
          </button>
        </div>
      </main>
    );
  }

  // ── Wizard steps 1–6 (PHI-90: must-dos inserted at step 4) ─────────────────

  // PHI-27: every child must have an age range picked before Continue is
  // enabled. Pre-selecting "Under 2" was a personalisation trap; making the
  // pick conscious is the right tradeoff.
  const allChildrenHaveAges = childrenAges.every((a) => a.length > 0);

  // PHI-47: regex check at the gate; "x" no longer passes. Server mirrors.
  const emailValid = EMAIL_RE.test(email.trim());

  // PHI-64: signed-in users only need a name (email comes from the
  // session). If their session already supplied a name we auto-finish,
  // so the gate only matters for the name-only branch.
  // PHI-90 renumber: variable was step5Ready; account step is now 6.
  const accountStepReady = authedUser
    ? name.trim().length > 0
    : name.trim().length > 0 && emailValid;

  const canContinue: Record<number, boolean> = {
    // PHI-30: step 1 also requires destinationVerified — the user might
    // have re-opened the autocomplete here and started editing.
    // PHI-99: flex mode swaps the date-field gate for a month + nights gate.
    1:
      destination.trim().length > 0 &&
      destinationVerified &&
      (flexMode
        ? flexMonth.length > 0 && flexNights >= 1
        : departureDate.length > 0 && returnDate.length > 0),
    2: true,
    3: travelCompany.length > 0 && allChildrenHaveAges,
    // PHI-90: must-dos step is fully skippable — empty textarea always
    // advances. Hard constraint: the step never blocks forward progress.
    4: true,
    5: !previewLoading && Object.keys(activityFeedback).length > 0,
    6: accountStepReady,
  };

  async function handleContinue() {
    // PHI-90 renumber: account step is now 6.
    if (step === 6) { await handleFinish(); return; }
    if (step === 3) { await savePreferencesToDb(); }
    if (step === 4) { await saveSeededActivitiesToDb(); }
    // PHI-99 — fire a telemetry event on step-1 advance with the mode the
    // user took. Build-readiness only; we don't act on this signal until
    // real traffic arrives. Fire-and-forget so a slow logger never blocks
    // the wizard.
    if (step === 1) {
      logOnboardingEvent("welcome_step1_advance", {
        mode: flexMode ? "flex" : "exact",
        ...(flexMode ? { flexMonth, flexNights } : {}),
      });
    }
    // PHI-57: when the destination is a country (not a city), insert
    // step 3.5 — AI city recommendations — between preferences and the
    // must-dos step. We use step 35 as a sentinel; from 35 we hand off
    // to step 4 (must-dos) when the user picks a recommendation.
    if (step === 3 && isCountryDestination) {
      goTo(35);
      void fetchCountryRecommendations();
      return;
    }
    goTo(step + 1);
  }

  // PHI-64: when the user is already signed in, swap account-step copy.
  // With a known name we auto-finish (no input needed); otherwise we ask
  // only for a display name. The anon path keeps its original copy.
  // PHI-90 renumber: account step was 5, now 6.
  const accountStepHeading = authedUser
    ? authedUser.existingName
      ? "Saving your trip…"
      : "One last thing — what should we call you?"
    : "Save your trip plan.";
  const accountStepSub = authedUser
    ? authedUser.existingName
      ? "We're tucking your itinerary into your account."
      : "We'll save your itinerary, transport advice, and trip summary to your account."
    : "Your activity plan, transport advice, and trip summary are ready. Create your account to save everything.";

  const headings: Record<number, string> = {
    1: "When are you going?",
    2: "Where are you staying?",
    3: "Tell us about yourself.",
    35: `Where in ${destination}?`,
    // PHI-90: new must-dos step heading. Optional — user can skip.
    4: "Anything you already want to do?",
    5: `Activities for your ${destination} trip.`,
    6: accountStepHeading,
  };

  const subs: Record<number, string> = {
    1: `Great choice. Now let's lock in the dates for ${destination}.`,
    2: "Your hotel helps us give better local advice — skip if you haven\u2019t booked yet.",
    3: "A few quick questions so we can personalise your experience.",
    35: "Pick a city or region \u2014 we'll personalise the rest from there.",
    // PHI-90: explicit "skippable" signal in the sub \u2014 Marcus persona test
    // case from the PRD ("skip the step in one tap").
    4: "Add the things you already know you want \u2014 one per line. Skip if you\u2019d rather we plan from scratch.",
    5: "Rate what excites you \u2014 and what doesn\u2019t. It shapes your itinerary.",
    6: accountStepSub,
  };

  const darkInput =
    "w-full bg-white border border-[#b8b3a9] focus:border-[#1a6b7f] outline-none rounded-xl px-5 py-4 text-[var(--text-primary)] text-lg placeholder-[#9ca3af] transition-colors";
  const underlineInput =
    "w-full bg-transparent border-b-2 border-[#d4cfc5] focus:border-[#1a6b7f] outline-none text-3xl font-semibold text-[var(--text-primary)] placeholder-[#9ca3af] py-3 transition-colors";

  return (
    <main className="min-h-screen bg-[#f8f6f1] flex flex-col">

      {/* Progress bar */}
      <div className="w-full h-1 bg-[#f0ede8]">
        <div
          className="h-1 bg-[#1a6b7f] transition-all duration-500 ease-out"
          style={{ width: `${(step / TOTAL_WIZARD_STEPS) * 100}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-2">
        <button
          onClick={() => goTo(step === 35 ? 3 : step - 1)}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <span className="text-[var(--text-muted)] text-sm">
          {/* PHI-90: 35 is the sentinel for the country-recs sub-step; show
              it as "3.5" while keeping the step counter sensible. */}
          {step === 35 ? "3.5" : step} / {TOTAL_WIZARD_STEPS}
        </span>
      </div>

      {/* Step content */}
      <div className="flex-1 flex flex-col justify-center px-6 pb-10">
        <div className="w-full max-w-xl mx-auto animate-step" key={animKey}>

          <div className="mb-10">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight mb-3 text-[var(--text-primary)]">
              {headings[step]}
            </h1>
            <p className="text-[var(--text-secondary)] text-lg">{subs[step]}</p>
          </div>

          {/* Step 1: Destination (editable) + Dates */}
          {step === 1 && (
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
          )}

          {/* Step 2: Hotel (optional). PHI-39: when multi-leg, render
              one hotel field per leg with the leg name as the label.
              Single-leg path is unchanged.
              PHI-100: single-leg path also exposes a "help me pick a
              neighbourhood →" affordance below the hotel input. Clicking
              swaps the hotel area for 4–6 AI-generated neighbourhood cards
              (lazy — no Anthropic call until clicked). Selecting a card
              fills `anchorNeighborhood` and continues to step 3. */}
          {step === 2 && parsedLegs.length < 2 && !neighborhoodPickerOpen && (
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
          )}
          {step === 2 && parsedLegs.length < 2 && neighborhoodPickerOpen && (
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
          )}
          {step === 2 && parsedLegs.length >= 2 && (
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
          )}

          {/* Step 3: Travel preferences */}
          {step === 3 && (
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
          )}

          {/* PHI-57: Step 3.5 — AI city recommendations when the user
              entered a country instead of a city. Single Haiku call;
              re-rank-on-revisit handled by re-firing fetchCountryRecommendations
              when the user navigates back from a later step. */}
          {step === 35 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-[var(--text-secondary)]">
                You picked <span className="font-semibold">{destination}</span> as a country. Here are 4 cities or regions that fit your profile.
              </p>
              {countryRecsLoading && (
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <div className="w-3 h-3 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin" />
                  <span>Picking the best fit…</span>
                </div>
              )}
              {!countryRecsLoading && countryRecsError && (
                <p className="text-sm text-red-500">{countryRecsError}</p>
              )}
              {!countryRecsLoading && countryRecommendations.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  {countryRecommendations.map((rec) => (
                    <button
                      key={rec.name}
                      type="button"
                      onClick={() => pickRecommendedCity(rec.name)}
                      className="text-left bg-white border border-[#e8e4de] rounded-2xl px-4 py-3 hover:border-[#1a6b7f] transition-colors"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-[var(--text-primary)]">{rec.name}</span>
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-[#1a6b7f]">
                          {rec.kind}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">{rec.why}</p>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">
                  Or pick a city yourself
                </p>
                <PlacesAutocomplete
                  value=""
                  onChange={() => {}}
                  onSelect={(place) => {
                    const name = place.split(",")[0].trim();
                    if (!name) return;
                    pickRecommendedCity(name);
                  }}
                  placeholder={`e.g. a city in ${destination}`}
                  types={["(cities)"]}
                  theme="light"
                  className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[#9ca3af] transition-colors"
                />
              </div>
            </div>
          )}

          {/* PHI-90 — Step 4: Must-dos textarea. Inserted between
              preferences (3) and the AI activity preview (now 5).
              Optional. Empty textarea is allowed and the user advances
              unchanged; the existing prompt path runs without an
              anchors block when the array is empty. The textarea grows
              with content (`min-h-[160px]`) and stays usable on a 360px
              viewport — the skip link sits visibly below it. */}
          {step === 4 && (() => {
            // PHI-93 — disclose silent filtering. splitSeededActivities()
            // drops lines >200 chars and caps the list at 20; the user
            // gets zero signal today. Compute the raw-vs-kept deltas
            // inline and surface an amber hint when anything was dropped.
            // The filter still runs (it's the safety net); the hint is
            // disclosure only, and Continue stays enabled per PHI-90's
            // "step must never block forward progress" invariant.
            const rawLines = userSeededText
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean);
            const tooLong = rawLines.filter((l) => l.length > 200).length;
            const overCount = Math.max(0, rawLines.length - 20);
            const filteredAny = tooLong > 0 || overCount > 0;
            // PHI-102 — show the popular-picks trigger ABOVE the textarea so
            // the soft keyboard on mobile doesn't push it below the fold.
            // The expanded panel renders below the textarea (also per spec).
            // Hide the trigger entirely when this destination's been
            // disabled (sub-minimum fallback) or when a country-level
            // destination is selected (country flow has its own discovery).
            //
            // PHI-102 — Haiku first ship hallucinated ~25% of venue names
            // (Tsukiji on Kyoto, "Mizuki Shikibu Museum", etc.) and the
            // eval failed at 3.72/4.0. Swapped to Sonnet 4.6 and the eval
            // passed cleanly at 4.06/5 (no fixture below 4.0). UI is now
            // live on this destination. The Haiku/Sonnet cost delta is
            // ~5× per uncached call (`$0.001` → `$0.005`); the cache
            // covers >70% of expected production traffic per the PRD's
            // own cost posture, so net production-cost impact is small.
            const POPULAR_PICKS_ENABLED = true;
            const dest = destination.trim();
            const showPopularPicksTrigger =
              POPULAR_PICKS_ENABLED &&
              dest.length > 0 &&
              popularPicksDisabledForDest !== dest &&
              countryRecommendations.length === 0;
            const showSoftCapNudge =
              popularPicksOpen &&
              popularPicksAddedCount >= 5 &&
              !popularPicksNudgeFiredRef.current &&
              ((popularPicksNudgeFiredRef.current = true) || true);

            return (
              <div className="flex flex-col gap-4" data-testid="welcome-must-dos-step">
                {showPopularPicksTrigger && !popularPicksOpen && (
                  <button
                    type="button"
                    onClick={() => void openPopularPicks()}
                    className="self-start text-sm text-[#1a6b7f] hover:text-[var(--text-primary)] underline-offset-4 hover:underline transition-colors"
                    data-testid="open-popular-picks"
                  >
                    Need ideas? See popular picks ▾
                  </button>
                )}
                {showPopularPicksTrigger && popularPicksOpen && (
                  <button
                    type="button"
                    onClick={() => setPopularPicksOpen(false)}
                    className="self-start text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    Hide picks ▴
                  </button>
                )}
                <label className="block">
                  <span className="block text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-3">
                    Your must-dos (optional)
                  </span>
                  <textarea
                    value={userSeededText}
                    onChange={(e) => setUserSeededText(e.target.value)}
                    placeholder={`e.g.\nCervejaria Ramiro\nSunset at Miradouro da Senhora do Monte\nTime Out Market`}
                    rows={6}
                    className="w-full min-h-[160px] bg-white border border-[#b8b3a9] focus:border-[#1a6b7f] outline-none rounded-xl px-4 py-3 text-[var(--text-primary)] text-base placeholder-[#9ca3af] transition-colors resize-y"
                  />
                </label>
                {/* PHI-102 — popular picks panel renders BELOW the textarea
                    so the textarea stays anchored where the user is typing
                    on mobile. */}
                {popularPicksOpen && (
                  <div
                    className="flex flex-col gap-3 rounded-2xl border border-[#e8e4de] bg-white p-4"
                    data-testid="popular-picks-panel"
                  >
                    <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">
                      Popular picks
                    </p>
                    {popularPicksLoading && (
                      <p className="text-sm text-[var(--text-muted)]">
                        Loading popular picks…
                      </p>
                    )}
                    {popularPicksError && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start justify-between gap-3">
                        <span>{popularPicksError}</span>
                        <button
                          onClick={() => {
                            setPopularPicks([]);
                            void openPopularPicks();
                          }}
                          className="underline shrink-0"
                        >
                          Try again
                        </button>
                      </div>
                    )}
                    {!popularPicksLoading &&
                      !popularPicksError &&
                      popularPicks.length === 0 &&
                      popularPicksDisabledForDest === dest && (
                        <p className="text-sm text-[var(--text-muted)]">
                          No popular picks for this destination yet — type your own ↓
                        </p>
                      )}
                    {popularPicks.length > 0 && (
                      <ul className="flex flex-col divide-y divide-[#e8e4de]">
                        {popularPicks.map((pick) => {
                          const added = isPickAdded(pick.name);
                          return (
                            <li
                              key={pick.name}
                              className="flex items-start justify-between gap-3 py-2.5"
                              data-testid={`popular-pick-${pick.name}`}
                            >
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <span className="text-sm font-semibold text-[var(--text-primary)]">
                                  {pick.name}
                                </span>
                                <span className="text-xs text-[var(--text-muted)] leading-snug">
                                  {pick.context_note}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  added ? removePick(pick) : addPick(pick)
                                }
                                aria-label={added ? `Remove ${pick.name}` : `Add ${pick.name}`}
                                className={`shrink-0 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl text-sm font-bold transition-colors ${
                                  added
                                    ? "bg-[#1a6b7f]/10 text-[#1a6b7f]"
                                    : "text-[#1a6b7f] hover:bg-[#1a6b7f]/5"
                                }`}
                              >
                                {added ? "✓" : "+ Add"}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {showSoftCapNudge && (
                      <p
                        className="text-xs text-[var(--text-muted)] mt-1"
                        data-testid="popular-picks-soft-cap"
                      >
                        Add anything else? ↓
                      </p>
                    )}
                  </div>
                )}
                {filteredAny && (
                  <p
                    data-testid="must-dos-filter-hint"
                    className="rounded-xl border border-[#f4d49e] bg-[#fef3e2] px-3 py-2 text-xs text-[var(--text-primary)] leading-relaxed"
                  >
                    {tooLong > 0 && (
                      <>
                        {tooLong} {tooLong === 1 ? "line was" : "lines were"} too long to use — keep each one under 200 characters.
                        {overCount > 0 ? " " : ""}
                      </>
                    )}
                    {overCount > 0 && (
                      <>Using your first 20 entries — remove one to add another.</>
                    )}
                  </p>
                )}
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  One per line. We&apos;ll place each one on a sensible day and
                  build the rest of your trip around it. You can adjust your
                  itinerary later from the trip page.
                </p>
                <p
                  data-testid="must-dos-pii-hint"
                  className="text-xs text-[var(--text-muted)] leading-relaxed"
                >
                  Heads up — what you type here goes to our AI planner. Skip
                  personal details (phone numbers, addresses) you wouldn&apos;t
                  share with a travel agent.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setUserSeededText("");
                    void handleContinue();
                  }}
                  className="self-start text-sm font-medium text-[#1a6b7f] hover:text-[#155a6b] transition-colors"
                >
                  Nothing yet — skip →
                </button>
              </div>
            );
          })()}

          {/* Step 5: AI Preview with activity cards (was step 4 pre-PHI-90) */}
          {step === 5 && (
            <div className="flex flex-col gap-4">
              {/* PHI-51: inspiration trust signal. Shown only when an
                  inspiration is set AND fewer than half of the rendered
                  cards visibly reference the theme — that's the case
                  where the soft bias didn't land hard enough for the
                  user to notice on their own. Theme-reference detection
                  is a substring check on title + description, not a
                  parser pass (deliberate simplicity per PRD). */}
              {(() => {
                const trimmed = inspiration.trim();
                if (!trimmed) return null;
                if (parsedActivities.length === 0) return null;
                const needle = trimmed.toLowerCase();
                const themed = parsedActivities.filter((a) => {
                  const haystack = `${a.name} ${a.description ?? ""}`.toLowerCase();
                  return haystack.includes(needle);
                }).length;
                const fewerThanHalf = themed * 2 < parsedActivities.length;
                if (!fewerThanHalf) return null;
                return (
                  <p
                    className="text-sm text-[var(--text-secondary)] italic px-2"
                    data-testid="inspiration-empty-state"
                  >
                    We heard &lsquo;{trimmed}&rsquo; — leaning into it where we can.
                  </p>
                );
              })()}
              {/* PHI-53: rainy-day hint. Shown when the trip-date forecast
                  flagged at least one bad day. The 6-card preview isn't
                  day-bound, so the message is trip-level — per-card
                  alternatives surface on the saved itinerary page. */}
              {previewBadDays && previewBadDays.length > 0 && (
                <div
                  data-testid="preview-rainy-hint"
                  className="rounded-xl border border-[#f4d49e] bg-[#fef3e2] px-4 py-2.5 text-sm text-[var(--text-primary)]"
                >
                  <span aria-hidden="true">☔</span>{" "}
                  <span className="font-semibold">
                    {previewBadDays.length} day
                    {previewBadDays.length === 1 ? "" : "s"} look
                    {previewBadDays.length === 1 ? "s" : ""} wet
                  </span>{" "}
                  <span className="text-[var(--text-secondary)]">
                    — your saved itinerary will surface indoor backups for
                    those.
                  </span>
                </div>
              )}
              {/* PHI-44: stream restarted after the user rated cards.
                  Explains why their ratings just disappeared. Auto-dismisses. */}
              {streamRefreshNote && (
                <div
                  role="status"
                  aria-live="polite"
                  data-testid="stream-refresh-note"
                  className="rounded-xl border border-[#1a6b7f]/25 bg-[#1a6b7f]/5 px-4 py-2.5 text-sm text-[var(--text-primary)]"
                >
                  Updated preferences — refreshing your picks.
                </div>
              )}
              {/* Initial loading state — before any cards arrive */}
              {previewLoading && parsedActivities.length === 0 && (
                <div className="rounded-2xl border border-[#e8e4de] bg-white p-6 min-h-[140px] flex items-center">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                      <div className="w-4 h-4 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin flex-shrink-0" />
                      <span>{previewLoadingLabel(destination, travelCompany)}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] ml-7">Activities will appear as we find them — rate each one as it arrives.</p>
                  </div>
                </div>
              )}

              {/* Rating progress counter */}
              {!previewLoading && parsedActivities.length > 0 && Object.keys(activityFeedback).length > 0 && (
                <p className="text-xs text-[var(--text-muted)] text-right">
                  {Object.keys(activityFeedback).length} of {parsedActivities.length} rated
                </p>
              )}

              {/* Progressive card reveal — cards appear as they complete */}
              {parsedActivities.map((activity) => (
                <ActivityCard
                  key={activity.id}
                  activity={activity}
                  chipsEntry={activityChips[activity.id]}
                  feedback={activityFeedback[activity.id]}
                  chipsOpen={openChipId === activity.id}
                  disabled={false}
                  onThumbsUp={() => handleThumbsUp(activity)}
                  onThumbsDown={() => handleThumbsDown(activity)}
                  onChipSelect={(chip) => handleChipSelect(activity, chip)}
                  onUndo={() => setOpenChipId(null)}
                  onSkip={() => handleSkip(activity)}
                  onRationaleExpand={() =>
                    logActivityEvent({
                      event: "rationale_expanded",
                      activityId: activity.id,
                      activityName: activity.name,
                      activityCategory: activity.category,
                    })
                  }
                />
              ))}

              {/* Inline loading indicator while more cards are incoming */}
              {previewLoading && parsedActivities.length > 0 && (
                <div className="flex items-center gap-3 px-2 py-3 text-[var(--text-muted)] text-sm">
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-[#6a7f8f] border-t-transparent animate-spin flex-shrink-0" />
                  <span>Found {parsedActivities.length} of ~6 activities...</span>
                </div>
              )}

              {/* Prompt to rate — shown after loading until user rates something */}
              {!previewLoading && parsedActivities.length > 0 && Object.keys(activityFeedback).length === 0 && (
                <p className="px-2 py-3 text-[#1a6b7f] text-sm font-medium">
                  Rate each activity to shape your itinerary.
                </p>
              )}

              {/* Follow-up #2 — Maya's Tier-2 inline prompt. Shown once the
                  user has rated 2+ activities (real engagement signal) but
                  before they advance to step 5. Soft, non-blocking, sits
                  inline with the cards — not a modal. */}
              {!previewLoading &&
                Object.keys(activityFeedback).length >= 2 &&
                !email && (
                  <div
                    data-testid="signup-tier2-prompt"
                    className="rounded-xl border border-[#1a6b7f]/25 bg-[#1a6b7f]/5 px-4 py-3 text-sm text-[var(--text-primary)]"
                  >
                    <span className="font-semibold">Loving these picks?</span>{" "}
                    <span className="text-[var(--text-secondary)]">
                      Save your email at the end so this trip doesn&apos;t
                      vanish when you close the tab.
                    </span>
                  </div>
                )}
            </div>
          )}

          {/* Step 6: Itinerary preview FIRST, then account creation.
              PHI-31 Part 2 slice 2 — the activation lever. Users see the
              actual product output before committing email. The signup
              form moves below as a "Save your trip" CTA.
              PHI-90 renumber: account step was 5, now 6. */}
          {step === 6 && (
            <div className="flex flex-col gap-6">
              {/* Hard exclusions edit affordance — kept at top because
                  users are still in "trip-shaping" mode here. */}
              {hardExcludedActivities.length > 0 && (
                <div className="rounded-2xl border border-[#e8e4de] bg-white px-5 py-4">
                  <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">
                    Skipped activities
                  </p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {hardExcludedActivities.map((entry) => (
                      <button
                        key={entry.activityId}
                        onClick={() => handleRemoveExclusion(entry.activityId)}
                        className="flex items-center gap-2 rounded-xl border border-[#d4cfc5] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:border-red-500/30 hover:text-red-400 transition-colors"
                      >
                        {entry.activityName}
                        <span className="text-[var(--text-muted)] text-xs">×</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">Tap to restore an activity.</p>
                </div>
              )}

              {/* Itinerary preview — read-only, day-by-day. Loading state
                  while /api/itinerary/generate streams the response. */}
              <div data-testid="itinerary-preview">
                <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-3">
                  Your trip plan
                </h2>
                {/* PHI-90: placement_notes — surface in the preview the same
                    way /itinerary does, so the user finds out about a
                    misspecified anchor or unfittable item BEFORE they
                    commit email. Hard constraint: anchors are never
                    silently dropped. */}
                {itineraryPlacementNotes && (
                  <div
                    data-testid="welcome-placement-notes"
                    className="rounded-xl border border-[#f4d49e] bg-[#fef3e2] px-4 py-3 text-sm text-[var(--text-primary)] mb-3"
                  >
                    <span className="font-semibold">A note on your must-dos:</span>{" "}
                    <span className="text-[var(--text-secondary)]">{itineraryPlacementNotes}</span>
                  </div>
                )}
                {itineraryPreviewLoading && !itineraryPreview && (
                  <div className="rounded-2xl border border-[#e8e4de] bg-white p-6 flex items-center gap-3 text-[var(--text-secondary)]">
                    <div className="w-4 h-4 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin" />
                    <span>
                      Building your day-by-day itinerary for {destination}…
                    </span>
                  </div>
                )}
                {itineraryPreviewError && !itineraryPreview && (
                  <div className="rounded-2xl border border-[#e8e4de] bg-[#f0ede8] p-5 text-sm text-[var(--text-secondary)]">
                    Couldn&apos;t load your trip preview. You can still save
                    your trip below — we&apos;ll generate the itinerary
                    after you sign in.
                  </div>
                )}
                {itineraryPreview && itineraryPreview.length > 0 && (
                  <div
                    className="flex flex-col gap-3"
                    data-testid="itinerary-preview-days"
                  >
                    {/* PHI-37 slice 3: group days by leg_index when the
                        plan is multi-leg. Single-leg renders identically
                        to before — the multiLegPreview wrapper kicks in
                        only when at least one day has a leg_index AND
                        parsedLegs has 2+ entries. */}
                    {(() => {
                      const isMultiLeg =
                        parsedLegs.length >= 2 &&
                        itineraryPreview.some((d) => typeof d.leg_index === "number");
                      if (!isMultiLeg) {
                        // Single-leg: existing flat day list.
                        return itineraryPreview.map((day) => (
                          <PreviewDayCard key={day.day_number} day={day} />
                        ));
                      }
                      // Multi-leg: group days by leg_index, with a leg
                      // header per group and transition days styled
                      // differently. Days without a leg_index fall into
                      // the previous leg (or leg 0 if at the start).
                      const groups: { legIndex: number; days: PreviewDay[] }[] = [];
                      let currentLeg = -1;
                      for (const day of itineraryPreview) {
                        const idx =
                          typeof day.leg_index === "number"
                            ? day.leg_index
                            : Math.max(0, currentLeg);
                        if (idx !== currentLeg) {
                          groups.push({ legIndex: idx, days: [day] });
                          currentLeg = idx;
                        } else {
                          groups[groups.length - 1].days.push(day);
                        }
                      }
                      return groups.map((g, gi) => {
                        const leg = parsedLegs[g.legIndex];
                        const legName = leg?.place?.name ?? `Leg ${g.legIndex + 1}`;
                        return (
                          <div
                            key={`leg-${gi}`}
                            data-testid={`leg-section-${g.legIndex}`}
                            className="flex flex-col gap-2"
                          >
                            <div className="sticky top-0 z-10 bg-[#f8f6f1] py-2 -mx-1 px-1">
                              <p
                                className="text-xs font-bold text-[#1a6b7f] uppercase tracking-widest"
                                data-testid={`leg-header-${g.legIndex}`}
                              >
                                Leg {g.legIndex + 1} · {legName}
                                {leg?.nights
                                  ? ` · ${leg.nights} night${leg.nights === 1 ? "" : "s"}`
                                  : ""}
                              </p>
                            </div>
                            {g.days.map((day) => (
                              <PreviewDayCard
                                key={day.day_number}
                                day={day}
                              />
                            ))}
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>

              {/* Save Trip section — signup form, framed as the persistent
                  banner from Maya's escalation pattern. Sits BELOW the
                  preview so the user has already seen the value.
                  PHI-64: signed-in users skip the form. If we already
                  have their name, the auto-finish effect handles save +
                  redirect; otherwise we show only a name input. */}
              {authedUser ? (
                authedUser.existingName ? (
                  <div
                    className="rounded-2xl border border-[#1a6b7f]/30 bg-[#1a6b7f]/5 p-5 flex items-center gap-3"
                    data-testid="signed-in-saving"
                  >
                    <div className="w-4 h-4 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin shrink-0" />
                    <p className="text-sm text-[var(--text-secondary)]">
                      Saving your trip to {authedUser.email}…
                    </p>
                  </div>
                ) : (
                  <div
                    className="rounded-2xl border border-[#1a6b7f]/30 bg-[#1a6b7f]/5 p-5"
                    data-testid="signed-in-name-only"
                  >
                    <p className="text-sm font-bold text-[var(--text-primary)] mb-1">
                      What should we call you?
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] mb-4">
                      You&apos;re signed in as {authedUser.email}. We just
                      need a display name to finish saving your trip.
                    </p>
                    <input
                      type="text"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      name="name"
                      className={darkInput}
                      data-testid="signup-name"
                    />
                  </div>
                )
              ) : (
                <div className="rounded-2xl border border-[#1a6b7f]/30 bg-[#1a6b7f]/5 p-5">
                  <p className="text-sm font-bold text-[var(--text-primary)] mb-1">
                    Save your trip to keep it.
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mb-4">
                    We&apos;ll save your itinerary, transport advice, and trip
                    summary to your account.
                  </p>
                  <div className="flex flex-col gap-3">
                    <input
                      type="text"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      name="name"
                      className={darkInput}
                    />
                    <div className="flex flex-col gap-1">
                      <input
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => setEmailTouched(true)}
                        autoComplete="email"
                        name="email"
                        aria-invalid={emailTouched && !emailValid}
                        aria-describedby={
                          emailTouched && !emailValid ? "email-error" : undefined
                        }
                        className={darkInput}
                        data-testid="signup-email"
                      />
                      {/* PHI-47: only show after field has been blurred,
                          so typing "p" doesn't immediately read as wrong. */}
                      {emailTouched && email.trim().length > 0 && !emailValid && (
                        <p
                          id="email-error"
                          role="alert"
                          className="text-xs text-red-500"
                        >
                          That doesn&apos;t look like a valid email.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Continue / finish button — hidden on step 3.5 since the
              user advances by picking a recommendation card or typing
              into the free-text fallback. PHI-64: also hidden on the
              account step (now 6) when a signed-in user has a known name
              (auto-finish runs). */}
          {step !== 35 && !(step === 6 && authedUser?.existingName) && (
          <button
            onClick={handleContinue}
            disabled={!canContinue[step] || saving}
            className="mt-10 w-full rounded-2xl bg-[#1a6b7f] text-white font-bold text-lg py-5 hover:bg-[#155a6b] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saving
              ? step === TOTAL_WIZARD_STEPS
                ? authedUser
                  ? "Saving your trip…"
                  : "Sending magic link…"
                : "Saving your trip…"
              : step === TOTAL_WIZARD_STEPS
              ? authedUser
                ? "Save trip →"
                : "Send magic link →"
              : step === 4
              ? splitSeededActivities(userSeededText).length > 0
                ? `Continue with ${splitSeededActivities(userSeededText).length} must-do${splitSeededActivities(userSeededText).length === 1 ? "" : "s"} →`
                : "Continue →"
              : step === 5
              ? previewLoading
                ? "Loading activities…"
                : Object.keys(activityFeedback).length === 0
                ? "Rate at least one activity to continue"
                : Object.keys(activityFeedback).length < Math.ceil(parsedActivities.length / 2)
                ? `Continue with ${Object.keys(activityFeedback).length} rated — more = better results →`
                : `Continue with ${Object.keys(activityFeedback).length} rated →`
              : "Continue →"}
          </button>
          )}

        </div>
      </div>

    </main>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <WelcomePageInner />
    </Suspense>
  );
}
