"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Activity = { id: number; name: string; category: string; description: string; emoji: string };
type Traveler = {
  id: string | null;
  name: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  hotel: string;
  activities: Activity[];
};

function formatDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function nightCount(dep: string, ret: string) {
  if (!dep || !ret) return 0;
  return Math.round((new Date(ret).getTime() - new Date(dep).getTime()) / 86400000);
}

export default function DashboardPage() {
  const router = useRouter();
  const [traveler, setTraveler] = useState<Traveler | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("rise_traveler");
    if (!raw) {
      router.replace("/welcome");
      return;
    }
    try {
      setTraveler(JSON.parse(raw));
    } catch {
      router.replace("/welcome");
    }
  }, [router]);

  if (!traveler) {
    return (
      <main className="min-h-screen bg-[#f8f6f1] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin" />
      </main>
    );
  }

  const nights = nightCount(traveler.departureDate, traveler.returnDate);

  return (
    <main className="min-h-screen bg-[#f8f6f1] px-6 py-14">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="mb-12">
          <p className="text-[#1a6b7f] text-sm font-semibold tracking-widest uppercase mb-3">Your trip</p>
          <h1 className="text-5xl font-extrabold tracking-tight mb-2">{traveler.destination}</h1>
          <p className="text-[#4a6580] text-lg">Hey {traveler.name}, here's what we've got planned.</p>
        </div>

        {/* Trip summary card */}
        <div className="bg-white border border-[#e8e4de] rounded-2xl p-7 mb-6">
          <h2 className="text-xs font-bold text-[#4a6580] uppercase tracking-widest mb-5">Trip details</h2>
          <div className="grid grid-cols-2 gap-y-5">
            <div>
              <p className="text-xs text-[#4a6580] mb-1">Departure</p>
              <p className="font-bold text-[#0e2a47]">{formatDate(traveler.departureDate)}</p>
            </div>
            <div>
              <p className="text-xs text-[#4a6580] mb-1">Return</p>
              <p className="font-bold text-[#0e2a47]">{formatDate(traveler.returnDate)}</p>
            </div>
            <div>
              <p className="text-xs text-[#4a6580] mb-1">Duration</p>
              <p className="font-bold text-[#0e2a47]">{nights > 0 ? `${nights} nights` : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-[#4a6580] mb-1">Hotel</p>
              <p className="font-bold text-[#0e2a47]">{traveler.hotel || "—"}</p>
            </div>
          </div>
        </div>

        {/* Activities */}
        {traveler.activities.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs font-bold text-[#4a6580] uppercase tracking-widest mb-4">
              Your activities · {traveler.activities.length} selected
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {traveler.activities.map((a) => (
                <div key={a.id} className="bg-white border border-[#e8e4de] rounded-2xl p-4">
                  <div className="text-2xl mb-2">{a.emoji}</div>
                  <div className="font-semibold text-sm text-[#0e2a47] mb-1">{a.name}</div>
                  <div className="text-xs text-[#6a7f8f]">{a.category}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick links */}
        <div className="bg-white border border-[#e8e4de] rounded-2xl p-6">
          <h2 className="text-xs font-bold text-[#4a6580] uppercase tracking-widest mb-5">Explore more</h2>
          <div className="flex flex-col gap-3">
            <a
              href="/itinerary"
              className="flex items-center justify-between rounded-xl bg-[#1a6b7f]/10 border border-[#1a6b7f]/30 px-5 py-4 hover:bg-[#1a6b7f]/20 transition-colors group"
            >
              <div>
                <div className="font-semibold text-[#0e2a47]">Day-by-day itinerary</div>
                <div className="text-xs text-[#1a6b7f]/70 mt-0.5">AI-planned · drag to reschedule</div>
              </div>
              <span className="text-[#1a6b7f] group-hover:text-[#0e2a47] transition-colors">→</span>
            </a>
            <a
              href="/profile"
              className="flex items-center justify-between rounded-xl bg-[#f0ede8] px-5 py-4 hover:bg-[#e8e4de] transition-colors group"
            >
              <div>
                <div className="font-semibold text-[#0e2a47]">Restaurant recommendations</div>
                <div className="text-xs text-[#6a7f8f] mt-0.5">AI picks based on your taste</div>
              </div>
              <span className="text-[#6a7f8f] group-hover:text-[#0e2a47] transition-colors">→</span>
            </a>
            <a
              href="/transport"
              className="flex items-center justify-between rounded-xl bg-[#f0ede8] px-5 py-4 hover:bg-[#e8e4de] transition-colors group"
            >
              <div>
                <div className="font-semibold text-[#0e2a47]">Airport → Hotel</div>
                <div className="text-xs text-[#6a7f8f] mt-0.5">Compare transport options</div>
              </div>
              <span className="text-[#6a7f8f] group-hover:text-[#0e2a47] transition-colors">→</span>
            </a>
            <a
              href={`/guides/${encodeURIComponent(traveler.destination.toLowerCase())}`}
              className="flex items-center justify-between rounded-xl bg-[#f0ede8] px-5 py-4 hover:bg-[#e8e4de] transition-colors group"
            >
              <div>
                <div className="font-semibold text-[#0e2a47]">Local guides</div>
                <div className="text-xs text-[#6a7f8f] mt-0.5">Insider tips for {traveler.destination}</div>
              </div>
              <span className="text-[#6a7f8f] group-hover:text-[#0e2a47] transition-colors">→</span>
            </a>
          </div>
        </div>

        <div className="mt-8 text-center">
          <button
            onClick={() => {
              localStorage.removeItem("rise_onboarded");
              localStorage.removeItem("rise_traveler");
              router.push("/welcome");
            }}
            className="text-sm text-[#6a7f8f] hover:text-[#4a6580] transition-colors"
          >
            Plan a new trip
          </button>
        </div>

      </div>
    </main>
  );
}
