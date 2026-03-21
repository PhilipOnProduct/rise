"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import PlacesAutocomplete from "@/app/components/PlacesAutocomplete";

const TOTAL_WIZARD_STEPS = 5; // steps 1–5

const COMPANY_OPTIONS = [
  { id: "solo", label: "Solo", emoji: "🧳" },
  { id: "partner", label: "Partner", emoji: "💑" },
  { id: "friends", label: "Friends", emoji: "👯" },
  { id: "family", label: "Family", emoji: "👨‍👩‍👧" },
];

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

type Chip = {
  label: string;
  type: "hard_exclusion" | "soft_signal";
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
  feedbackType: "thumbs_up" | "chip_selected";
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
  chips: Chip[] | undefined;
  feedback: ActivityFeedbackEntry | undefined;
  chipsOpen: boolean;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  onChipSelect: (chip: Chip) => void;
};

function ActivityCard({
  activity,
  chips,
  feedback,
  chipsOpen,
  onThumbsUp,
  onThumbsDown,
  onChipSelect,
}: ActivityCardProps) {
  const isHardExcluded =
    feedback?.feedbackType === "chip_selected" && feedback.chip?.type === "hard_exclusion";
  const isSoftNoted =
    feedback?.feedbackType === "chip_selected" && feedback.chip?.type === "soft_signal";
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
        <div className="flex items-center gap-2">
          <button
            onClick={onThumbsUp}
            className="rounded-xl border border-[#2a2a2a] px-3 py-1.5 text-sm text-gray-500 hover:border-green-500/40 hover:text-green-400 transition-colors"
            title="Interested"
          >
            👍
          </button>
          <button
            onClick={onThumbsDown}
            className="rounded-xl border border-[#2a2a2a] px-3 py-1.5 text-sm text-gray-500 hover:border-red-500/40 hover:text-red-400 transition-colors"
            title="Not for me"
          >
            👎
          </button>
        </div>
      )}

      {/* Thumbs up confirmed */}
      {isThumbsUp && <p className="text-xs text-[#00D64F]">Noted ✓</p>}

      {/* Chips layer */}
      {chipsOpen && (
        <div className="flex flex-wrap gap-2">
          {chips ? (
            chips.map((chip) => (
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
            ))
          ) : (
            <p className="text-xs text-gray-600">Loading reasons…</p>
          )}
        </div>
      )}

      {/* Chip selected — hard exclusion */}
      {isHardExcluded && <p className="text-xs text-orange-400">We&apos;ll skip this.</p>}

      {/* Chip selected — soft signal */}
      {isSoftNoted && <p className="text-xs text-gray-500">Noted.</p>}
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
  const [activityChips, setActivityChips] = useState<Record<string, Chip[]>>({});
  const [activityFeedback, setActivityFeedback] = useState<
    Record<string, ActivityFeedbackEntry>
  >({});
  const [openChipId, setOpenChipId] = useState<string | null>(null);
  const chipsFetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (departureDate) setReturnDate(addDays(departureDate, 7));
  }, [departureDate]);

  // Fire streaming preview when entering step 4
  useEffect(() => {
    if (step !== 4) return;

    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewLoading(true);
    setPreviewText("");
    setParsedActivities([]);
    chipsFetchedRef.current = new Set();

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

  // Generate chips for each card as soon as they're parsed
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
          if (data.chips) {
            setActivityChips((prev) => ({ ...prev, [activity.id]: data.chips! }));
          }
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
    setOpenChipId(activity.id);
    logActivityEvent({
      event: "chips_shown",
      activityId: activity.id,
      activityName: activity.name,
      activityCategory: activity.category,
    });
  }

  function handleChipSelect(activity: ParsedActivity, chip: Chip) {
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
    router.push("/dashboard");
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
              onSelect={setHotel}
              placeholder="e.g. Park Hyatt Tokyo"
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
                  Who are you travelling with?
                </label>
                <div className="flex flex-wrap gap-3">
                  {COMPANY_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setTravelCompany(travelCompany === opt.id ? "" : opt.id)}
                      className={`flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm font-semibold transition-all ${
                        travelCompany === opt.id
                          ? "border-[#00D64F] bg-[#00D64F]/10 text-white"
                          : "border-[#1e1e1e] bg-[#111] text-gray-400 hover:border-[#333] hover:text-white"
                      }`}
                    >
                      <span>{opt.emoji}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

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
                  chips={activityChips[activity.id]}
                  feedback={activityFeedback[activity.id]}
                  chipsOpen={openChipId === activity.id}
                  onThumbsUp={() => handleThumbsUp(activity)}
                  onThumbsDown={() => handleThumbsDown(activity)}
                  onChipSelect={(chip) => handleChipSelect(activity, chip)}
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
