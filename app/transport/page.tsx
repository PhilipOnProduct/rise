"use client";

import { useState, useEffect } from "react";

function renderLine(line: string, i: number) {
  if (line.startsWith("## ")) {
    return <h2 key={i} className="text-base font-bold text-gray-900 mt-6 mb-2">{line.slice(3)}</h2>;
  }
  if (line.trim() === "---") return <hr key={i} className="border-gray-200 my-4" />;
  if (line.trim() === "") return <div key={i} className="mt-2" />;
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  const rendered = parts.map((part, j) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={j}>{part.slice(2, -2)}</strong>
      : part
  );
  return <p key={i} className="text-sm text-gray-700 leading-relaxed">{rendered}</p>;
}

export default function TransportPage() {
  const [airport, setAirport] = useState("");
  const [hotel, setHotel] = useState("");
  const [city, setCity] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [travelerCount, setTravelerCount] = useState<number | null>(null);
  const [childrenAges, setChildrenAges] = useState<string[] | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("rise_traveler");
      if (raw) {
        const t = JSON.parse(raw);
        if (t.travelerCount) setTravelerCount(t.travelerCount);
        if (t.childrenAges?.length) setChildrenAges(t.childrenAges);
        if (t.destination && !city) setCity(t.destination);
        if (t.hotel && !hotel) setHotel(t.hotel);
      }
    } catch {}
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult("");
    setLoading(true);

    const res = await fetch("/api/transport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        airport,
        hotel,
        city,
        travelerCount,
        childrenAges,
      }),
    });

    if (!res.body) { setLoading(false); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      setResult((prev) => prev + decoder.decode(value));
    }
    setLoading(false);
  }

  const inputCls = "w-full bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white placeholder-[#444] transition-colors text-sm";

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-14">
      <div className="max-w-xl mx-auto">

        <div className="mb-10">
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">Airport → Hotel</h1>
          <p className="text-gray-400">Compare public transport vs taxi for your journey.</p>
        </div>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Departure airport</label>
            <input type="text" placeholder="e.g. Amsterdam Schiphol (AMS)"
              value={airport} onChange={(e) => setAirport(e.target.value)} required className={inputCls} />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Destination city</label>
            <input type="text" placeholder="e.g. Amsterdam"
              value={city} onChange={(e) => setCity(e.target.value)} required className={inputCls} />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Hotel or area</label>
            <input type="text" placeholder="e.g. Hotel V Nesplein, or city centre"
              value={hotel} onChange={(e) => setHotel(e.target.value)} required className={inputCls} />
          </div>

          <button type="submit" disabled={loading}
            className="w-full rounded-2xl bg-[#00D64F] text-black font-bold py-5 text-lg hover:bg-[#00c248] transition-colors disabled:opacity-40 mt-2">
            {loading ? "Comparing options…" : "Compare transport →"}
          </button>

        </form>

        {(result || loading) && (
          <div className="mt-8 bg-white rounded-2xl p-7">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5">Your options</h2>
            <div>
              {result.split("\n").map((line, i) => renderLine(line, i))}
              {loading && <span className="inline-block w-2 h-4 bg-[#00D64F] animate-pulse ml-0.5 align-middle rounded-sm" />}
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
