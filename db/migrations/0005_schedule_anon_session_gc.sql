-- PHI-31 Part 2 — schedule the anonymous-session GC cron
--
-- Privacy disclosure (policy-only, 14-day TTL per user sign-off) commits
-- to "data deleted if you don't create an account in 14 days." This
-- migration enables pg_cron and schedules a daily run of
-- gc_anonymous_sessions() at 03:15 UTC (low-traffic window for the EU
-- project).
--
-- Idempotent: `create extension if not exists` and cron.schedule replaces
-- by name.

create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'gc_anonymous_sessions_daily',
  '15 3 * * *',
  $$select gc_anonymous_sessions()$$
);

-- Verify with:
--   select jobid, schedule, command, jobname, active
--   from cron.job where jobname = 'gc_anonymous_sessions_daily';
