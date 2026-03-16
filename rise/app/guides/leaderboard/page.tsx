"use client";

import { useEffect, useState } from "react";
import { getLevel, LEVEL_BADGE } from "@/lib/guides";

type GuideEntry = { id: string; name: string; points: number; tip_count: number };

const LEVEL_COLORS: Record<string, string> = {
  Explorer: "text-gray-400 bg-[#1a1a1a]",
  Local:    "text-blue-400 bg-blue-500/10",
  Insider:  "text-purple-400 bg-purple-500/10",
  Legend:   "text-yellow-400 bg-yellow-500/10",
};

export default function LeaderboardPage() {
  const [guides, setGuides] = useState<GuideEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/guides/leaderboard")
      .then((r) => r.json())
      .then((data) => { setGuides(data); setLoading(false); });
  }, []);

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-14">
      <div className="max-w-xl mx-auto">

        <a href="/guides" className="text-gray-600 text-sm hover:text-gray-400 transition-colors mb-8 inline-block">← Guides</a>

        <div className="mb-10">
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">🏆 Leaderboard</h1>
          <p className="text-gray-400">Top local guides ranked by points.</p>
        </div>

        {/* How to earn */}
        <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-6 mb-8">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">How to earn points</p>
          <div className="flex flex-col gap-2 text-sm text-gray-300">
            <div className="flex justify-between">
              <span>📝 Submit a tip</span>
              <span className="text-[#00D64F] font-bold">+10 pts</span>
            </div>
            <div className="flex justify-between">
              <span>👁 Tip reaches 10 views</span>
              <span className="text-[#00D64F] font-bold">+15 pts</span>
            </div>
            <div className="flex justify-between">
              <span>⭐ Traveler rates your tip</span>
              <span className="text-[#00D64F] font-bold">+25 pts</span>
            </div>
          </div>
          <p className="mt-4 text-xs text-gray-600">
            🌱 Explorer · 📍 Local (50+) · 🔑 Insider (200+) · ⭐ Legend (500+)
          </p>
        </div>

        {loading && <p className="text-gray-600 text-sm">Loading…</p>}

        {!loading && guides.length === 0 && (
          <p className="text-gray-500 text-sm">
            No guides yet. <a href="/guides/add" className="text-[#00D64F] hover:underline">Be the first!</a>
          </p>
        )}

        {!loading && guides.length > 0 && (
          <div className="flex flex-col gap-3">
            {guides.map((guide, i) => {
              const level = getLevel(guide.points);
              const badge = LEVEL_BADGE[level];
              const levelColor = LEVEL_COLORS[level];
              const rankEmoji = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;

              return (
                <div key={guide.id}
                  className={`flex items-center gap-4 rounded-2xl border bg-[#111] px-5 py-4 ${
                    i < 3 ? "border-[#2a2a2a]" : "border-[#1a1a1a]"
                  }`}>
                  <div className="w-8 text-center text-xl">
                    {rankEmoji ?? <span className="text-sm text-gray-600">#{i + 1}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-bold text-white">{guide.name}</span>
                      <span className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${levelColor}`}>
                        {badge} {level}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">{guide.tip_count} tip{guide.tip_count !== 1 ? "s" : ""}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-extrabold text-[#00D64F]">{guide.points}</span>
                    <p className="text-xs text-gray-600">pts</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-10 text-center">
          <a href="/guides/add"
            className="inline-block rounded-2xl bg-[#00D64F] text-black font-bold px-8 py-4 hover:bg-[#00c248] transition-colors text-sm">
            Become a local guide →
          </a>
        </div>

      </div>
    </main>
  );
}
