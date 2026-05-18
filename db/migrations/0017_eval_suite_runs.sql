-- PHI-119 — Evals GUI card 2: persistence for suite runs.
--
-- Two new tables back the suites surface at /admin/evals/suites:
--
--   eval_suite_runs   — one row per "I clicked Run on suite X" event.
--   eval_case_runs    — one row per case within a suite run.
--
-- Plus an additive `suite_run_id` column on ai_logs so any Anthropic
-- calls made by a suite (cards 3+ will hit the live API) can be joined
-- back to the run that triggered them. Existing rows stay NULL.
--
-- All operations are idempotent (`if not exists`). Safe to re-run.
--
-- The status enum follows the state machine named in the PRD:
--   queued | running | succeeded | failed | cancelled
-- (`partial` lives in the GUI as a derived view of succeeded + some
-- case_runs failing — no need for a separate persisted state.)
--
-- pass_rate / summary_score are nullable because the suite may crash
-- before producing them; finished_at is nullable for the same reason
-- and also stays null while a run is in progress.

create table if not exists public.eval_suite_runs (
  id uuid primary key default gen_random_uuid(),
  suite text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  model text,
  total_cost_usd numeric(10,6),
  pass_rate numeric(5,2),
  summary_score numeric(5,2),
  notes text,
  created_by text
);

create index if not exists idx_suite_runs_suite_started
  on public.eval_suite_runs (suite, started_at desc);

create table if not exists public.eval_case_runs (
  id uuid primary key default gen_random_uuid(),
  suite_run_id uuid not null references public.eval_suite_runs(id) on delete cascade,
  case_name text not null,
  run_index integer not null default 0,
  programmatic_pass boolean,
  judge_score numeric(5,2),
  judge_reasoning text,
  output_snippet text,
  cost_usd numeric(10,6),
  duration_ms integer,
  error text,
  created_at timestamptz default now()
);

create index if not exists idx_case_runs_suite
  on public.eval_case_runs (suite_run_id);

alter table public.ai_logs
  add column if not exists suite_run_id uuid;

-- Partial index: the join from suite_run → ai_logs is rare and only
-- against runs we just wrote. Same shape as the session_id index in
-- 0006 — keeps the bulk of NULL rows out of the index.
create index if not exists ai_logs_suite_run_id_idx
  on public.ai_logs (suite_run_id, created_at desc)
  where suite_run_id is not null;

-- Verify with:
--   select table_name from information_schema.tables
--   where table_name in ('eval_suite_runs','eval_case_runs');
--   select column_name from information_schema.columns
--   where table_name = 'ai_logs' and column_name = 'suite_run_id';
