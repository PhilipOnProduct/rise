-- PHI-68 — revoke anon/authenticated SELECT on ai_logs
--
-- Background: ai_logs is intentionally RLS-off (per PHI-61 / CLAUDE.md)
-- and accessed exclusively via the service-role admin client
-- (lib/ai-logger.ts writes; /api/admin/logs reads;
-- scripts/multi-leg-cost-report.ts reads with service-role key).
--
-- However, default Supabase grants give the `anon` and `authenticated`
-- roles SELECT on every public table. With RLS off, that means anyone
-- holding the anon key can read ai_logs via PostgREST/GraphQL — and
-- since PHI-40 added a session_id column to correlate calls within a
-- trip, the Supabase advisor (`0023_sensitive_columns_exposed`) flags
-- this as a data-exposure vector.
--
-- Fix (Option A from the issue): revoke SELECT from anon and
-- authenticated. The service-role client bypasses these grants, so the
-- writer (ai-logger), the admin reader (/api/admin/logs), and the
-- multi-leg cost report are all unaffected.
--
-- Idempotent: REVOKE on a privilege the role doesn't hold is a no-op.

revoke select on table public.ai_logs from anon, authenticated;

-- Verify with:
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'ai_logs'
--     and grantee in ('anon', 'authenticated')
--     and privilege_type = 'SELECT';
-- Expected: 0 rows.
