-- Supabase security advisor fix — enable RLS on all remaining public tables
--
-- Background: the 2026-07-12 Supabase security advisor email flagged
-- `rls_disabled_in_public` (ERROR) on the 19 tables below. With RLS off,
-- the default PostgREST grants let anyone holding the public anon key —
-- which ships in the browser bundle — read, edit, and delete every row.
--
-- Fix: enable RLS with NO policies. That denies the `anon` and
-- `authenticated` roles entirely while the service-role admin client
-- (lib/supabase-admin.ts) bypasses RLS and keeps working. Every code
-- path that previously used the anon key on these tables was migrated
-- to server-side routes on the admin client in the same change:
--   - guides/tips routes  → lib/guides-server.ts + admin client
--   - /team browser code  → /api/team/{conversations,objectives,memory,prd-feedback}
--
-- Belt-and-braces: also revoke the default table grants from anon and
-- authenticated so the tables disappear from the PostgREST/GraphQL
-- surface entirely (clears the pg_graphql_*_table_exposed advisor
-- warnings for these tables too).
--
-- Idempotent: `enable row level security` is a no-op when already on;
-- REVOKE of a privilege a role doesn't hold is a no-op.

-- ── Community tables (accessed via /api/guides/* and /api/tips/*) ───────
alter table public.guides enable row level security;
alter table public.tips enable row level security;
alter table public.tip_ratings enable row level security;

-- ── Product-team tables (accessed via /api/team/*) ──────────────────────
alter table public.team_conversations enable row level security;
alter table public.objectives enable row level security;
alter table public.agent_memory enable row level security;
alter table public.prd_feedback enable row level security;

-- ── System / telemetry tables (service-role writers + admin-gated reads) ─
-- ai_logs: 0010 only revoked SELECT — anon still held write grants.
alter table public.ai_logs enable row level security;
alter table public.profiles enable row level security;
alter table public.user_feedback enable row level security;
alter table public.activity_feedback enable row level security;
alter table public.anonymous_sessions enable row level security;
alter table public.api_usage enable row level security;
alter table public.api_limits enable row level security;
alter table public.eval_test_cases enable row level security;
alter table public.eval_results enable row level security;
alter table public.eval_suite_runs enable row level security;
alter table public.eval_case_runs enable row level security;
alter table public.destination_neighborhoods enable row level security;
alter table public.popular_picks_cache enable row level security;

-- ── Drop the default PostgREST grants for the anon-key roles ────────────
revoke all on table
  public.guides,
  public.tips,
  public.tip_ratings,
  public.team_conversations,
  public.objectives,
  public.agent_memory,
  public.prd_feedback,
  public.ai_logs,
  public.profiles,
  public.user_feedback,
  public.activity_feedback,
  public.anonymous_sessions,
  public.api_usage,
  public.api_limits,
  public.eval_test_cases,
  public.eval_results,
  public.eval_suite_runs,
  public.eval_case_runs,
  public.destination_neighborhoods,
  public.popular_picks_cache
from anon, authenticated;

-- Verify with:
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and rowsecurity = false;
-- Expected: no Rise tables in the result.
