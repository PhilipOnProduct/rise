"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CATEGORIES, CATEGORY_LABELS, getLevel, LEVEL_BADGE, type Category, type Tip } from "@/lib/guides";

export default function CityGuidePage() {
  const { city } = useParams<{ city: string }>();
  const [tips, setTips] = useState<Tip[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratedTips, setRatedTips] = useState<Set<string>>(new Set());
  const [ratingInProgress, setRatingInProgress] = useState<Set<string>>(new Set());

  const displayCity = decodeURIComponent(city).charAt(0).toUpperCase() + decodeURIComponent(city).slice(1);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("rated_tips");
      if (stored) setRatedTips(new Set(JSON.parse(stored)));
    } catch {}
  }, []);

  useEffect(() => {
    fetch(`/api/guides?city=${encodeURIComponent(city)}`)
      .then((r) => r.json())
      .then((data: Tip[]) => {
        setTips(data);
        setLoading(false);
        data.forEach((tip) => {
          fetch(`/api/tips/${tip.id}/view`, { method: "POST" }).catch(() => {});
        });
      });
  }, [city]);

  async function handleRate(tipId: string) {
    if (ratedTips.has(tipId) || ratingInProgress.has(tipId)) return;
    setRatingInProgress((s) => new Set(s).add(tipId));
    const res = await fetch(`/api/tips/${tipId}/rate`, { method: "POST" });
    if (res.ok) {
      const newRated = new Set(ratedTips).add(tipId);
      setRatedTips(newRated);
      try { localStorage.setItem("rated_tips", JSON.stringify([...newRated])); } catch {}
    }
    setRatingInProgress((s) => { const n = new Set(s); n.delete(tipId); return n; });
  }

  const byCategory = CATEGORIES.reduce<Record<Category, Tip[]>>((acc, cat) => {
    acc[cat] = tips.filter((t) => t.category === cat);
    return acc;
  }, {} as Record<Category, Tip[]>);

  const filledCategories = CATEGORIES.filter((cat) => byCategory[cat].length > 0);

  // Category accent colors on dark
  const ACCENT: Record<string, string> = {
    orange: "border-orange-500/30 bg-orange-500/5",
    blue:   "border-blue-500/30 bg-blue-500/5",
    purple: "border-purple-500/30 bg-purple-500/5",
    green:  "border-green-500/30 bg-green-500/5",
    pink:   "border-pink-500/30 bg-pink-500/5",
  };
  const HEADING: Record<string, string> = {
    orange: "text-orange-400", blue: "text-blue-400", purple: "text-purple-400",
    green: "text-green-400", pink: "text-pink-400",
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-14">
      <div className="max-w-2xl mx-auto">

        <div className="flex items-center justify-between mb-2">
          <a href="/guides" className="text-gray-600 text-sm hover:text-gray-400 transition-colors">← Guides</a>
          <a href="/guides/add"
            className="rounded-xl bg-[#00D64F] text-black font-bold px-4 py-2 text-sm hover:bg-[#00c248] transition-colors">
            + Add tip
          </a>
        </div>

        <div className="mt-8 mb-12">
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">Local tips: {displayCity}</h1>
          <p className="text-gray-400">Insider knowledge from people who live here.</p>
        </div>

        {loading && <p className="text-gray-600 text-sm">Loading tips…</p>}

        {!loading && tips.length === 0 && (
          <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-12 text-center">
            <p className="text-gray-400 mb-6">No tips yet for {displayCity}.</p>
            <a href="/guides/add"
              className="inline-block rounded-2xl bg-[#00D64F] text-black font-bold px-8 py-4 hover:bg-[#00c248] transition-colors">
              Be the first →
            </a>
          </div>
        )}

        {!loading && filledCategories.length > 0 && (
          <div className="flex flex-col gap-10">
            {filledCategories.map((cat) => {
              const { label, icon, color } = CATEGORY_LABELS[cat];
              return (
                <section key={cat}>
                  <h2 className={`text-sm font-bold uppercase tracking-widest mb-4 ${HEADING[color]}`}>
                    {icon} {label}
                  </h2>
                  <div className="flex flex-col gap-4">
                    {byCategory[cat].map((tip) => {
                      const guide = tip.guide;
                      const level = guide ? getLevel(guide.points) : null;
                      const badge = level ? LEVEL_BADGE[level] : null;
                      const hasRated = ratedTips.has(tip.id);
                      const isRating = ratingInProgress.has(tip.id);

                      return (
                        <div key={tip.id}
                          className={`rounded-2xl border ${ACCENT[color]} p-5`}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h3 className="font-bold text-white">{tip.title}</h3>
                            {guide && level && (
                              <span className="shrink-0 text-xs text-gray-500 font-medium">
                                {badge} {guide.name} · {level}
                              </span>
                            )}
                            {!guide && (
                              <span className="shrink-0 text-xs text-gray-500">{tip.name}</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-300 leading-relaxed mb-4">{tip.description}</p>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-600">
                              👁 {tip.views} view{tip.views !== 1 ? "s" : ""}
                            </span>
                            <button
                              onClick={() => handleRate(tip.id)}
                              disabled={hasRated || isRating}
                              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                                hasRated
                                  ? "bg-yellow-500/20 text-yellow-400 cursor-default"
                                  : "border border-[#2a2a2a] text-gray-400 hover:border-yellow-500/50 hover:text-yellow-400 disabled:opacity-40"
                              }`}>
                              ⭐ {hasRated ? "Rated!" : isRating ? "Rating…" : "Rate"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <div className="mt-14 text-center">
          <a href="/guides/leaderboard" className="text-sm text-gray-600 hover:text-white transition-colors">
            🏆 View top guides leaderboard →
          </a>
        </div>

      </div>
    </main>
  );
}
