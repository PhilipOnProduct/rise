# PHI-33 / RISE-303 — Schema Migration Design (legs JSONB)

**Status:** Draft for sign-off · **Author:** Luca (Tech Lead) · **Reviewer:** Sarah (PM) · **Date:** 2026-05-04

This document is the schema-migration design the team review specified before any code on PHI-33 lands. It blocks PHI-34 (free-form input) which depends on the leg-based shape.

---

## 1 · Why we're doing this

Today's `travelers` table treats a trip as a single tuple: `(destination, departure_date, return_date, hotel)`. That works for a one-stop trip but not for:

- **Multi-city:** Sam & Chris in the May 2026 review want Lisbon → Porto → Madrid → Barcelona. The single field can't express it.
- **Per-leg hotels:** Elena flagged that real travellers often book leg 1 hotel + leg 2 TBD. Hotel and date optionality should be independent fields per leg.
- **Free-form input (PHI-34):** the parser needs to write a multi-leg result into the schema. Without legs, the parser is artificially constrained.

The smallest valuable version is to model trips as an ordered list of legs, with each leg holding its own optional hotel and optional dates within the trip's overall window.

---

## 2 · Target shape

```ts
type TripLeg = {
  id: string;            // stable per-leg ID for UI keying + per-leg edits
  place: PlaceRef;       // resolved place (PHI-30 will populate fully; today: { name } )
  hotel?: string | null; // free-text or future place ID
  startDate?: string;    // ISO date; if absent, inferred from previous leg's end
  endDate?: string;      // ISO date; if absent, inferred from next leg's start (or trip end)
};

type PlaceRef = {
  // PHI-30 future-proofing: today only `name` is reliably populated.
  name: string;
  id?: string;       // Mapbox/Google Places ID
  lat?: number;
  lng?: number;
  type?: "place" | "region" | "country" | "locality" | "poi";
  unverified?: boolean; // PHI-30 "use anyway" path
};
```

The trip itself keeps its overall `departure_date` / `return_date` fields as the outer envelope. Legs sit inside as a JSONB array.

---

## 3 · Migration

```sql
-- One column, JSONB, default empty array. Existing rows stay valid (empty legs).
alter table travelers
  add column legs jsonb not null default '[]'::jsonb;

-- Backfill: for every existing row that has a destination but no legs,
-- create a single-leg array from the existing fields. Run as one transactional
-- batch. ~ms per row, no lock concerns at our current scale.
update travelers
set legs = jsonb_build_array(
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'place', jsonb_build_object('name', destination),
    'hotel', hotel,
    'startDate', departure_date,
    'endDate', return_date
  )
)
where (legs = '[]'::jsonb or legs is null)
  and destination is not null;

-- Optional GIN index for future query patterns (multi-city analytics, etc.)
-- Skip for v1 — read patterns don't justify it yet.
-- create index travelers_legs_gin on travelers using gin (legs);
```

**The destination, hotel, departure_date, return_date columns are kept** for backwards compatibility through Sprint 3. They become read-only mirrors of `legs[0].place.name`, `legs[0].hotel`, etc. After PHI-34 ships and we confirm no readers depend on them, drop in a follow-up.

This is **lazy migration**: existing rows backfill once during the migration, but the application reads/writes only `legs`. The legacy columns are populated on writes for the transition window so downstream consumers (anything that reads destination/hotel/dates from the row) keep working.

---

## 4 · Validation rules

Enforced in the application layer (Postgres has weak JSONB validation; we do this in the API):

1. **At least one leg required** for a non-empty trip.
2. **Every leg has a `place.name`.** Free text is allowed (PHI-30 unverified path); structured place data is preferred.
3. **Date envelope:** every leg's `startDate` ≥ trip's `departure_date` and `endDate` ≤ trip's `return_date`.
4. **No overlapping legs** (legs sorted by `startDate` must have non-overlapping ranges). Soft-warn rather than hard-fail at first — travellers sometimes have fuzzy plans.
5. **Coverage:** legs SHOULD cover the entire trip date range, but gaps are allowed (model can ask the user to clarify).
6. **Legs in chronological order** in the array. Re-order on save.

**TypeScript validators in `lib/trip-schema.ts`** (new file). Re-used by `/api/travelers`, `/api/anonymous-session`, and the activities-stream prompt builder.

---

## 5 · UI shape (for Maya — also referenced in step-3 component refactor)

**Single-leg trip (default for users who don't volunteer multi-city):**

```
[Destination input — populated, read-only chip from PHI-30]
[Departure date]
[Return date]
[Hotel — optional, with autocomplete]
[I haven't booked yet — skip]
```

**Multi-leg trip (PHI-34 produces these from free-form input):**

```
[Trip dates: Departure, Return]

Leg 1
  [Place — chip]
  [Optional dates within trip]
  [Optional hotel]

Leg 2
  [Place — chip]
  [Optional dates within trip]
  [Optional hotel]

[+ Add leg]
```

The "leg" abstraction is invisible to single-city users. Only renders for multi-leg trips.

Hotel autocomplete reuses the place-resolution endpoint with a `category=lodging` filter (Mapbox supports this; if we stay on Google Places, use `types=["lodging"]`).

---

## 6 · Activity generation prompt impact

Currently the prompt sends `destination` as a single string. Once legs ship, the prompt should iterate per leg:

```
Trip overview: 2 adults, 14 days (Jun 15 – Jun 29), Cultural + Food-led, Comfortable budget.

Leg 1: Lisbon, Portugal — Jun 15–20 (5 nights)
Leg 2: Porto, Portugal — Jun 20–24 (4 nights)
Leg 3: Madrid, Spain — Jun 24–29 (5 nights)

Suggest 5–6 activities PER leg. Mark each activity with the leg it belongs to.
```

This is a meaningful prompt change. Worth doing alongside PHI-33's UI ship, OR splitting: PHI-33 ships the schema + UI for entering multi-leg, then a follow-up extends the prompt for actual multi-leg activity generation.

**Recommend:** ship PHI-33 with the schema + UI but keep activity generation single-leg for now (use `legs[0]` as the "primary destination"). Mark a follow-up ticket for "multi-leg activity generation" as a Q2 item. Multi-leg in the data model unblocks PHI-34 even if we don't fully exploit it yet.

---

## 7 · Edge cases

| Case | Behaviour |
|---|---|
| User adds a leg with no place | Disallowed; require place before save. |
| User's leg dates exceed trip envelope | Soft-correct (clip to envelope) with a visible warning, OR ask the user to extend the envelope. Recommend: soft-correct + warning. |
| User reorders legs | Allowed; resort by `startDate` on save. |
| User deletes the only leg | Treat as deleting the destination. Either disallow or roll back to the welcome step. |
| Existing single-destination trip is edited | Read from `legs[0]` if present, else from legacy `destination`. Write to both `legs` and legacy fields during the transition window. |
| Anonymous session (PHI-31) has its own `legs` field | Yes — PHI-31's design doc adds `legs` to the anon session schema in parallel. Keep them aligned. |

---

## 8 · Test plan

- **Unit:** `lib/trip-schema.ts` validators against 20+ fixture legs (valid + invalid).
- **API:** PATCH `/api/travelers` with single-leg, multi-leg, and edge cases (empty, overlapping, out-of-envelope).
- **Migration:** before/after snapshot of the `travelers` table on a staging DB. Verify backfill creates correct single-leg arrays for existing rows. Verify legs JSONB is queryable via standard operators.
- **Playwright:** add a multi-leg path to the welcome spec once UI ships (skip for v1; will land with the multi-leg UI ticket).

---

## 9 · Implementation order

1. **Day 1:** Schema migration (alter table + backfill). Run on staging, snapshot before/after.
2. **Day 1:** `lib/trip-schema.ts` with TypeScript types + validators. Unit tests.
3. **Day 2:** Update `/api/travelers` POST/PATCH to read/write `legs`, with legacy column mirroring on write.
4. **Day 2–3:** Update step-3 / new step-2 (combined trip details) UI to render the leg list. Single-leg path keeps current look; multi-leg adds the leg-card UI.
5. **Day 3–4:** Wire `/api/anonymous-session` (depends on PHI-31). Same legs field there.
6. **Day 4–5:** QA, especially the migration on staging. Manually verify a handful of existing rows look right post-backfill.

**Estimate:** 3–5 dev-days. **Sequencing:** ship before PHI-34. Recommend after PHI-31 (so anon session has the legs schema from day one).

---

## 10 · Open questions for sign-off

1. **Drop legacy columns when?** Recommend: keep through Sprint 3, drop in a Q2 follow-up.
2. **Multi-leg activity generation:** include in PHI-33 or split?
3. **Per-leg cost / time-zone fields:** worth adding now (cheap to add later, but easier to migrate one column than many)?
4. **Initial leg's `id`:** UUID or short slug? UUID is safer; slugs are friendlier in URLs but we don't expose leg IDs in URLs anyway.

---

**Ready for sign-off when:** Sarah confirms the legs+envelope model fits the PRD she's writing for PHI-34. After sign-off, migration + code can begin.
