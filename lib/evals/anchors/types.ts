/**
 * PHI-118 — Shared types for the anchors eval suite. Split out so
 * `cases.ts` and `judge.ts` can import without circular references.
 */

import type { Day, SeededAnchorResolution, TestCase } from "./cases";

export type { TestCase };

export type ApiResponse = {
  days: Day[];
  bad_day_dates: string[] | null;
  placement_notes: string | null;
  // PHI-103: per-anchor titling-mode debug record. Required on responses
  // where anchors were supplied; null otherwise.
  seeded_anchor_resolutions: SeededAnchorResolution[] | null;
  // PHI-114: time-sensitive travel facts the traveller must verify or act on.
  time_sensitive_alerts: string[] | null;
};
