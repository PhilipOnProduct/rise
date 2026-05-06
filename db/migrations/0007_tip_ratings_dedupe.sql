-- Tip-rating dedupe: one rating per (tip_id, anonymous session).
--
-- Before this, rating was deduped only in the browser via localStorage,
-- so any caller could POST /api/tips/<id>/rate repeatedly to inflate
-- the guide's points. We now require a session token (rise_session_id
-- cookie) and enforce uniqueness in the DB.
--
-- Existing rows are preserved; rater_session is nullable so the unique
-- constraint only affects new (server-deduped) rows. Once accounts ship,
-- replace rater_session with rater_user_id.

alter table tip_ratings
  add column if not exists rater_session text;

create unique index if not exists tip_ratings_tip_session_uniq
  on tip_ratings(tip_id, rater_session)
  where rater_session is not null;
