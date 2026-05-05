# Sprint 2 — Trust + Activation (2–4 weeks)

Three tickets. Higher complexity than Sprint 1 — at least one schema change and
a third-party integration. This is where the activation lift lives.

---

## RISE-201 · Replace silent destination auto-correct with disambiguation dropdown

**Type:** Feature · **Effort:** M (3–5 days) · **Priority:** P0
**Owner suggestion:** Full-stack

**Why (PM):**
The single most trust-damaging behavior I observed: typing "Lisbon, Portugal"
silently became "Cascais, Portugal." Silent input override on the *very first*
field of an AI product is a category-breaker — users learn that the system
doesn't trust their input, so why should they trust its output? Also a
pre-requisite for multi-city support (Sprint 3 / Q2).

**UX (Designer):**
Standard typeahead pattern.

- As the user types, fetch and display up to 5 matching place suggestions in a
  dropdown below the input.
- Each suggestion shows: place name, region/country, type-icon (city, region,
  country, neighborhood).
- User must select a result before "Start planning" is enabled. Free-form
  unmatched input is *not* accepted (with one escape hatch — see below).
- **Escape hatch:** if no results match, show a "Use \"{query}\" anyway →" link.
  Tag this in the data model as `unverified: true` and let the model handle it
  with a "we'll do our best" caveat.
- After selection, the chosen place displays as a chip in the input, like a
  contact pill in an email composer. Clicking the chip clears it.
- For Sprint 2, single destination only. (Multi-city is Q2.)

**Build (Tech Lead):**
- Pick a place service: Google Places Autocomplete API (most accurate,
  paywalled) vs. Mapbox Geocoding (cheaper, very good) vs. Photon/OSM (free,
  inconsistent for tourism). **Recommendation: Mapbox** — strikes the best
  balance for a v1 product.
- Add a thin server endpoint `/api/places/suggest?q=...` that proxies and caches
  responses (caching by lower-cased query string for 24h is fine).
- Persist the selected place as `{ id, displayName, country, lat, lng, type }`
  rather than a free-string. Future-proofs for Sprint 3 free-form input which
  also needs to resolve places.
- Debounce input by 250ms to control API spend.

**Acceptance criteria:**
- [ ] Typing "Lisb" shows a dropdown including "Lisbon, Portugal" within 500ms.
- [ ] User cannot continue without selecting a result OR explicitly using the
      "Use anyway" escape.
- [ ] Selected place persists structurally (id, lat, lng) — verified in network
      payload.
- [ ] No silent override of typed text under any circumstance.
- [ ] Selected place appears as a chip; clicking the chip clears and reopens
      the input.

---

## RISE-202 · Show generated itinerary BEFORE forcing signup (anonymous session)

**Type:** Architecture + Feature · **Effort:** M-L (5–8 days) · **Priority:** P0
**Owner suggestion:** Full-stack + Backend lead

**Why (PM):**
The biggest activation lever. Four of five personas flagged forced-signup as
drop-off risk. The product's "aha moment" — seeing a personalized day-by-day
itinerary — should happen *before* the signup wall, not after. Signup gates
*saving + return*, not first viewing. This is the standard B2C pattern for AI
products in 2026; doing otherwise is leaving activation on the table.

**UX (Designer):**
- After step 4 (activity rating), the user sees the generated itinerary —
  full screen, scrollable, day-by-day.
- Light persistent banner at the top: "Save your plan to keep it forever or
  edit later." with a "Save trip" CTA.
- Soft inline prompts after meaningful interactions (e.g., editing an
  activity, downloading): "To save changes, create a free account."
- After ~30 seconds of viewing or on certain actions (share, edit, refresh),
  surface a modal signup with the same "Save" pitch.
- Critically: signup is *available* but never *required* for first viewing.

**Build (Tech Lead):**
The architecture change is: state moves from client-side ephemeral to
server-side anonymous-session.

Steps:
1. **Anonymous session creation:** on first onboarding step (or first request),
   set an HttpOnly cookie `rise_session_id` keyed to a server-side row in
   a new `anonymous_sessions` table.
2. **State writes:** every onboarding step writes the partial trip state to
   that session row. Today's client-side state stays as a UX nicety (instant
   rendering) but the server is the source of truth.
3. **Itinerary generation:** runs on submit of step 4, persisted to the same
   session.
4. **Signup "claim" flow:** when user signs up, the new account row gets
   `claimed_session_id = rise_session_id`, and trips are migrated from the
   anonymous session to the user's account in a single transaction.
5. **GC policy:** anonymous sessions older than 30 days with no claim get
   pruned. Document this clearly for privacy review.
6. **Edge cases:** user opens a 2nd tab; user clears cookies; user signs up
   from a different device. Document each in the design doc.

**Privacy / data note:** the anonymous session contains PII-adjacent travel
intent. Consider whether this changes your privacy policy (likely yes — disclose
"we collect trip details before signup to deliver previews; this is retained for
30 days unless you create an account.").

**Acceptance criteria:**
- [ ] User completes steps 1–4 without signing up; sees the full itinerary on
      step 5 (was previously the signup wall).
- [ ] Save button on the banner triggers the existing signup flow; on success,
      the trip is automatically attached to the new account.
- [ ] Closing the browser and reopening within 30 days from the same browser
      restores the trip from the anonymous session.
- [ ] On signup, server-side trip data is correctly migrated and the
      anonymous session row is marked `claimed`.
- [ ] Pre- vs. post-signup conversion is measurable in analytics
      (event: `itinerary_viewed`, `signup_initiated_after_itinerary`,
      `signup_initiated_pre_itinerary`).

---

## RISE-203 · Per-activity "why this" rationale

**Type:** Feature · **Effort:** S-M (2–4 days) · **Priority:** P1
**Owner suggestion:** Full-stack with prompt-eng

**Why (PM):**
Trust-sensitive personas (Sam & Chris, Anjali) consistently want to know *why*
an activity was picked. This is one of the cheapest ways to lift trust in any
AI product: make the model show its reasoning. ~50 tokens per card. Likely
also reduces "Not for me" rates because users self-correct misunderstandings
when they see the model's logic.

**UX (Designer):**
- Each activity card gains a small "Why this →" link/button below the
  description.
- Clicking expands a short rationale (1–2 sentences) in plain language:
  *"Picked because you flagged kid-friendly and your hotel is 8 minutes' walk
   from here."*
- Default state: collapsed (don't add visual noise). Expanded state: tinted
  background to distinguish.
- On mobile, an expanded card shouldn't push other cards offscreen — limit
  height with internal scroll if needed.

**Build (Tech Lead):**
- Update the activity-generation prompt to also return a `rationale` field per
  activity. Constrain length (target ≤25 words, reject if >40).
- API contract change: activity object gains a `rationale: string` field.
- Frontend: lazy-render the rationale only on expand (so the model can produce
  rationales for *all* cards but the user only sees them on demand). Or
  produce inline if cheaper.
- Telemetry: log `rationale_expanded` events. This tells you whether users
  actually want this — if expansion rate is <5%, consider deprecating.

**Acceptance criteria:**
- [ ] Every activity card has a "Why this" affordance.
- [ ] Expanding shows a 1–2 sentence rationale that references at least one
      user-supplied input (party size, ages, style choices, hotel location).
- [ ] Manual review: pick 10 random activities across 3 personas; rationales
      should correctly cite the relevant signal in 9/10.
- [ ] Rationale is announced to screen readers when expanded.
- [ ] Telemetry event fires on expand.

---

## Sprint 2 totals

| Ticket | Effort | Impact |
|---|---|---|
| RISE-201 Destination disambig | M | Critical (trust foundation, multi-city prereq) |
| RISE-202 Pre-signup itinerary | M-L | Largest activation win available |
| RISE-203 Why this rationale | S-M | Trust lift; cheap to ship |

**Total estimate:** ~10–17 developer-days · ~3 designer-days · ~1 day prompt-eng.

**Definition of done for Sprint 2:**
- All three tickets shipped
- Pre-signup itinerary view rate measured for at least 14 days
- Conversion funnel measured: % completing onboarding → % seeing itinerary →
  % signing up → % returning within 7 days
- One round of LLM cost monitoring (RISE-203 adds tokens per session)

**Risks worth flagging:**
- **RISE-202 anonymous session privacy:** disclose clearly in privacy policy;
  may need a brief legal review depending on jurisdiction (GDPR, CCPA).
- **RISE-201 third-party dependency:** Mapbox uptime, rate-limits, billing.
  Implement aggressive caching and a clear fallback if the API is down.
- **RISE-203 prompt regression:** rationales may sometimes be wrong or
  hallucinated. Worth a confidence threshold or a "this is AI-generated"
  caveat — or at minimum, easy reporting affordance.
