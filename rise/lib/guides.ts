export type Category = "food" | "transport" | "culture" | "nature" | "hidden gem";

export type Tip = {
  id: string;
  name: string;
  city: string;
  category: Category;
  title: string;
  description: string;
  createdAt: string;
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
