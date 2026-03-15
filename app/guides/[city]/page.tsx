"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CATEGORIES, CATEGORY_LABELS, getLevel, LEVEL_BADGE, type Category, type Tip } from "@/lib/guides";

const COLOR_CLASSES: Record<string, { border: string; bg: string; badge: string; heading: string }> = {
  orange: { border: "border-orange-100", bg: "bg-orange-50",  badge: "bg-orange-100 text-orange-700", heading: "text-orange-800" },
  blue:   { border: "border-blue-100",   bg: "bg-blue-50",    badge: "bg-blue-100 text-blue-700",     heading: "text-blue-800"   },
  purple: { border: "border-purple-100", bg: "bg-purple-50",  badge: "bg-purple-100 text-purple-700", heading: "text-purple-800" },
  green:  { border: "border-green-100",  bg: "bg-green-50",   badge: "bg-green-100 text-green-700",   heading: "text-green-800"  },
  pink:   { border: "border-pink-100",   bg: "bg-pink-50",    badge: "bg-pink-100 text-pink-700",     heading: "text-pink-800"   },
};

export default function CityGuidePage() {
  const { city } = useParams<{ city: string }>();
  const [tips, setTips] = useState<Tip[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratedTips, setRatedTips] = useState<Set<string>>(new Set());
  const [ratingInProgress, setRatingInProgress] = useState<Set<string>>(new Set());

  const displayCity = city.charAt(0).toUpperCase() + city.slice(1);

  useEffect(() => {
    // Load rated tips from localStorage
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
        // Increment views for each tip
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
      try {
        localStorage.setItem("rated_tips", JSON.stringify([...newRated]));
      } catch {}
    }

    setRatingInProgress((s) => { const n = new Set(s); n.delete(tipId); return n; });
  }

  const byCategory = CATEGORIES.reduce<Record<Category, Tip[]>>((acc, cat) => {
    acc[cat] = tips.filter((t) => t.category === cat);
    return acc;
  }, {} as Record<Category, Tip[]>);

  const filledCategories = CATEGORIES.filter((cat) => byCategory[cat].length > 0);

  return (
    <main className="flex min-h-screen flex-col items-center bg-gradient-to-b from-blue-50 to-white px-8 py-16">
      <div className="w-full max-w-2xl">

        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold text-blue-900">Local tips: {displayCity}</h1>
          <a
            href="/guides/add"
            className="rounded-full bg-blue-600 px-5 py-2.5 text-sm text-white font-semibold hover:bg-blue-700 transition-colors"
          >
            + Add tip
          </a>
        </div>
        <p className="text-gray-500 mb-10">Insider knowledge from people who live here.</p>

        {loading && (
          <p className="text-gray-400 text-sm">Loading tips…</p>
        )}

        {!loading && tips.length === 0 && (
          <div className="rounded-2xl border border-blue-100 bg-white p-10 text-center">
            <p className="text-gray-500 mb-4">No tips yet for {displayCity}.</p>
            <a
              href="/guides/add"
              className="rounded-full bg-blue-600 px-6 py-3 text-white font-semibold hover:bg-blue-700 transition-colors"
            >
              Be the first to add one
            </a>
          </div>
        )}

        {!loading && filledCategories.length > 0 && (
          <div className="flex flex-col gap-10">
            {filledCategories.map((cat) => {
              const { label, icon, color } = CATEGORY_LABELS[cat];
              const colors = COLOR_CLASSES[color];
              return (
                <section key={cat}>
                  <h2 className={`text-lg font-semibold ${colors.heading} mb-4`}>
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
                        <div
                          key={tip.id}
                          className={`rounded-xl border ${colors.border} ${colors.bg} p-5`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h3 className="font-semibold text-gray-900">{tip.title}</h3>
                            <div className="flex items-center gap-2 shrink-0">
                              {guide && level && (
                                <span className="text-xs text-gray-500 font-medium">
                                  {badge} {guide.name} · {level}
                                </span>
                              )}
                              {!guide && (
                                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${colors.badge}`}>
                                  {tip.name}
                                </span>
                              )}
                            </div>
                          </div>

                          <p className="text-sm text-gray-700 leading-relaxed mb-3">{tip.description}</p>

                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-400">
                              👁 {tip.views} view{tip.views !== 1 ? "s" : ""}
                            </span>
                            <button
                              onClick={() => handleRate(tip.id)}
                              disabled={hasRated || isRating}
                              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                                hasRated
                                  ? "bg-yellow-100 text-yellow-700 cursor-default"
                                  : "border border-gray-200 text-gray-600 hover:bg-yellow-50 hover:border-yellow-300 hover:text-yellow-700 disabled:opacity-50"
                              }`}
                            >
                              ⭐ {hasRated ? "Rated!" : isRating ? "Rating…" : "Rate this tip"}
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

        <div className="mt-12 text-center">
          <a href="/guides/leaderboard" className="text-sm text-blue-600 hover:underline font-medium">
            🏆 View top guides leaderboard →
          </a>
        </div>

      </div>
    </main>
  );
}
