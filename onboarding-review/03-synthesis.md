# Synthesis — three lenses on the onboarding feedback

The same feedback, viewed by three people with different jobs.

---

## Theme map (what kept coming up)

| # | Theme | Personas affected | Severity |
|---|---|---|---|
| T1 | No "Solo" or "Family" trip type chip — Trip Type field disappears with 1 adult or with kids | Mira, Anjali, Marco | High |
| T2 | Forced account creation before seeing the itinerary | Mira, Marco, Sam & Chris, Tomás | High |
| T3 | No multi-city / multi-leg trip support | Sam & Chris (and any 7+ night planner) | High |
| T4 | No way to express constraints (allergies, mobility, dietary, etc.) | Anjali (kids), Sam & Chris (older), Marco (premium) | High |
| T5 | Destination field silently auto-corrects to a different city | All personas potentially | Critical (trust) |
| T6 | Hotel field is free-text and standalone step (not autocomplete, not inline) | Marco, Tomás, Anjali | Medium |
| T7 | Activity rating UI: small buttons, only "Interested / Not for me", no "Skip", no easy way to revisit | All | Medium |
| T8 | "Save your trip plan" screen has duplicated body text | All | Low effort, High signal |
| T9 | Age buckets stop at 9-12 — no teen option; "Under 2" pre-selected as default | Anjali | Medium |
| T10 | No share / collaborate path for group trips | Tomás, Anjali | Medium |
| T11 | Trust signals missing (where do recommendations come from?) | Sam & Chris, Anjali | Medium |
| T12 | "Pick up to 3" travel styles is restrictive | Tomás, Marco | Low |
| T13 | Step counter resets oddly — destination is "pre-step", then 1/5 starts at dates | Sam & Chris (visible scrutiny) | Low |
| T14 | No express path for users who know what they want | Marco | Medium |
| T15 | Continue enabled on profile screen with zero selections (Solo path) | Mira, Marco | Medium |

---

## PM Lens — what's the value problem?

**Reframing the diagnosis:** the onboarding is asking users to invest 5 steps before
they see *any* product output. That's only worth doing if the personalization meaningfully
beats "search for Lisbon things to do." Right now there's an evidence gap: the user
puts info in, but never sees a confirmation that the system "got it." Trip type chips
disappearing for Solo/Family (T1) is the smoking gun for this — input goes in, no output
acknowledges it.

**The activation bet is wrong-shaped:**
- Today: collect data → show activities to rate → require signup → reveal itinerary.
- Better: show partial value at every step → let user *see* personalization happening →
  signup gates persistence (saving + return), not first viewing.

**Where the value leaks (PM priorities):**

1. **Activation:** Forced signup before payoff (T2) is the single biggest growth-blocker.
   In B2C trip planning, the "aha" must happen pre-signup. Hotels.com, Airbnb, even
   ChatGPT itself follow this pattern.
2. **Retention/Differentiation:** Multi-city + constraints (T3, T4) are the things that
   make Rise meaningfully better than a generic LLM. Without them, "ChatGPT can do this
   for free." This isn't a UX issue — it's a product positioning gap.
3. **Trust:** Silent destination override (T5) and no source attribution (T11) destroy
   trust before users have any reason to grant it. AI products live and die by trust.
4. **Group dynamics:** No share path (T10) misses an organic distribution channel —
   Tomás's friends are 3 free user acquisitions per trip he plans.

**Strategic question for the PM:** is Rise an *expert travel planner* (deep, considered)
or a *fast travel assistant* (quick, light)? The current onboarding tries both and lands
in the middle. Marco wants fast; Sam & Chris want deep. Pick one as the lead persona
and design accordingly — then add a path for the other.

---

## Designer Lens — what's the usability problem?

The flow is *prettier than it is usable*. Visual polish (color, typography, copy
warmth) is high. Information design and feedback loops are weaker.

**Specific usability findings:**

1. **Confirmation gaps (T1, T15):** When you remove the Trip Type chips for solo/family,
   the user gets no positive signal that "Solo" or "Family with 2 kids" was understood.
   Replace the disappearing chip with an *always-present* trip-type label that updates
   live: "Planning a solo trip" / "Planning a family trip" / "Planning for 4 friends."

2. **Hidden auto-correction (T5):** The destination field silently changes user input.
   This is the worst kind of UX failure — invisible, mistrust-inducing, and impossible
   to undo. Standard pattern: show a dropdown of suggestions, let the user pick. Never
   override silently.

3. **Step counter is misleading (T13):** "1/5" on the dates screen, but destination was
   already a step. This makes commitment feel deeper than it is. Either count from 0
   (i.e., "1/6") or make destination part of step 1 (combine destination + dates).

4. **Touch target on rating buttons (T7):** ~25px, below the 44px Apple/WCAG guideline.
   Increase to at least 44x44 with clear focus state and hover feedback. Add a third
   "Skip / not sure" affordance — currently users either ignore the card (which doesn't
   feed the model) or pick the wrong one.

5. **Hotel step is misplaced (T6):** It interrupts the demographic flow. Either move it
   into a "trip details" combined step (dates + hotel together), or make it a post-
   itinerary refinement.

6. **Pre-selected defaults are traps (T9):** "Under 2" preselected on every child means
   a parent who sets Children=2 and clicks Continue gets a toddler-itinerary regardless
   of their kids' actual ages. Defaults should be empty + required, OR a sensible
   middle (5-8).

7. **The duplicate body text on signup (T8):** Pure CSS/copy bug. Single line fix.

8. **Information density on the profile screen:** 4 distinct decisions (count, type,
   style, budget) on one screen. Consider splitting count + type from style + budget
   for easier cognitive load.

**Heuristics worth applying as a quick audit:**

- Nielsen #1 (visibility of status): broken in T1, T5
- Nielsen #2 (match with real world): "Friend group" is correct, but "Couple"
  excludes "Two friends" — consider "Two of us" or letting users self-define
- Nielsen #6 (recognition vs. recall): hotel is recall-mode (free text); should be
  recognition (autocomplete)

---

## Tech Lead Lens — what's possible now and what's the right architecture?

The product's promise is "AI-powered trip planning." 2026 LLMs make a lot of these
fixes much easier than they would have been 18 months ago. The current onboarding
underuses what the model can do.

**What modern AI capabilities make trivial / easy now:**

1. **Free-form trip description** — instead of 5 structured steps, let users say
   "We're a couple in our 50s going to Portugal and Spain for two weeks, love food
   and history, no hiking, my wife has a knee issue." A single LLM call can extract
   destination(s), dates, party composition, constraints, style, budget. Keep the
   structured form as a fallback / for users who prefer it. This solves T3 (multi-
   city), T4 (constraints), and T14 (express path) in one move.

2. **Destination disambiguation via tool use** — instead of silent auto-correct (T5),
   call a place-resolution tool (Google Places, Mapbox, your own DB) that returns
   ranked candidates and let the LLM ask: "Did you mean Lisbon (city) or Lisboa
   region?" This is one tool call.

3. **Streaming activity generation** — the current loading state ("Found 2 of ~6")
   suggests sequential generation. With current models, you can stream activities
   as the LLM produces them. The UI already partially supports this; consider
   surfacing reasoning ("looking for kid-friendly food spots near your Belém hotel...")
   to make wait time feel intelligent.

4. **Rating is over-engineered** — the thumbs-up/down loop is a 2018 pattern
   (collaborative filtering). Modern alternative: let the user *type* feedback
   ("more like the monastery, less beach"), and have the LLM rerank. Cheaper to
   build, more expressive, more fun.

5. **Per-stop reasoning + sourcing (T11)** — the model can include a one-line
   "why this" rationale per activity (e.g., *"Picked because you flagged kid-friendly
   and your hotel is 8 min walk away"*). This costs ~50 tokens per card and dramatically
   raises trust.

**Architecture considerations:**

- **Where state lives during onboarding** — the current flow appears to keep state
  client-side until the signup step. That's correct for fast UX. But it means a
  page refresh = data loss. Recommend: anonymous server-side session keyed by
  cookie; signup later "claims" the session. This unblocks T2 (show itinerary
  pre-signup) without losing data on bounce.
- **LLM call budget** — moving to one free-form input + tool-use disambiguation +
  streaming activities is more model-intensive than the current path. Estimate
  ~3-5x token spend per session. Worth it if activation goes up; track LLM cost /
  activated user.
- **Schema design for trips** — the data model needs to support multi-city
  (legs/segments), constraints (free-text + structured tags), and shared editing
  (collaborator list, vote schema) before T3, T4, and T10 are buildable. Worth
  doing this design pass before bolting features on top.

**What's *not* worth chasing yet (tech-lead skeptic mode):**

- Voice / chat-only onboarding — sounds AI-shiny but Marco and Anjali both want
  speed and structure. Save for a v3 once core gaps are closed.
- Hyper-personalized RL on rating signals — premature given the data volume of a
  pre-launch product. Stick with prompt-based personalization until you have ~10K
  rated activities to learn from.
- Native apps — the current responsive web is fine; the gap is *what the app does*,
  not the platform.

---

## What this synthesis converges on

Three things the PM, Designer, and Tech Lead all agree should happen first:

1. **Don't gate the itinerary behind signup** (PM: activation; Designer: payoff;
   Tech: anonymous session is straightforward).
2. **Replace silent destination override with a disambiguation step** (PM: trust;
   Designer: visibility; Tech: one tool call).
3. **Add free-form trip description as the lead path; keep structured as fallback**
   (PM: differentiation; Designer: cognitive load; Tech: this is what LLMs are *for*).

These are the three highest-converged moves. Lower-priority items follow in the
prioritized shortlist.
