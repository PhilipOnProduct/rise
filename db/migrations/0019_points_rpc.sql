-- 0019 — atomic point/view increments for the guides reputation system.
--
-- Replaces the read-then-write pattern in /api/guides, /api/tips/[id]/view
-- and /api/tips/[id]/rate, where two concurrent requests could both read
-- the same `points`/`views` value and write back a stale increment
-- (acknowledged MVP limitation in CLAUDE.md § Supabase conventions).
--
-- NOTE: these functions were found already deployed in the production
-- database (discovered 2026-06 while wiring the routes onto them) — the
-- definitions below mirror the deployed versions verbatim so this file is
-- the truthful record. Run once, idempotent. The API route helpers in
-- lib/guides.ts fall back to the legacy read-then-write path when the
-- functions don't exist, so deploy order doesn't matter on fresh
-- environments.

create or replace function increment_guide_points(p_guide_id uuid, p_amount integer)
returns integer
language sql
as $$
  update guides
     set points = coalesce(points, 0) + p_amount
   where id = p_guide_id
  returning points;
$$;

create or replace function increment_tip_views(p_tip_id uuid)
returns integer
language sql
as $$
  update tips
     set views = coalesce(views, 0) + 1
   where id = p_tip_id
  returning views;
$$;
