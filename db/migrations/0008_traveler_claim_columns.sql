-- PHI-60 — trip claim flow
--
-- A signed-in user can have multiple `travelers` rows (e.g. they planned
-- a fresh local trip while already having one saved to their account).
-- The claim flow at /auth/claim asks them which to keep as the active
-- trip; the chosen row is marked is_primary=true and stamped with
-- claimed_at, the others are flipped to is_primary=false.
--
-- - is_primary: which row the dashboard should default to. Old rows are
--   not deleted — keeping them lets us re-surface the trip later.
-- - claimed_at: when the row was linked to an auth user via the claim
--   flow. Null for legacy rows that were linked silently in PHI-59.
--
-- Backfill marks every existing row primary so single-trip users keep
-- their current dashboard behaviour unchanged.

alter table travelers
  add column if not exists is_primary boolean default true;
alter table travelers
  add column if not exists claimed_at timestamptz;

update travelers
  set is_primary = true
  where is_primary is null;
