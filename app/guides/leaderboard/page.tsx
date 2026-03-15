"use client";

import { useEffect, useState } from "react";
import { getLevel, LEVEL_BADGE } from "@/lib/guides";

type GuideEntry = {
  id: string;
  name: string;
  points: number;
  tip_count: number;
};

const LEVEL_COLORS: Record<string, string> = {
  Explorer: "text-gray-600 bg-gray-100",
  Local:    "text-blue-700 bg-blue-100",
  Insider:  "text-purple-700 bg-purple-100",
  Legend:   "text-yellow-700 bg-yellow-100",
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
    <main className="flex min-h-screen flex-col items-center bg-gradient-to-b from-blue-50 to-white px-8 py-16">
      <div className="w-full max-w-2xl">

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-blue-900">🏆 Guide Leaderboard</h1>
          <p className="text-gray-500 mt-1">Top local guides ranked by points.</p>
        </div>

        <div className="mb-6 bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-600">
          <p className="font-semibold text-gray-700 mb-2">How to earn points</p>
          <ul className="space-y-1">
            <li>📝 Submit a tip — <strong>10 points</strong></li>
            <li>👁 Tip reaches 10 views — <strong>15 points</strong></li>
            <li>⭐ Traveler rates your tip — <strong>25 points</strong></li>
          </ul>
          <p className="mt-3 text-xs text-gray-400">
            Levels: 🌱 Explorer (0–49) · 📍 Local (50–199) · 🔑 Insider (200–499) · ⭐ Legend (500+)
          </p>
        </div>

        {loading && <p className="text-gray-400 text-sm">Loading…</p>}

        {!loading && guides.length === 0 && (
          <p className="text-gray-400 text-sm">No guides yet. <a href="/guides/add" className="text-blue-600 underline">Be the first!</a></p>
        )}

        {!loading && guides.length > 0 && (
          <div className="flex flex-col gap-3">
            {guides.map((guide, index) => {
              const level = getLevel(guide.points);
              const badge = LEVEL_BADGE[level];
              const levelColor = LEVEL_COLORS[level];
              const isTop3 = index < 3;
              const rankEmoji = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : null;

              return (
                <div
                  key={guide.id}
                  className={`flex items-center gap-4 rounded-xl border bg-white px-5 py-4 ${
                    isTop3 ? "border-blue-100 shadow-sm" : "border-gray-200"
                  }`}
                >
                  <div className="w-8 text-center text-lg font-bold text-gray-400">
                    {rankEmoji ?? <span className="text-sm text-gray-300">#{index + 1}</span>}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{guide.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${levelColor}`}>
                        {badge} {level}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{guide.tip_count} tip{guide.tip_count !== 1 ? "s" : ""}</p>
                  </div>

                  <div className="text-right">
                    <span className="text-lg font-bold text-blue-700">{guide.points}</span>
                    <p className="text-xs text-gray-400">points</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-10 flex gap-4 justify-center text-sm">
          <a href="/guides" className="text-blue-600 hover:underline">← Search guides</a>
          <a href="/guides/add" className="text-blue-600 hover:underline">Become a local guide →</a>
        </div>

      </div>
    </main>
  );
}
