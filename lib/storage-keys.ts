/**
 * Centralised localStorage / sessionStorage keys.
 *
 * Always import from here rather than typing the literal — that keeps writers
 * and readers in sync if a key is renamed.
 */

export const STORAGE_KEYS = {
  /** Full traveller object — name, email, destination, dates, hotel, prefs, activities. */
  traveler: "rise_traveler",
  /** "true" once onboarding completes; gates the welcome → dashboard redirect. */
  onboarded: "rise_onboarded",
  /** Cached ItineraryDay[] array — cleared on Regenerate. */
  itinerary: "rise_itinerary",
  /** "build" or "research" — Build/Research mode toggle on /team. */
  teamMode: "rise_team_mode",
  /** ActivityFeedbackEntry[] — thumbs/chip selections from the activity preview. */
  activityFeedback: "rise_activity_feedback",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
