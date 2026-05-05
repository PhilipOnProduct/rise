-- PHI-40 — multi-leg cost telemetry: add session_id to ai_logs
--
-- Tags every Anthropic call with the rise_session_id cookie (set by
-- middleware, also used by the anonymous_sessions row claim flow). Lets
-- the cost-report script group calls by trip without parsing the input
-- JSONB column.
--
-- Idempotent: `if not exists` on column + index. Safe to re-run.

alter table public.ai_logs
  add column if not exists session_id text;

-- Index so the report query (group by session_id within a date window)
-- doesn't sequential-scan the whole log table. Partial — most rows have
-- no session_id today, no point indexing them.
create index if not exists ai_logs_session_id_idx
  on public.ai_logs (session_id, created_at desc)
  where session_id is not null;

-- Verify with:
--   select column_name from information_schema.columns
--   where table_name = 'ai_logs' and column_name = 'session_id';
