import type { ActivityCategory, TimeBlock } from "@/types/itinerary";
import type { ItineraryItem } from "./itinerary-types";

// ── Constants ─────────────────────────────────────────────────────────────────

export const TIME_BLOCK_ORDER: Record<TimeBlock, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
};

export const TIME_BLOCKS: TimeBlock[] = ["morning", "afternoon", "evening"];

export const TIME_BLOCK_LABEL: Record<TimeBlock, { emoji: string; label: string }> = {
  morning: { emoji: "🌅", label: "Morning" },
  afternoon: { emoji: "☀️", label: "Afternoon" },
  evening: { emoji: "🌙", label: "Evening" },
};

export const CATEGORY_ICON: Record<ActivityCategory, string> = {
  activity: "🎯",
  restaurant: "🍽️",
  transport: "🚌",
  note: "📝",
};

// Nav is h-14 = 56px sticky at top-0
export const NAV_HEIGHT_PX = 56;

export const UNDO_TIMEOUT_MS = 5000;

export const TYPE_EMOJI: Record<ItineraryItem["type"], string> = {
  activity: "\u{1F3AF}",
  restaurant: "\u{1F37D}\u{FE0F}",
  transport: "\u{1F68C}",
  note: "\u{1F4DD}",
};
