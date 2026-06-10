export type Chip = {
  label: string;
  type: "hard_exclusion" | "soft_signal";
};

export type ChipsEntry = {
  chips: Chip[];
  source: "fallback" | "dynamic";
};

// PHI-31 Part 2 slice 2: minimal shape for the inline itinerary preview
// rendered on step 5 BEFORE the signup form. Mirrors the /api/itinerary/generate
// response. We don't reuse the full /itinerary page render because it
// includes drag-to-reschedule, travel connectors, etc. — out of scope for
// the pre-signup preview, which is read-only.
export type PreviewItem = {
  id: string;
  title: string;
  description: string;
  type: string;
  time_block: "morning" | "afternoon" | "evening";
  // PHI-90: true on items the generator placed in response to a user
  // anchor. Surfaced inline on the preview + the saved /itinerary view
  // so the traveller can confirm "yes, my picks landed".
  seededByUser?: boolean;
};
export type PreviewDay = {
  date: string;
  day_number: number;
  items: PreviewItem[];
  // PHI-37: multi-leg trips — index into legs[] (0-based). Absent on
  // single-leg trips. `is_transition: true` flags a travel day between
  // two legs and is rendered as a muted transport-only card.
  leg_index?: number;
  is_transition?: boolean;
};

export type ParsedActivity = {
  id: string;
  name: string;
  category: string;
  description: string;
  when: string;
  // PHI-32: optional because older streams may not include it; the UI
  // hides the "Why this" affordance when missing.
  rationale?: string;
  // PHI-37: leg index this activity belongs to. Absent on single-leg
  // streams; populated when the upstream emits "LEG: <index>" markers.
  legIndex?: number;
};

export type ActivityFeedbackEntry = {
  activityId: string;
  activityName: string;
  activityCategory: string;
  // PHI-28: "skipped" is distinct from "no feedback at all". It tells the
  // model the user *consciously* declined to commit either way — useful
  // signal for downstream personalization.
  feedbackType:
    | "thumbs_up"
    | "chip_selected"
    | "thumbs_down_no_chip"
    | "skipped";
  chip?: Chip;
};
