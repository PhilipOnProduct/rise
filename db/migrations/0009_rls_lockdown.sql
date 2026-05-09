-- PHI-61 — RLS lockdown on user-owned tables
--
-- Enables row-level security on the three tables that hold per-user
-- trip data, with policies tied to `auth.uid()`. Admin/system tables
-- (ai_logs, api_usage, api_limits, eval_*, team_*, agent_memory,
-- prd_feedback, objectives, profiles, anonymous_sessions, activity_feedback,
-- user_feedback, itinerary_items, guides, tips, tip_ratings) are NOT
-- enabled here — they're written either by the service-role admin client
-- (bypasses RLS) or by admin-gated browser code that uses the anon client
-- against the site_password + ADMIN_PASSWORD perimeter. Migrating those
-- tables to RLS is a follow-up.
--
-- Idempotent: drops existing policies before recreating, and uses
-- `enable row level security` (no-op when already on).
--
-- Pre-signup callers (welcome flow) act under no auth context and
-- therefore can't read or write under RLS via the anon client. Routes
-- that legitimately serve those callers (POST /api/travelers, the
-- anonymous-session API, the welcome-step writes) must use the
-- service-role admin client and verify ownership in code.

-- ── travelers ────────────────────────────────────────────────────────────
alter table travelers enable row level security;

drop policy if exists travelers_select_own on travelers;
drop policy if exists travelers_insert_own on travelers;
drop policy if exists travelers_update_own on travelers;
drop policy if exists travelers_delete_own on travelers;

create policy travelers_select_own
  on travelers for select
  using (auth_user_id = auth.uid());

create policy travelers_insert_own
  on travelers for insert
  with check (auth_user_id = auth.uid());

create policy travelers_update_own
  on travelers for update
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy travelers_delete_own
  on travelers for delete
  using (auth_user_id = auth.uid());

-- ── itineraries ──────────────────────────────────────────────────────────
alter table itineraries enable row level security;

drop policy if exists itineraries_select_own on itineraries;
drop policy if exists itineraries_insert_own on itineraries;
drop policy if exists itineraries_update_own on itineraries;
drop policy if exists itineraries_delete_own on itineraries;

create policy itineraries_select_own
  on itineraries for select
  using (
    traveler_id in (select id from travelers where auth_user_id = auth.uid())
  );

create policy itineraries_insert_own
  on itineraries for insert
  with check (
    traveler_id in (select id from travelers where auth_user_id = auth.uid())
  );

create policy itineraries_update_own
  on itineraries for update
  using (
    traveler_id in (select id from travelers where auth_user_id = auth.uid())
  )
  with check (
    traveler_id in (select id from travelers where auth_user_id = auth.uid())
  );

create policy itineraries_delete_own
  on itineraries for delete
  using (
    traveler_id in (select id from travelers where auth_user_id = auth.uid())
  );

-- ── travel_connectors ────────────────────────────────────────────────────
alter table travel_connectors enable row level security;

drop policy if exists travel_connectors_select_own on travel_connectors;
drop policy if exists travel_connectors_insert_own on travel_connectors;
drop policy if exists travel_connectors_update_own on travel_connectors;
drop policy if exists travel_connectors_delete_own on travel_connectors;

create policy travel_connectors_select_own
  on travel_connectors for select
  using (
    traveler_id in (select id from travelers where auth_user_id = auth.uid())
  );

create policy travel_connectors_insert_own
  on travel_connectors for insert
  with check (
    traveler_id in (select id from travelers where auth_user_id = auth.uid())
  );

create policy travel_connectors_update_own
  on travel_connectors for update
  using (
    traveler_id in (select id from travelers where auth_user_id = auth.uid())
  )
  with check (
    traveler_id in (select id from travelers where auth_user_id = auth.uid())
  );

create policy travel_connectors_delete_own
  on travel_connectors for delete
  using (
    traveler_id in (select id from travelers where auth_user_id = auth.uid())
  );
