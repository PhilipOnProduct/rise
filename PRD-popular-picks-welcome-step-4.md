# PRD — Popular Picks (Welcome Step 4)

**Card type:** Improvement
**Linear destination:** Backlog
**Author:** Sarah (PM), with input from Maya (Design), Luca (Tech), Elena (Travel)

---

## Overview

Add a collapsed "Popular picks" affordance below the must-dos textarea on welcome step 4. When expanded, it surfaces 5–8 personalised, iconic activities for the destination, each with a single-line context note (friction, profile fit, or pro tip). Tapping **+ Add** appends the pick to the textarea, which remains the single source of truth.

The picks are an assist, not a replacement. The textarea stays primary; the panel is collapsed by default so users who already have anchors aren't tempted to skip their own typing.

---

## Problem Statement

Welcome step 4 asks travellers to type in must-dos that anchor the AI's day-by-day itinerary. The textarea is optional and easily skipped. Two failure modes:

1. Traveller has no must-dos in their head (typical for short trips, first-time-to-city, jet-lagged business extenders) and skips. The itinerary generates without anchors and may surface activities they'd have wanted to nominate themselves.
2. Traveller has a vague sense but no specific names — leaves Rise mid-onboarding to Google "top 10 things to do in [city]" and may or may not come back.

The textarea assumes a list already in hand. For a meaningful share of travellers, it isn't.

---

## User Need

A traveller who isn't sure what to put in the must-dos textarea needs a quiet, personalised nudge that helps them recognise iconic activities — without taking over the step or pretending to be a full discovery surface. The nudge must respect their trip shape (solo vs. family vs. couple, kid-friendly vs. nightlife) and carry the second-order context that makes a pick worth more than a TripAdvisor entry.

---

## Proposed Solution

A progressive-disclosure list below the textarea, collapsed by default behind a "Need ideas? See popular picks ▾" link.

**Expanded state:**

- Header: "Popular picks", footer: "Hide picks ▴"
- 5–8 pick rows. Each row stacks:
  - Line 1: pick name (primary text) + **+ Add** action right-aligned (teal, 44px tap target)
  - Line 2: context note (muted, ≤80 chars, soft target 55), drawn from one of three categories — **friction flag** / **profile fit** / **pro tip**. Every pick carries exactly one note. If we can't write one, the pick doesn't make the list.
- Tone discipline on notes: friend's text message, not guidebook caption. Lowercase after comma, no preambles ("Pro tip:", "Note:"), no hedging.
- Tap **+ Add** → name appends to textarea on a new line, **+** swaps to **✓**, row stays in place. No toast, no auto-scroll, no auto-collapse.
- Tap **✓** → removes the matching line from the textarea (case-insensitive title match), swaps back to **+**.
- Textarea remains the single source of truth. Added/not-added state is *derived* from textarea contents on every render — not held independently.
- **Soft cap at 5 picks added.** When the user has added 5 picks via the panel, a muted line appears below the picks block: "Add anything else? ↓" — pointing back to the textarea. Adding more picks beyond 5 still works (no hard block); the nudge only fires once per session. This protects the *personal* anchor signal step 5 depends on, so the textarea doesn't become a list of generic top picks.
- **Sub-minimum fallback.** If Haiku returns fewer than 5 picks: show what we have if ≥3. Below 3, the panel renders a single muted line — "No popular picks for this destination yet — type your own ↓" — and the **See popular picks ▾** affordance hides on this destination for the rest of the session.

Personalisation: Step 3 traveler type + top 3 style tags + children's age bands all flow into the picks call. A family of four with a 3-year-old sees pram-friendly options; Priya solo-to-Lisbon sees safety-aware notes where relevant.

---

## User Stories

- **As Priya (solo first-timer to Lisbon)**, I want iconic activities surfaced with a safety-or-time-of-day note so I don't switch to Google and miss critical context Rise could have given me.
- **As Marcus (business extender, jet-lagged)**, I want a short high-quality list I can tap through in 60 seconds so my two evenings are sorted without me having to research at 11pm.
- **As the Bergmans (family, 3 + 6)**, I want the picks I see to actually work with a 3-year-old in a pram — not generic "family" picks that include a hot botanical garden with no playground.
- **As a traveller who already knows what they want**, I want the picks to stay out of my way so the textarea isn't competing with a wall of suggestions I didn't ask for.
- **As Philip walking the feature**, I want telemetry already in place so when real traffic arrives I can see what works without retrofitting.

---

## Success Metrics

No real-user traffic yet — these are framed as **readiness**, not measurement targets. The point is that the plumbing is in place so signals are available when traffic arrives.

**Readiness:**

- New `activity_feedback` events emit cleanly for `pick_shown`, `pick_added`, `pick_removed` with `(city, travelCompany, picks_source: "popular-picks", category)` metadata.
- Picks reach `/api/itinerary/generate` via the existing `userSeededActivities` path with no code-path divergence — verified end-to-end on Philip's own walks (Priya / Bergmans / Marcus archetypes).
- Cache hit/miss on `/api/destination/popular-picks` logs to `api_usage` so cost characteristics are visible from day one.
- `npm run eval:popular-picks` exists and passes cleanly (≥4/5 average, no case <3/5) before any deploy.

**Future user metrics once traffic arrives** (to validate, not to project):

- Expand-rate on the "Popular picks ▾" link among users who reach step 4.
- Median picks added per traveller who expands.
- Step 4 skip-rate before vs. after launch.
- Correlation between picks-added and step 5 thumbs-up rate (proxy for whether anchors are improving the AI activity preview).

---

## Technical Considerations

- **Generation:** live Haiku call (`/api/destination/popular-picks`) with destination + profile in the user message. Static system prompt cache-eligible (`cache_control: { type: "ephemeral" }`).
- **Cache:** new `popular_picks_cache` table keyed on `(city, travel_company, children_age_bands, top_style_tags)`. 7-day TTL.
- **Cost posture:** Haiku ~$0.001/call. Cache hit-rate expected >70% on common profile shapes. Net cost is rounding error.
- **Limit posture:** `checkApiLimit("anthropic")` runs before any cache-miss Haiku call. On limit exceeded, serve cached payload if available; 429 only on cache miss when limit hit.
- **Eval coverage:** new `scripts/eval-popular-picks.ts`. 10 cities × 3 profile shapes (solo-female / family-under-5 / business-extender). Sonnet 4.6 as judge via `tool_use` against three criteria: factual accuracy (no hallucinated venues), profile-fit accuracy, useful-friction. Pass gate: ≥4/5 average AND no case <3/5. Same harness pattern as `eval:country-destination`.
- **Integration with itinerary generation:** zero changes to `/api/itinerary/generate` or `buildUserSeededAnchorsSegment`. Picks added to the textarea are textarea content; existing parser path handles them.
- **Destination scope:** this PRD assumes a city. For country-level destinations (PHI-69 flow), the picks affordance is hidden until a city is selected — country flow has its own discovery surface.

---

## Risks & Open Questions

- **Risk — hallucinated venues.** A fabricated restaurant or museum on a popular picks list is a day-one trust kill. Mitigation: the eval is non-optional before first deploy; factual-accuracy is the hard floor.
- **Risk — context notes drift to guidebook prose.** Without tone discipline in the prompt, notes will read like Wikipedia captions. Mitigation: in-prompt good/bad examples + 80-char hard cap + the eval's useful-friction criterion.
- **Risk — picks displace typing.** Travellers tap several picks and skip typing their actual personal anchors, weakening the personalised activity preview in step 5. **Mitigation:** soft cap at 5 picks added — a "Add anything else? ↓" nudge fires once per session, pointing back to the textarea. No hard block; just a gentle nudge.
- **Risk — cache key drift.** If Step 3's style tag set evolves, the cache key changes and miss-rate spikes silently. Mitigation: log cache hit/miss with the actual key shape into `api_usage`.
- **Open — cache TTL.** 7 days is a guess. Picks change slowly (seasonal venues, closures). Worth a stale-picks review one week after real traffic begins.

---

## Claude Code Implementation Prompt

Build the "Popular picks" affordance on welcome step 4 of the Rise onboarding flow.

**Functional description:**

1. New server route `/api/destination/popular-picks` accepting `{ destination, travelCompany, childrenAges, styleTags }`. Returns `{ picks: [{ name, context_note, category }] }`, 5–8 items. Uses Claude Haiku via the standard `ai-logger` + `log-api-usage` wrappers; static system prompt is cache-eligible.
2. New table `popular_picks_cache` keyed on `(city, travel_company, children_age_bands, top_style_tags)`, 7-day TTL. Cache read before Haiku call; cache write on successful generation.
3. New UI section on welcome step 4, below the textarea and above "Continue". Default state: a collapsed link "Need ideas? See popular picks ▾". Expanded state: list of pick rows, name on line 1 with "+ Add" right-aligned, context note on line 2 muted. Tap **+ Add** appends name to textarea on a new line and swaps to **✓**. Tap **✓** removes the matching textarea line and swaps back to **+**.
4. Picks integrate with existing `userSeededActivities` flow. No changes to `/api/itinerary/generate` or `buildUserSeededAnchorsSegment`.
5. New telemetry events into `activity_feedback`: `pick_shown`, `pick_added`, `pick_removed`. Each event carries `(city, travelCompany, picks_source: "popular-picks", category)` in metadata.
6. New eval script `scripts/eval-popular-picks.ts` runnable via `npm run eval:popular-picks`. 10 cities × 3 profile shapes (solo-female / family-under-5 / business-extender). Sonnet 4.6 LLM-as-judge with `tool_use`, three criteria. Pass gate: ≥4/5 average AND no case <3/5. Same pattern as `scripts/eval-country-destination.ts`.

**Hard constraints (sequencing and data flow only):**

- Every rendered pick carries exactly one context note. If Haiku omits the note on any pick, drop the pick rather than render a noteless row.
- Context note is ≤80 chars enforced server-side (truncate or regenerate; never pass through a longer note).
- The textarea is the single source of truth. Added/not-added state on the panel is derived from textarea contents on every render — never held independently.
- **Soft cap nudge:** once the user has added 5 picks via the panel in the current session, show a muted "Add anything else? ↓" line below the picks block, pointing at the textarea. Fires once per session; adding more picks beyond 5 is not blocked.
- **Sub-minimum fallback:** if Haiku returns fewer than 5 picks, show what we have if the count is ≥3. If the count is <3, render only a muted "No popular picks for this destination yet — type your own ↓" line and hide the **See popular picks ▾** affordance on this destination for the rest of the session.
- `checkApiLimit("anthropic")` runs before any cache-miss Haiku call. On limit exceeded: serve cached payload if available, else 429.
- `npm run eval:popular-picks` must pass cleanly before this deploys to Vercel. No exceptions.
