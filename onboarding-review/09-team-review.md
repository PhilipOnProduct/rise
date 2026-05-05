# Team review — Onboarding tickets (PHI-25 → PHI-35)

Round-robin team review per ticket. Roles per `TEAM.md`:

- **Sarah** — Product Manager (value, outcome, smallest valuable version)
- **Maya** — Product Designer (usability, all states, accessibility, copy)
- **Luca** — Tech Lead (architecture, what's just-now possible, Rise stack: Next.js 16, Supabase, Anthropic API, Vercel, Google Maps)
- **Elena** — Travel Expert (15 years senior travel planner; traveller reality)

**Mode:** Build (per TEAM.md default — ship the smallest end-to-end version, learn from shipping).

> Note: the persona "Mira" in the onboarding review was renamed from "Maya" to avoid clash with Maya the Designer.

---

## PHI-25 / RISE-101 — Fix duplicate body text on signup screen *(Bug · P0)*

**Sarah:** Pure trust win. Don't overthink it. Smallest version: ship the fix, no analytics needed. Watch for it on other screens too — if the same component is reused elsewhere, fix once.

**Maya:** Confirmed the duplicate is a copy-paste from the heading area into the body slot. While we're in there, audit the screen's spacing — the duplicate currently masks a slightly anaemic empty state. Add a visual regression snapshot to prevent regression.

**Luca:** Trivial. One file, one prop. I'll grep the component tree for the same string in case it appears on related screens. ETA <2h. Will add a Playwright/visual snapshot for the screen since we don't have one yet.

**Elena:** Travellers in trust-deficit mode (older, high-stakes trip) read every word on the signup screen. Duplicate text makes them assume the whole product is undercooked. Fix is right; nothing to add from a travel POV.

**Synthesis:** Ship it. No scope creep. Add visual regression coverage on this screen as a side-effect.

**Agreed next step:** Luca picks it up; PR includes snapshot test. No spec needed.

---

## PHI-26 / RISE-102 — Persistent trip-type confirmation label *(Improvement · P0)*

**Sarah:** Real activation lever for two underserved segments (solo, family). Outcome to track: completion rate of the profile step for Adults=1 and Children>0 cohorts vs. Adults=2/Children=0. If the gap closes, we know it worked. Smallest valuable version is the label — defer fancy chip animations.

**Maya:** Three sub-states matter — *transitioning* (one chip selected, second click toggles), *no-fit* (3 adults + chip shown but neither matches), *aria-live* announcement when label changes. Don't centre the label; place it left-aligned above the section header so screen readers naturally read it before the inputs. Mobile: keep label single-line; truncate the kid-age list at 2 ages (e.g., "with 2 children, ages 5–8 +1 more").

**Luca:** Pure derived state. Add a `tripDescriptor` selector that takes (adults, children, ages, chip) and returns the label string. Test it as a unit. No backend change. ~3 hours including tests.

**Elena:** This is the biggest "the system sees me" moment in onboarding. Travellers feel invisible to most travel products *unless* they fit "couple" or "family." A solo traveller reading "Planning a solo trip" silently exhales. One travel-reality nuance: avoid "couple's trip" copy when the two adults are travelling as friends — many friend-pairs bristle at being called a couple. Default the 2-adult ambiguous case to chip-still-visible (already in spec — keep it).

**Synthesis:** Ship as specced. Track completion rate by party-type cohort. Watch for any user reports of unwelcome "couple" framing — if more than a handful, default 2-adult to "Two of us" without commitment.

**Agreed next step:** Maya designs the three sub-states (transition, no-fit, mobile-truncation); Luca builds the selector and ships behind feature flag.

---

## PHI-27 / RISE-103 — Add 13–17 age bucket; remove "Under 2" pre-selection *(Improvement · P1)*

**Sarah:** Two changes, one ticket. The teen bucket is a feature; the default fix is a bug. Both should ship together because the no-default validation rule needs the new bucket to make sense. Outcome: family-trip itineraries that include teens differ meaningfully from toddler itineraries (manual QA in 3 destinations is the right gate).

**Maya:** "Under 2" preselected is a dark pattern by accident. Empty default + disabled Continue + inline error on hover/focus is the right model. Don't use a tooltip — many travellers won't see it. Inline copy: *"Pick an age range for each child so we match the right activities."* On mobile, chips wrap; ensure the "Continue" button stays sticky-bottom so users see the disabled state.

**Luca:** Adding the enum value is trivial. The interesting bit is the prompt — "Kid-friendly" as a chip name is wrong for teens. Two options: (a) rename to "Family-friendly", (b) split into "Kid-friendly (under 12)" and "Teen-friendly (13–17)". Recommend (b) — more signal for the model. ETA: 4 hours including a prompt-eval pass on 5 sample family inputs.

**Elena:** Teens are the most under-served family travellers in this category. They are NOT little kids — they want some autonomy, hate "kid" framing, and respond to different content (urban exploration, food markets, adventure sports, photo spots). Splitting "Kid-friendly" vs. "Teen-friendly" (Luca's option b) is the right call from a travel POV — it changes activity selection materially. One more ask: when ages 13–17 are present, the activity pool should also include *near-adult* options the family might enjoy together (vineyard tour, cooking class, kayaking) that you'd never serve to a 5-year-old's family.

**Synthesis:** Ship Luca's option (b). The prompt change is the real payoff — without it, the teen bucket is cosmetic. Add Elena's "near-adult activities" guidance to the prompt.

**Agreed next step:** Luca writes the prompt update + 5-input eval; Maya designs the empty-default error state.

---

## PHI-28 / RISE-104 — Larger rating buttons + Skip affordance *(Improvement · P1)*

**Sarah:** Rating quality drives every downstream personalization decision. The Skip signal is the missing third option that cleans up our training data — today, "no rating" is ambiguous (didn't see, didn't decide, didn't care). Worth the day of work.

**Maya:** 44×44 is non-negotiable for accessibility and mobile. While we're touching the cards, consider hover states on desktop and active-press feedback on mobile. Skip should look distinctly tertiary — a small text link below the card, not a third equal-weight button. Counter copy update is a single change in the existing string. Add keyboard shortcuts (←/→ for thumb down/up, space for Skip) — power users will love this.

**Luca:** The schema change is trivial — add `'skipped'` to the rating enum. The bigger Q is whether we surface "skipped" cards differently in the next batch of AI-generated activities. Build mode says: ship the signal, defer the use of it. Track `skipped_count` per session; analyze later. ~1 day.

**Elena:** Travellers genuinely don't always know if they'd like an activity until they have more context. "Skip" lets them pass without lying. From a travel POV, the strongest signal is actually *neither* thumb but a "tell me more" — a follow-up that gives them more detail before deciding. That's a future iteration; for now Skip is the right minimum.

**Synthesis:** Ship as specced + keyboard shortcuts (Maya's add). Don't change activity-generation behaviour based on Skip yet — log it, learn later. Park "tell me more" as a future iteration.

**Agreed next step:** Maya designs the Skip affordance + keyboard hint; Luca ships the enum change and analytics event.

---

## PHI-29 / RISE-105 — Step counter cleanup *(Improvement · P2)*

**Sarah:** Cosmetic. If we're shipping PHI-33 (combined trip details) within 4–6 weeks, this resolves itself. Don't spend time on Option B. Defer.

**Maya:** Agreed with Sarah. The "1/5 starting at dates while destination is a pre-step" inconsistency is real but minor. If we *must* fix in Sprint 1, it's a one-line constant. Otherwise it gets cleaned up by PHI-33's restructure.

**Luca:** Option B is 30 minutes. Option A is structural and lives in PHI-33. My vote: include the 30-minute fix in Sprint 1 only if we have a 30-minute slot — otherwise drop and let PHI-33 handle it.

**Elena:** Travellers don't count steps; they feel friction. The off-by-one isn't friction — it's a numerical curiosity. Skip from a travel POV.

**Synthesis:** **Defer.** Mark this ticket as blocked-by PHI-33 and let it auto-close when PHI-33 ships. If anyone has 30 spare minutes, Option B is fine.

**Agreed next step:** Add a relation: PHI-29 blocked-by PHI-33. Move PHI-29 priority to Low (already Low). Don't actively work on it.

---

## PHI-30 / RISE-201 — Destination disambiguation dropdown *(Feature · P0)*

**Sarah:** Foundational. Trust + multi-city prereq + free-form input prereq, all in one. Sprint 2's most important ticket. The smallest valuable version is single-destination, no escape hatch — but Maya's escape-hatch design is a small add and prevents user lockout, so include it.

**Maya:** Standard typeahead is well-understood; don't reinvent. Borrow patterns from Booking.com or Airbnb — paint suggestions appear ~250ms after the last keystroke, with type-icon (city / region / neighborhood / country). Empty state: don't show the dropdown if the field is empty. Loading state: subtle skeleton row, not a spinner. Selected state: the chip pattern is right — make sure clicking the chip *clears* and re-opens, not toggles.

**Luca:** Mapbox is the right call for v1. Google Places is more accurate for tourism but ~3x cost; revisit when revenue justifies. Cache the lower-cased query → suggestion list for 24h; invalidate weekly. Persist the selected place as a structural object — this matters for PHI-34 (free-form parsing also resolves places via this endpoint). ETA 3–5 days including the chip UI and backend caching layer.

**Elena:** This is where my expertise actually matters most. Travellers DO NOT type place names the way databases store them. Real input examples I've seen:
- "the Amalfi Coast" (region, not a city — Mapbox handles regions, but our UI must accept them)
- "Lisboa" vs. "Lisbon" (local-language vs. English — make sure both surface the same place)
- "Portugal" (whole country — should be valid for "I haven't decided which city")
- "New York" (means Manhattan, but Mapbox returns the state) — UI should rank "New York City" above "New York State"
- "JFK" or "CDG" (airport codes — common shorthand for "I'm flying into")
- "St. Lucia" (typo-prone; "Saint Lucia" should match)
- "Disneyland Paris" (a place AND a hotel AND an attraction — be charitable)

**Recommendation:** the dropdown should show place *type* clearly, and the design should accept regions/countries as legitimate destinations (not just cities). Multi-city support coming in Sprint 3 helps here — "Portugal" can become "the user is open to multiple cities in Portugal."

**Synthesis:** Ship Mapbox-backed typeahead with the chip pattern. Critically: support regions and countries (not just cities) — Elena's input changes the spec slightly. The data model needs a `placeType` field already (cities, region, country, neighborhood, POI).

**Agreed next step:** Sarah updates the spec to reflect Elena's region/country support. Luca scopes the Mapbox query parameters (`types=place,region,country,locality`). Maya designs the type-icon set.

---

## PHI-31 / RISE-202 — Pre-signup itinerary view (anonymous session) *(Feature · P0)*

**Sarah:** Biggest activation lever in the backlog. Track lift in `signup_initiated_after_itinerary` vs. baseline `signup_initiated_pre_itinerary`. Privacy disclosure is required and not optional — coordinate with whoever owns legal/policy.

**Maya:** Banner-vs.-modal-vs.-inline-prompt for "Save your trip" is the design fork. My recommendation: persistent slim banner (always visible) + soft inline prompt after 2 user actions (edit, share, refresh) + modal only if user tries to *leave* the page. Three escalating pressure points, not one nag. Empty state if generation fails: graceful retry with a "Save what we have so far" CTA.

**Luca:** Anonymous session is straightforward in our stack — Supabase row keyed by HttpOnly cookie. The interesting parts are the *claim* on signup (atomic transaction) and the *GC* policy (cron at 30 days). For multi-tab safety, use `SELECT ... FOR UPDATE` on the session row. Privacy: 30-day TTL is conservative; some jurisdictions might want shorter. ETA: 5–8 days, ~2 days of which is privacy disclosure work.

**Elena:** The single biggest thing I see in real trip planning is travellers wanting to *send the itinerary to someone* before booking. A husband, a friend, a parent. If pre-signup view supports a "share read-only link" affordance — even minimal — it converts solo viewers into multi-user prospects. Even if we don't build full sharing in this ticket, design the URL structure to support it (`/trip/<anon-session-id>/preview` works as a future-shareable link, but only with explicit user consent).

**Synthesis:** Ship as specced + Maya's escalation pattern. Hold the share affordance for a Q2 ticket but reserve the URL structure now (Luca: `/trip/<id>/preview` route, currently no-op without consent). Engage privacy/legal early in the sprint, not at the end.

**Agreed next step:** Sarah: privacy review kick-off this week. Luca: anon-session schema + URL structure design doc. Maya: prompt-escalation states.

---

## PHI-32 / RISE-203 — Per-activity "Why this" rationale *(Feature · P1)*

**Sarah:** Cheap trust win. Watch `rationale_expanded` event rate as the leading indicator — if expansion rate is meaningful (>15%), it's earning its keep. If <5%, deprecate next quarter.

**Maya:** Collapsed-by-default is right; expanded reveals 1–2 sentences. Don't allow rationales to push neighbouring cards offscreen — fix expanded card height with internal scroll on mobile. Tone: warm and specific, not a bullet list. Animation: 200ms ease-out, no bounce.

**Luca:** Prompt change is small. Output schema: `{ activity, rationale }` per item. Constrain rationale to ≤25 words; reject + retry once if too long. ~50 tokens × 6 cards = 300 tokens per session at $X/Mtok — negligible. Telemetry event ships with the feature. ETA: 2–4 days.

**Elena:** Rationales matter ENORMOUSLY in travel — they're how a knowledgeable friend recommends something. A bad rationale is worse than no rationale. Rules I'd push for in the prompt:
1. Never invent a connection. If the only reason is "matches your style chip", say so plainly — don't fabricate "and your hotel is nearby" if it isn't.
2. Cite *specific* user input ("you flagged kid-friendly", "your couple preference"), not vague "your interests".
3. For high-stakes constraints (mobility, dietary, accessibility), include the constraint in the rationale as a confidence signal: "wheelchair accessible per your note."
4. When the model is *uncertain* it satisfies a constraint, say so: "Likely accessible — please confirm." This builds trust faster than false certainty.

**Synthesis:** Ship as specced + Elena's four prompt rules. The "uncertain → say so" rule is especially important — it's where trust is built.

**Agreed next step:** Luca writes prompt v2 with Elena's rules; runs eval on 20 sample activities × 3 personas; targets 9/10 correct citation as acceptance criterion.

---

## PHI-33 / RISE-303 — Combined "trip details" step (dates + hotel + multi-stay) *(Improvement · P1)*

**Sarah:** Schema-touching ticket; sequence first in Sprint 3 because PHI-34 depends on the leg-based shape. Outcome: drop in friction (measured by step-3-completion rate) once dates and hotel are co-located.

**Maya:** Single screen with two stacked sections. For single-city trips, the "leg" abstraction is invisible to the user — just dates + optional hotel. For multi-city, per-leg cards appear after destination resolution. Keep "I haven't booked yet — skip" as a clear text link, removing the conflict between "Continue is enabled with empty field" and "skip link." Mobile: vertical stacking is natural; no special mobile design needed.

**Luca:** Schema migration: trip table gains `legs` (JSONB array). Existing single-destination trips become 1-leg arrays. Migration is read-time (lazy); writes go to new shape. Hotel autocomplete reuses `/api/places/suggest` with `category=lodging`. Validation: leg dates must be within trip dates OR absent (model auto-fills proportional). ETA 3–5 days including migration script.

**Elena:** Multi-leg is how real travel works for anything longer than 5 nights. Even single-city travellers often have a "first night near the airport, then move to centre" pattern. Allow per-leg dates explicitly. One real-world detail: travellers often book a *partial* multi-stay (leg 1 hotel known, leg 2 TBD). Make per-leg hotel optional independently of leg dates.

**Synthesis:** Ship as specced + Elena's "per-leg hotel optional independently of dates." Schema migration is the riskiest moving part — Luca to design it as a doc before code.

**Agreed next step:** Luca writes a 1-page schema migration design (legs JSONB, lazy migration). Sarah signs off. Maya designs single-leg vs. multi-leg layout switch.

---

## PHI-34 / RISE-301 — Free-form trip description as lead path *(Feature · P0)*

**Sarah:** Largest single move in the backlog. Differentiation thesis vs. ChatGPT free-tier. The smallest valuable version is *parser + confirmation chips + structured-form fallback link*. We do NOT need voice, multi-turn, or fancy parsing in v1. Ship it small; iterate on quality.

**Maya:** The confirmation-chip page is the safety net — without it, hallucinated parses ship to users. Each parsed field gets a chip; clicking opens an inline editor. Empty state: textarea with placeholder + 3 example prompts as one-tap chips below ("4 nights solo in Lisbon", "Family Portugal trip", "Two weeks Italy honeymoon"). Loading state during parse: animated dots + "Reading your trip..." message — reinforces the model's intelligence. Error state: parse failure → drop into structured form pre-filled with what was extracted.

**Luca:** Three new infra pieces: parser prompt, clarification system, place resolution wiring (existing from PHI-30). Use Anthropic's structured-output / tool-use mode to get reliable JSON. Temperature 0–0.2. Run a 50-input eval before launch. Cost ballpark: parser is ~500 input tokens + 200 output × $X/Mtok = small; the dominant cost remains activity generation. ETA 10–15 days, with 3 days of prompt iteration.

**Elena:** This is where Rise becomes real for travellers. Real users do think this way. Consider the inputs I've actually heard from clients:
- "Ten days in Italy, May, anniversary, food and wine, no hiking, my back hurts"
- "Bucket list trip — Japan in cherry blossom season, two weeks, foodie, photographer husband, mid-budget but treat ourselves once"
- "Long weekend somewhere warm, just need to escape, surprise me"
- "Family of 5, 7 nights, pool, kid club, all-inclusive, May half-term"
- "Following Eurovision in Basel — what to do for 3 nights, late May"

The parser must handle *vague-on-destination* ("somewhere warm") gracefully — that's a clarification, not an error. It must extract *anniversary / birthday / honeymoon* as a category that biases tone (romantic vs. casual). It must extract *health/mobility constraints* even when offhand ("my back hurts"). And it must surface *not-yet-decided* fields as clarifications, not silently skip them.

**Synthesis:** Ship Sarah's smallest version. Critically include Elena's vague-destination handling and the anniversary/honeymoon/birthday extraction — these are differentiators that ChatGPT won't get right out of the box. Defer voice, multi-turn refinement, and free-form-as-default to a v2 once we see usage data.

**Agreed next step:** Sarah writes the spec with Elena's input-pattern catalogue baked in. Luca runs the 50-input eval before code freeze. Maya designs the parsing → confirmation transition.

---

## PHI-35 / RISE-302 — Constraint expression *(Feature · P1)*

**Sarah:** High-stakes for trust-sensitive personas. Standalone-shippable (subset of PHI-34 logic). The smallest valuable version is the input + "MUST respect" prompt addition.

**Maya:** Free-text + chip pattern is the right balance — chips for common cases reduce typing; freetext for everything else. Selected chips fold into the textarea as comma-separated text but remain toggleable (like Apple Mail's recipient pills). Empty optional → no nag. Critical accessibility: the textarea needs proper labelling for screen readers — *"Anything we should know? Optional."*

**Luca:** Schema: `constraints: { freeText, tags[] }`. Prompt change uses "MUST respect:" prefix. Belt-and-braces validator: post-generation, scan activity titles + descriptions against hard-constraint tags (e.g., user said "no hiking" → filter activities containing /hike|trail|trek/i). Validator runs server-side; flagged activities are excluded silently from the rating step. ETA 4–6 days.

**Elena:** Constraints are where travel products either earn or lose trust permanently. The chip set should include the highest-stakes categories first:
- **Mobility:** "Wheelchair accessible only", "No long walks", "Step-free access"
- **Dietary:** "Vegetarian", "Vegan", "Halal", "Kosher", "Gluten-free", "Severe allergy (we'll ask which)"
- **Religious / cultural:** "Quiet at sunset (Ramadan)", "Modest dress required"
- **Family:** "Not late nights", "Stroller-friendly", "Kid menu required"
- **Other:** "Pet travels with us", "Sensory-sensitive", "Pregnancy considerations"

Two travel-reality nuances:
1. Some constraints are LIFE-IMPACTING (severe nut allergy at a foreign restaurant). The model MUST NOT silently ignore. If the chip "severe allergy" is present, ALL food activities should include explicit allergy info or be filtered out.
2. Some constraints are *partial* — "no long walks" doesn't mean "no walks". The prompt language matters.

Future iteration: tie constraints to activity-level metadata (Mapbox/Google Places have accessibility tags) so we can hard-filter, not just prompt-bias.

**Synthesis:** Ship as specced + Elena's prioritized chip set + the life-impacting constraint rule (severe allergy must trigger explicit info or filtering). Defer Mapbox accessibility-tag integration to Q2.

**Agreed next step:** Sarah finalizes the chip taxonomy with Elena's list. Luca writes the prompt + validator. Maya designs the chip → freetext fold-in interaction.

---

## Cross-cutting team observations

A few things came up across multiple tickets:

**1. Elena's input changes more specs than expected.** Her "regions/countries as valid destinations" (PHI-30), "near-adult activities for teens" (PHI-27), "rationale rules" (PHI-32), "free-form input pattern catalogue" (PHI-34), and "life-impacting constraint rule" (PHI-35) all materially change ticket scope. **Recommendation:** Sarah should circle back with Elena before each Sprint kickoff.

**2. Privacy / disclosure is its own workstream.** PHI-31 (anonymous session) needs legal coordination and shouldn't be left to the engineer to figure out. **Recommendation:** treat it as a parallel track owned by Sarah.

**3. Build-mode discipline is paying off.** The team review didn't add new tickets — it refined existing scope. We caught features creeping in (sharing in PHI-31, voice in PHI-34) and parked them. Stay disciplined as Sprint 3 unfolds.

**4. The Mira persona's name change (formerly Maya) should be reflected wherever the persona is referenced going forward.** All current docs are updated; if external materials reference "Maya the solo traveler", note the rename.

---

## Round-up: what changed in scope after team review

| Ticket | Change to scope after team review |
|---|---|
| PHI-25 | + visual regression snapshot test (Luca) |
| PHI-26 | + 3 sub-states in design (transition / no-fit / mobile-truncation), no scope change otherwise |
| PHI-27 | + split "Kid-friendly" → "Kid-friendly" + "Teen-friendly" chips; prompt update; "near-adult activities" guidance for teen families |
| PHI-28 | + keyboard shortcuts (←/→/space); defer Skip-aware activity selection |
| PHI-29 | **Defer.** Block on PHI-33; do not actively work on |
| PHI-30 | + region/country support in addition to cities; placeType field in data model |
| PHI-31 | + URL structure that supports future sharing (`/trip/<id>/preview`); + Maya's escalation pattern (banner → inline → modal-on-leave); + privacy/legal track |
| PHI-32 | + 4 prompt rules from Elena (no fabrication, specific citation, surface constraints, "uncertain → say so") |
| PHI-33 | + per-leg hotel optional independently of leg dates; + 1-page schema migration design before code |
| PHI-34 | + Elena's input-pattern catalogue (vague destinations, anniversary/honeymoon, mobility); 50-input eval pre-launch |
| PHI-35 | + Elena's prioritized chip taxonomy; + life-impacting constraint rule (severe allergy = explicit info or filter) |

The team's collective contribution: each ticket got at least one specific scope refinement. **Elena's travel-reality lens added the most net new requirements** — confirming the gap I had before this review.
