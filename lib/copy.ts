/**
 * PHI-104 — canonical copy strings used in more than one render site.
 *
 * Putting a string in `lib/copy.ts` is the discipline for any user-facing
 * label that is referenced from both a UI component and a prefix/template
 * — keeping it here means a future copy tweak is a single-file edit, not
 * a hunt-and-replace across the codebase.
 *
 * Keep this file tiny. Most copy lives next to its component; only the
 * cross-file labels graduate here.
 */

/**
 * The "from your list" badge label rendered on `/itinerary` day cards
 * where `seededByUser: true`. Also used as the prefix on the verbatim
 * subtitle ("from your list: <quoted verbatim>") when the resolved
 * title differs from the user's typed entry.
 */
export const FROM_YOUR_LIST = "from your list";
