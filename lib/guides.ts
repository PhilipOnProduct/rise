export type Category = "food" | "transport" | "culture" | "nature" | "hidden gem";

export type Level = "Explorer" | "Local" | "Insider" | "Legend";

export type Guide = {
  id: string;
  name: string;
  email: string;
  points: number;
  created_at: string;
};

export type Tip = {
  id: string;
  guide_id: string | null;
  name: string;
  city: string;
  category: Category;
  title: string;
  description: string;
  views: number;
  created_at: string;
  guide?: { name: string; points: number } | null;
};

export function getLevel(points: number): Level {
  if (points >= 500) return "Legend";
  if (points >= 200) return "Insider";
  if (points >= 50) return "Local";
  return "Explorer";
}

export const LEVEL_BADGE: Record<Level, string> = {
  Explorer: "🌱",
  Local: "📍",
  Insider: "🔑",
  Legend: "⭐",
};

export const CATEGORIES: Category[] = [
  "food",
  "transport",
  "culture",
  "nature",
  "hidden gem",
];

export const CATEGORY_LABELS: Record<Category, { label: string; icon: string; color: string }> = {
  food:         { label: "Food & Drink",   icon: "🍽️", color: "orange" },
  transport:    { label: "Getting Around", icon: "🚇", color: "blue"   },
  culture:      { label: "Culture",        icon: "🏛️", color: "purple" },
  nature:       { label: "Nature",         icon: "🌿", color: "green"  },
  "hidden gem": { label: "Hidden Gems",    icon: "💎", color: "pink"   },
};

export { supabase } from "@/lib/supabase";

import { supabase as db } from "@/lib/supabase";

/**
 * Award reputation points to a guide atomically via the
 * `increment_guide_points` RPC (db/migrations/0019_points_rpc.sql).
 *
 * Falls back to the legacy read-then-write pattern when the RPC doesn't
 * exist yet (migration not applied), so the routes keep working across
 * the deploy/migration window. The fallback is racy under concurrent
 * requests — same behaviour as before 0019, not worse.
 */
export async function awardGuidePoints(guideId: string, amount: number): Promise<void> {
  const { error } = await db.rpc("increment_guide_points", {
    p_guide_id: guideId,
    p_amount: amount,
  });
  if (!error) return;

  const { data: guide } = await db.from("guides").select("points").eq("id", guideId).single();
  if (!guide) return;
  await db.from("guides").update({ points: guide.points + amount }).eq("id", guideId);
}

/**
 * Increment a tip's view counter atomically via `increment_tip_views`,
 * returning the new count (used for the 10-view milestone). Same
 * fallback contract as awardGuidePoints.
 */
export async function incrementTipViews(tipId: string, currentViews: number): Promise<number> {
  const { data, error } = await db.rpc("increment_tip_views", { p_tip_id: tipId });
  if (!error && typeof data === "number") return data;

  const newViews = currentViews + 1;
  const { error: updateError } = await db.from("tips").update({ views: newViews }).eq("id", tipId);
  if (updateError) throw updateError;
  return newViews;
}
