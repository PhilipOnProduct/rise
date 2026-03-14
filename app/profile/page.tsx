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

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [saved, setSaved] = useState<Profile | null>(null);
  const [recommendations, setRecommendations] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const submittedProfile = { ...profile };
    setSaved(submittedProfile);
    setRecommendations("");
    setLoading(true);

    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submittedProfile),
    });

    const res = await fetch("/api/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submittedProfile),
    });

    if (!res.body) {
      setLoading(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      setRecommendations((prev) => prev + decoder.decode(value));
    }

    setLoading(false);
  }

  // Render markdown-style bold (**text**) as <strong>
  function renderText(text: string) {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return <em key={i}>{part.slice(1, -1)}</em>;
      }
      return part;
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white px-8 py-16">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-blue-100 shadow-sm p-10">

        <h1 className="text-3xl font-bold text-blue-900 mb-2">Your travel profile</h1>
        <p className="text-gray-500 mb-8">Rise uses this to give you personalised advice.</p>

        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              placeholder="Your name"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">What kind of traveler are you? <span className="text-gray-400 font-normal">(select all that apply)</span></label>
            <div className="flex flex-col gap-2">
              {TRAVELER_TYPES.map((type) => {
                const checked = profile.travelerTypes.includes(type);
                return (
                  <label
                    key={type}
                    className={`flex items-center gap-3 cursor-pointer rounded-xl border px-4 py-3 transition-colors ${
                      checked
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-blue-400 hover:bg-blue-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked
                          ? profile.travelerTypes.filter((t) => t !== type)
                          : [...profile.travelerTypes, type];
                        setProfile({ ...profile, travelerTypes: next });
                      }}
                      className="sr-only"
                    />
                    <span className={`w-5 h-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-colors ${checked ? "border-blue-500 bg-blue-500" : "border-gray-300"}`}>
                      {checked && (
                        <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="text-gray-900">{type}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Destination</label>
            <input
              type="text"
              placeholder="Where are you going?"
              value={profile.destination}
              onChange={(e) => setProfile({ ...profile, destination: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Departure date</label>
              <input
                type="date"
                value={profile.departureDate}
                onChange={(e) => setProfile({ ...profile, departureDate: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Return date</label>
              <input
                type="date"
                value={profile.returnDate}
                onChange={(e) => setProfile({ ...profile, returnDate: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Travel company</label>
            <select
              value={profile.travelCompany}
              onChange={(e) => setProfile({ ...profile, travelCompany: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option>Solo</option>
              <option>Couple</option>
              <option>Family with children</option>
              <option>Group of friends</option>
              <option>Business trip</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Budget</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: "budget", label: "Budget", sub: "< €100/day" },
                { value: "mid-range", label: "Mid-range", sub: "€100–250/day" },
                { value: "luxury", label: "Luxury", sub: "> €250/day" },
              ].map(({ value, label, sub }) => (
                <label
                  key={value}
                  className={`flex flex-col items-center gap-1 cursor-pointer rounded-xl border p-4 transition-colors ${
                    profile.budget === value
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-blue-400 hover:bg-blue-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="budget"
                    value={value}
                    checked={profile.budget === value}
                    onChange={(e) => setProfile({ ...profile, budget: e.target.value })}
                    className="sr-only"
                  />
                  <span className="font-semibold text-gray-900">{label}</span>
                  <span className="text-xs text-gray-500">{sub}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dietary wishes <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              placeholder="e.g. vegetarian, no shellfish, halal…"
              value={profile.dietaryWishes}
              onChange={(e) => setProfile({ ...profile, dietaryWishes: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-blue-600 py-4 text-white font-semibold text-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
          >
            {loading ? "Finding restaurants…" : "Save profile & get recommendations"}
          </button>

        </form>

        {saved && (
          <div className="mt-8 rounded-xl border border-green-200 bg-green-50 p-6">
            <h2 className="text-lg font-semibold text-green-800 mb-3">Profile saved!</h2>
            <dl className="flex flex-col gap-2 text-sm text-gray-700">
              <div className="flex justify-between"><dt className="font-medium">Name</dt><dd>{saved.name || "—"}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">Traveler type</dt><dd>{saved.travelerTypes.length ? saved.travelerTypes.join(", ") : "—"}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">Destination</dt><dd>{saved.destination || "—"}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">Departure date</dt><dd>{saved.departureDate || "—"}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">Return date</dt><dd>{saved.returnDate || "—"}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">Travel company</dt><dd>{saved.travelCompany}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">Budget</dt><dd>{saved.budget || "—"}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">Dietary wishes</dt><dd>{saved.dietaryWishes || "—"}</dd></div>
            </dl>

            </div>
        )}

        {(recommendations || loading) && (
          <div className="mt-6 rounded-xl border border-orange-100 bg-orange-50 p-6">
            <h2 className="text-lg font-semibold text-orange-900 mb-4">Restaurant recommendations</h2>
            <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
              {recommendations.split("\n").map((line, i) => (
                <p key={i} className={line === "" ? "mt-3" : ""}>{renderText(line)}</p>
              ))}
              {loading && (
                <span className="inline-block w-2 h-4 bg-orange-400 animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
