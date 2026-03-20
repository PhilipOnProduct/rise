# Rise Onboarding Reorder — PRD

Author: Sarah Chen, Product Manager

Status: Ready for implementation

Last updated: 2026-03-20

---

## Overview

The Rise onboarding wizard currently collects user preferences (travel company, style tags, budget tier) in Step 3 — after the AI activity preview in Step 4. This is a sequencing error, not a UX polish issue. We are reordering the steps so preferences are captured before the AI generates suggestions, and updating the Claude prompt to treat those preferences as hard constraints. Step 3 preferences, the updated prompt, and the loading state ship as a single release.

---

## Problem Statement

The wizard asks Claude to personalise output before we have anything to personalise with. The result is generic suggestions that could apply to any traveller going to Lisbon — or anywhere else. This isn't a minor quality issue. If the AI preview doesn't feel personal, users have no reason to believe Rise understands them, and no reason to create an account.

The data dependency is also a logic error. Budget, company, and style exist as columns on the itinerary table. We have the inputs. We are currently ignoring them at the exact moment they matter most.

The secondary problem is measurement. We do not have per-step completion baselines. We are about to ship a change we cannot properly evaluate. Pulling whatever step-level data exists in Supabase before ship is a hard requirement, not a nice-to-have.

---

## User Need

A first-time user completing the Rise onboarding wizard needs to feel that the AI is responding to them specifically — not producing output that happens to mention their destination. The core need is trust: evidence, early and unambiguous, that Rise has understood their inputs and is acting on them.

Generic suggestions don't just fail to impress. They actively signal that the AI wasn't listening. That perception is harder to undo than never making the promise in the first place.

---

## Proposed Solution

Reorder Steps 3 and 4. Preferences (company, style tags, budget tier) move to Step 3. The AI activity preview moves to Step 4. The preview now has three real constraints to work with before Claude generates anything.

Write Step 3 to the database on advance, not on final submission. When the user moves past the preferences step, fire a partial upsert to the itinerary row. Step 4 reads from the database. This survives a page refresh, captures partial completion data for analytics, and ensures the AI log records the actual inputs that generated the output.

Update the Claude prompt so preferences are hard constraints, not flavour text. Budget, company, and style are structural inputs to the prompt. A solo, food-led traveller on a comfortable budget should receive suggestions a generic Lisbon visitor would not.

Build a loading state that echoes inputs back. The transition between Step 3 and Step 4 is not a spinner. It is the product proving it listened. Use a structured, minimal format — "Planning your solo trip to Lisbon" — not verbose sentences that risk reading as data recitation. The loading state is part of this release, not a follow-on.

Step 3 design specifics:

- Company: single-select visual cards (Solo / Couple / Family / Friends). No default selection.

- Style tags: six options displayed, maximum three selections. Tag copy uses identity language ("Food-led" not "Foodie", "Slow travel" not "Relaxed"). Vocabulary locked before prompt work begins.

- Budget tier: three options, named by behaviour — Savvy / Comfortable / Flexible. No Luxury tier at MVP.

---

## User Stories

As a first-time user completing onboarding, I want the activity suggestions to reflect the preferences I just provided, so that I trust Rise is actually personalising my experience rather than showing me generic output.

As a solo traveller with a food-led style and a comfortable budget, I want the AI preview to suggest things I would plausibly do in Lisbon, so that I have a concrete reason to create an account and continue.

As a user mid-flow who refreshes the page, I want my Step 3 preferences to be preserved, so that I do not have to re-enter my inputs and the AI preview still generates correctly.

As a product team, we want to measure step-level completion before and after this change, so that we can evaluate whether the reorder improved the completion-to-account conversion rate.

---

## Success Metrics

Primary metric: Completion-to-account conversion rate. The percentage of users who complete all five wizard steps and create an account. This is the number the reorder is designed to move. Baseline must be pulled before ship.

Secondary metrics:

- Step 4 time-on-step. If users are spending less than five seconds on the activity preview, personalisation quality is not the bottleneck and we need to reassess priority order.

- Drop-off rate at the new Step 3 (preferences). Preferences moving earlier could increase friction at that step. We need to know if the reorder improves the overall funnel or simply shifts where users leave.

- Partial completion rate. With Option A (write on advance), we will have a new signal: users who completed Step 3 but did not finish the wizard. Track this from day one.

Measurement dependency: Alex pulls current Supabase step-level data this week. If event tracking is not granular enough to give clean per-step data, that is a finding we document and fix — but it does not block the release. We need an imperfect before number rather than no before number.

---

## Technical Considerations

State management — Option A is the decision. Write Step 3 preferences to the itinerary row on step advance via partial upsert. Do not hold preferences in component state and pass through URL params. Option A is auditable, survives a page refresh, and captures partial completion data. The latency cost on step advance is acceptable.

Schema status — confirmed, no migration needed. The three columns (`travel_company`, `style_tags`, `budget_tier`) exist on the itinerary table. All are nullable. `style_tags` is a text array. `budget_tier` is an enum (`budget`, `comfortable`, `luxury`). Note: the enum currently includes `luxury` — this does not need to change at the database level, but the Flexible tier label in the UI maps to `luxury` (the only remaining enum value above `comfortable`). The UI never shows the word "Luxury" — the button is labelled "Flexible".

Tag vocabulary must be locked before the prompt is written. Freeform strings passed to Claude will produce inconsistent output. The six style tags are defined in the UI. They are passed to the prompt as a clean comma-separated string. Prompt logic follows from the locked tag set, not the other way around.

Prompt structure. Budget, company, and style are positioned as constraints in the system prompt, not appended as context after the main instruction. The prompt draft is written by product once Maya confirms the tag set, and reviewed by Luca before it touches the codebase.

AI log integrity. The admin dashboard AI log should capture the actual `travel_company`, `style_tags`, and `budget_tier` values that were passed into each Claude call. This is a debugging and quality requirement, not a nice-to-have.

---

## Risks & Open Questions

The atomic release requirement is the highest risk. If preferences, the updated prompt, and the loading state do not ship together, we create the worst possible outcome: the product signals it is listening and then proves it is not. Any one piece missing means the release waits. This is non-negotiable.

The loading state assumption is unvalidated. The moment where the screen echoes inputs back is doing significant trust work. We do not have evidence that users read it, find it reassuring, or register the causal link it is trying to establish. The surveillance-adjacent risk Alex raised is real — verbose recitation of user data could read as unsettling rather than personalised. The mitigation is minimal, structured copy ("Planning your solo trip to Lisbon") rather than full sentences. Five moderated sessions post-ship will give us signal on whether this is landing.

Preferences earlier may increase Step 3 drop-off. We are assuming preferences feel like a payoff unlock before the AI preview. Users may experience them as friction that blocks the preview. The step-level drop-off data will tell us. If Step 3 abandonment increases materially post-ship, we revisit the framing and consider whether a lighter preference capture (company only, style tags optional) reduces the barrier.

Tag vocabulary is an open item blocking prompt work. Maya finalises the six tags and copy this sprint. Until that is confirmed, the Claude prompt cannot be written. This is the critical path dependency.

Budget enum mismatch. The database enum uses `luxury` as a value. The UI will not expose Luxury as an option. The Flexible tier maps to the `luxury` enum value — this must be explicit in code, not silent. Ensure the mapping is named in a constant so it is visible to any future reader.

---

## Claude Code Implementation Prompt

```
Read docs/prds/2026-03-20-reorder-onboarding-steps.md and read CLAUDE.md for
full project context. Then implement the PRD exactly as specified. All three
pieces — reordered steps, updated Claude prompt, and loading state — must ship
in a single commit. Do not ship any piece in isolation.

Files to change:

1. app/welcome/page.tsx
   - Swap steps 3 and 4. Step 3 becomes Travel Preferences. Step 4 becomes AI
     Preview.
   - Replace COMPANY_OPTIONS with Solo / Couple / Family / Friends only. Remove
     Business. No default selection.
   - Replace STYLE_OPTIONS with exactly six identity-language tags: Food-led,
     Culture-first, Adventure, Slow travel, Nature, Nightlife. Cap selections at
     3. Disable (not hide) tags once the cap is reached.
   - Add BUDGET_OPTIONS: Savvy (maps to DB value "budget"), Comfortable (maps to
     "comfortable"), Flexible (maps to "luxury"). No default. Show a short
     description beside each label.
   - Add budgetTier state. Require travelCompany to be selected before the
     Continue button is enabled on step 3. Style tags and budget are optional.
   - On advance from step 3 to step 4: fire a partial POST to /api/travelers
     with destination, dates, hotel, and all three preferences. Store the
     returned id in a travelerId state variable. On step 5 finish: if travelerId
     exists, PATCH to add name and email; otherwise POST the full record. This
     is Option A from the PRD.
   - Pass travelCompany, travelerTypes (as styleTags), and budgetTier to the
     /api/activities-stream fetch call.
   - Change the loading message from "Planning your {destination} trip…" to
     "Planning your {company} trip to {destination}…" where company is the
     human-readable label (e.g. "solo", "couples", "family", "friends"). Fall
     back to "Planning your trip to {destination}…" if no company is selected.
   - Update the button label "Looks good — continue →" to appear on step 4
     (AI Preview), not step 3.
   - Include budgetTier in the localStorage rise_traveler object.
   - Update headings and subheadings: step 3 heading "Tell us about yourself.",
     step 4 heading "What to do in {destination}.".

2. app/api/activities-stream/route.ts
   - Accept travelCompany, styleTags, budgetTier from the request body.
   - Inject them into the Claude prompt as hard constraints, not flavour text.
     Position the constraint block before the activity-format instructions. Every
     suggestion must fit the traveller profile. A solo food-led traveller on a
     savvy budget must receive different suggestions than a family on a flexible
     budget.
   - Include travelCompany, styleTags, and budgetTier in the logAiInteraction
     input field so they appear in the admin AI log.

3. app/api/travelers/route.ts
   - Make name and email optional in the POST handler (to support partial writes
     at step 3 advance before account creation).
   - Add travel_company, style_tags, and budget_tier to the Supabase insert.
   - Add a PATCH handler that accepts { id, name?, email?, travelCompany?,
     styleTags?, budgetTier? } and updates only the fields provided.

4. CLAUDE.md
   - Update the onboarding wizard description to reflect the new step order.
   - Update the activities-stream description to note it now accepts preferences.
   - Update the rise_traveler localStorage key entry to include budgetTier.

Do not add Luxury as a selectable UI option. Do not change the database enum.
Do not add any steps, fields, or options beyond what the PRD specifies. Do not
refactor unrelated code.

Commit all four files together with a clear message explaining why (not what).
```
