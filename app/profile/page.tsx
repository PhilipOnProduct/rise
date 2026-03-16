"use client";

import { useState } from "react";

type Profile = {
  name: string;
  travelerTypes: string[];
  destination: string;
  departureDate: string;
  returnDate: string;
  travelCompany: string;
  budget: string;
  dietaryWishes: string;
};

const TRAVELER_TYPES = [
  "Adventurer — off the beaten track",
  "Comfort traveler — good hotels and restaurants",
  "Cultural — museums, history, architecture",
  "Foodie — food comes first",
  "Relaxer — sun, beach, doing nothing",
];

const defaultProfile: Profile = {
  name: "",
  travelerTypes: [],
  destination: "",
  departureDate: "",
  returnDate: "",
  travelCompany: "Solo",
  budget: "",
  dietaryWishes: "",
};

function renderMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [recommendations, setRecommendations] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRecommendations("");
    setLoading(true);

    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });

    const res = await fetch("/api/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });

    if (!res.body) { setLoading(false); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      setRecommendations((prev) => prev + decoder.decode(value));
    }
    setLoading(false);
  }

  const inputCls = "w-full bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white placeholder-[#444] transition-colors text-sm";

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-14">
      <div className="max-w-xl mx-auto">

        <a href="/" className="text-gray-600 text-sm hover:text-gray-400 transition-colors mb-8 inline-block">← Rise</a>

        <div className="mb-10">
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">Your travel profile</h1>
          <p className="text-gray-400">Tell us about yourself and we'll find the best restaurants.</p>
        </div>

        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Name</label>
            <input type="text" placeholder="Your name" value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              className={inputCls} />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
              Traveler type <span className="text-gray-600 font-normal normal-case">(select all that apply)</span>
            </label>
            <div className="flex flex-col gap-2">
              {TRAVELER_TYPES.map((type) => {
                const checked = profile.travelerTypes.includes(type);
                return (
                  <label key={type}
                    className={`flex items-center gap-3 cursor-pointer rounded-xl border px-4 py-3.5 transition-colors ${
                      checked ? "border-[#00D64F] bg-[#00D64F]/10" : "border-[#2a2a2a] hover:border-[#3a3a3a]"
                    }`}>
                    <input type="checkbox" checked={checked} onChange={() => {
                      const next = checked
                        ? profile.travelerTypes.filter((t) => t !== type)
                        : [...profile.travelerTypes, type];
                      setProfile({ ...profile, travelerTypes: next });
                    }} className="sr-only" />
                    <span className={`w-5 h-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                      checked ? "border-[#00D64F] bg-[#00D64F]" : "border-[#444]"
                    }`}>
                      {checked && <svg className="w-3 h-3 text-black" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>}
                    </span>
                    <span className="text-sm text-gray-200">{type}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Destination</label>
            <input type="text" placeholder="Where are you going?" value={profile.destination}
              onChange={(e) => setProfile({ ...profile, destination: e.target.value })}
              className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Departure</label>
              <input type="date" value={profile.departureDate}
                onChange={(e) => setProfile({ ...profile, departureDate: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Return</label>
              <input type="date" value={profile.returnDate}
                onChange={(e) => setProfile({ ...profile, returnDate: e.target.value })}
                className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Travel company</label>
            <select value={profile.travelCompany}
              onChange={(e) => setProfile({ ...profile, travelCompany: e.target.value })}
              className={inputCls}>
              <option>Solo</option>
              <option>Couple</option>
              <option>Family with children</option>
              <option>Group of friends</option>
              <option>Business trip</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Budget</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: "budget", label: "Budget", sub: "< €100/day" },
                { value: "mid-range", label: "Mid-range", sub: "€100–250/day" },
                { value: "luxury", label: "Luxury", sub: "> €250/day" },
              ].map(({ value, label, sub }) => (
                <label key={value}
                  className={`flex flex-col items-center gap-1 cursor-pointer rounded-xl border p-4 transition-colors ${
                    profile.budget === value ? "border-[#00D64F] bg-[#00D64F]/10" : "border-[#2a2a2a] hover:border-[#3a3a3a]"
                  }`}>
                  <input type="radio" name="budget" value={value} checked={profile.budget === value}
                    onChange={(e) => setProfile({ ...profile, budget: e.target.value })}
                    className="sr-only" />
                  <span className="font-bold text-white text-sm">{label}</span>
                  <span className="text-xs text-gray-500">{sub}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
              Dietary wishes <span className="text-gray-600 font-normal normal-case">(optional)</span>
            </label>
            <input type="text" placeholder="e.g. vegetarian, no shellfish, halal…"
              value={profile.dietaryWishes}
              onChange={(e) => setProfile({ ...profile, dietaryWishes: e.target.value })}
              className={inputCls} />
          </div>

          <button type="submit" disabled={loading}
            className="w-full rounded-2xl bg-[#00D64F] text-black font-bold py-5 text-lg hover:bg-[#00c248] transition-colors disabled:opacity-40">
            {loading ? "Finding restaurants…" : "Get recommendations →"}
          </button>

        </form>

        {(recommendations || loading) && (
          <div className="mt-8 bg-white rounded-2xl p-7">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5">Restaurant recommendations</h2>
            <div className="text-sm text-gray-800 leading-relaxed">
              {recommendations.split("\n").map((line, i) => (
                <p key={i} className={line === "" ? "mt-3" : ""}>{renderMarkdown(line)}</p>
              ))}
              {loading && <span className="inline-block w-2 h-4 bg-[#00D64F] animate-pulse ml-0.5 align-middle rounded-sm" />}
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
