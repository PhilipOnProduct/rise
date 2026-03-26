"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GuidesPage() {
  const [city, setCity] = useState("");
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const slug = city.trim().toLowerCase();
    if (slug) router.push(`/guides/${encodeURIComponent(slug)}`);
  }

  return (
    <main className="min-h-screen bg-[#f8f6f1] px-6 flex flex-col items-center justify-center">
      <div className="w-full max-w-lg">

        <div className="mb-10">
          <h1 className="text-5xl font-extrabold tracking-tight mb-3">Local guides</h1>
          <p className="text-[#4a6580] text-lg">Insider tips from people who actually live there.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Enter a city, e.g. Amsterdam"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            autoFocus
            className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-5 py-5 text-[#0e2a47] text-lg placeholder-[#9ca3af] transition-colors"
          />
          <button
            type="submit"
            disabled={!city.trim()}
            className="w-full rounded-2xl bg-[#1a6b7f] text-white font-bold py-5 text-lg hover:bg-[#155a6b] transition-colors disabled:opacity-30"
          >
            Explore →
          </button>
        </form>

        <div className="mt-8 flex items-center justify-between">
          <a href="/guides/add" className="text-sm text-[#6a7f8f] hover:text-[#0e2a47] transition-colors">
            Become a local guide →
          </a>
          <a href="/guides/leaderboard" className="text-sm text-[#6a7f8f] hover:text-[#0e2a47] transition-colors">
            🏆 Leaderboard
          </a>
        </div>

      </div>
    </main>
  );
}
