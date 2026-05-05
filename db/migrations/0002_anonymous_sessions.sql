-- PHI-31 / RISE-202 — anonymous_sessions table
--
-- Backs the pre-signup itinerary view. Cookie-keyed, 14-day TTL (per
-- user's sign-off — chose 14 days uniform rather than jurisdiction-aware
-- for simpler ops). Claimed-on-signup; otherwise GC'd by the daily cron
-- in cron_anonymous_session_gc() (separate migration if needed).
--
-- Privacy disclosure (policy-only, per user's sign-off — no banner): see
-- the privacy policy update in this PR's commit notes.
--
-- Run from Supabase SQL editor or `supabase db push`.

create table if not exists anonymous_sessions (
  id                   uuid primary key default gen_random_uuid(),
  -- Trip data — superset of the welcome-page state until step 5
  legs                 jsonb not null default '[]'::jsonb,
  destination          text,
  destination_verified boolean default false,
  departure_date       date,
  return_date          date,
  hotel                text,
  travel_company       text,
  style_tags           text[],
  budget_tier          text,
  traveler_count       int,
  children_ages        text[],
  constraint_tags      text[],
  constraint_text      text,
  -- Generated artefacts
  activities           jsonb,
  activity_feedback    jsonb,
  itinerary            jsonb,
  -- Lifecycle (14-day TTL per user sign-off on PHI-31 design doc)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  expires_at           timestamptz not null default now() + interval '14 days',
  claimed_at           timestamptz,
  claimed_by_user_id   uuid references auth.users(id) on delete set null
);

-- ────────────────────────────────────────────────────────────────────────
-- Triggers
-- ────────────────────────────────────────────────────────────────────────
create or replace function tg_anonymous_sessions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tg_anonymous_sessions_updated_at on anonymous_sessions;
create trigger tg_anonymous_sessions_updated_at
  before update on anonymous_sessions
  for each row execute procedure tg_anonymous_sessions_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- Indexes
-- ────────────────────────────────────────────────────────────────────────
create index if not exists anonymous_sessions_expires_at_idx
  on anonymous_sessions (expires_at) where claimed_at is null;
create index if not exists anonymous_sessions_claimed_by_idx
  on anonymous_sessions (claimed_by_user_id) where claimed_by_user_id is not null;

-- ────────────────────────────────────────────────────────────────────────
-- GC
-- ────────────────────────────────────────────────────────────────────────
-- Run from Supabase pg_cron (or manually) once per day.
create or replace function gc_anonymous_sessions()
returns int language plpgsql as $$
declare
  removed int;
begin
  delete from anonymous_sessions
  where claimed_at is null and expires_at < now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- Claim-on-signup atomic transaction
-- ────────────────────────────────────────────────────────────────────────
-- Called from /api/auth or wherever user creation lands. Atomically
-- migrates the anonymous session into a traveler row and marks the
-- session as claimed. Returns the new traveler id, or null if the
-- session is already claimed / not found.
create or replace function claim_anonymous_session(
  p_session_id uuid,
  p_user_id    uuid,
  p_email      text,
  p_name       text
) returns uuid language plpgsql as $$
declare
  v_traveler_id uuid;
  v_row         anonymous_sessions%rowtype;
begin
  -- Lock the session row to prevent concurrent claims
  select * into v_row
  from anonymous_sessions
  where id = p_session_id and claimed_at is null
  for update;

  if not found then
    return null;
  end if;

  -- Migrate into travelers
  insert into travelers (
    name, email,
    legs,
    destination, departure_date, return_date, hotel,
    travel_company, style_tags, budget_tier,
    traveler_count, children_ages,
    constraint_tags, constraint_text,
    activities
  ) values (
    p_name, lower(p_email),
    v_row.legs,
    v_row.destination, v_row.departure_date, v_row.return_date, v_row.hotel,
    v_row.travel_company, v_row.style_tags, v_row.budget_tier,
    v_row.traveler_count, v_row.children_ages,
    v_row.constraint_tags, v_row.constraint_text,
    coalesce(v_row.activities, '[]'::jsonb)
  )
  returning id into v_traveler_id;

  -- Mark session claimed
  update anonymous_sessions
  set claimed_at = now(), claimed_by_user_id = p_user_id
  where id = p_session_id;

  return v_traveler_id;
end;
$$;

comment on table anonymous_sessions is
  'PHI-31: pre-signup trip drafts. 14-day TTL. Cookie-keyed via rise_session_id. '
  'Claimed atomically into a travelers row on signup via claim_anonymous_session().';
