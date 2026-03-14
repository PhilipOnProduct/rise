"use client";

import { useState } from "react";

export default function TransportPage() {
  const [airport, setAirport] = useState("");
  const [hotel, setHotel] = useState("");
  const [city, setCity] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult("");
    setLoading(true);

    const res = await fetch("/api/transport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ airport, hotel, city }),
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
      setResult((prev) => prev + decoder.decode(value));
    }

    setLoading(false);
  }

  function renderLine(line: string, i: number) {
    // Headings
    if (line.startsWith("## ")) {
      return <h2 key={i} className="text-lg font-bold text-blue-900 mt-6 mb-2">{line.slice(3)}</h2>;
    }
    // Horizontal rule
    if (line.trim() === "---") {
      return <hr key={i} className="border-blue-100 my-4" />;
    }
    // Empty line → spacing
    if (line.trim() === "") {
      return <div key={i} className="mt-2" />;
    }
    // Inline bold (**text**)
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const rendered = parts.map((part, j) =>
      part.startsWith("**") && part.endsWith("**")
        ? <strong key={j}>{part.slice(2, -2)}</strong>
        : part
    );
    return <p key={i} className="text-sm text-gray-800 leading-relaxed">{rendered}</p>;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white px-8 py-16">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-blue-100 shadow-sm p-10">

        <h1 className="text-3xl font-bold text-blue-900 mb-2">Airport to hotel</h1>
        <p className="text-gray-500 mb-8">Compare public transport vs taxi for your journey.</p>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Departure airport</label>
            <input
              type="text"
              placeholder="e.g. Amsterdam Schiphol (AMS)"
              value={airport}
              onChange={(e) => setAirport(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Destination city</label>
            <input
              type="text"
              placeholder="e.g. Amsterdam"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hotel name or area</label>
            <input
              type="text"
              placeholder="e.g. Hotel V Nesplein, or city centre"
              value={hotel}
              onChange={(e) => setHotel(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-blue-600 py-4 text-white font-semibold text-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
          >
            {loading ? "Comparing options…" : "Compare transport options"}
          </button>

        </form>

        {(result || loading) && (
          <div className="mt-8 rounded-xl border border-blue-100 bg-blue-50 p-6">
            <h2 className="text-base font-semibold text-blue-900 mb-4">Your transport options</h2>
            <div>
              {result.split("\n").map((line, i) => renderLine(line, i))}
              {loading && (
                <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
