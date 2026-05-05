# PHI-31 / RISE-202 — Anonymous Session Architecture Design

**Status:** Draft for sign-off · **Author:** Luca (Tech Lead) · **Reviewers:** Sarah (PM), Privacy/Legal · **Date:** 2026-05-04

This document is the design-gate the team review specified before any code on PHI-31 lands. It covers schema, flow, edge cases, and the parallel privacy track owned by Sarah.

---

## 1 · Goal & success criteria

**Goal:** let users see their generated itinerary BEFORE creating an account. Signup gates *saving + return*, not first viewing.

**Success criteria** (from Linear ticket):
- User completes steps 1–4 without signing up; sees the full itinerary on step 5
- "Save trip" → existing signup; trip auto-attaches to new account
- Reopening within 30 days from same browser restores the trip
- On signup, server-side trip data atomically migrated; anonymous session marked `claimed`
- Pre- vs. post-signup conversion measurable (`itinerary_viewed`, `signup_initiated_after_itinerary`, `signup_initiated_pre_itinerary`)

---

## 2 · Schema

New table `anonymous_sessions`:

```sql
create table anonymous_sessions (
  id           uuid primary key default gen_random_uuid(),
  -- Trip data — superset of what currently lives in client state until step 5
  destination       text,
  destination_verified boolean default false,  -- PHI-30
  departure_date    date,
  return_date       date,
  hotel             text,
  travel_company    text,
  style_tags        text[],
  budget_tier       text,
  traveler_count    int,
  children_ages     text[],
  constraint_tags   text[],   -- PHI-35
  constraint_text   text,     -- PHI-35
  -- Generated artefacts
  activities        jsonb,     -- streamed activity cards as parsed
  activity_feedback jsonb,     -- ratings (interested / not_for_me / chip / skipped)
  itinerary         jsonb,     -- final generated itinerary, if reached
  -- Lifecycle
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '30 days',
  claimed_at        timestamptz,
  claimed_by_user_id uuid references auth.users(id) on delete set null
);

create index anonymous_sessions_expires_at_idx
  on anonymous_sessions (expires_at) where claimed_at is null;
create index anonymous_sessions_claimed_by_idx
  on anonymous_sessions (claimed_by_user_id) where claimed_by_user_id is not null;
```

**Trigger** keeps `updated_at` fresh on writes.

---

## 3 · Cookie

Name: `rise_session_id`
Type: HttpOnly, SameSite=Lax, Secure, Path=/
Lifetime: 30 days, refreshed on each session-bearing request
Set: on first onboarding-step request that doesn't already carry it

```ts
// In a middleware (or route handler), one of two paths:
const cookie = req.cookies.get("rise_session_id")?.value;
if (!cookie) {
  const newRow = await supabase.from("anonymous_sessions").insert({}).select("id").single();
  res.cookies.set("rise_session_id", newRow.data!.id, COOKIE_OPTS);
}
```

---

## 4 · State writes

Each onboarding step writes its partial state to the session row. Today's client-side state stays as a UX nicety (instant rendering) but the server is the source of truth.

Suggested endpoint: `PATCH /api/anonymous-session` accepts a partial trip-state object and merges into the row (debounced from the client).

Activity generation streams as today; the streamed text and parsed cards are written to `activities` at the end of step 4. Itinerary is written to `itinerary` at end of step 5 (or whenever final generation runs).

---

## 5 · Claim-on-signup atomic transaction

When a user signs up:

```sql
-- 1. Verify cookie session exists and is unclaimed
select id from anonymous_sessions
where id = $1 and claimed_at is null
for update;

-- 2. Migrate fields into the new traveler/user record
insert into travelers (
  user_id, name, email, destination, departure_date, ..., constraint_tags, ...
) select
  $newUserId, $name, $email, destination, departure_date, ..., constraint_tags, ...
from anonymous_sessions where id = $1;

-- 3. Mark the session as claimed
update anonymous_sessions
set claimed_at = now(), claimed_by_user_id = $newUserId
where id = $1;

-- 4. Clear the cookie OR refresh it; row stays for audit
```

All four steps wrap in a single Supabase transaction (use a Postgres function or RLS-safe stored procedure). `for update` prevents concurrent claims.

---

## 6 · Edge cases

| Case | Behaviour |
|---|---|
| User opens 2nd tab during onboarding | Both tabs share the same cookie → write to same row. Last-write-wins on text fields; activity feedback is keyed by activity ID so safe. |
| User clears cookies mid-flow | New cookie issued, new empty session created. Previous session orphans and expires after 30 days. |
| User signs up from a different device | Different cookie → no claim possible. Mention in copy: *"Save your plan on this device — sign up on another to access."* (Or implement email-based recovery later.) |
| User signs up when session is already claimed (race) | `for update` returns the row; `claimed_at IS NOT NULL` causes the insert step to skip; surface "already linked" message. |
| Activity generation fails mid-stream | Partial state in `activities` is fine — the user can re-trigger generation. |
| User abandons before step 4 | Session row contains partial state only; no itinerary. Eligible for GC at expires_at. |

---

## 7 · GC policy

**Cron / scheduled function** runs daily:

```sql
delete from anonymous_sessions
where claimed_at is null and expires_at < now();
```

Privacy disclosure (see §9) commits to "30 days unless you create an account." Match the cron to that promise.

For **claimed sessions**, retain indefinitely as part of the user's trip history (subject to the user's data-deletion rights).

---

## 8 · Telemetry

Three new analytics events:

- `itinerary_viewed` — fired when step 5 renders for the first time on a session
- `signup_initiated_pre_itinerary` — user clicked Save trip before viewing itinerary (shouldn't happen post-PHI-31, but track baseline)
- `signup_initiated_after_itinerary` — user clicked Save trip after viewing itinerary

Compare conversion:
- Baseline (current): % of signup_initiated_pre_itinerary that complete signup
- Post-PHI-31: % of itinerary_viewed that complete signup

Expected lift: significant (4 of 5 personas in the May 2026 review flagged forced-signup as drop-off).

---

## 9 · Privacy / legal track (Sarah's parallel work)

**Required before launch.** Cannot ship without disclosure.

The session contains PII-adjacent travel intent. Privacy policy must add:

> "We collect trip details (destination, dates, party composition, travel style, dietary or accessibility constraints, and similar preferences) before you create an account, so we can generate a personalised itinerary preview. This data is stored on a temporary anonymous session for up to 30 days and is automatically deleted if you don't create an account in that window. If you create an account, this data is migrated to your user profile."

**Jurisdictional considerations:**
- **EU (GDPR):** lawful basis = legitimate interest (preview the product). Need a banner / disclosure on first session creation. Consider shorter TTL (14 days?) for EU users.
- **California (CCPA):** disclose categories of PI collected pre-signup. Add to "Categories of Personal Information" section.
- **UK (UK GDPR):** mirrors EU. ICO would expect explicit notice.
- **Brazil (LGPD), India (DPDPA):** similar — disclose, justify, retain only as long as needed.

**Action items for Sarah this week:**
1. Brief whoever owns legal/policy at Anthropic / Rise's parent
2. Draft the privacy policy update (block above is a starting point)
3. Decide on TTL: 30 days uniform, or 14 days for EU/UK?
4. Decide on banner: do we show an explicit "we'll save your inputs for 30 days" notice, or rely on the privacy policy alone? (Banner is friendlier but adds friction; policy alone is legally minimal but less transparent.)
5. Sign off before code freeze

---

## 10 · Implementation order (recommended sub-tasks)

1. **Sprint week 1:** Supabase migration for `anonymous_sessions` table. Server-side cookie middleware. New `/api/anonymous-session` PATCH endpoint.
2. **Sprint week 1:** Wire onboarding steps 1–4 to PATCH on each step advance (debounced). Verify sessions are written and updated correctly.
3. **Sprint week 2:** Activity generation persists to session. Itinerary generation persists to session.
4. **Sprint week 2:** Claim-on-signup transaction (Postgres function). Migrate to traveler row atomically. Test races.
5. **Sprint week 2:** Telemetry events.
6. **Parallel — Sarah's track:** privacy disclosure, legal review, banner copy decision.
7. **Pre-launch:** soft launch behind feature flag, watch claim race conditions, watch GC running cleanly.

**Estimate:** 5–8 dev-days + ~2 days privacy/legal coordination. Don't compress.

---

## 11 · Open questions for the team

1. **TTL — 30 days uniform or jurisdiction-aware?** (Sarah / Legal)
2. **Banner vs. policy-only disclosure?** (Sarah / Legal)
3. **Should the session ID appear in URLs at all?** (Likely no for security; cookie-only is safer.)
4. **Multi-device share (Q2 ticket reservation):** the URL `/trip/<id>/preview` was reserved in PHI-30 for a future shareable-link feature. Is the anon-session ID the same as the share ID, or do we mint separate IDs at share time? Recommend separate to avoid leaking session cookies via shareable URLs.
5. **Re-using a session across login states:** if a logged-in user starts a new trip from `/welcome`, do we use their user_id directly or still mint an anon session for in-progress drafts? Recommend: logged-in users skip the anon path; trip lives directly in their account from step 1.

---

**Ready for sign-off when:** privacy/legal draft is ready, TTL + banner decisions made, this doc reviewed by Sarah + Luca + (privacy contact). After sign-off, code can begin.
