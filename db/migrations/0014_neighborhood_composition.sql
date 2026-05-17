-- PHI-107 — family-mode shard on the neighbourhood picker cache.
--
-- The PHI-100 picker prompt didn't consume traveller composition, so the
-- Bergmans archetype walk (2 adults + kids aged 3 and 6) saw a Lisbon card
-- set with zero pram-friendly residential options. Family-mode is the new
-- second shard on the cache: the route computes `has_children` from the
-- POST body and looks up / writes the row with that flag. The system
-- prompt has a "Family mode" block that activates when the user message
-- carries the composition note.
--
-- Additive + idempotent. Existing rows take the default `has_children =
-- false`, which is correct for them — they were generated without any
-- composition context. Lazy migration: existing destinations regenerate
-- the second (family) row only on first family-mode visit.

alter table destination_neighborhoods
  add column if not exists has_children boolean not null default false;

drop index if exists idx_destination_neighborhoods_key;

create unique index if not exists idx_destination_neighborhoods_key
  on destination_neighborhoods(destination_key, has_children);
