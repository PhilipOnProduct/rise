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
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white px-8">
      <div className="w-full max-w-lg text-center">

        <h1 className="text-4xl font-bold text-blue-900 mb-3">Local guides</h1>
        <p className="text-gray-500 mb-10">Insider tips from people who actually live there.</p>

        <form onSubmit={handleSubmit} className="flex gap-3 mb-6">
          <input
            type="text"
            placeholder="Enter a city, e.g. Amsterdam"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="flex-1 rounded-full border border-gray-200 px-6 py-4 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <button
            type="submit"
            disabled={!city.trim()}
            className="rounded-full bg-blue-600 px-6 py-4 text-white font-semibold hover:bg-blue-700 transition-colors disabled:opacity-40"
          >
            Explore
          </button>
        </form>

        <a href="/guides/add" className="text-sm text-blue-600 hover:underline">
          Become a local guide →
        </a>

      </div>
    </main>
  );
}
