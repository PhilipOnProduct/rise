-- PHI-35 hygiene fix
--
-- The PHI-35 ticket shipped the API change to write constraint_tags +
-- constraint_text on /api/travelers, but the corresponding columns were
-- never added — Supabase silently dropped the fields on insert/update.
-- This migration backfills the schema so the data actually persists.
--
-- Idempotent: `add column if not exists`.

alter table travelers
  add column if not exists constraint_tags text[],
  add column if not exists constraint_text text;

comment on column travelers.constraint_tags is
  'PHI-35: high-stakes constraint chip tags (Wheelchair accessible only, '
  'No long walks, Vegetarian, Halal/Kosher, Severe allergy, Stroller-friendly).';
comment on column travelers.constraint_text is
  'PHI-35: free-text constraints not covered by chips (allergies, mobility, '
  'dietary, religious).';
