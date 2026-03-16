"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import PlacesAutocomplete from "@/app/components/PlacesAutocomplete";

type Activity = {
  id: number;
  name: string;
  category: string;
  description: string;
  emoji: string;
};

const TOTAL_STEPS = 5;

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

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [animKey, setAnimKey] = useState(1);

  const [destination, setDestination] = useState("");
  const [destinationBias, setDestinationBias] = useState<{ lat: number; lng: number } | null>(null);
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [hotel, setHotel] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (departureDate) setReturnDate(addDays(departureDate, 7));
  }, [departureDate]);

  function goTo(next: number) {
    setStep(next);
    setAnimKey((k) => k + 1);
  }

  // After destination is selected, geocode it to bias the hotel autocomplete
  function handleDestinationSelect(place: string) {
    setDestination(place);
    if (!window.google?.maps) return;
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: place }, (results, status) => {
      if (status === "OK" && results?.[0]) {
        const loc = results[0].geometry.location;
        setDestinationBias({ lat: loc.lat(), lng: loc.lng() });
      }
    });
  }

  async function fetchActivities() {
    setLoadingActivities(true);
    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination }),
      });
      const data = await res.json();
      setActivities(Array.isArray(data) ? data : []);
    } catch {
      setActivities([]);
    }
    setLoadingActivities(false);
  }

  function toggleActivity(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleFinish() {
    setSaving(true);
    const selectedActivities = activities.filter((a) => selectedIds.includes(a.id));
    let travelerId: string | null = null;
    try {
      const res = await fetch("/api/travelers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, destination, departureDate, returnDate, hotel, activities: selectedActivities }),
      });
      if (res.ok) {
        const data = await res.json();
        travelerId = data.id;
      }
    } catch {}
    const travelerData = { id: travelerId, name, email, destination, departureDate, returnDate, hotel, activities: selectedActivities };
    localStorage.setItem("rise_traveler", JSON.stringify(travelerData));
    localStorage.setItem("rise_onboarded", "true");
    setSaving(false);
    router.push("/dashboard");
  }

  const canContinue: Record<number, boolean> = {
    1: destination.trim().length > 0,
    2: departureDate.length > 0 && returnDate.length > 0,
    3: hotel.trim().length > 0,
    4: true,
    5: name.trim().length > 0 && email.trim().length > 0,
  };

  async function handleContinue() {
    if (step === 3) { goTo(4); fetchActivities(); }
    else if (step === 5) { await handleFinish(); }
    else { goTo(step + 1); }
  }

  const stepHeadings = [
    "Where are you going?",
    "When are you travelling?",
    "Where are you staying?",
    "What do you want to do?",
    "Almost done.",
  ];
  const stepSubs = [
    "Enter your destination city or country.",
    "Pick your dates. We'll plan around them.",
    "Your hotel helps us give better transport advice.",
    `Pick the activities you're excited about in ${destination}.`,
    "Create your Rise account to save your trip.",
  ];

  const underlineInput = "w-full bg-transparent border-b-2 border-[#2a2a2a] focus:border-[#00D64F] outline-none text-3xl font-semibold text-white placeholder-[#333] py-3 transition-colors";
  const darkInput = "w-full bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white text-lg placeholder-[#444] transition-colors";

  return (
    <main className="min-h-screen bg-[#0a0a0a] flex flex-col">

      {/* Progress bar */}
      <div className="w-full h-1 bg-[#1a1a1a]">
        <div
          className="h-1 bg-[#00D64F] transition-all duration-500 ease-out"
          style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-2">
        {step > 1 ? (
          <button
            onClick={() => goTo(step - 1)}
            className="text-gray-400 hover:text-white transition-colors text-sm font-medium"
          >
            ← Back
          </button>
        ) : (
          <a href="/" className="text-gray-600 hover:text-gray-400 transition-colors text-sm">Rise</a>
        )}
        <span className="text-gray-600 text-sm">{step} / {TOTAL_STEPS}</span>
      </div>

      {/* Step content */}
      <div className="flex-1 flex flex-col justify-center px-6 pb-10">
        <div className="w-full max-w-xl mx-auto animate-step" key={animKey}>

          <div className="mb-10">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight mb-3">
              {stepHeadings[step - 1]}
            </h1>
            <p className="text-gray-400 text-lg">{stepSubs[step - 1]}</p>
          </div>

          {/* Step 1: Destination with Places autocomplete */}
          {step === 1 && (
            <PlacesAutocomplete
              value={destination}
              onChange={setDestination}
              onSelect={handleDestinationSelect}
              placeholder="e.g. Tokyo, Japan"
              types={["(cities)"]}
              autoFocus
              onEnter={() => canContinue[1] && handleContinue()}
              className={underlineInput}
            />
          )}

          {/* Step 2: Dates */}
          {step === 2 && (
            <div className="flex flex-col gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Departure</label>
                <input
                  type="date"
                  value={departureDate}
                  min={tomorrow()}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  className={darkInput}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Return</label>
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

          {/* Step 3: Hotel with Places autocomplete biased toward destination */}
          {step === 3 && (
            <PlacesAutocomplete
              value={hotel}
              onChange={setHotel}
              onSelect={setHotel}
              placeholder="e.g. Park Hyatt Tokyo"
              types={["establishment"]}
              locationBias={destinationBias}
              autoFocus
              onEnter={() => canContinue[3] && handleContinue()}
              className={underlineInput}
            />
          )}

          {/* Step 4: Activities */}
          {step === 4 && (
            <div>
              {loadingActivities ? (
                <div className="flex flex-col items-center gap-4 py-16">
                  <div className="w-10 h-10 rounded-full border-2 border-[#00D64F] border-t-transparent animate-spin" />
                  <p className="text-gray-400">Finding activities in {destination}…</p>
                </div>
              ) : (
                <>
                  {selectedIds.length > 0 && (
                    <p className="text-[#00D64F] text-sm font-semibold mb-4">{selectedIds.length} selected</p>
                  )}
                  <div className="grid grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
                    {activities.map((a) => {
                      const sel = selectedIds.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          onClick={() => toggleActivity(a.id)}
                          className={`text-left rounded-2xl border p-4 transition-all ${
                            sel ? "border-[#00D64F] bg-[#00D64F]/10" : "border-[#1e1e1e] bg-[#111] hover:border-[#333]"
                          }`}
                        >
                          <div className="text-2xl mb-2">{a.emoji}</div>
                          <div className="font-semibold text-sm text-white leading-snug mb-1">{a.name}</div>
                          <div className="text-xs text-gray-500">{a.description}</div>
                          {sel && <div className="mt-2 text-[#00D64F] text-xs font-bold">✓ Selected</div>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 5: Account */}
          {step === 5 && (
            <div className="flex flex-col gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Your name</label>
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
                <label className="block text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Email</label>
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

          {/* Continue button */}
          <button
            onClick={handleContinue}
            disabled={!canContinue[step] || saving || (step === 4 && loadingActivities)}
            className="mt-10 w-full rounded-2xl bg-[#00D64F] text-black font-bold text-lg py-5 hover:bg-[#00c248] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saving ? "Saving your trip…" : step === TOTAL_STEPS ? "Let's go →" : "Continue →"}
          </button>

        </div>
      </div>

    </main>
  );
}
