"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import PlacesAutocomplete from "@/app/components/PlacesAutocomplete";
import type { TripIntent } from "@/lib/trip-intent";

const TOTAL_WIZARD_STEPS = 5; // steps 1–5

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
  "Wheelchair accessible only",
  "No long walks",
  "Vegetarian",
  "Halal/Kosher",
  "Severe allergy",
  "Stroller-friendly",
] as const;

const MAX_STYLE_SELECTIONS = 3;

// PHI-27: added "13–17" so teen families aren't silently excluded.
const CHILD_AGE_RANGES = ["Under 2", "2–4", "5–8", "9–12", "13–17"] as const;

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
};
type PreviewDay = {
  date: string;
  day_number: number;
  items: PreviewItem[];
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

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
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
  const results: ParsedActivity[] = [];
  let match;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    results.push({
      id: `act-${idx++}`,
      name: match[1].trim(),
      category: match[2].trim(),
      description: match[3].trim(),
      when: match[4].trim(),
      rationale: match[5]?.trim() || undefined,
    });
  }
  return results;
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
        <div className="font-bold text-[#0e2a47] text-base leading-snug">{activity.name}</div>
        <div className="text-xs text-[#1a6b7f] font-semibold mt-0.5">{activity.category}</div>
      </div>
      <p className="text-sm text-[#4a6580] leading-relaxed mb-4">{activity.description}</p>

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
            className="text-xs text-[#1a6b7f] hover:text-[#0e2a47] underline-offset-4 hover:underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a6b7f] focus-visible:ring-offset-2 rounded"
            data-testid={`why-this-${activity.id}`}
          >
            {rationaleOpen ? "Hide why ↑" : "Why this →"}
          </button>
          {rationaleOpen && (
            <div
              id={`rationale-${activity.id}`}
              role="region"
              aria-live="polite"
              className="mt-2 px-3 py-2.5 rounded-xl bg-[#f0ede8] text-xs text-[#4a6580] leading-relaxed"
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
                  : "border-[#d4cfc5] text-[#6a7f8f] hover:border-[#1a6b7f]/40 hover:text-[#1a6b7f]"
              }`}
              title="Interested"
              aria-label={`Interested in ${activity.name}`}
            >
              👍
            </button>
            <button
              onClick={onThumbsDown}
              className="flex items-center justify-center w-12 h-12 rounded-xl border border-[#d4cfc5] text-lg text-[#6a7f8f] hover:border-red-500/40 hover:text-red-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              title="Not for me"
              aria-label={`Not for me: ${activity.name}`}
            >
              👎
            </button>
            <button
              onClick={onSkip}
              className="ml-auto text-xs text-[#6a7f8f] hover:text-[#4a6580] underline-offset-4 hover:underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a6b7f] focus-visible:ring-offset-2 rounded px-2 py-1"
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
                className="rounded-xl border border-[#d4cfc5] px-3 py-1.5 text-xs font-medium text-[#4a6580] hover:border-[#b8b3a9] hover:text-[#0e2a47] transition-colors"
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#6a7f8f]">Pick one to help us plan better.</p>
            <button
              onClick={onUndo}
              className="text-xs text-[#6a7f8f] hover:text-[#4a6580] transition-colors"
            >
              ← Undo
            </button>
          </div>
        </div>
      )}

      {/* Chip selected — hard exclusion */}
      {isHardExcluded && <p className="text-xs text-orange-400">We&apos;ll skip this.</p>}

      {/* Soft signal or no-chip submission */}
      {isNoted && <p className="text-xs text-[#6a7f8f]">👎 Noted — we&apos;ll adjust.</p>}

      {/* PHI-28: skipped — distinct visual from thumbs-down so users see
          their conscious "not sure" was registered */}
      {isSkipped && (
        <p className="text-xs text-[#6a7f8f]">Skipped — no preference recorded.</p>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [animKey, setAnimKey] = useState(0);

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
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [hotel, setHotel] = useState("");

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

  // Account
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  // Partial traveler ID written to DB at step 3 advance
  const [travelerId, setTravelerId] = useState<string | null>(null);

  // AI Preview (step 4)
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);

  // PHI-31 Part 2 slice 2: itinerary preview rendered on step 5 BEFORE
  // signup. Generated by /api/itinerary/generate using the full state we
  // already have (destination, dates, party, styles, activity feedback).
  const [itineraryPreview, setItineraryPreview] = useState<PreviewDay[] | null>(null);
  const [itineraryPreviewLoading, setItineraryPreviewLoading] = useState(false);
  const [itineraryPreviewError, setItineraryPreviewError] = useState<string | null>(null);
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

  useEffect(() => {
    if (departureDate) setReturnDate(addDays(departureDate, 7));
  }, [departureDate]);

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

  // Fire streaming preview when entering step 4 — parse cards incrementally
  useEffect(() => {
    if (step !== 4) return;

    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewLoading(true);
    setParsedActivities([]);
    chipsFetchedRef.current = new Set();
    submittedActivitiesRef.current = new Set();

    (async () => {
      let accumulated = "";
      let emittedCount = 0;
      try {
        const res = await fetch("/api/activities-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            destination,
            departureDate: departureDate || "",
            returnDate: returnDate || "",
            travelCompany: travelCompany || null,
            styleTags: travelerTypes.length > 0 ? travelerTypes : null,
            budgetTier: budgetTier || null,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
            // PHI-35: optional constraints. Empty fields are dropped server-side.
            constraintTags: constraintTags.length > 0 ? constraintTags : null,
            constraintText: constraintText.trim() || null,
          }),
        });
        if (!res.body) return;
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
  }, [step, destination, departureDate, returnDate, travelCompany, travelerTypes, budgetTier]);

  // PHI-31 Part 2 slice 2: generate the itinerary preview when entering
  // step 5, so the user sees the actual product output BEFORE the signup
  // form. This is the activation lever: 4 of 5 personas in the May 2026
  // review flagged forced-signup as drop-off; showing payoff first should
  // close most of that gap.
  useEffect(() => {
    if (step !== 5) return;
    if (itineraryPreview || itineraryPreviewLoading) return; // already loaded / loading
    const controller = new AbortController();
    itineraryAbortRef.current = controller;
    setItineraryPreviewLoading(true);
    setItineraryPreviewError(null);

    (async () => {
      try {
        const feedbackArray = Object.values(activityFeedback);
        const res = await fetch("/api/itinerary/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            destination,
            departureDate,
            returnDate,
            hotel: hotel || null,
            travelCompany: travelCompany || null,
            travelerTypes,
            activityFeedback: feedbackArray,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
          }),
        });
        if (!res.ok) {
          const err = await res.text();
          setItineraryPreviewError(err || "Couldn't load your trip preview.");
          setItineraryPreviewLoading(false);
          return;
        }
        const data = (await res.json()) as { days?: PreviewDay[] };
        if (Array.isArray(data.days) && data.days.length > 0) {
          setItineraryPreview(data.days);
          // Cache for /itinerary so we don't regenerate after signup
          if (typeof window !== "undefined") {
            localStorage.setItem("rise_itinerary", JSON.stringify(data.days));
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
  function patchAnonymousSession() {
    if (typeof window === "undefined") return;
    const body = {
      destination,
      destinationVerified,
      departureDate,
      returnDate,
      hotel: hotel || null,
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
      }
    });
  }

  // PHI-30: typing into the destination input always invalidates the
  // verified state — the user is editing, so any prior selection is stale.
  function handleDestinationChange(text: string) {
    setDestination(text);
    setDestinationVerified(false);
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
    });
  }

  const hardExcludedActivities = Object.values(activityFeedback).filter(
    (f) => f.feedbackType === "chip_selected" && f.chip?.type === "hard_exclusion"
  );

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
          }),
        });
      } else {
        const res = await fetch("/api/travelers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination,
            departureDate,
            returnDate,
            hotel: hotel || null,
            travelCompany: travelCompany || null,
            styleTags: travelerTypes.length > 0 ? travelerTypes : null,
            budgetTier: budgetTier || null,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
            activities: [],
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
    try {
      if (travelerId) {
        await fetch("/api/travelers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: travelerId, name, email }),
        });
      } else {
        const res = await fetch("/api/travelers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            destination,
            departureDate,
            returnDate,
            hotel: hotel || null,
            travelCompany: travelCompany || null,
            styleTags: travelerTypes.length > 0 ? travelerTypes : null,
            budgetTier: budgetTier || null,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
            activities: [],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setTravelerId(data.id ?? null);
        }
      }
    } catch {}
    const travelerData = {
      id: travelerId,
      name,
      email,
      destination,
      departureDate,
      returnDate,
      hotel: hotel || null,
      travelCompany,
      travelerCount: adultCount + childrenAges.length,
      childrenAges: childrenAges.length > 0 ? childrenAges : null,
      travelerTypes,
      budgetTier,
      // PHI-35: include constraints in the persisted snapshot so downstream
      // (itinerary generation, future AI calls) can keep respecting them.
      constraintTags: constraintTags.length > 0 ? constraintTags : null,
      constraintText: constraintText.trim() || null,
      activities: [],
    };
    localStorage.setItem("rise_traveler", JSON.stringify(travelerData));
    localStorage.setItem("rise_onboarded", "true");
    // Persist activity feedback so itinerary generation can use it
    const feedbackArray = Object.values(activityFeedback);
    localStorage.setItem("rise_activity_feedback", JSON.stringify(feedbackArray));
    setSaving(false);
    router.push("/itinerary");
  }

  // ── Step 0: Full-screen landing ────────────────────────────────────────────

  // ── PHI-34 UI: dual-CTA landing ────────────────────────────────────────
  // Default first impression. Free-form textarea → /api/parse-trip → chips
  // confirmation → pre-fill state and advance. Structured form remains
  // available via the "Or step by step →" link.
  async function submitFreeForm() {
    if (!parserText.trim()) return;
    setParserPhase("parsing");
    setParserError(null);
    logOnboardingEvent("freeform_initiated", { length: parserText.length });
    try {
      const res = await fetch("/api/parse-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: parserText }),
      });
      if (!res.ok) {
        const err = await res.text();
        setParserError(err || "Couldn't read that — try the structured form below.");
        setParserPhase("landing");
        return;
      }
      const data = (await res.json()) as { intent: TripIntent };
      setParsedIntent(data.intent);
      setParserPhase("confirming");
      logOnboardingEvent(
        data.intent.clarifications.length > 0
          ? "freeform_required_clarification"
          : "freeform_parsed_clean",
        { clarifications: data.intent.clarifications.length }
      );
    } catch (e: unknown) {
      setParserError(e instanceof Error ? e.message : "Network error.");
      setParserPhase("landing");
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
    }
    if (parsedIntent.dates.departure) setDepartureDate(parsedIntent.dates.departure);
    if (parsedIntent.dates.return) setReturnDate(parsedIntent.dates.return);
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

    logOnboardingEvent("freeform_completed", {
      destinationCount: parsedIntent.destinations.length,
      hadConstraints:
        parsedIntent.constraintTags.length + (parsedIntent.constraintText ? 1 : 0),
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
            <h1 className="text-3xl md:text-4xl font-extrabold text-[#0e2a47] mb-3">
              Got it. Anything to fix?
            </h1>
            <p className="text-base text-[#4a6580] mb-6">
              Here&apos;s what we picked up. Tap any chip to fix it; we&apos;ll
              walk through the rest after.
            </p>
            <div className="flex flex-wrap gap-2 mb-6" data-testid="confirm-chips">
              {/* Destination(s) — editable */}
              {intent.destinations.length === 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    const next = prompt("Where to?");
                    if (next?.trim())
                      updateIntent({
                        destinations: [{ name: next.trim() }],
                      });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-[#d4a94a]/60 bg-white px-3 py-1.5 text-sm text-[#0e2a47] hover:border-[#1a6b7f] transition-colors"
                  aria-label="Add destination"
                >
                  <span>📍</span>
                  <span className="font-medium">Add a destination</span>
                </button>
              ) : (
                intent.destinations.map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      const next = prompt("Edit destination", d.name);
                      if (next?.trim()) {
                        const arr = [...intent.destinations];
                        arr[i] = { ...d, name: next.trim() };
                        updateIntent({ destinations: arr });
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4cfc5] bg-white px-3 py-1.5 text-sm text-[#0e2a47] hover:border-[#1a6b7f] transition-colors"
                    aria-label={`Edit destination ${d.name}`}
                  >
                    <span>📍</span>
                    <span className="font-medium">
                      {d.name}
                      {d.kind ? ` (${d.kind})` : ""}
                    </span>
                  </button>
                ))
              )}

              {/* Dates — editable. Show current value or a prompt to set. */}
              <button
                type="button"
                onClick={() => {
                  const dep = prompt(
                    "Departure date (YYYY-MM-DD), or leave blank for none",
                    intent.dates.departure ?? ""
                  );
                  if (dep === null) return;
                  const ret = prompt(
                    "Return date (YYYY-MM-DD), or leave blank for none",
                    intent.dates.return ?? ""
                  );
                  if (ret === null) return;
                  updateIntent({
                    dates: {
                      ...intent.dates,
                      departure: dep.trim() || undefined,
                      return: ret.trim() || undefined,
                    },
                  });
                }}
                className={`inline-flex items-center gap-1.5 rounded-xl border bg-white px-3 py-1.5 text-sm text-[#0e2a47] hover:border-[#1a6b7f] transition-colors ${
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

              {/* Adults — editable via prompt */}
              <button
                type="button"
                onClick={() => {
                  const next = prompt(
                    "How many adults?",
                    String(intent.party.adults ?? 1)
                  );
                  const n = Number(next);
                  if (Number.isInteger(n) && n >= 1)
                    updateIntent({
                      party: { ...intent.party, adults: n },
                    });
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4cfc5] bg-white px-3 py-1.5 text-sm text-[#0e2a47] hover:border-[#1a6b7f] transition-colors"
                aria-label="Edit adult count"
              >
                <span>👤</span>
                <span className="font-medium">
                  {intent.party.adults ?? 1} adult
                  {(intent.party.adults ?? 1) > 1 ? "s" : ""}
                </span>
              </button>

              {/* Children — read-only display (count + ages) */}
              {intent.party.children?.length ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4cfc5] bg-white px-3 py-1.5 text-sm text-[#0e2a47]">
                  <span>👶</span>
                  <span className="font-medium">
                    {intent.party.children.length}{" "}
                    {intent.party.children.length === 1 ? "child" : "children"}
                  </span>
                </span>
              ) : null}

              {/* Style — read-only chip; user can edit in the wizard */}
              {intent.styleTags?.length ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4cfc5] bg-white px-3 py-1.5 text-sm text-[#0e2a47]">
                  <span>🎯</span>
                  <span className="font-medium">{intent.styleTags.join(", ")}</span>
                </span>
              ) : null}

              {/* Budget — read-only */}
              {intent.budgetTier && (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4cfc5] bg-white px-3 py-1.5 text-sm text-[#0e2a47]">
                  <span>💼</span>
                  <span className="font-medium">{intent.budgetTier}</span>
                </span>
              )}

              {/* Occasion — read-only */}
              {intent.occasion && (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4cfc5] bg-white px-3 py-1.5 text-sm text-[#0e2a47]">
                  <span>✨</span>
                  <span className="font-medium">{intent.occasion}</span>
                </span>
              )}

              {/* Constraints — read-only with full text */}
              {(intent.constraintTags?.length || intent.constraintText) && (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#d4a94a]/40 bg-[#d4a94a]/5 px-3 py-1.5 text-sm text-[#0e2a47]">
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
            </div>
            {intent.clarifications.length > 0 && (
              <div className="mb-6 rounded-2xl border border-[#d4a94a]/40 bg-[#d4a94a]/5 px-5 py-4">
                <p className="text-xs font-bold text-[#0e2a47] uppercase tracking-widest mb-2">
                  A few things we&apos;ll ask in the next steps
                </p>
                <ul className="text-sm text-[#4a6580] flex flex-col gap-1.5">
                  {intent.clarifications.map((c, i) => (
                    <li key={i}>· {c}</li>
                  ))}
                </ul>
              </div>
            )}
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
              }}
              className="w-full text-sm text-[#6a7f8f] hover:text-[#4a6580] underline-offset-4 hover:underline transition-colors"
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
            className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-2xl px-5 py-4 text-base text-[#0e2a47] placeholder-[#9ca3af] transition-colors mb-4"
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
                className="text-xs text-[#1a6b7f] hover:text-[#0e2a47] underline-offset-4 hover:underline transition-colors disabled:opacity-40"
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
            onClick={submitFreeForm}
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
            className="w-full text-sm text-[#6a7f8f] hover:text-[#4a6580] underline-offset-4 hover:underline transition-colors py-2"
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
              className="mt-3 text-sm text-[#1a6b7f] hover:text-[#0e2a47] underline-offset-4 hover:underline transition-colors"
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

  // ── Wizard steps 1–5 ───────────────────────────────────────────────────────

  // PHI-27: every child must have an age range picked before Continue is
  // enabled. Pre-selecting "Under 2" was a personalisation trap; making the
  // pick conscious is the right tradeoff.
  const allChildrenHaveAges = childrenAges.every((a) => a.length > 0);

  const canContinue: Record<number, boolean> = {
    // PHI-30: step 1 also requires destinationVerified — the user might
    // have re-opened the autocomplete here and started editing.
    1:
      destination.trim().length > 0 &&
      destinationVerified &&
      departureDate.length > 0 &&
      returnDate.length > 0,
    2: true,
    3: travelCompany.length > 0 && allChildrenHaveAges,
    4: !previewLoading && Object.keys(activityFeedback).length > 0,
    5: name.trim().length > 0 && email.trim().length > 0,
  };

  async function handleContinue() {
    if (step === 5) { await handleFinish(); return; }
    if (step === 3) { await savePreferencesToDb(); }
    goTo(step + 1);
  }

  const headings: Record<number, string> = {
    1: "When are you going?",
    2: "Where are you staying?",
    3: "Tell us about yourself.",
    4: `Activities for your ${destination} trip.`,
    5: "Save your trip plan.",
  };

  const subs: Record<number, string> = {
    1: `Great choice. Now let's lock in the dates for ${destination}.`,
    2: "Your hotel helps us give better local advice — skip if you haven\u2019t booked yet.",
    3: "A few quick questions so we can personalise your experience.",
    4: "Rate what excites you \u2014 and what doesn\u2019t. It shapes your itinerary.",
    5: "Your activity plan, transport advice, and trip summary are ready. Create your account to save everything.",
  };

  const darkInput =
    "w-full bg-white border border-[#b8b3a9] focus:border-[#1a6b7f] outline-none rounded-xl px-5 py-4 text-[#0e2a47] text-lg placeholder-[#9ca3af] transition-colors";
  const underlineInput =
    "w-full bg-transparent border-b-2 border-[#d4cfc5] focus:border-[#1a6b7f] outline-none text-3xl font-semibold text-[#0e2a47] placeholder-[#9ca3af] py-3 transition-colors";

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
          onClick={() => goTo(step - 1)}
          className="text-[#4a6580] hover:text-[#0e2a47] transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <span className="text-[#6a7f8f] text-sm">{step} / {TOTAL_WIZARD_STEPS}</span>
      </div>

      {/* Step content */}
      <div className="flex-1 flex flex-col justify-center px-6 pb-10">
        <div className="w-full max-w-xl mx-auto animate-step" key={animKey}>

          <div className="mb-10">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight mb-3 text-[#0e2a47]">
              {headings[step]}
            </h1>
            <p className="text-[#4a6580] text-lg">{subs[step]}</p>
          </div>

          {/* Step 1: Destination (editable) + Dates */}
          {step === 1 && (
            <div className="flex flex-col gap-6">
              <div>
                <label className="block text-sm font-semibold text-[#4a6580] uppercase tracking-widest mb-3">
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
                    className="mt-2 text-sm text-[#1a6b7f] hover:text-[#0e2a47] underline-offset-4 hover:underline transition-colors"
                  >
                    Use &ldquo;{destination.trim()}&rdquo; anyway →
                  </button>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#4a6580] uppercase tracking-widest mb-3">
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
                <label className="block text-sm font-semibold text-[#4a6580] uppercase tracking-widest mb-3">
                  Return
                </label>
                <input
                  type="date"
                  value={returnDate}
                  min={departureDate || tomorrow()}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className={darkInput}
                />
              </div>
            </div>
          )}

          {/* Step 2: Hotel (optional) */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <PlacesAutocomplete
                value={hotel}
                onChange={setHotel}
                onSelect={(v) => setHotel(v.split(",")[0].trim())}
                placeholder="e.g. Hotel Arts"
                types={["establishment"]}
                locationBias={destinationBias}
                autoFocus
                onEnter={() => handleContinue()}
                className={underlineInput}
              />
              <button
                onClick={() => { setHotel(""); handleContinue(); }}
                className="self-start text-sm text-[#6a7f8f] hover:text-[#0e2a47] transition-colors"
              >
                I haven&apos;t booked yet — skip →
              </button>
            </div>
          )}

          {/* Step 3: Travel preferences */}
          {step === 3 && (
            <div className="flex flex-col gap-8">
              <div>
                <label className="block text-sm font-semibold text-[#4a6580] uppercase tracking-widest mb-4">
                  Who&apos;s coming?
                </label>

                {/* Adults + Children steppers side by side */}
                <div className="flex gap-8 mb-5">
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-[#6a7f8f] uppercase tracking-widest">Adults</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setAdultCount((c) => Math.max(1, c - 1))}
                        className="w-8 h-8 rounded-xl border border-[#d4cfc5] bg-white text-[#4a6580] hover:text-[#0e2a47] hover:border-[#b8b3a9] transition-colors text-lg leading-none flex items-center justify-center"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-bold text-[#0e2a47] text-sm">{adultCount}</span>
                      <button
                        onClick={() => setAdultCount((c) => c + 1)}
                        className="w-8 h-8 rounded-xl border border-[#d4cfc5] bg-white text-[#4a6580] hover:text-[#0e2a47] hover:border-[#b8b3a9] transition-colors text-lg leading-none flex items-center justify-center"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-[#6a7f8f] uppercase tracking-widest">Children</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { if (childrenAges.length > 0) removeChild(childrenAges.length - 1); }}
                        className="w-8 h-8 rounded-xl border border-[#d4cfc5] bg-white text-[#4a6580] hover:text-[#0e2a47] hover:border-[#b8b3a9] transition-colors text-lg leading-none flex items-center justify-center"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-bold text-[#0e2a47] text-sm">{childrenAges.length}</span>
                      <button
                        onClick={addChild}
                        className="w-8 h-8 rounded-xl border border-[#d4cfc5] bg-white text-[#4a6580] hover:text-[#0e2a47] hover:border-[#b8b3a9] transition-colors text-lg leading-none flex items-center justify-center"
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
                        <span className="text-xs font-semibold text-[#6a7f8f] w-14 shrink-0">Child {idx + 1}</span>
                        <div className="flex gap-1.5 flex-wrap">
                          {CHILD_AGE_RANGES.map((range) => (
                            <button
                              key={range}
                              onClick={() => updateChildAge(idx, range)}
                              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                                age === range
                                  ? "border-[#1a6b7f] bg-[#1a6b7f]/10 text-[#0e2a47]"
                                  : "border-[#e8e4de] bg-white text-[#4a6580] hover:border-[#b8b3a9] hover:text-[#0e2a47]"
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
                className="text-[#0e2a47] text-base font-medium -mt-2"
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
                    <label className="block text-sm font-semibold text-[#4a6580] uppercase tracking-widest mb-4">
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
                                ? "border-[#1a6b7f] bg-[#1a6b7f]/10 text-[#0e2a47]"
                                : "border-[#e8e4de] bg-white text-[#4a6580] hover:border-[#b8b3a9] hover:text-[#0e2a47]"
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
                <label className="block text-sm font-semibold text-[#4a6580] uppercase tracking-widest mb-1">
                  What&apos;s your travel style?
                </label>
                <p className="text-[#6a7f8f] text-sm mb-4">
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
                            ? "border-[#1a6b7f] bg-[#1a6b7f]/10 text-[#0e2a47]"
                            : maxed
                            ? "border-[#e8e4de] bg-white text-[#6a7f8f] cursor-not-allowed"
                            : "border-[#e8e4de] bg-white text-[#4a6580] hover:border-[#b8b3a9] hover:text-[#0e2a47]"
                        }`}
                      >
                        {style}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#4a6580] uppercase tracking-widest mb-4">
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
                      <span className={`text-sm font-bold ${budgetTier === opt.id ? "text-[#0e2a47]" : "text-[#4a6580]"}`}>
                        {opt.label}
                      </span>
                      <span className="text-xs text-[#6a7f8f]">{opt.description}</span>
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
                  className="block text-sm font-semibold text-[#4a6580] uppercase tracking-widest mb-1"
                >
                  Anything we should know?
                </label>
                <p className="text-[#6a7f8f] text-sm mb-4">
                  Optional. Allergies, mobility, dietary, religious — anything we should respect.
                </p>
                <textarea
                  id="trip-constraints"
                  value={constraintText}
                  onChange={(e) => setConstraintText(e.target.value)}
                  placeholder="e.g. one of us has a knee issue, no long walks; severe peanut allergy"
                  rows={3}
                  className="w-full bg-white border border-[#b8b3a9] focus:border-[#1a6b7f] outline-none rounded-xl px-4 py-3 text-[#0e2a47] text-sm placeholder-[#9ca3af] transition-colors mb-3"
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
                            ? "border-[#1a6b7f] bg-[#1a6b7f]/10 text-[#0e2a47]"
                            : "border-[#e8e4de] bg-white text-[#4a6580] hover:border-[#b8b3a9] hover:text-[#0e2a47]"
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

          {/* Step 4: AI Preview with activity cards */}
          {step === 4 && (
            <div className="flex flex-col gap-4">
              {/* Initial loading state — before any cards arrive */}
              {previewLoading && parsedActivities.length === 0 && (
                <div className="rounded-2xl border border-[#e8e4de] bg-white p-6 min-h-[140px] flex items-center">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3 text-[#4a6580]">
                      <div className="w-4 h-4 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin flex-shrink-0" />
                      <span>{previewLoadingLabel(destination, travelCompany)}</span>
                    </div>
                    <p className="text-xs text-[#6a7f8f] ml-7">Activities will appear as we find them — rate each one as it arrives.</p>
                  </div>
                </div>
              )}

              {/* Rating progress counter */}
              {!previewLoading && parsedActivities.length > 0 && Object.keys(activityFeedback).length > 0 && (
                <p className="text-xs text-[#6a7f8f] text-right">
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
                <div className="flex items-center gap-3 px-2 py-3 text-[#6a7f8f] text-sm">
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
            </div>
          )}

          {/* Step 5: Itinerary preview FIRST, then account creation.
              PHI-31 Part 2 slice 2 — the activation lever. Users see the
              actual product output before committing email. The signup
              form moves below as a "Save your trip" CTA. */}
          {step === 5 && (
            <div className="flex flex-col gap-6">
              {/* Hard exclusions edit affordance — kept at top because
                  users are still in "trip-shaping" mode here. */}
              {hardExcludedActivities.length > 0 && (
                <div className="rounded-2xl border border-[#e8e4de] bg-white px-5 py-4">
                  <p className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-3">
                    Skipped activities
                  </p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {hardExcludedActivities.map((entry) => (
                      <button
                        key={entry.activityId}
                        onClick={() => handleRemoveExclusion(entry.activityId)}
                        className="flex items-center gap-2 rounded-xl border border-[#d4cfc5] px-3 py-1.5 text-sm text-[#4a6580] hover:border-red-500/30 hover:text-red-400 transition-colors"
                      >
                        {entry.activityName}
                        <span className="text-[#6a7f8f] text-xs">×</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[#6a7f8f]">Tap to restore an activity.</p>
                </div>
              )}

              {/* Itinerary preview — read-only, day-by-day. Loading state
                  while /api/itinerary/generate streams the response. */}
              <div data-testid="itinerary-preview">
                <h2 className="text-xs font-bold text-[#4a6580] uppercase tracking-widest mb-3">
                  Your trip plan
                </h2>
                {itineraryPreviewLoading && !itineraryPreview && (
                  <div className="rounded-2xl border border-[#e8e4de] bg-white p-6 flex items-center gap-3 text-[#4a6580]">
                    <div className="w-4 h-4 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin" />
                    <span>
                      Building your day-by-day itinerary for {destination}…
                    </span>
                  </div>
                )}
                {itineraryPreviewError && !itineraryPreview && (
                  <div className="rounded-2xl border border-[#e8e4de] bg-[#f0ede8] p-5 text-sm text-[#4a6580]">
                    Couldn&apos;t load your trip preview. You can still save
                    your trip below — we&apos;ll generate the itinerary
                    after you sign in.
                  </div>
                )}
                {itineraryPreview && itineraryPreview.length > 0 && (
                  <div className="flex flex-col gap-3">
                    {itineraryPreview.map((day) => (
                      <div
                        key={day.day_number}
                        className="rounded-2xl border border-[#e8e4de] bg-white p-5"
                      >
                        <p className="text-xs font-bold text-[#1a6b7f] uppercase tracking-widest mb-1">
                          Day {day.day_number}
                          {day.date ? ` · ${day.date}` : ""}
                        </p>
                        <ul className="flex flex-col gap-2.5 mt-2">
                          {day.items.map((item) => (
                            <li key={item.id} className="flex flex-col gap-0.5">
                              <div className="flex items-baseline gap-2">
                                <span className="text-[10px] uppercase tracking-widest text-[#6a7f8f] w-16 shrink-0">
                                  {item.time_block}
                                </span>
                                <span className="text-sm font-semibold text-[#0e2a47]">
                                  {item.title}
                                </span>
                              </div>
                              {item.description && (
                                <p className="text-xs text-[#4a6580] ml-[72px] leading-relaxed">
                                  {item.description}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Save Trip section — signup form, framed as the persistent
                  banner from Maya's escalation pattern. Sits BELOW the
                  preview so the user has already seen the value. */}
              <div className="rounded-2xl border border-[#1a6b7f]/30 bg-[#1a6b7f]/5 p-5">
                <p className="text-sm font-bold text-[#0e2a47] mb-1">
                  Save your trip to keep it.
                </p>
                <p className="text-xs text-[#4a6580] mb-4">
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
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    name="email"
                    className={darkInput}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Continue / finish button */}
          <button
            onClick={handleContinue}
            disabled={!canContinue[step] || saving}
            className="mt-10 w-full rounded-2xl bg-[#1a6b7f] text-white font-bold text-lg py-5 hover:bg-[#155a6b] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saving
              ? "Saving your trip…"
              : step === TOTAL_WIZARD_STEPS
              ? "Let's go →"
              : step === 4
              ? previewLoading
                ? "Loading activities…"
                : Object.keys(activityFeedback).length === 0
                ? "Rate at least one activity to continue"
                : Object.keys(activityFeedback).length < Math.ceil(parsedActivities.length / 2)
                ? `Continue with ${Object.keys(activityFeedback).length} rated — more = better results →`
                : `Continue with ${Object.keys(activityFeedback).length} rated →`
              : "Continue →"}
          </button>

        </div>
      </div>

    </main>
  );
}
