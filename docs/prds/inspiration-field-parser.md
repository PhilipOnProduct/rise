# PRD — Inspiration field in free-form parser

**Author:** Sarah (PM)
**Status:** Refined — ready for Linear
**Date:** 2026-05-06 (refined same day)
**Card type:** Improvement (regression recovery)
**Linear:** _to be created_
**Refinement contributors:** Maya (Design), Luca (Tech Lead), Elena (Travel Expert)

---

## Overview

Add an optional `inspiration` field to the free-form trip parser so that creative themes the user types into the welcome landing — books, films, franchises, hobbies, eras, people — are captured, confirmed back to the user as a chip, and used as a soft bias in activity generation. This restores a behaviour Rise had in an earlier version, where prompts like *"Harry Potter inspired family trip throughout the UK, starting in London"* produced thematically-relevant suggestions. Today the parser silently drops the theme.

## Problem Statement

The free-form parser at `/api/parse-trip` converts a trip description into a structured `TripIntent` (lib/trip-intent.ts). The schema captures destinations, dates, party, style tags, budget, occasion, and constraints — but has no field for creative inspiration. As a result, when a user types *"Harry Potter inspired family trip throughout the UK"*, the parser produces a TripIntent with `destinations: [UK, London]`, `party: { adults: 2, children: [...] }`, `styleTags: ["Kid-friendly", ...]`, and either drops the "Harry Potter inspired" phrase entirely or — at best — stuffs it into `constraintText` as a verbatim string that no downstream prompt reads.

Downstream consumers (`lib/activity-gen-prompt.ts`, `/api/itinerary/generate`, `/api/itinerary/edit`) bias their suggestions on structured chips only. The themed signal never reaches them. The user receives a generic family-friendly UK itinerary indistinguishable from what they would get from a competitor that doesn't accept free-form input.

The user-facing symptom is silent loss: Philip typed something meaningful, Rise gave no acknowledgement that it understood, and the resulting itinerary doesn't reflect it. This erodes the central value proposition of the free-form parser — that Rise can act on intent expressed in the user's own words.

## User Need

A traveller who has an emotional or creative thread for their trip — a child who has just discovered a book series, a couple recreating a favourite film, a friend group leaning into a music genre, a family planning a trip "in the footsteps of" a historical figure — wants Rise to acknowledge that thread and lean into it where it makes sense, without forcing it. The user is not asking for a theme park; they are asking for one or two "this is the real thing" moments per leg, woven into an otherwise normal trip that still respects their party composition, budget, and stamina.

The need also has a defensive dimension: if Rise can't capture this kind of input, the free-form parser is a worse experience than a structured form, because it raises an expectation it then quietly fails. Better to delete the textarea than to ignore half of what the user typed.

## Proposed Solution

We add an optional `inspiration` field to `TripIntent` and the `parse_trip_intent` tool input schema. The parser system prompt receives extraction rules grounded in the phrasings real travellers use, with explicit guardrails against the patterns Elena flagged as common confusions:

- Extract `inspiration` when the user uses an anchor phrase: *"X-inspired"*, *"inspired by X"*, *"in the footsteps of X"*, *"like in [film/book/show]"*, *"themed around X"*, *"we want to do some X stuff"*, *"a [genre] trip"*, *"in honour of X"*.
- Never infer from destination alone (Paris ≠ Amélie, Tokyo ≠ anime).
- Never extract from negation patterns (*"not too touristy"*, *"avoid the Eat-Pray-Love itinerary"*) — these are constraints, not inspirations.
- Personal-history inspirations (*"in honour of my grandmother"*, *"my dad served in Vietnam"*) are valid `inspiration` values. They will not match a curated atlas and shouldn't try to — the soft-bias prompt handles them by tone, not content.

On the chip-confirmation screen, an extracted inspiration appears as an editable chip rendered as *"Inspired by: Harry Potter"* — same edit and remove affordances as destination, dates, and adults. This matters because the chip is the user's only visible signal that Rise heard them; without it the field would be silent again. The chip sits below constraint chips in the visual hierarchy: constraints are life-impacting, inspiration is mood-flavouring, and they cannot read with equal weight. Constraints retain the existing amber accent; inspiration gets the neutral teal of the rest of the chips. Edit mode opens a plain-text input — no autocomplete in v1 (autocomplete is the curated atlas in disguise).

Two prompt-injection strings are added across three sites. The shared multi-item-generator string (used by `lib/activity-gen-prompt.ts` for the onboarding activity preview, and by `/api/itinerary/generate` for full itinerary generation): *"Inspiration: the traveller wants this trip to lean into '${inspiration}' where natural. Don't force it. Only suggest theme-relevant items if a real, high-quality option exists in the destination. One or two strong themed moments per leg is the goal — not every activity."* The single-slot edit string (used by `/api/itinerary/edit`): *"Inspiration: the traveller has stated '${inspiration}'. The replacement must match the original slot's category first and the inspiration second — don't pivot a dinner suggestion into a museum just because the museum is more themed. Only suggest theme-relevant items if a real, high-quality option exists. Apply the standard hallucination guard: never invent themed locations."*

In the activity preview header (Step 4), when `inspiration` is present AND the generated cards reference the theme on fewer than half of them, surface one line: *"We heard '${inspiration}' — leaning into it where we can."* This is the trust signal that explains the soft bias when it doesn't visibly land. When most cards are themed, the bias is self-evident and the line is suppressed. Theme-reference detection is a post-stream substring check on card titles and descriptions against the inspiration value plus a small list of known synonyms — kept simple, not a parser pass.

We deliberately do *not* build a "themed atlas" lookup (curated POI database for major franchises, predetermined leg suggestions for Wizarding-World UK trips, etc.) in this iteration. That is a real feature with real value but it is a 5-10x scope increase, and we want to ship the soft-bias version first to learn whether themed input lifts the engagement metric we care about.

## User Stories

A parent typing *"Harry Potter inspired family trip throughout the UK, starting in London"* sees a chip-confirm screen that includes *"Inspired by: Harry Potter"* alongside the destination and party chips. They can edit it (typo, change to a different book in the series), remove it (changed their mind, want a generic trip), or accept it as-is. The activity preview that follows surfaces themed activities where they exist — Warner Bros Studio Tour in London, Alnwick Castle on the way north — woven into a normal family itinerary, not as a checklist.

A user typing *"weekend in Lisbon, food-led, late 30s couple"* sees no inspiration chip because no theme was named. The flow behaves identically to today.

A user typing *"romantic Paris trip like in Amélie"* sees the chip *"Inspired by: Amélie"*. The activity generator surfaces Café des Deux Moulins in Montmartre and Sacré-Cœur photo spots where it can do so without inventing things, but does not stuff every meal into a film-set parallel.

A user removes the inspiration chip after seeing it. Activity generation reruns without the bias. No silent persistence of the dropped value.

## Success Metrics

The primary metric is thumbs-up rate on activity preview cards (Step 4 of onboarding) for trips that came in with an `inspiration` value vs. trips that did not. We expect themed trips to out-rate baseline by a non-trivial margin — if they don't, the soft bias isn't earning its keep and we should reconsider before investing in the curated atlas. A secondary signal is whether users edit or remove the inspiration chip on the confirm screen: high removal rates would indicate the parser is over-extracting (catching things the user didn't mean as themes).

A negative-direction metric to watch: hallucination flag rate in the location eval. If injecting a theme causes Sonnet to invent themed locations that don't exist, that's a quality regression we cannot ship.

## Technical Considerations

This is a small, contained change spanning the parser schema, the welcome page chip UI, and three prompt-injection sites. The shape is well-understood; the eval harness exists; cost impact is below the noise floor on the multi-leg cost report.

The single architectural decision worth flagging is the choice to keep `inspiration` as a free-text string rather than a structured taxonomy. A taxonomy would let us power the curated atlas in a future iteration, but it would also forclose creative inputs that don't map to a known franchise (a TV show that aired last month, a niche hobby, a personal connection like "in honour of my grandmother who was born in Krakow"). Free-text is the correct shape for the soft-bias version; if and when we build the atlas, we add structured tagging on top of it without breaking the free-text contract.

The hallucination guard in the activity-gen prompt — *"only suggest theme-relevant items if a real, high-quality option exists"* — is load-bearing. Without it, Sonnet at default temperature will invent a Wizarding-World cafe in Edinburgh. The location-eval harness (`scripts/eval-itinerary-location.ts`) is the right tool to verify this; we add a themed trap case before merging.

## Risks & Open Questions

The biggest risk is silent hallucination: themed activities that sound right but aren't real. Mitigation is the prompt guard plus an eval trap case; residual risk is that Sonnet still slips occasionally on edge cases. We accept this in exchange for the value lift, and we monitor via the existing AI logs and user feedback.

A secondary risk is over-extraction — the parser deciding "Paris" implies an Amélie inspiration, or "Tokyo" implies anime. The system prompt rule *"Never infer from destination alone"* addresses this directly, and the eval harness can verify it.

Resolved during refinement:

- Removal of the chip strips the field locally; the parser does not re-run.
- Plain-text edit only in v1; no autocomplete.
- `inspiration` is logged to `activity_feedback.metadata` (the existing PHI-45 jsonb column) per onboarding session. This is the join key for the success-metric query — without it the metric is unmeasurable.

Open questions deferred to follow-up cards:

- Ambiguous-extraction UI. Maya proposed *"Theme: Harry Potter?"* with tap-to-confirm for low-confidence extractions. Deferred until eval data shows whether the ambiguity rate justifies the extra state.
- Child-age-weighted inspiration biasing. Elena's note: a family with a 7-year-old typing *"Harry Potter inspired"* wants the theme threaded through three or four moments; two adults typing the same phrase want one Warner Bros visit and a nice dinner. The activity-gen prompt currently treats these the same. v2 refinement, separate card.
- Weather-aware outdoor pairing. Elena flagged the broader problem: themed trips with families are the case where outdoor-without-wet-weather-alternative bites first (Glenfinnan in November), but the problem applies to all outdoor activity suggestions. Filed as a separate, larger card.

## Claude Code Implementation Prompt

Implement an optional `inspiration` field on the free-form trip parser, surface it as an editable chip on the welcome chip-confirmation screen, and inject it as a soft bias into activity and itinerary generation prompts.

Sequencing constraints: complete the schema and parser changes first, then the chip UI, then the prompt injections. Each phase should be independently testable. Eval coverage must be added before any prompt edit is committed — both `eval:parser` and `eval:location`.

Hard constraints on data flow:

- `inspiration` is optional and may be `undefined` at every consumer. No defaults, no inference from other fields.
- The parser must extract `inspiration` only when the user clearly named a creative inspiration. Do not infer from destination, party shape, or style tags.
- Removal of the inspiration chip strips the field from local state only; do not re-run the parser.
- Activity-gen and itinerary-gen prompts must include the hallucination guard verbatim: *"only suggest theme-relevant items if a real, high-quality option exists in the destination."*

Hard constraints on prompt strings:

- The shared multi-item string is used identically by `lib/activity-gen-prompt.ts` and `/api/itinerary/generate/route.ts`. They must reference the same constant — do not duplicate the string in two places.
- The single-slot edit string is used only by `/api/itinerary/edit/route.ts`.
- Both strings carry the hallucination guard verbatim: *"Only suggest theme-relevant items if a real, high-quality option exists in the destination."*

Files to touch:

- `lib/trip-intent.ts` — add `inspiration?: string` to `TripIntent`, add to `TRIP_INTENT_TOOL.input_schema.properties` (NOT in `required`), handle in `coerceTripIntent`.
- `app/api/parse-trip/route.ts` — add extraction rules: anchor phrasings, never-infer-from-destination, negation exclusion, personal-history acknowledgement.
- `app/welcome/page.tsx` — render the inspiration chip on the chip-confirm screen below constraint chips with edit (plain-text) and remove affordances; thread `inspiration` through `applyParsedIntentAndAdvance` and the trip state. Add the activity-preview header line gated on theme-reference count.
- `lib/activity-gen-prompt.ts` — export `INSPIRATION_MULTI_ITEM_INJECTION` constant and append to the user message when `inspiration` is present.
- `app/api/itinerary/generate/route.ts` — import and inject the same constant.
- `app/api/itinerary/edit/route.ts` — define `INSPIRATION_EDIT_INJECTION` (single-slot, category-first) and inject when present.
- `app/api/activity-feedback/route.ts` — add `inspiration` to the metadata payload it accepts.
- `app/welcome/page.tsx` — pass `inspiration` into the `activity-feedback` calls during the onboarding flow.
- Parser eval (`scripts/eval-parser.ts` or equivalent) — add four cases: (a) clear theme extracted, (b) destination alone does not trigger extraction, (c) ambiguous theme returns clarification, (d) constraint-preservation gate holds when an inspiration is also present (e.g. *"Harry Potter inspired family trip, no peanuts, the youngest is allergic"*). Existing gates apply: ≥85% field accuracy, 100% on constraint preservation.
- `scripts/eval-itinerary-location.ts` — add a themed trap case where the inspiration biases toward a famous-but-wrong-city POI (e.g. *"Harry Potter inspired Edinburgh trip"* must NOT suggest Warner Bros Studio in Watford; it should suggest Greyfriars Kirkyard, the Elephant House, or Victoria Street).

Quality validation is the founder's responsibility. Run `npm run eval:parser` and `npm run eval:location` before merge; both must pass at the existing gates.

---

## Sign-off

- [x] Sarah (PM) — refined and ready for Linear
- [x] Maya (Design) — chip label, edit/remove affordance (plain-text v1), visual hierarchy below constraint chips, empty-state line in activity-preview header
- [x] Luca (Tech Lead) — optional schema field, two prompt-injection strings (shared multi-item + single-slot edit), four-case parser eval, themed location trap, `activity_feedback.metadata` logging
- [x] Elena (Travel Expert) — anchor phrasings list, negation exclusion, personal-history acknowledgement; child-weighted biasing and weather-pairing filed as separate follow-up cards

## Follow-up cards (filed separately, not in this PRD's scope)

- **Child-age-weighted inspiration biasing** — when the party includes a child in the inspiration's natural age band, weight the theme more heavily in activity-gen.
- **Weather-aware outdoor pairing** — pair every outdoor activity suggestion with a wet-weather alternative; broader than themed trips but bites first there.
- **Curated themed atlas (v2)** — structured POI database for major franchises, predetermined leg suggestions. Only build if the soft-bias version proves the lift.
