# Sprint 1 — Quick Wins (1–2 weeks)

Five tickets. All are scoped to a single developer-week or less. Goal: ship visible
trust + clarity improvements before tackling architecture (Sprint 2) or product
direction (Sprint 3).

Each ticket is written from three viewpoints: **Why** (PM), **UX** (Designer),
**Build** (Tech Lead). Acceptance criteria are runnable.

---

## RISE-101 · Fix duplicate body text on "Save your trip plan" screen

**Type:** Bug · **Effort:** XS (≤2h) · **Priority:** P0
**Owner suggestion:** Front-end

**Why (PM):**
First impression for a high-trust moment (signup). Duplicate text reads as
"AI slop / unfinished" — biggest credibility cost vs. cost-to-fix in the entire
backlog. Single line fix.

**UX (Designer):**
Today, the description "Your activity plan, transport advice, and trip summary are
ready. Create your account to save everything." appears twice on `/welcome` step 5
— once in the styled body slot and again in a smaller grey duplicate below.
Remove the duplicate.

**Build (Tech Lead):**
Almost certainly a leftover prop pass-through or template variable rendered twice.
Likely lives in the step-5 component (search for the duplicated string).

**Acceptance criteria:**
- [ ] On the final onboarding step ("Save your trip plan"), the description appears
      exactly once.
- [ ] Visual regression test added or a snapshot test pinning that screen.

---

## RISE-102 · Persistent trip-type confirmation label

**Type:** Feature · **Effort:** S (1–2 days) · **Priority:** P0
**Owner suggestion:** Front-end + light backend

**Why (PM):**
Two of five personas (Solo and Family) currently get **no confirmation** that the
system understood who's traveling. The Trip Type chips disappear when Adults=1 or
when any Children>0. This silent state is the root of the "did I miss a step?"
feeling for solo and family travelers — likely the second- and third-largest
segments after couples.

**UX (Designer):**
Replace the disappearing Trip Type chip group with a *persistent* label that
updates live based on the Who's Coming counters and chip selection.

Copy rules:
- 1 adult, 0 kids → "Planning a solo trip"
- 2 adults, 0 kids, "Couple" selected → "Planning a couple's trip"
- 2 adults, 0 kids, "Friend group" selected → "Planning a trip for two friends"
- 3+ adults, 0 kids → default "Planning a trip for {N} friends" (Friend group),
  show chip if user wants to switch (e.g., 3 adults could be "3 friends" or
  "couple + 1 guest")
- Any kids → "Planning a family trip with {N} {child/children} ({age, age, ...})"

The label should sit above "Tell us about yourself." in the same warm tone as the
existing copy. Keep the chips when the type is genuinely ambiguous (2 adults).

**Build (Tech Lead):**
Pure presentational — derive label from existing form state, no new fields.
Make the label a function of (adults, children, ages, selected chip).

**Acceptance criteria:**
- [ ] With Adults=1 / Children=0, the label reads "Planning a solo trip" and is
      visible.
- [ ] With Adults=2 + 2 children (5–8 and 9–12), the label reads
      "Planning a family trip with 2 children (5–8, 9–12)".
- [ ] With Adults=2 / Children=0, both Couple and Friend group chips remain;
      label updates based on selection.
- [ ] Label is announced to screen readers (use `aria-live="polite"`).

---

## RISE-103 · Add 13–17 age bucket and remove "Under 2" pre-selection

**Type:** Feature + Bug · **Effort:** XS (≤4h) · **Priority:** P1
**Owner suggestion:** Front-end

**Why (PM):**
Anjali persona surfaced this. Age buckets stop at 9–12 — teen families, a real
segment, are silently excluded. Worse, "Under 2" is pre-selected for every child,
meaning an inattentive parent who sets Children=2 gets a toddler-itinerary by
default — quiet personalization failure.

**UX (Designer):**
- Add a fifth bucket: "13–17"
- Change pre-selected default from "Under 2" to *no selection*
- Disable Continue until each child has an age bucket selected
- Inline error if user tries to advance without selecting: "Pick an age range
  for each child so we can match activities."

**Build (Tech Lead):**
Add the bucket to the enum, update validation in the Continue handler, ensure
downstream prompt template can handle teens (likely already fine, but worth a
prompt review for "kid-friendly" → does the model still pick teen-appropriate
activities? May want to relabel "Kid-friendly" to "Family-friendly" or split.)

**Acceptance criteria:**
- [ ] "13–17" appears as the rightmost age bucket in each child row.
- [ ] No bucket is pre-selected for any child.
- [ ] Continue is disabled until every Child row has a bucket picked.
- [ ] Activities surfaced for a "13–17" child meaningfully differ from those for
      "Under 2" (manual QA — check 3 destinations).

---

## RISE-104 · Increase rating button hit area + add "Skip" affordance

**Type:** Feature · **Effort:** S (1 day) · **Priority:** P1
**Owner suggestion:** Front-end

**Why (PM):**
Activity rating is *the* personalization signal. Today, buttons are ~25px (below
WCAG / Apple HIG 44px minimum), and only "Interested" / "Not for me" exist —
forcing users to pick a side or skip the card silently (zero signal). A "Skip /
not sure" option captures intent without forcing commitment.

**UX (Designer):**
- Increase thumb buttons to 44×44px minimum (consider 48×48 for mobile).
- Add a third button: a low-emphasis "Not sure" or "Skip" affordance. Tertiary
  visual style — text link or outlined ghost button.
- Show clear focus state (keyboard tab order) and a subtle hover lift.
- Active state should be obvious — the existing teal-fill is good; keep it.
- Counter copy: "Continue with N rated of {total} — more = better results"
  (currently shows just "N rated", which under-explains the relationship).

**Build (Tech Lead):**
"Skip" should be a distinct backend signal from "no rating" — it tells the model
"user saw this and consciously declined to commit." This is a meaningful
distinction for downstream personalization. Suggest schema:
`{ activityId, rating: 'interested' | 'not_for_me' | 'skipped' | null }`.

**Acceptance criteria:**
- [ ] Both rating buttons are ≥44px clickable area (verified via Chrome DevTools
      "Render → Show hit-test borders" or equivalent).
- [ ] A visible "Skip" affordance is present on each card.
- [ ] Selecting "Skip" persists distinct from "no rating" in the API payload.
- [ ] Counter shows "N of M rated" with M = total cards loaded.
- [ ] Keyboard navigation works: Tab into card → Enter for Interested,
      Shift+Tab back, etc. (Or arrow-key shortcuts.)

---

## RISE-105 · Step counter cleanup

**Type:** Polish · **Effort:** XS (≤2h) · **Priority:** P2
**Owner suggestion:** Front-end

**Why (PM):**
Sam & Chris persona noticed: destination is a "pre-step" before the counter
starts at 1/5. This makes commitment feel deeper than it is and is mildly
confusing for scrutinizing users.

**UX (Designer):**
Two options — pick one:
- **Option A (recommended):** Combine the destination input with the dates
  step. "Where and when?" — single screen, two stacked sections. Reduces step
  count from 6 to 5 *and* makes the counter accurate. Bundle this with the
  combined trip-details step in Sprint 3 if you'd rather defer.
- **Option B (cheaper):** Keep destination as its own screen but show "1/6" on
  it and rebase subsequent steps to start from 2/6. Less elegant; pure counter
  fix.

**Build (Tech Lead):**
A is structurally cleaner. B is a one-line constant change.

**Acceptance criteria:**
- [ ] The first step the user sees shows 1/N where N is the total number of
      onboarding screens including that one.
- [ ] All subsequent steps show consistent X/N progression with no gaps.

---

## Sprint 1 totals

| Ticket | Effort | Impact |
|---|---|---|
| RISE-101 Duplicate text | XS | S, but disproportionate trust win |
| RISE-102 Trip-type label | S | M (closes confirmation gap for 2 of 5 personas) |
| RISE-103 Teen bucket + default | XS | M for family segment |
| RISE-104 Rating UX | S | M (improves the personalization signal that powers everything else) |
| RISE-105 Step counter | XS | S |

**Total estimate:** ~4–5 developer-days of work · ~1 designer-day for review.

**Definition of done for Sprint 1:**
- All five tickets shipped to production
- Visual regression suite covers the affected screens
- Conversion through onboarding measured before & after (baseline now, post-ship,
  ideally one full week of each)

**What this sprint deliberately does *not* address:**
- The forced-signup wall (Sprint 2)
- Multi-city, constraint expression, free-form input (Sprint 3)
- Destination disambiguation (Sprint 2 — needs a place-resolution service)
