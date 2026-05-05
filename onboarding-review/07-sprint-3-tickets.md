# Sprint 3 — Differentiation (4–8 weeks)

Three tickets. This is where Rise stops looking like "structured form + LLM" and
starts looking like a product only achievable with a 2026-grade model. The lead
ticket (RISE-301) is the largest single move in the entire backlog, and may
warrant being broken into its own milestone.

---

## RISE-301 · Free-form trip description as the lead onboarding path

**Type:** Feature · **Effort:** L (10–15 days) · **Priority:** P0
**Owner suggestion:** Full-stack + prompt-eng + designer

**Why (PM):**
Today, the structured form treats the user like a 2018 web user filling out a
booking form. In 2026, the user's mental model is "talk to the AI." A
free-form input that the LLM parses into the same structured trip schema:
- Solves multi-city, constraint expression, and express path *in a single move*
- Reduces friction for power users (Marco, Mira) who want to dump everything in
  one go
- Moves the product's voice from "form-based AI tool" to "intelligent travel
  agent" — the differentiation thesis vs. ChatGPT's free-tier
- Leaves the structured form available as a fallback for users who prefer
  click-driven flows (Anjali, Sam & Chris)

This is the ticket that makes the product feel new, not the others.

**UX (Designer):**

The new flow:

1. **Landing → "Describe your trip" hero.** Single large textarea with placeholder:
   *"e.g. Two of us, Portugal and Spain for two weeks in June, love food and
   history, no hiking, my wife has a knee issue."*
2. Below the textarea: "Or step by step →" link → drops user into the existing
   structured form (Sprint 1 + 2 versions).
3. **On submit:** show a parsing state — *"Got it. You're going to Lisbon and
   Madrid for 14 days, 2 adults, food + history, accessibility considerations.
   Anything to fix?"*
4. Each parsed field is a clickable chip. Clicking opens an inline edit. This
   is the user's chance to correct the model's interpretation before activity
   generation begins.
5. Confirm → activity rating step (RISE-104) → itinerary (RISE-202).

This converts the 5-step form into a 2-step flow for users who want speed,
without losing the structured option for users who don't.

**Build (Tech Lead):**

Three pieces of new infrastructure:

1. **Parser prompt + schema.** Define a strict JSON schema for the parsed trip
   (destinations array, dates, party, ages, constraints, style tags, budget,
   notes). Use a structured-output / function-calling model call to parse the
   user's free-form text into that schema. Keep temperature low (0–0.2) for
   parser reliability.
2. **Disambiguation flow when fields are missing.** If parser can't fill a
   required field (e.g., dates), it returns an array of `clarifications` —
   the UI shows them as inline questions on the confirmation screen.
3. **Place resolution.** Each destination from the parser still flows through
   RISE-201's place-resolution endpoint. So multi-city becomes "for each leg,
   resolve the place." This is also where multi-city support fundamentally
   slots in.

The structured form (existing) and the free-form input (new) share the same
trip schema downstream, so the activity generation, itinerary builder, and
account claim flows all work without modification.

**Acceptance criteria:**
- [ ] User who pastes "We're a couple in our 50s going to Portugal and Spain
      for two weeks, love food and history, no hiking, knee issues" sees a
      confirmation page with: 2 destinations (Lisbon and Madrid as a sensible
      default — or whichever cities the LLM picks), ~14 days inferred,
      Adults=2, style chips Cultural + Food-led, constraint note "no hiking,
      knee issues" surfaced explicitly.
- [ ] User can edit any parsed chip on the confirmation page.
- [ ] If a required field can't be parsed (most likely: specific dates), the
      UI asks one targeted question rather than punting back to the structured
      form.
- [ ] Place resolution (RISE-201) handles each parsed destination and shows
      ambiguity inline (e.g., "Did you mean Madrid, Spain or Madrid, Iowa?").
- [ ] Free-form path completes ≥80% as often as structured (measured after
      2 weeks live).
- [ ] Telemetry: `freeform_initiated`, `freeform_parsed_clean`,
      `freeform_required_clarification`, `freeform_completed`.

**Risk callouts:**
- **Hallucinated parsing:** LLM may invent constraints the user didn't say.
  The confirmation step (chips) is the safety net. Test extensively across
  ambiguous inputs.
- **Cost:** parsing + activity generation + rationale (RISE-203) compounds
  LLM spend per session. Monitor cost-per-activated-user.
- **Cold-start UX:** users may stare at the empty textarea unsure what to
  type. The placeholder is the first defense; consider adding 2–3 example
  prompts as one-tap chips below the textarea.

---

## RISE-302 · Constraint expression (allergies, mobility, dietary, religious)

**Type:** Feature · **Effort:** M (4–6 days) · **Priority:** P1
**Owner suggestion:** Full-stack

**Why (PM):**
For Anjali, Sam & Chris, and Marco — the trip-stakes-are-real personas — the
ability to say "celiac diet, knee issues, no fish" is the difference between
"trustworthy" and "useless." Today there's nowhere to express this in the
structured flow. RISE-301 catches some of this through free-form input, but
not all users will use that path; constraints belong in both flows.

**UX (Designer):**
- New optional section on the "Tell us about yourself" screen, below budget:
  **"Anything we should know?"** with placeholder examples and a free-text
  area (~3 lines tall).
- Below the textarea: 4–6 quick-pick chips that pre-populate common cases:
  "Vegetarian," "Halal/Kosher," "Wheelchair-accessible only," "No hiking,"
  "Pet-friendly," "Quiet/sensory-considerate."
- Selected chips show inline as comma-separated text in the field, but remain
  toggleable.
- Optional → users can skip; never required.

**Build (Tech Lead):**
- Add `constraints: { freeText: string, tags: string[] }` to the trip schema.
- Update the activity generation prompt to include constraints prominently —
  use "MUST respect:" language to ensure the model takes them seriously.
- Optional: a server-side validator that flags activities clearly violating
  hard constraints (e.g., a rated card titled "Sintra hiking trail" gets
  filtered if user said "no hiking"). Belt-and-braces.

**Acceptance criteria:**
- [ ] "Anything we should know?" appears as an optional section on the
      profile screen.
- [ ] Both free-text and chip-pick paths persist into the trip schema.
- [ ] In manual QA: setting "no hiking" eliminates obviously hiking-titled
      activities from the rating step.
- [ ] Constraints surface in the per-activity rationale (RISE-203):
      *"Picked because it's wheelchair accessible per your note."*

---

## RISE-303 · Combined "trip details" step (dates + hotel + multi-stay)

**Type:** Refactor · **Effort:** M (3–5 days) · **Priority:** P1
**Owner suggestion:** Front-end + Backend

**Why (PM):**
The hotel step is awkwardly placed between dates and demographics. The Continue
button is enabled with the field empty (despite a "skip" link), creating a UX
inconsistency. Combining dates + hotel into one step also future-proofs for
multi-city — each leg gets its own optional hotel.

**UX (Designer):**
Replace two screens (dates, hotel) with one:

**"Trip details"**
- Dates (departure / return)
- For each destination (one for single-city, multiple for multi-city via
  RISE-301):
  - Place name (read-only, from RISE-201 selection)
  - Optional hotel field (with autocomplete via RISE-201's same place service)
  - Optional dates *within* the trip (e.g., "Lisbon Jun 15–20, Madrid Jun 20–25")
  - "I haven't booked yet — skip" link (clearly clickable, removes hotel
    requirement; resolves the current ambiguity)
- Continue is enabled once required fields (dates) are filled; hotel is
  always optional.

**Build (Tech Lead):**
- Combine the existing two route components.
- Hotel becomes part of trip schema's leg structure: `legs: [{ place, hotel?,
  startDate?, endDate? }]`.
- Multi-leg validation: leg dates must be within (or absent and inferred to
  fill) the overall trip dates.
- Hotel autocomplete reuses the place-resolution endpoint with a `category=lodging`
  filter (Mapbox supports this).

**Acceptance criteria:**
- [ ] Single screen replaces the previous two.
- [ ] User can skip hotel without ambiguity (no separate enabled-Continue +
      skip-link conflict).
- [ ] For multi-city trips, per-leg date and hotel inputs render and persist.
- [ ] Hotel autocomplete returns lodging-only results.
- [ ] Step counter is accurate (resolves the lingering RISE-105 issue if not
      already done).

---

## Sprint 3 totals

| Ticket | Effort | Impact |
|---|---|---|
| RISE-301 Free-form input | L | Largest differentiator move |
| RISE-302 Constraint expression | M | High-stakes personas need this |
| RISE-303 Combined trip details | M | Cleans up a long-standing flow awkwardness |

**Total estimate:** ~17–26 developer-days · ~5 designer-days · ~3 days prompt-eng.

**Sequence within the sprint:** RISE-303 first (it touches the schema), then
RISE-301 (which depends on the leg-based schema), then RISE-302 in parallel.

**Definition of done for Sprint 3:**
- All three tickets shipped
- Free-form vs. structured choice rate measured for ≥30 days — informs whether
  to make free-form the *default* in a future iteration
- Constraint expression usage measured — % of users who fill anything,
  % who use chips vs. free text
- Multi-city trips supported in onboarding (UI uses it for the first time)

**What's deliberately deferred to Q2:**
- Group share / collaboration (RISE-401, separate doc)
- Voice / chat-only onboarding (parked — see shortlist)
- RL on rating signals (parked)
- Multi-city support in the *itinerary view* itself (vs. just onboarding) —
  may need its own ticket pass

**The big decision point Sprint 3 forces:**
After this sprint ships, you'll have data on free-form vs. structured. Once
you see ≥60% of users picking free-form, the next big question is:
*should the structured form become the fallback, not the lead?* That's a
positioning bet — make it consciously, not by drift.
