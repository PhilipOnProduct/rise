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
    <main className="min-h-screen bg-[#0a0a0a] px-6 flex flex-col items-center justify-center">
      <div className="w-full max-w-lg">

        <a href="/" className="text-gray-600 text-sm hover:text-gray-400 transition-colors mb-12 inline-block">← Rise</a>

        <div className="mb-10">
          <h1 className="text-5xl font-extrabold tracking-tight mb-3">Local guides</h1>
          <p className="text-gray-400 text-lg">Insider tips from people who actually live there.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Enter a city, e.g. Amsterdam"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            autoFocus
            className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-5 text-white text-lg placeholder-[#444] transition-colors"
          />
          <button
            type="submit"
            disabled={!city.trim()}
            className="w-full rounded-2xl bg-[#00D64F] text-black font-bold py-5 text-lg hover:bg-[#00c248] transition-colors disabled:opacity-30"
          >
            Explore →
          </button>
        </form>

        <div className="mt-8 flex items-center justify-between">
          <a href="/guides/add" className="text-sm text-gray-500 hover:text-white transition-colors">
            Become a local guide →
          </a>
          <a href="/guides/leaderboard" className="text-sm text-gray-500 hover:text-white transition-colors">
            🏆 Leaderboard
          </a>
        </div>

      </div>
    </main>
  );
}
