-- PHI-120 — Evals GUI card 3: link api_usage rows to suite runs.
--
-- Adds an additive `suite_run_id` column to `api_usage` so the runs
-- route can roll up realised cost per suite run via a single SUM query.
--
-- Mirrors the additive `suite_run_id` column on `ai_logs` from 0017,
-- including the partial index keyed where the value is non-null. The
-- column is nullable + has no default so production traffic and legacy
-- rows stay untouched; only suite-driven calls (identified by the
-- `X-Suite-Run-Id` request header on the three target routes) carry it.
--
-- Idempotent. Safe to re-run.

alter table public.api_usage
  add column if not exists suite_run_id uuid;

create index if not exists api_usage_suite_run_id_idx
  on public.api_usage (suite_run_id, created_at desc)
  where suite_run_id is not null;

-- Verify with:
--   select column_name from information_schema.columns
--   where table_name = 'api_usage' and column_name = 'suite_run_id';
