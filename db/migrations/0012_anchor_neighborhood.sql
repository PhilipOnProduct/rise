-- PHI-100 — soft neighbourhood picker on welcome step 2
--
-- Travellers without a booked hotel get an "Help me pick a neighbourhood →"
-- affordance below the hotel input. Selecting one of 4–6 AI-generated
-- neighbourhood cards stores the chosen name on the traveler row so it can
-- be used downstream as a soft location anchor (instead of a hotel name)
-- in activity-gen and itinerary-gen prompts.
--
-- The cache table holds the AI output keyed by a case-insensitive
-- destination string so a city's neighbourhoods are generated once per
-- Anthropic call, not per visitor. Hits skip the API call entirely.
--
-- Both columns are nullable / additive — existing rows and the existing
-- hotel path keep working byte-identically.

alter table travelers
  add column if not exists anchor_neighborhood text;

create table if not exists destination_neighborhoods (
  id uuid primary key default gen_random_uuid(),
  destination_key text not null,
  destination_display text not null,
  neighborhoods jsonb not null,
  model text not null,
  created_at timestamptz default now()
);

create unique index if not exists idx_destination_neighborhoods_key
  on destination_neighborhoods(destination_key);
