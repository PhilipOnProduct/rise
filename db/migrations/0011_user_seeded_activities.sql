-- PHI-90 — user-seeded must-dos
--
-- New optional step in the Welcome wizard between preferences (step 3) and
-- the AI activity preview lets travellers seed the itinerary with their own
-- must-dos (free-text, one per line). The itinerary-gen prompt receives
-- these entries as ANCHOR placements; the generator builds the surrounding
-- schedule around them.
--
-- Nullable + no default — rows without a seeded list keep generating
-- exactly as today. Backward-compatible by design.

alter table travelers
  add column if not exists user_seeded_activities text[];
