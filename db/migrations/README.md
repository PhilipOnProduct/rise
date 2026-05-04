# Database migrations

Numbered SQL migrations for the Supabase `travelers` schema and downstream
tables. New convention as of PHI-33 (May 2026).

## Running

Each migration is a standalone idempotent-where-possible SQL script. To apply:

1. Open the Supabase SQL editor for the Rise project, OR install the Supabase
   CLI and link the project (`supabase link --project-ref <ref>`).
2. Execute each migration file in numerical order. You can paste the file
   directly into the SQL editor, or use `supabase db push` if migrations
   live under `supabase/migrations/`.
3. Verify the migration applied (e.g., `\d travelers` or run the equivalent
   `select column_name from information_schema.columns where table_name = 'travelers'`).

## Convention

- Filenames: `NNNN_short_description.sql`. NNNN is a 4-digit sequential
  number; reserve the next number when creating a new migration.
- Each file is self-contained and idempotent (`if not exists` / `do nothing
  on conflict`) where possible so re-running is safe.
- Add a header comment with: ticket reference, what it does, what (if any)
  follow-up migrations are expected.
- Don't bundle unrelated changes into one migration. Separate column adds,
  index creation, and constraint changes when practical.

## Roster

| File | Ticket | Notes |
|---|---|---|
| 0001_add_legs_to_travelers.sql | PHI-33 / RISE-303 | Adds `legs` JSONB. Backfill from existing destination/dates/hotel. Legacy columns kept; dropped in a follow-up migration once readers are gone. |
