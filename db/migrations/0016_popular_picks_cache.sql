-- PHI-102 — popular picks cache for the welcome step-4 anchors discovery.
--
-- Welcome step 4 asks travellers to type in must-dos that anchor the
-- itinerary, but many travellers don't have a list in their head. The
-- popular-picks affordance surfaces 5–8 personalised iconic activities for
-- the destination, each with a one-line context note (friction / fit /
-- pro tip). Cache keeps Haiku cost a rounding error: ~$0.001/call uncached,
-- expected >70% hit rate on common profile shapes.
--
-- The cache is keyed on the FULL profile shape — same city + same
-- company + same age bands + same sorted style tags hit the same row.
-- Tag sort order is enforced in lib/popular-picks-prompt.ts:
-- popularPicksCacheKey() so a re-ordered selection doesn't inflate
-- miss-rate silently.
--
-- city_key is lowercased like destination_neighborhoods.destination_key
-- (PHI-100). Single source of truth for picks per profile-shape.
--
-- Note on slot: the PHI-102 PRD pointed at 0014; PHI-107 took 0014 first
-- and PHI-111 took 0015 — 0016 is the next free slot.

create table if not exists popular_picks_cache (
  id uuid primary key default gen_random_uuid(),
  city_key text not null,
  city_display text not null,
  travel_company text,
  children_age_bands text[],
  top_style_tags_sorted text[],
  picks jsonb not null,
  model text not null,
  created_at timestamptz default now()
);

create unique index if not exists idx_popular_picks_cache_key
  on popular_picks_cache(
    city_key,
    coalesce(travel_company, ''),
    coalesce(children_age_bands, '{}'::text[]),
    coalesce(top_style_tags_sorted, '{}'::text[])
  );
