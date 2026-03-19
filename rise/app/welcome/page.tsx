"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import PlacesAutocomplete from "@/app/components/PlacesAutocomplete";

const TOTAL_WIZARD_STEPS = 5; // steps 1–5

const COMPANY_OPTIONS = [
  { id: "solo", label: "Solo", emoji: "🧳" },
  { id: "couple", label: "Couple", emoji: "💑" },
  { id: "family", label: "Family", emoji: "👨‍👩‍👧" },
  { id: "friends", label: "Friends", emoji: "👯" },
];

const STYLE_OPTIONS = [
  "Food-led",
  "Culture-first",
  "Adventure",
  "Slow travel",
  "Nature",
  "Nightlife",
];

const BUDGET_OPTIONS = [
  { id: "budget", label: "Savvy", description: "Great value, local finds" },
  { id: "comfortable", label: "Comfortable", description: "Quality without excess" },
  { id: "luxury", label: "Flexible", description: "Spend where it matters" },
];

const MAX_STYLE_SELECTIONS = 3;

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
    couple: "couples",
    family: "family",
    friends: "friends",
  };
  const label = companyLabel[travelCompany];
  if (label) return `Planning your ${label} trip to ${destination}…`;
  return `Planning your trip to ${destination}…`;
}

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

  // Write preferences to DB when advancing from step 3 to step 4
  async function savePreferencesToDb() {
    try {
      if (travelerId) {
        // Update existing partial record
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
        // Create a partial record with trip + preference data
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
        // Update the partial record with name/email
        await fetch("/api/travelers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: travelerId, name, email }),
        });
      } else {
        // No partial record — create the full traveler record
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
            Tell us your destination and we'll build your trip.
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
                  What's your travel style?
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
                  What's your budget style?
                </label>
                <div className="flex flex-col gap-2">
                  {BUDGET_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setBudgetTier(budgetTier === opt.id ? "" : opt.id)}
                      className={`flex items-center justify-between px-5 py-4 rounded-2xl border text-sm font-semibold transition-all text-left ${
                        budgetTier === opt.id
                          ? "border-[#00D64F] bg-[#00D64F]/10 text-white"
                          : "border-[#1e1e1e] bg-[#111] text-gray-400 hover:border-[#333] hover:text-white"
                      }`}
                    >
                      <span>{opt.label}</span>
                      <span className="text-gray-600 font-normal text-xs">{opt.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 4: AI Preview */}
          {step === 4 && (
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

          {/* Step 5: Account creation */}
          {step === 5 && (
            <div className="flex flex-col gap-6">
              <p className="text-gray-500 text-sm -mt-4">
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
