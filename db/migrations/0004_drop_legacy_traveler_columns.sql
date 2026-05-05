-- PHI-33 PR2 — drop legacy travel columns from travelers
--
-- Now that:
-- 1. The application reads/writes legs JSONB exclusively (PR1 + PR2)
-- 2. All existing rows have been backfilled into legs (migration 0001)
-- 3. The /api/travelers route no longer mirrors writes to legacy columns
-- 4. claim_anonymous_session() is recreated below without legacy refs
--
-- ...we can drop the legacy columns. Trip shape now lives only in legs.

-- Recreate claim_anonymous_session without writing to legacy columns
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
  select * into v_row
  from anonymous_sessions
  where id = p_session_id and claimed_at is null
  for update;

  if not found then
    return null;
  end if;

  insert into travelers (
    name, email,
    legs,
    travel_company, style_tags, budget_tier,
    traveler_count, children_ages,
    constraint_tags, constraint_text,
    activities
  ) values (
    p_name, lower(p_email),
    v_row.legs,
    v_row.travel_company, v_row.style_tags, v_row.budget_tier,
    v_row.traveler_count, v_row.children_ages,
    v_row.constraint_tags, v_row.constraint_text,
    coalesce(v_row.activities, '[]'::jsonb)
  )
  returning id into v_traveler_id;

  update anonymous_sessions
  set claimed_at = now(), claimed_by_user_id = p_user_id
  where id = p_session_id;

  return v_traveler_id;
end;
$$;

-- Drop the legacy columns from travelers
alter table travelers drop column if exists destination;
alter table travelers drop column if exists hotel;
alter table travelers drop column if exists departure_date;
alter table travelers drop column if exists return_date;
