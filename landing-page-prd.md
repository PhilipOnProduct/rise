# Landing Page Rework — PRD

**Author:** Sarah (PM), with input from Maya, Luca, Elena, Noor
**Date:** 2026-05-06
**Status:** Direction-finding — pick one option, then write the implementation PRD

---

## Problem

The current `/` page is competent and cautious. The headline "Your next trip, thoughtfully planned" could appear on any premium travel product's homepage, which means it differentiates Rise from nothing. The aspects of Rise that are actually distinctive — the local-guide reputation system, family-aware planning (children's age constraints, pram access, nap windows), day-by-day pacing — are absent from the page. The single CTA forces every visitor through the same six-step wizard regardless of intent.

Tested against the team's archetype walkthroughs, the page tells the Bergmans (couple, two children under 7) nothing about whether Rise will understand their day, and tells Priya (solo to Lisbon) nothing about whether the local tips are real or generic.

## Goal

Replace the generic page with one that proves *one* thing Rise actually does, in under three seconds of attention.

## Non-goals

- Full rebrand or new visual identity. The cream / teal / navy palette stays, DM Sans stays.
- Video, scroll-driven animation, or anything requiring a CDN beyond `next/image`.
- A/B testing infrastructure. Pick one direction, ship, let onboarding completion rate and qualitative walkthroughs tell us if we got it right.
- Marketing pages (pricing, about, blog). Out of scope for v1.

## Target user

Two archetypes from `TEAM.md` are the test:

1. **The Bergmans** — couple, two children (3 and 6), tired Sunday evening. Want to know in three seconds: *will this product understand that a 90-minute walking tour at 4pm is a non-starter?*
2. **Priya, solo to Lisbon** — late 20s, first international trip. Wants to know in three seconds: *are the local tips real, and would I actually feel safe walking there at 9pm?*

If the rework works for both, we keep it. If it pulls toward one, we acknowledge that and decide.

---

## Three options

Each option keeps the same page skeleton (nav → hero → supporting block → skyline) but changes the hero copy, supporting block, and CTA. Visual style stays. Pick one direction before any code moves.

### Option A — Specificity-led

**Hero:** Plan a trip that knows where you're going.

**Subhead:** Most travel apps guess. Rise asks where you're going, who's coming, and how you actually like to travel — then builds the day.

**Primary CTA:** Inline destination input with placeholder *"Where to? (e.g. Lisbon, Tokyo, Marrakech)"* and a "Plan it →" button. Pressing enter deep-links to `/welcome` with destination pre-filled.

**Supporting block:** Three small cards showing one specimen day each — "A relaxed Saturday in Lisbon", "Three jet-lagged days in Tokyo", "A family Sunday in Rome" — each card showing a 3-line itinerary excerpt.

**Voice (Noor):** Confident, specific, no exclamation points. Aimed at the "I want to see what this actually does" visitor.

**Risk:** Low. Still serves all archetypes. Doesn't lean into either of Rise's two strongest differentiators.

### Option B — Local-voice-led

**Hero:** Tips from people who actually live there.

**Subhead:** Rise plans your day-by-day, then weaves in tips from real residents who care enough to share what's worth your time.

**Primary CTA:** Plan my trip → (unchanged).

**Supporting block:** A live-rotating quote pulled from the `tips` table — e.g. *"The bakery on Rua das Flores still uses the wood oven. Go before 9am."* — Marcos, Lisbon · 🌱 Local. One real, current tip, refreshed weekly via ISR.

**Voice (Noor):** Warm, slightly conspiratorial. Aimed at the "I want to feel like a local" visitor (Priya).

**Risk:** Medium. Requires `tips` to have enough real, well-written entries to populate this confidently. Currently sparse — content quality is the gating risk. If the rotating quote is a bad one, the page sells the wrong promise.

### Option C — Family-mode-led

**Hero:** Travel that knows your three-year-old needs a nap at 2pm.

**Subhead:** Rise plans around naps, snacks, pram routes, and the 7pm meltdown. Tell us your kids' ages and we'll do the rest.

**Primary CTA:** Plan my family trip → with a smaller "Just for me →" link below.

**Supporting block:** A two-day specimen itinerary for "Rome with a 3-year-old and a 6-year-old", showing the morning museum, the afternoon park, the early dinner.

**Voice (Noor):** Direct, knowing, slightly relieved. Aimed squarely at the Bergmans.

**Risk:** Higher. Narrows positioning — solo and couple-without-children visitors will bounce harder. We'd want to verify family-mode is the wedge before committing the homepage to it.

---

## Recommendation

**Default: Option A.** Lowest-risk improvement (still serves every archetype), the most concrete claim, and the inline-destination CTA is the single biggest conversion lever — it converts the homepage from a promise into a first move.

Switch to Option C if telemetry from the activity-preview launch shows family bookings dominating.

Switch to Option B if `tips` content quality reaches the bar where leading with one is a confident move, not a hopeful one.

## Success metrics

- **Onboarding completion rate** (% of `/welcome` visitors who reach Step 5) holds or improves over the four weeks after launch.
- **Time-to-first-CTA-click** decreases — proxy for "did the page do its job in three seconds".
- **Qualitative:** archetype walkthroughs (per `TEAM.md` testing protocol) report a "this gets us" reaction at least once across the four archetypes.

## Technical considerations *(Luca)*

- Pull `LandmarkSkyline` out of `app/page.tsx` into `app/components/LandmarkSkyline.tsx` regardless of option chosen — current page is 200 lines of inline SVG.
- **Option A:** reuse `PlacesAutocomplete.tsx`. Deep-link via query string `/welcome?destination=Lisbon`. `/welcome` already needs to read it and pre-populate Step 1 state.
- **Option B:** server-side fetch from `tips` table; render at build time with ISR (revalidate ~24h). Add a `featured` boolean on `tips` so a human can curate which ones surface, instead of trusting the live table.
- **Option C:** no new technical requirements.
- All three keep API costs at zero on the landing page itself (no Claude calls).

## Usability notes *(Maya)*

- Whichever option ships, fix the muted pill colour `#6a7f8f` on `#f8f6f1` — borderline AA at small sizes. Nudge to `#5a6f7f`.
- On a 360px viewport the current `text-lg` subhead wraps to four lines and crowds the CTA against the skyline. Reduce to `text-base` on mobile.
- Add a tertiary path for the curious browser who isn't ready to start the wizard — Option A's inline input solves this; Options B/C should add a "See how it works" anchor link.

## Traveller-reality notes *(Elena)*

- Option C is the most truthful to what the product currently does best. The Bergmans' day is the use case Rise has actually thought hardest about.
- Option B's promise only holds if a real Lisbon resident wrote the rotating tip. A generated or thin tip will read as inauthentic faster than no tip at all.
- Option A is the safest but Elena's note: don't pick "Tokyo, jet-lagged" as a specimen card unless someone on the team has actually planned a jet-lagged Tokyo trip recently. Specimens have to be true.

## Voice notes *(Noor)*

- Strike "thoughtfully planned" wherever it appears. It is the most-used phrase in the premium-product category and means nothing.
- Quirky-for-its-own-sake is out. A clever line that doesn't tell you what Rise does is decoration. The test of fitness for any quirky line: would the Bergmans, tired on a Sunday, smile at it? If yes, ship. If they squint, cut.
- Keep one small surprise on the page. The skyline already does some of this work — lean into that kind of warm specificity rather than reaching for irreverence.

## Open questions

1. Keep "Sign in" in nav, or remove it and route returning users via the welcome flow's account check? *(Maya: keep but de-emphasise.)*
2. Should the rework include meta description / OG image refresh? *(Out of scope for v1; track separately.)*
3. If Option B is chosen, what's the curation policy for `tips.featured` — guide-self-elects, or admin-curates?

## Next step

Philip picks A / B / C. Sarah then writes the implementation PRD with copy locked, Maya produces a one-screen mock at 360px and 1280px, and the card lands in Linear at `Refine`. Estimated two days of work after the direction is chosen.
