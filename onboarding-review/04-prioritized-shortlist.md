# Rise onboarding — prioritized shortlist

This is the "what should we actually do" document. Each item lists impact, effort,
the lens(es) that flagged it, and the rationale. Use it as a working document — pick,
defer, or kill items as you go.

**Rating scale:**
- **Impact:** S (small) / M (medium) / L (large) — measured against onboarding completion + activation
- **Effort:** S (≤1 day) / M (a few days) / L (≥1 week, may require schema or model changes)

---

## IMPLEMENT NOW (high impact, low-medium effort)

### #1 · Fix duplicate body text on signup screen
**Impact:** S · **Effort:** XS · **Lens:** Designer (T8)
The "Save your trip plan" screen renders the description twice in different styles —
clearly a copy/CSS bug, but for trust-sensitive personas (Sam & Chris, Anjali) it
reads as "AI slop / unfinished product." Single-line fix; ship today.

### #2 · Persistent trip-type confirmation label
**Impact:** M · **Effort:** S · **Lens:** Designer + PM (T1, T15)
Replace the disappearing Trip Type chip with an always-visible label that updates
live: "Planning a solo trip" / "Planning a family trip with 2 kids (5–8, 9–12)" /
"Planning for 4 friends." Closes the confirmation gap for solo and family travelers
(2 of 5 personas). Can be a one-line component above "Tell us about yourself."

### #3 · Add teen age bucket + sensible default
**Impact:** S · **Effort:** XS · **Lens:** Designer (T9)
Add 13-17 to the age buckets. Change the default from "Under 2" pre-selected to
unselected (require pick) OR pre-select 5-8 as a sensible middle. Today, an
inattentive parent gets a toddler-itinerary because of a bad default.

### #4 · Replace silent destination auto-correct with disambiguation dropdown
**Impact:** L · **Effort:** M · **Lens:** PM + Designer + Tech (T5)
The single most trust-damaging issue: typing "Lisbon, Portugal" silently became
"Cascais, Portugal" once during testing. Fix: show a typeahead/dropdown (Google
Places, Mapbox, or your DB) and require user to confirm a result. Never override
silently. This is also a foundation for multi-city support later.

### #5 · Show the itinerary BEFORE forcing signup
**Impact:** L · **Effort:** M · **Lens:** PM + Tech (T2)
The biggest activation lever. Currently every persona except Anjali flagged the
forced-signup wall. Architecture move: keep an anonymous server-side session
(cookie-keyed) so users can see their generated itinerary immediately; signup
gates *saving* and *return*, not first viewing. Track conversion: pre-itinerary
signup vs. post-itinerary signup — expect a clear win on completion rate.

### #6 · Increase rating button hit area + add "skip / not sure" option
**Impact:** M · **Effort:** S · **Lens:** Designer (T7)
Buttons are ~25px today. Bring to 44x44 minimum (WCAG, Apple HIG). Add a third
"Skip" affordance so users who aren't sure don't get penalized in personalization.
Currently a card with no rating is treated the same as one with both options
hidden — bad signal.

---

## CONSIDER (high impact, larger effort or design uncertainty)

### #7 · Free-form trip description as the lead onboarding path
**Impact:** L · **Effort:** L · **Lens:** Tech + PM (T3, T4, T14)
Instead of 5 structured steps, let users type "We're a couple in our 50s going to
Portugal and Spain for two weeks, love food and history, no hiking, knee issues."
LLM extracts destination(s), dates, party, constraints, style, budget. Solves
multi-city, constraint expression, and express path *in one move*. Keep structured
form as a fallback / progressive-disclosure for users who prefer click flows.
This is the move that distinguishes Rise from generic LLM trip plans.

### #8 · Multi-city / multi-leg support
**Impact:** L · **Effort:** L · **Lens:** PM + Tech (T3)
Adds a real differentiator vs. ChatGPT. Schema needs trip = ordered list of legs,
each with its own destination, dates, hotel. Probably worth designing the data
model now even if the UI ships later — see also #7 (free-form input often produces
multi-city naturally).

### #9 · Per-activity "why this" rationale
**Impact:** M · **Effort:** S-M · **Lens:** Tech + PM (T11)
Add a one-line LLM-generated explanation under each activity ("Picked because you
flagged kid-friendly and your hotel is 8 min walk away"). Costs ~50 tokens per
card; dramatically increases trust for cautious personas (Sam & Chris, Anjali).
Also makes the model's reasoning auditable — useful when users disagree with picks.

### #10 · Constraint expression (allergies, mobility, dietary)
**Impact:** M · **Effort:** M · **Lens:** PM (T4)
A free-text "anything we should know?" box on the profile screen. Subset of #7
but standalone-shippable. High-stakes for families, older travelers, and
premium buyers — all of whom won't trust the system without it.

### #11 · Share / collaborate path for group trips
**Impact:** M · **Effort:** M-L · **Lens:** PM (T10)
Tomás's persona — friend group organizers — exposes an organic distribution
channel. After itinerary generation, allow "Share with the group" → friends can
view + vote on activities without account creation. This is also implicitly a
viral acquisition loop.

### #12 · Combined "trip details" step (dates + hotel + multi-stay)
**Impact:** M · **Effort:** M · **Lens:** Designer (T6)
Today: separate steps for dates and hotel, with hotel being optional and oddly
placed. Combine into one step. Future-proofs for multi-city (each leg gets its
own optional hotel). Also makes total step count feel shorter.

---

## PARK (worth noting, but not a current priority)

### #13 · Step counter inconsistency
**Impact:** S · **Effort:** S · **Lens:** Designer (T13)
Destination is "step 0", then 1/5 starts at dates. Cosmetic but worth fixing when
the flow is restructured anyway (e.g., when #12 ships).

### #14 · Loosen "pick up to 3" travel-style limit
**Impact:** S · **Effort:** S · **Lens:** Designer (T12)
Friend groups and bleisure travelers feel constrained. Could be "pick 3-5" or
remove the cap entirely. Low priority — the bigger fix (#7) replaces this whole
mechanic.

### #15 · Hotel autocomplete (vs. free text)
**Impact:** S · **Effort:** M · **Lens:** Designer (T6)
Marco notices it feels dated. Nice-to-have but not gate-keeping. Park until #12
is in flight.

### #16 · Voice / chat-only onboarding
**Impact:** Unknown · **Effort:** L · **Lens:** Tech (cautioned)
Tempting AI-shiny direction. Hold off until v3 — current personas mostly want
speed + structure, not conversation. Reassess after #7 ships and produces data
on text-input preference.

### #17 · Reinforcement learning on rating signals
**Impact:** Unknown · **Effort:** L · **Lens:** Tech (cautioned)
Premature optimization for a pre-launch product. Need ~10K+ rated activities
before there's signal. Use prompt-based personalization until then.

---

## Recommended sequencing

**Sprint 1 — quick wins (1-2 weeks):**
- #1 Duplicate text bug
- #2 Persistent trip-type label
- #3 Teen bucket + better default
- #6 Rating button hit area + skip option
- #13 Step counter cleanup (optional, bundle with above)

**Sprint 2 — trust + activation (2-4 weeks):**
- #4 Destination disambiguation
- #5 Show itinerary before signup (schema change — anonymous session)
- #9 Per-activity "why this" rationale

**Sprint 3 — differentiation (4-8 weeks):**
- #7 Free-form trip description (lead path)
- #10 Constraint expression (subset shippable earlier)
- #12 Combined trip-details step

**Quarter 2:**
- #8 Multi-city / multi-leg support
- #11 Share / collaborate

---

## Metrics to instrument

If you ship the above, track:

1. **Completion rate** of onboarding by persona-proxy (party size, trip length).
   Today, expect Solo and Family to underperform Couple.
2. **Pre-signup itinerary view rate** (#5) → activation lift.
3. **Destination disambiguation acceptance rate** (#4) → confidence in input.
4. **Free-form vs. structured choice rate** (#7) → tells you which is the future
   of the flow.
5. **"Why this" expansion clicks** (#9) → trust signal — tells you when users want
   reasoning vs. just want results.
6. **Time-to-first-activity-rating** as a proxy for onboarding friction.

---

## What to decide next

Three decisions for you (the founder/PM):

1. **Lead persona for v1.** Marco-style speed/efficiency, or Sam & Chris-style
   depth/trust? The flow can serve both, but should be designed for one. (PM lens
   recommends choosing.)
2. **Activation thesis.** Free itinerary preview pre-signup, or signup-first with
   a stronger pitch? Recommended: free preview (#5).
3. **Lead input pattern.** Stick with structured 5-step flow + improvements,
   or move to free-form-first with structured fallback (#7)? This is the
   biggest design fork.
