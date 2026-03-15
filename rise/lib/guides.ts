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
