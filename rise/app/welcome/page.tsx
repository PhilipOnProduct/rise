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

const STYLE_OPTIONS = [
  "Adventure",
  "Food-led",
  "Cultural",
  "Nightlife",
  "Relaxed",
  "Off the beaten track",
  "Art & Design",
  "Wellness",
  "History",
  "Photography",
];

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
  { label: "Doesn't fit my itinerary", type: "soft_signal" },
  { label: "Done it before", type: "hard_exclusion" },
  { label: "Not really my thing", type: "soft_signal" },
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
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  onChipSelect: (chip: Chip) => void;
  onNoChipSubmit: () => void;
};

function ActivityCard({
  activity,
  chipsEntry,
  feedback,
  chipsOpen,
  onThumbsUp,
  onThumbsDown,
  onChipSelect,
  onNoChipSubmit,
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
          ? "border-[#1e1e1e] bg-[#0d0d0d] opacity-50"
          : "border-[#1e1e1e] bg-[#111]"
      }`}
    >
      <div className="mb-3">
        <div className="font-bold text-white text-base leading-snug">{activity.name}</div>
        <div className="text-xs text-[#00D64F] font-semibold mt-0.5">{activity.category}</div>
      </div>
      <p className="text-sm text-gray-400 leading-relaxed mb-1">{activity.description}</p>
      <p className="text-xs text-gray-600 mb-4">When: {activity.when}</p>

      {/* Default: thumbs buttons */}
      {!feedback && !chipsOpen && (
        <div className="flex items-center gap-3">
          <button
            onClick={onThumbsUp}
            className="flex items-center justify-center w-11 h-11 rounded-xl border border-[#2a2a2a] text-lg text-gray-500 hover:border-green-500/40 hover:text-green-400 transition-colors"
            title="Interested"
          >
            👍
          </button>
          <button
            onClick={onThumbsDown}
            className="flex items-center justify-center w-11 h-11 rounded-xl border border-[#2a2a2a] text-lg text-gray-500 hover:border-red-500/40 hover:text-red-400 transition-colors"
            title="Not for me"
          >
            👎
          </button>
        </div>
      )}

      {/* Thumbs up confirmed */}
      {isThumbsUp && <p className="text-xs text-[#00D64F]">Liked ✓</p>}

      {/* Chips layer — always present immediately (fallback → dynamic swap happens silently) */}
      {chipsOpen && chipsEntry && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {chipsEntry.chips.map((chip) => (
              <button
                key={chip.label}
                onClick={() => onChipSelect(chip)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                  chip.type === "hard_exclusion"
                    ? "border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                    : "border-[#2a2a2a] text-gray-400 hover:border-[#444] hover:text-white"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <button
            onClick={onNoChipSubmit}
            className="self-start text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Skip →
          </button>
        </div>
      )}

      {/* Chip selected — hard exclusion */}
      {isHardExcluded && <p className="text-xs text-orange-400">We&apos;ll skip this.</p>}

      {/* Soft signal or no-chip submission */}
      {isNoted && <p className="text-xs text-gray-500">Noted.</p>}
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
  const [previewText, setPreviewText] = useState("");
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

  // Fire streaming preview when entering step 4
  useEffect(() => {
    if (step !== 4) return;

    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewLoading(true);
    setPreviewText("");
    setParsedActivities([]);
    chipsFetchedRef.current = new Set();
    submittedActivitiesRef.current = new Set();

    (async () => {
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
          setPreviewText((prev) => prev + decoder.decode(value, { stream: true }));
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== "AbortError") {
          console.error("[preview]", e);
        }
      }
      setPreviewLoading(false);
    })();

    return () => {
      controller.abort();
    };
  }, [step, destination, departureDate, returnDate, travelCompany, travelerTypes, budgetTier]);

  // Parse activities once streaming completes
  useEffect(() => {
    if (previewLoading || !previewText) return;
    const activities = parseActivities(previewText);
    setParsedActivities(activities);
  }, [previewLoading, previewText]);

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

  function handleNoChipSubmit(activity: ParsedActivity) {
    const chipsEntry = activityChips[activity.id];
    submittedActivitiesRef.current.add(activity.id);
    setActivityFeedback((prev) => ({
      ...prev,
      [activity.id]: {
        activityId: activity.id,
        activityName: activity.name,
        activityCategory: activity.category,
        feedbackType: "thumbs_down_no_chip",
      },
    }));
    setOpenChipId(null);
    logActivityEvent({
      event: "thumbs_down_no_chip",
      activityId: activity.id,
      activityName: activity.name,
      activityCategory: activity.category,
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
            hotel,
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
            hotel,
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
      hotel,
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
    router.push("/itinerary/view");
  }

  // ── Step 0: Full-screen landing ────────────────────────────────────────────

  if (step === 0) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-xl animate-step" key={animKey}>
          <p className="text-[#00D64F] font-extrabold text-xl tracking-tight mb-16">Rise</p>
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight leading-tight mb-4">
            Where to?
          </h1>
          <p className="text-gray-500 text-lg mb-10">
            Tell us your destination and we&apos;ll build your trip.
          </p>
          <PlacesAutocomplete
            value={destination}
            onChange={setDestination}
            onSelect={(place) => handleDestinationSelect(place)}
            placeholder="e.g. Tokyo, Japan"
            types={["(cities)"]}
            autoFocus
            onEnter={() => { if (destination.trim()) goTo(1); }}
            className="w-full bg-transparent border-b-2 border-[#2a2a2a] focus:border-[#00D64F] outline-none text-3xl font-semibold text-white placeholder-[#2a2a2a] py-3 transition-colors"
          />
          <button
            onClick={() => goTo(1)}
            disabled={!destination.trim()}
            className="mt-10 w-full rounded-2xl bg-[#00D64F] text-black font-bold text-lg py-5 hover:bg-[#00c248] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Start planning →
          </button>
        </div>
      </main>
    );
  }

  // ── Wizard steps 1–5 ───────────────────────────────────────────────────────

  const canContinue: Record<number, boolean> = {
    1: destination.trim().length > 0 && departureDate.length > 0 && returnDate.length > 0,
    2: hotel.trim().length > 0,
    3: travelCompany.length > 0,
    4: true,
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
    4: `What to do in ${destination}.`,
    5: "Save your trip plan.",
  };

  const subs: Record<number, string> = {
    1: `Great choice. Now let's lock in the dates for ${destination}.`,
    2: "Your hotel helps us give you better transport and local advice.",
    3: "A few quick questions so we can personalise your experience.",
    4: "AI activity ideas tailored to your trip — before you commit to anything.",
    5: "Your personalised plan is ready. Create an account to save it.",
  };

  const darkInput =
    "w-full bg-[#111] border border-[#444] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white text-lg placeholder-[#555] transition-colors";
  const underlineInput =
    "w-full bg-transparent border-b-2 border-[#2a2a2a] focus:border-[#00D64F] outline-none text-3xl font-semibold text-white placeholder-[#333] py-3 transition-colors";

  return (
    <main className="min-h-screen bg-[#0a0a0a] flex flex-col">

      {/* Progress bar */}
      <div className="w-full h-1 bg-[#1a1a1a]">
        <div
          className="h-1 bg-[#00D64F] transition-all duration-500 ease-out"
          style={{ width: `${(step / TOTAL_WIZARD_STEPS) * 100}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-2">
        <button
          onClick={() => goTo(step - 1)}
          className="text-gray-400 hover:text-white transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <span className="text-gray-600 text-sm">{step} / {TOTAL_WIZARD_STEPS}</span>
      </div>

      {/* Step content */}
      <div className="flex-1 flex flex-col justify-center px-6 pb-10">
        <div className="w-full max-w-xl mx-auto animate-step" key={animKey}>

          <div className="mb-10">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight mb-3">
              {headings[step]}
            </h1>
            <p className="text-gray-400 text-lg">{subs[step]}</p>
          </div>

          {/* Step 1: Destination (editable) + Dates */}
          {step === 1 && (
            <div className="flex flex-col gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
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
                <label className="block text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
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
                <label className="block text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
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

          {/* Step 2: Hotel */}
          {step === 2 && (
            <PlacesAutocomplete
              value={hotel}
              onChange={setHotel}
              onSelect={(v) => setHotel(v.split(",")[0].trim())}
              placeholder="e.g. Hotel Arts"
              types={["establishment"]}
              locationBias={destinationBias}
              autoFocus
              onEnter={() => canContinue[2] && handleContinue()}
              className={underlineInput}
            />
          )}

          {/* Step 3: Travel preferences */}
          {step === 3 && (
            <div className="flex flex-col gap-8">
              <div>
                <label className="block text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">
                  Who&apos;s coming?
                </label>

                {/* Adults + Children steppers side by side */}
                <div className="flex gap-8 mb-5">
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Adults</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setAdultCount((c) => Math.max(1, c - 1))}
                        className="w-8 h-8 rounded-xl border border-[#2a2a2a] bg-[#111] text-gray-400 hover:text-white hover:border-[#444] transition-colors text-lg leading-none flex items-center justify-center"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-bold text-white text-sm">{adultCount}</span>
                      <button
                        onClick={() => setAdultCount((c) => c + 1)}
                        className="w-8 h-8 rounded-xl border border-[#2a2a2a] bg-[#111] text-gray-400 hover:text-white hover:border-[#444] transition-colors text-lg leading-none flex items-center justify-center"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Children</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { if (childrenAges.length > 0) removeChild(childrenAges.length - 1); }}
                        className="w-8 h-8 rounded-xl border border-[#2a2a2a] bg-[#111] text-gray-400 hover:text-white hover:border-[#444] transition-colors text-lg leading-none flex items-center justify-center"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-bold text-white text-sm">{childrenAges.length}</span>
                      <button
                        onClick={addChild}
                        className="w-8 h-8 rounded-xl border border-[#2a2a2a] bg-[#111] text-gray-400 hover:text-white hover:border-[#444] transition-colors text-lg leading-none flex items-center justify-center"
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
                        <span className="text-xs font-semibold text-gray-500 w-14 shrink-0">Child {idx + 1}</span>
                        <div className="flex gap-1.5 flex-wrap">
                          {CHILD_AGE_RANGES.map((range) => (
                            <button
                              key={range}
                              onClick={() => updateChildAge(idx, range)}
                              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                                age === range
                                  ? "border-[#00D64F] bg-[#00D64F]/10 text-white"
                                  : "border-[#1e1e1e] bg-[#111] text-gray-400 hover:border-[#333] hover:text-white"
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
                    <label className="block text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">
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
                                ? "border-[#00D64F] bg-[#00D64F]/10 text-white"
                                : "border-[#1e1e1e] bg-[#111] text-gray-400 hover:border-[#333] hover:text-white"
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
                <label className="block text-sm font-semibold text-gray-400 uppercase tracking-widest mb-1">
                  What&apos;s your travel style?
                </label>
                <p className="text-gray-600 text-sm mb-4">
                  Pick up to {MAX_STYLE_SELECTIONS}.
                </p>
                <div className="flex flex-wrap gap-2">
                  {STYLE_OPTIONS.map((style) => {
                    const selected = travelerTypes.includes(style);
                    const maxed = travelerTypes.length >= MAX_STYLE_SELECTIONS && !selected;
                    return (
                      <button
                        key={style}
                        onClick={() => toggleStyle(style)}
                        disabled={maxed}
                        className={`px-4 py-2 rounded-xl border text-sm font-semibold transition-all ${
                          selected
                            ? "border-[#00D64F] bg-[#00D64F]/10 text-white"
                            : maxed
                            ? "border-[#1e1e1e] bg-[#111] text-gray-600 cursor-not-allowed"
                            : "border-[#1e1e1e] bg-[#111] text-gray-400 hover:border-[#333] hover:text-white"
                        }`}
                      >
                        {style}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">
                  What&apos;s your budget?
                </label>
                <div className="flex flex-col gap-2">
                  {BUDGET_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setBudgetTier(budgetTier === opt.id ? "" : opt.id)}
                      className={`flex items-center justify-between px-5 py-4 rounded-2xl border text-left transition-all ${
                        budgetTier === opt.id
                          ? "border-[#00D64F] bg-[#00D64F]/10"
                          : "border-[#1e1e1e] bg-[#111] hover:border-[#333]"
                      }`}
                    >
                      <span className={`text-sm font-bold ${budgetTier === opt.id ? "text-white" : "text-gray-400"}`}>
                        {opt.label}
                      </span>
                      <span className="text-xs text-gray-600">{opt.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 4: AI Preview with activity cards */}
          {step === 4 && (
            <div className="flex flex-col gap-4">
              {/* Streaming / loading state */}
              {(previewLoading || parsedActivities.length === 0) && (
                <div className="rounded-2xl border border-[#1e1e1e] bg-[#111] p-6 min-h-[280px]">
                  {previewLoading && !previewText && (
                    <div className="flex items-center gap-3 text-gray-400">
                      <div className="w-4 h-4 rounded-full border-2 border-[#00D64F] border-t-transparent animate-spin flex-shrink-0" />
                      <span>{previewLoadingLabel(destination, travelCompany)}</span>
                    </div>
                  )}
                  {previewText && (
                    <div className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                      {previewText}
                      {previewLoading && (
                        <span className="inline-block w-1.5 h-4 bg-[#00D64F] ml-0.5 align-middle animate-pulse" />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Card view — shown once parsing completes */}
              {parsedActivities.map((activity) => (
                <ActivityCard
                  key={activity.id}
                  activity={activity}
                  chipsEntry={activityChips[activity.id]}
                  feedback={activityFeedback[activity.id]}
                  chipsOpen={openChipId === activity.id}
                  onThumbsUp={() => handleThumbsUp(activity)}
                  onThumbsDown={() => handleThumbsDown(activity)}
                  onChipSelect={(chip) => handleChipSelect(activity, chip)}
                  onNoChipSubmit={() => handleNoChipSubmit(activity)}
                />
              ))}
            </div>
          )}

          {/* Step 5: Account creation */}
          {step === 5 && (
            <div className="flex flex-col gap-6">
              {/* Hard exclusions edit affordance */}
              {hardExcludedActivities.length > 0 && (
                <div className="rounded-2xl border border-[#1e1e1e] bg-[#111] px-5 py-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
                    Skipped activities
                  </p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {hardExcludedActivities.map((entry) => (
                      <button
                        key={entry.activityId}
                        onClick={() => handleRemoveExclusion(entry.activityId)}
                        className="flex items-center gap-2 rounded-xl border border-[#2a2a2a] px-3 py-1.5 text-sm text-gray-400 hover:border-red-500/30 hover:text-red-400 transition-colors"
                      >
                        {entry.activityName}
                        <span className="text-gray-600 text-xs">×</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-600">Tap to restore an activity.</p>
                </div>
              )}

              <p className="text-gray-500 text-sm -mt-2">
                Your activity plan, transport advice, and trip summary are ready. Create your account to save everything.
              </p>
              <div>
                <label className="block text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
                  Your name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Sofia"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  className={darkInput}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
                  Email
                </label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={darkInput}
                />
              </div>
            </div>
          )}

          {/* Continue / finish button */}
          <button
            onClick={handleContinue}
            disabled={!canContinue[step] || saving}
            className="mt-10 w-full rounded-2xl bg-[#00D64F] text-black font-bold text-lg py-5 hover:bg-[#00c248] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saving
              ? "Saving your trip…"
              : step === TOTAL_WIZARD_STEPS
              ? "Let's go →"
              : step === 4
              ? "Looks good — continue →"
              : "Continue →"}
          </button>

        </div>
      </div>

    </main>
  );
}
