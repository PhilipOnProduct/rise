export type Category = "food" | "transport" | "culture" | "nature" | "hidden gem";

export type Tip = {
  id: string;
  name: string;
  city: string;       // stored lowercase, e.g. "amsterdam"
  category: Category;
  title: string;
  description: string;
  createdAt: string;
};

export const tips: Tip[] = [];

export function addTip(data: Omit<Tip, "id" | "createdAt">): Tip {
  const tip: Tip = {
    ...data,
    city: data.city.toLowerCase().trim(),
    id: Math.random().toString(36).slice(2),
    createdAt: new Date().toISOString(),
  };
  tips.push(tip);
  return tip;
}

export function getTipsForCity(city: string): Tip[] {
  return tips.filter((t) => t.city === city.toLowerCase().trim());
}

export const CATEGORIES: Category[] = [
  "food",
  "transport",
  "culture",
  "nature",
  "hidden gem",
];

export const CATEGORY_LABELS: Record<Category, { label: string; icon: string; color: string }> = {
  food:         { label: "Food & Drink",    icon: "🍽️", color: "orange" },
  transport:    { label: "Getting Around",  icon: "🚇", color: "blue"   },
  culture:      { label: "Culture",         icon: "🏛️", color: "purple" },
  nature:       { label: "Nature",          icon: "🌿", color: "green"  },
  "hidden gem": { label: "Hidden Gems",     icon: "💎", color: "pink"   },
};
