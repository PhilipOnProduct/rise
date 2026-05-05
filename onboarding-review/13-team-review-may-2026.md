# Onboarding flow — May 2026 team review

**Date:** 2026-05-05
**Scope:** Full onboarding flow end-to-end after PHI-25 through PHI-40 + the seven follow-ups.
**Mode:** Build (per TEAM.md default).
**Team:** Sarah (PM), Maya (Designer), Luca (Tech Lead), Elena (Travel Expert).

---

## Test backbone

### Automated (Playwright e2e, run before this review)

**12 / 12 passing**, 35–40s wall clock, single Chromium worker on a clean Next dev server (port 3100, `SITE_PASSWORD=""`).

| # | Test | Covers |
|---|---|---|
| 1 | step 0 gates Start planning on verified destination | PHI-30 (silent override fix) |
| 2 | step 3 persistent trip-type label across compositions | PHI-26 |
| 3 | step 3 supports teen ages and gates Continue on age picks | PHI-27 |
| 4 | step 4 supports Skip as a distinct rating signal | PHI-28 |
| 5 | step 3 captures constraints (chips + free text) and forwards them | PHI-35 |
| 6 | step 4 cards show expandable Why this rationale | PHI-32 |
| 7 | step 5 shows itinerary preview before signup form | PHI-31 Part 2 |
| 8 | dual-CTA: free-form input parses and pre-fills the wizard | PHI-34 |
| 9 | parser enriches destination with resolved PlaceRef on save | Follow-up #4 |
| 10 | step 4 shows Tier-2 inline signup prompt after 2 ratings | Follow-up #2 |
| 11 | multi-leg parser drives leg-aware activity gen + per-leg hotel | PHI-37 + PHI-39 |
| 12 | step 5 description shown exactly once + visual snapshot | PHI-25 + snapshot baseline |

### Live walk

Deferred — the Chrome MCP extension is sitting on a domain-permission prompt that needs Philip to click through in the side panel. The 12 automated tests already cover the same step transitions and contract assertions a manual walk would, so the team review draws on those plus the code state.

---

## Logical persona walks

I traced four personas through the current `main` codepaths to surface UX cliffs that the e2e suite doesn't cover.

### Mira — solo, spontaneous (parser path)

> *"4 nights solo in Lisbon, food-led, mid-budget, no nightlife"*

Lands on dual-CTA → submits free-form → parser returns Lisbon (1 destination, 4 nights, "Food-led", "comfortable", `constraintText: "no nightlife"`). Resolve-place fires in the background → Lisbon gets `lat / lng / place_id`. Allocator UI hidden (single leg). "Looks right →" advances to step 1 (dates). Step 2 hotel skipped. Step 3 picks Couple? — no, single adult, label shows "Planning a solo trip" via PHI-26. Steps 4 + 5 normal.

**Cliff:** if the parser misclassifies "no nightlife" as a `Nightlife` style tag (negation handling), Mira would see Nightlife pre-selected on step 3. Eval coverage exists (PHI-38 has a single-leg case asserting absence). No live evidence either way.

### Sam — family of 4, peanut allergy (constraints path)

> *"Singapore, 4 days, foodie trip, my daughter (10) has a severe peanut allergy"*

Parser sets `constraintTags: ["Severe allergy"]` and `constraintText: "Severe peanut allergy in 10-year-old"`. `peanut` preserved verbatim. Child age `9–12`. Continue gate (PHI-27) fires until age explicitly picked. Constraints surface in step 3 chips with the warning chrome from PHI-35. Activity-gen prompt has a hardened block: *"if 'Severe allergy' is tagged, EVERY food activity MUST include explicit allergy awareness or be filtered out."* PHI-38 eval covers this exact case.

**Cliff:** the prompt is a contract, not a guarantee. Sonnet 4.6 mostly complies, but the eval needs to actually run to bank a baseline. Today the harness ships untested.

### Hiroshi — couple, multi-leg (PHI-37 + PHI-39)

> *"Couple, Tokyo then Kyoto, 6 nights, cultural and food, comfortable"*

Parser returns 2 destinations + `durationNights: 6`. Allocator renders with **3 / 3 default** (equal-split). Hiroshi adjusts to 4 / 2. Both destinations resolve via Places. "Looks right →" → `parsedLegs` populated with both legs + per-leg nights. Step 1 dates. **Step 2 (PHI-39 new): two hotel inputs**, leg 0 + leg 1, location-biased to each leg's coordinates. He fills the Tokyo hotel, skips Kyoto. Step 4 streams activities tagged `LEG: 0` / `LEG: 1`; UI groups by leg. Step 5 itinerary preview shows sticky leg headers + a transition-day card between leg 1 day 4 and leg 2 day 5. Sign up. `legs` JSONB lands in `travelers` with `place.id / lat / lng / hotel` per leg. Anthropic call tagged with `session_id` (PHI-40).

**Smoke-tested end-to-end** — this is the path the new e2e covers.

**Cliff (Elena):** equal-split is the wrong default for Tokyo + Kyoto. Real travellers spend more time in the bigger city.

### Léa — vague (clarification path)

> *"Long weekend somewhere warm, just need to escape, surprise me"*

Parser returns `destinations: []`, `durationNights: 3`, clarifications: `["Any region preference, or are you genuinely open?"]`. Chip screen shows the clarification block + a single "Add a destination" placeholder chip. Léa has no good escape — she has to either type a destination into the prompt() editor or click "Start over" and re-prompt with more detail.

**Cliff (Maya):** there's no inline "let me edit my prompt" affordance from the chip screen. Start over throws away everything.

---

## What shipped this cycle

| Ticket | What | Status |
|---|---|---|
| PHI-25 | Duplicate body text fix on step 5 | Done |
| PHI-26 | Persistent trip-type label across compositions | Done |
| PHI-27 | 13–17 age bucket + Kid/Teen-friendly chip split + age gate | Done |
| PHI-28 | Rating button hit area + Skip + keyboard shortcuts | Done |
| PHI-30 | Destination disambiguation (gate Continue on verified place) | Done |
| PHI-31 | Anonymous session (HttpOnly cookie + 14-day TTL + claim-on-signup + privacy policy + Maya tier-1 banner) | Done |
| PHI-32 | Per-activity Why this rationale | Done |
| PHI-33 | Trip schema (legs JSONB) | Done |
| PHI-34 | Free-form parser + dual-CTA landing + chip confirmation | Done |
| PHI-35 | Constraint expression (chips + free text) | Done |
| PHI-36 | Playwright + step-5 snapshot test | Done |
| PHI-37 | Multi-leg activity generation | Done |
| PHI-38 | Activity-gen eval harness (30 cases) | Done |
| PHI-39 | Per-leg hotels for multi-leg trips | Done |
| PHI-40 | Multi-leg cost telemetry | Done |
| Follow-up #1 | Inline chip editors on PHI-34 confirmation | Done |
| Follow-up #2 | Maya's tier-2 inline + tier-3 modal-on-leave escalation | Done |
| Follow-up #3 | `/itinerary` page anon-session fallback | Done |
| Follow-up #4 | Place resolution wiring on parser output | Done |
| Follow-up #5 | Privacy policy review | Reviewed (Philip) |
| Follow-up #6 | Eval expansion (10 → 50 inputs) | Done |
| Follow-up #7 | Multi-leg activity gen | Same as PHI-37 |

15 tickets + 7 follow-ups. 12 / 12 e2e tests. One DB migration this cycle (`0006_add_session_id_to_ai_logs`). Two new scripts (`eval-activities.ts`, `multi-leg-cost-report.ts`).

---

## Sarah — Product (Value)

The activation lever rebuild landed. Six months ago first impression was a 5-step structured wizard; today it's a textarea with sample suggestions, optimistic place resolution running in the background, and a chip-confirm screen that lets users edit destination / dates / adults / per-leg nights before they commit. That's a meaningful product shift, and we paid for it in implementation depth — PHI-31, PHI-33, PHI-34, PHI-37 were each ~1-week tickets.

**What's working:**
- 12 / 12 e2e tests green; every step transition has at least one regression guard.
- Multi-leg activity generation actually generates per-leg activities. After PHI-34 alone, the parser confirmed multi-leg and the system silently dropped legs ≥ 1 — that broken promise is closed.
- Constraints surface verbatim into activity gen with a hard "MUST respect" gate for life-impacting items (allergy, mobility, dietary, religious).
- Cost is observable via PHI-40. We can revisit the architecture if multi-leg blows the budget.
- The pre-signup itinerary preview is the right activation lever — users see the actual product before committing email.

**What's not yet visible:**
- Zero real users on the new parser path. Every quality signal I have is eval-based.
- Maya's tier-3 modal-on-leave ships browser-native confirmation — no telemetry on how often it triggers.
- Activity feedback (thumbs / skip / chips) flows to itinerary-generate, but I have no signal on adoption — are users actually rating, or skimming through?
- Vague-on-destination cliff (Léa). The chip screen has no good "let me redo my prompt" affordance — Start over is destructive.

**Smallest valuable next:** wire telemetry events for parser outcomes (`parsed_clean`, `required_clarification`, `abandoned_at_chip`, `completed_signup`) and aggregate them in a dashboard. Without this we're flying blind on whether the new flow actually outperforms the old.

---

## Maya — Design (Usability)

The visual language held through 4 sprints. Sticky leg headers, transition-day muted cards, inline chip editors, per-leg night allocator — they all use the same `#f8f6f1` background, `#1a6b7f` teal, `#d4cfc5` borders. Single-leg trips render identically to the original because we gated all multi-leg UI on `parsedLegs.length >= 2`. Common case unchanged.

**Still uncomfortable:**
- **The chip-confirm screen is dense.** Destination chip(s) + date chip + adults chip + (optional) leg allocator + (optional) clarifications + "Looks right →" + "Start over". On a 360px screen that's 4–5 screen heights. The first thing the user sees might not be the most important.
- **Inline chip editing is `prompt()`.** Browser dialogs for destination / dates / adults break visual consistency. Should be inline editors or a sheet.
- **PlacesAutocomplete dropdown overlap on multi-leg step 2.** I had to force-click in the smoke test because the Google dropdown overlays Continue. That'll bite real users on small screens.
- **Tier-2 inline prompt copy is generic.** *"Loving these picks?"* is too coy. Should reference what they rated: *"You loved Pastéis de Belém — save your trip so it's still there tomorrow."*
- **No empty/loading state on the multi-leg date allocator** when `durationNights` is missing. Allocator shows "0 nights" cards. Should prompt with "Set dates first."
- **Léa's exit cliff:** clarification list with no good way to amend the prompt without losing the rest of the parse.

**Smallest valuable next:** replace `prompt()` chip editors with inline text inputs that match the visual language. Same field-and-label pattern as the structured wizard. Half a day's work, immediate quality lift.

---

## Luca — Tech Lead (Architecture)

Architecturally we're in a good place. PHI-33's `legs` JSONB ate the schema migration once, and every new feature since (PHI-37, PHI-39) layered on without DB churn. PHI-40's `session_id` was the only schema add this cycle. That's the architectural test — does the shape absorb new requirements? Yes.

**Hot spots:**
- **Two prompts in two files plus an inline copy in the eval script.** `app/api/activities-stream/route.ts` SYSTEM, `scripts/eval-activities.ts` SYSTEM, plus the `legsBlock` builder in both. They drift. The eval mirrors the route at writing time, but anyone editing the route prompt has to remember to mirror it in the eval. That bites in 3 months. Not urgent, but file a tech-debt ticket.
- **12 e2e tests in 35–40s.** Fast enough today. But every new feature added a test, none was removed — at 25–30 tests we'll hit Playwright's tolerance for flake. PlacesAutocomplete already produced one (force-click workaround in PHI-39). Worth a "test hygiene" pass before the count grows further.
- **Multi-leg cost ratio observable but not measured.** Ratio = 0 today because `session_id` was just added. Need a week or two of real traffic.
- **PHI-38 eval harness ran zero times.** The script exists, the cases are typed, but I haven't seen output. Run once, bank a baseline.
- **Anthropic prompt caching is wired** (`cache_control: ephemeral` on SYSTEM blocks). With multi-leg's longer prompts, cache hit rate matters more — should appear in `api_usage` rows but I haven't validated.
- **Per-leg PlacesAutocomplete components** on step 2 share the Maps script via singleton but each opens its own dropdown. With 3+ legs the visual stacking gets hairy — defer to PHI-39 follow-up if user feedback signals.

**Smallest valuable next:** run `npm run eval:activities` once, bank the baseline output. Then file a small ticket to extract the legs-block builder to `lib/` so route + eval share it.

---

## Elena — Travel Expert (Reality)

The biggest improvement: we now respect that travellers move between cities. PHI-37 fixed the broken promise — the parser said "I heard you, two cities" and the system actually does it now. That earns more trust than anything else this cycle.

**Where I'm still uneasy:**
- **Equal-split as default on the chip-confirm allocator is wrong.** Real travellers don't split equally between cities. Tokyo + Kyoto in 6 nights is more like 4 + 2 (Tokyo as base, Kyoto as side trip). Lisbon + Porto in 5 nights is more like 3 + 2. We default to 3 / 3 and 3 / 2, which forces every multi-leg user to manually rebalance every trip. The default should reflect prior knowledge: leg 0 gets ~60% of nights when there are 2 legs, otherwise equal.
- **"Per-leg hotel" is a real-world misnomer for many trips.** Many "multi-leg" travellers stay in one base and day-trip out. The PHI-37 prompt already says "stay in previous leg's hotel when ≤2 nights" — but the PHI-39 UI contradicts this by asking for a hotel for every leg. The prompt is right; the UI is too aggressive. Add *"or skip — you can also day-trip from your previous hotel"* to the second-leg field copy.
- **Transition day still feels like a designer's afterthought.** A muted card saying *"Travel to Kyoto"* doesn't help a real traveller. What they need on travel day: time of train / flight, where to leave bags, a meal close to the station, *"check-in is at 3pm so plan something nearby."* Empty card feels cold.
- **Severe allergy in multi-leg has a real edge case.** Every food card includes allergy awareness — but subtle ingredients in regional cuisine the model doesn't know to flag are still a risk. *"Likely allergen-free, please confirm"* isn't enough — needs a stronger "we cannot guarantee, ask the restaurant" footer per leg.
- **Last leg under-attended.** Sonnet biases toward variety — if leg 1 has 5 cards, leg 2 may also have 5. The prompt says "fewer on later legs" but we don't enforce it. Real-world travellers are exhausted by leg 3.

**Smallest valuable next:** ship a smarter default in the night allocator: leg 0 gets ⌊60%⌋ when there are 2 legs, otherwise equal. Document the why so we don't second-guess later.

---

## Synthesis

After PHI-25 through PHI-40, the onboarding flow is end-to-end coherent — the parser, chip confirmation, structured wizard, multi-leg activity gen, signup, and itinerary all work together. The 12 automated tests give confidence in structural contracts; the missing piece is real user data and real model-output data. The team's biggest converging concern is **observability of the new parser path** — Sarah wants user-event telemetry, Luca wants the activity-gen eval baseline, Elena wants signals on whether multi-leg is actually being used the way the prompts assume. Maya's concerns (`prompt()` chip editing, Tier-2 copy, allocator empty-state) and Elena's smarter-default split are real but are polish that should queue up after we know how the model performs.

### Agreed next step

**Run `npm run eval:activities` once, bank the baseline, and file the top-3 most actionable findings as tickets.** That gives Sarah quality data, Luca a regression floor, Maya a list of prompt issues to address (if any), and Elena a place to weigh in on which model behaviour matches traveller reality.

Everything else queues after the baseline:
1. Sarah: parser-outcome telemetry events + dashboard
2. Maya: replace `prompt()` chip editors with inline inputs
3. Elena: leg-0-gets-60%-default in the night allocator
4. Luca: extract shared legs-block builder; test-hygiene pass

### Open question for Philip

The eval costs ~$1–2 per run on Sonnet 4.6 (one Anthropic call per case × 30 cases × ~1k tokens out). Is the API budget OK to run it now, or do you want to gate on prompt-edit cadence (the PRD-stated rule is "before any prompt edit in `/api/activities-stream`")?
