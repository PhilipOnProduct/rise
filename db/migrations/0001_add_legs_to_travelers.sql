-- PHI-33 / RISE-303 — add legs JSONB to travelers
--
-- This is PR1 of a two-part migration. PR2 (a separate ticket) drops
-- the legacy destination / hotel / departure_date / return_date columns
-- once we've verified no readers remain.
--
-- The JSONB shape mirrors lib/trip-schema.ts:TripLeg:
--   { id, place: { name, ... }, hotel?, startDate?, endDate?,
--     costEstimate?, timezone? }
--
-- Run from a Supabase project SQL editor or via the CLI:
--   supabase db push
--
-- Safe to re-run: column add + backfill are idempotent for the
-- "legs is empty" predicate.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Add the column
-- ────────────────────────────────────────────────────────────────────────────
alter table travelers
  add column if not exists legs jsonb not null default '[]'::jsonb;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Backfill: every existing row with a destination becomes a 1-leg trip
-- ────────────────────────────────────────────────────────────────────────────
update travelers
set legs = jsonb_build_array(
  jsonb_build_object(
    'id',          gen_random_uuid()::text,
    'place',       jsonb_build_object('name', destination),
    'hotel',       hotel,                  -- null if not booked
    'startDate',   departure_date,
    'endDate',     return_date,
    'costEstimate', null,                  -- per-leg cost added in PHI-33;
    'timezone',    null                    -- left null on backfill
  )
)
where (legs = '[]'::jsonb or legs is null)
  and destination is not null;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Comment for future archaeologists
-- ────────────────────────────────────────────────────────────────────────────
comment on column travelers.legs is
  'PHI-33: ordered list of trip legs. Single-leg = current single-destination trip. '
  'Multi-leg added by PHI-34 free-form parser. Each leg: '
  '{ id: uuid, place: { name, id?, lat?, lng?, type?, unverified? }, '
  'hotel?, startDate?, endDate?, costEstimate?: number, timezone?: string }';

-- ────────────────────────────────────────────────────────────────────────────
-- Follow-up (separate ticket — PR2 of PHI-33):
-- ────────────────────────────────────────────────────────────────────────────
-- alter table travelers drop column destination;
-- alter table travelers drop column hotel;
-- alter table travelers drop column departure_date;
-- alter table travelers drop column return_date;
-- ────────────────────────────────────────────────────────────────────────────
