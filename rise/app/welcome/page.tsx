"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import PlacesAutocomplete from "@/app/components/PlacesAutocomplete";

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
  family:  ["Kid-friendly", "Beach", "Educational", "Wellness", "Photography"],
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

const MAX_STYLE_SELECTIONS = 3;

const CHILD_AGE_RANGES = ["Under 2", "2–4", "5–8", "9–12"] as const;

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

type ParsedActivity = {
  id: string;
  name: string;
  category: string;
  description: string;
  when: string;
};

export type ActivityFeedbackEntry = {
  activityId: string;
  activityName: string;
  activityCategory: string;
  feedbackType: "thumbs_up" | "chip_selected" | "thumbs_down_no_chip";
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
  // Matches: **Name** — Category\nDescription\n*When: timing*
  const regex = /\*\*([^*\n]+)\*\*\s*[—–\-]\s*([^\n]+)\n([^\n*][^\n]*)\n\*When:\s*([^*\n]+)\*/g;
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
}: ActivityCardProps) {
  const isHardExcluded =
    feedback?.feedbackType === "chip_selected" && feedback.chip?.type === "hard_exclusion";
  const isNoted =
    feedback?.feedbackType === "chip_selected" && feedback.chip?.type === "soft_signal" ||
    feedback?.feedbackType === "thumbs_down_no_chip";
  const isThumbsUp = feedback?.feedbackType === "thumbs_up";

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

      {/* Thumbs buttons — hidden while streaming or when chips are open */}
      {!chipsOpen && !disabled && !isHardExcluded && !isNoted && (
        <div className="flex items-center gap-3">
          <button
            onClick={onThumbsUp}
            className={`flex items-center justify-center w-11 h-11 rounded-xl border text-lg transition-colors ${
              isThumbsUp
                ? "border-[#1a6b7f] bg-[#1a6b7f] text-white shadow-sm"
                : "border-[#d4cfc5] text-[#6a7f8f] hover:border-[#1a6b7f]/40 hover:text-[#1a6b7f]"
            }`}
            title="Interested"
          >
            👍
          </button>
          <button
            onClick={onThumbsDown}
            className="flex items-center justify-center w-11 h-11 rounded-xl border border-[#d4cfc5] text-lg text-[#6a7f8f] hover:border-red-500/40 hover:text-red-400 transition-colors"
            title="Not for me"
          >
            👎
          </button>
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
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [hotel, setHotel] = useState("");

  // Preferences (Step 3)
  const [travelCompany, setTravelCompany] = useState("");
  const [adultCount, setAdultCount] = useState(2);
  const [childrenAges, setChildrenAges] = useState<string[]>([]);
  const [travelerTypes, setTravelerTypes] = useState<string[]>([]);
  const [budgetTier, setBudgetTier] = useState("");

  // Account
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  // Partial traveler ID written to DB at step 3 advance
  const [travelerId, setTravelerId] = useState<string | null>(null);

  // AI Preview (step 4)
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);

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
      // Final parse — emit all remaining cards
      const final = parseActivities(accumulated);
      if (final.length > emittedCount) {
        setParsedActivities(final);
      }
      setPreviewLoading(false);
    })();

    return () => {
      controller.abort();
    };
  }, [step, destination, departureDate, returnDate, travelCompany, travelerTypes, budgetTier]);

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

  function goTo(next: number) {
    setStep(next);
    setAnimKey((k) => k + 1);
  }

  function handleDestinationSelect(place: string) {
    setDestination(place);
    if (typeof window === "undefined" || !window.google?.maps) return;
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: place }, (results, status) => {
      if (status === "OK" && results?.[0]) {
        const loc = results[0].geometry.location;
        setDestinationBias({ lat: loc.lat(), lng: loc.lng() });
      }
    });
  }

  function toggleStyle(style: string) {
    setTravelerTypes((prev) => {
      if (prev.includes(style)) return prev.filter((s) => s !== style);
      if (prev.length >= MAX_STYLE_SELECTIONS) return prev;
      return [...prev, style];
    });
  }

  function addChild() {
    setChildrenAges((prev) => [...prev, CHILD_AGE_RANGES[0]]);
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
            onChange={setDestination}
            onSelect={(place) => handleDestinationSelect(place)}
            placeholder="e.g. Tokyo, Japan"
            types={["(cities)"]}
            autoFocus
            theme="light"
            onEnter={() => { if (destination.trim()) goTo(1); }}
            className="w-full bg-white border-b-2 border-[#d4cfc5] focus:border-[#1a6b7f] outline-none text-3xl font-medium py-3 transition-colors placeholder-[#b8b0a4]"
            style={{ color: "#0e2a47" }}
          />
          <button
            onClick={() => goTo(1)}
            disabled={!destination.trim()}
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

  const canContinue: Record<number, boolean> = {
    1: destination.trim().length > 0 && departureDate.length > 0 && returnDate.length > 0,
    2: true,
    3: travelCompany.length > 0,
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
                  onChange={setDestination}
                  onSelect={handleDestinationSelect}
                  placeholder="e.g. Tokyo, Japan"
                  types={["(cities)"]}
                  className={darkInput}
                />
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

          {/* Step 5: Account creation */}
          {step === 5 && (
            <div className="flex flex-col gap-6">
              {/* Hard exclusions edit affordance */}
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

              <p className="text-[#6a7f8f] text-sm -mt-2">
                Your activity plan, transport advice, and trip summary are ready. Create your account to save everything.
              </p>
              <div>
                <label className="block text-sm font-semibold text-[#4a6580] uppercase tracking-widest mb-3">
                  Your name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Sofia"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  name="name"
                  autoFocus
                  className={darkInput}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#4a6580] uppercase tracking-widest mb-3">
                  Email
                </label>
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
