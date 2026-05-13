-- PHI-99 — flexible-date entry on welcome step 1
--
-- Adds two optional columns so a traveller who isn't yet committed to dates
-- can capture a month + nights and still get a full activity preview and
-- itinerary. Existing rows keep behaving as today: when both columns are
-- null AND legs[*].startDate/endDate are populated, the prompt path is
-- byte-identical to pre-PHI-99.
--
-- Idempotent and additive — no backfill, no defaults.
--
-- Note: the PHI-99 PRD pointed at filename 0012_flex_dates.sql but 0012 is
-- already taken by PHI-100 (db/migrations/0012_anchor_neighborhood.sql);
-- this is the next free slot.

alter table travelers
  add column if not exists flex_month text,
  add column if not exists flex_nights integer;
