# PHI-34 / RISE-301 — Free-form Trip Description PRD

**Status:** Draft for sign-off · **Author:** Sarah (PM) with Elena (Travel Expert) input · **Reviewers:** Maya (Designer), Luca (Tech Lead) · **Date:** 2026-05-04

This is the spec the team review identified as the gate before any code on PHI-34. It's the largest single move in the onboarding backlog and the differentiator vs. ChatGPT's free-tier — so it's worth doing well.

---

## 1 · Problem & opportunity

Today's onboarding treats the user like a 2018 web user filling out a structured booking form. In 2026, the user's mental model is "talk to the AI." The structured form is competent but generic — ChatGPT can do this for free.

**Opportunity:** a free-form trip description that the LLM parses into the same structured trip schema. Solves multi-city, constraint expression, and express-path *in a single move*. Repositions the product as an *intelligent travel agent* rather than a *form-based AI tool*.

**Strategic question this answers:** "Is Rise an expert travel planner or a fast travel assistant?" The free-form path serves the *fast* user (Marco, Mira); the structured form remains for users who want guided choices (Anjali, Sam & Chris).

---

## 2 · Outcomes & success metrics

**Primary:**
- ≥40% of new users in the first 4 weeks choose the free-form path on first visit
- Free-form completion rate ≥80% of structured completion (i.e. it doesn't lose us users)
- Onboarding time-to-itinerary drops by ≥40% for free-form users

**Secondary:**
- Reduced clarification rate over time (parse cleanly on first try ≥70% by week 4)
- Multi-city trips (≥2 legs) start showing up — a leading indicator of differentiation since structured form doesn't natively support them
- Cost per activated user stays within +30% of pre-launch baseline (the parser adds tokens; if it's >30%, we're spending too much)

**Negative metrics to watch:**
- "Free-form started, structured finished" rate >25% means the parser is failing too often
- Hallucinated constraints (user reports / Why-this contradiction) >5% means we need a tighter parser prompt or a confirmation step we don't have

---

## 3 · The flow

### 3.1 Landing

Today: full-screen "Where to?" with a single Places autocomplete.

Proposed: dual-CTA hero with the free-form path as primary.

```
[Hero copy: "Tell us about your trip"]

[Large textarea, 4 lines tall]
[Placeholder: "e.g. Two of us, Portugal and Spain for two weeks in June, love food and history, no hiking, my wife has a knee issue."]

[3 example chips below the textarea — one-tap fills the textarea:]
  · 4 nights solo in Lisbon, food-led, mid-budget
  · Family Portugal trip, kids 7 and 11, beach + culture
  · Two weeks Italy honeymoon, anniversary, no hiking

[CTA: "Plan my trip →"]

[Below: "Or step by step →" link → drops user into the existing structured form]
```

The structured-form fallback is a single text link. The free-form path is the primary flow.

### 3.2 Parsing state

After submit:

```
[Animated dots + "Reading your trip..."]
```

200–600ms typically (parser is small, fast). Streaming "thinking aloud" text would feel more intelligent ("looking for cities in Portugal and Spain...") but adds latency — defer to v2.

### 3.3 Confirmation chips

Critical safety net. Without it, hallucinated parses ship straight to activity generation.

```
"Got it. You're going to Lisbon and Madrid for 14 days, 2 adults, food + history, accessibility considerations. Anything to fix?"

Each parsed field is a clickable chip:
  [📍 Lisbon, Portugal · Jun 15–20] [edit]
  [📍 Madrid, Spain · Jun 20–29] [edit]
  [👤 2 adults]
  [🎯 Cultural · Food-led]
  [💼 Comfortable budget]
  [⚠ Note: "knee issue, no long walks"]

[+ Add anything else]
[Looks right — generate my activities →]
[Start over]
```

Clicking a chip opens an inline editor for that specific field. Other chips don't change. The "Looks right" CTA proceeds to activity generation (existing PHI-32-enhanced flow).

### 3.4 Clarifications (when parser couldn't fill a required field)

If the parser couldn't extract dates / a destination it's confident about / a party composition, the confirmation page shows targeted questions:

```
"Got it — a few quick clarifications before I plan:"

❓ When are you going? [date picker — both dates required]
❓ How many people? [stepper]

[Continue →]  [Or fill the rest as a form →]
```

One question per missing required field. Always offer the structured-form escape if the user gets frustrated.

---

## 4 · What the parser must handle (Elena's input-pattern catalogue)

Real traveller inputs from Elena's 15 years as a travel planner. The parser must handle these gracefully:

| Pattern | Example | Parser behaviour |
|---|---|---|
| Vague-on-destination | "Long weekend somewhere warm, surprise me" | Treat as a clarification, not an error. Ask: "Any region preference, or are you genuinely open?" |
| Region (not city) | "Two weeks in Tuscany" | Accept as `placeType: "region"` (PHI-30 schema). Multi-city follow-up: "Want help picking specific cities?" |
| Anniversary / honeymoon / birthday | "Anniversary trip", "honeymoon", "her 40th" | Extract as `occasion` field that biases tone (romantic vs. casual). **Differentiator vs. ChatGPT** — generic LLMs miss this. |
| Mobility constraint stated offhand | "my back hurts", "knee surgery last year" | Extract as a constraint into the constraints field (PHI-35). Surface in the confirmation chip explicitly. |
| Health / medical | "first-trimester pregnancy", "celiac" | Same — extract, surface, treat as life-impacting if applicable. |
| Multi-country | "Portugal and Spain", "Italy + Croatia + a stop in Slovenia" | Extract as multiple legs (depends on PHI-33 schema). |
| Time-vague | "next month", "early summer", "during half-term" | Suggest specific dates, ask user to confirm. Half-term varies by region — ask which country's school calendar. |
| Budget hint without amount | "treat ourselves", "savvy", "we're saving up" | Map to budget tier (Flexible / Comfortable / Savvy) but flag low-confidence. |
| Trip purpose | "bucket list", "first big trip in a decade", "kids' first time abroad" | Use to bias activity selection toward high-impact / accessible / once-in-a-lifetime experiences. |
| Following an event | "for Eurovision in Basel", "around the Tour de France finish" | Extract event + city + dates. Bias toward event-period activities. |

The parser MUST NOT:
- Invent constraints the user didn't mention (Elena's "no fabrication" rule from PHI-32)
- Skip fields silently — if uncertain, ask
- Resolve ambiguous places without confirmation (PHI-30 reuse: parser-extracted destinations flow through the place-resolution endpoint and may surface "Did you mean Lisbon or Lisboa region?" inline)

---

## 5 · Parser prompt sketch

```
You are a travel-planning input parser. Convert a user's free-form trip
description into a structured TripIntent JSON object. Be conservative —
NEVER invent fields the user didn't mention. When a required field is
uncertain or missing, return it as a clarification rather than guessing.

Output schema (use Anthropic's structured-output / tool-use mode):

type TripIntent = {
  destinations: { name: string }[];      // one entry per leg/region/country
  dates: { departure?: string; return?: string; durationNights?: number };
  party: { adults?: number; children?: { ageRange?: string }[] };
  styleTags: string[];                   // matches existing taxonomy
  budgetTier?: "budget" | "comfortable" | "luxury";
  constraintTags: string[];              // matches PHI-35 chip taxonomy
  constraintText?: string;               // anything not in tags
  occasion?: "anniversary" | "honeymoon" | "birthday" | "bucket_list" | "other";
  clarifications: string[];              // questions for the user, one per missing required field
};

Rules:
1. NEVER invent. If user said "no hiking" but didn't mention dietary, leave constraintTags empty for diet.
2. Be conservative with budget: if user said "treat ourselves," map to luxury, but include in clarifications: "Confirm: ~£300/night per person, or different?"
3. Multi-country → multiple destination entries (one per country/city).
4. Vague destinations ("somewhere warm") → empty destinations + clarification: "Any region preference, or are you genuinely open?"
5. Always extract occasion if mentioned. It biases downstream tone.
6. Children: extract ages or age ranges. If said "the kids" without ages, push to clarifications.
7. Output ONLY the JSON object. No prose.

Examples:
[Three sample inputs + outputs spanning the patterns above — see eval set.]
```

Temperature: 0–0.2. Model: Sonnet 4.6. Estimated input tokens: ~500 (system + examples), output: ~200.

---

## 6 · 50-input eval plan

Before code freeze, run 50 inputs through the parser. Score each on:

1. **Field accuracy** (1 pt per correctly extracted field; deduct 1 per hallucinated field)
2. **Clarification appropriateness** (did the parser correctly flag missing required fields, vs. silently skipping or vs. over-clarifying?)
3. **Place resolution** (does the place flow through PHI-30's resolver and surface ambiguity inline?)
4. **Constraint preservation** (life-impacting constraints — allergies, mobility — must NEVER be dropped)

**Pass gate:** ≥85% field accuracy, 100% on constraint preservation, ≤10% over-clarification rate.

**Test inputs span:**

```
1. "Ten days in Italy, May, anniversary, food and wine, no hiking, my back hurts"
2. "Bucket list trip — Japan in cherry blossom season, two weeks, foodie, photographer husband, mid-budget but treat ourselves once"
3. "Long weekend somewhere warm, just need to escape, surprise me"
4. "Family of 5, 7 nights, pool, kid club, all-inclusive, May half-term"
5. "Following Eurovision in Basel — what to do for 3 nights, late May"
6. "Mum, dad, two teens, Iceland, late June. Photographer, no group tours."
7. "Solo trip, Lisbon, 4 nights, food-led, no nightlife"
8. "Couple's anniversary, Paris, weekend, Michelin-curious"
9. "Bachelorette in Barcelona, 4 of us, 3 nights, beach + clubs"
10. "Multi-gen family trip — me, partner, our two kids 8 and 12, my parents (60s, knee issues), Tuscany, 10 nights"
... [40 more spanning the patterns in §4, including pathological cases like very short trips, very long trips, conflicting signals, profanity, non-English]
```

**Run owner:** Luca, with Elena reviewing 20% sample for travel-domain accuracy.

---

## 7 · Telemetry

| Event | When | Why |
|---|---|---|
| `freeform_initiated` | User clicks Plan my trip with text in the textarea | Funnel top |
| `freeform_parsed_clean` | Parser returned 0 clarifications | Quality of parse |
| `freeform_required_clarification` | Parser returned ≥1 clarification | Quality + UX |
| `freeform_chip_edited` | User clicked a confirmation chip to edit | Trust signal — high edit rate = parser hallucinating |
| `freeform_completed` | User clicked "Looks right — generate" | Conversion |
| `freeform_abandoned_to_structured` | User clicked "Or step by step" after starting free-form | Failure mode signal |

**Watch:** `freeform_chip_edited` rate per session. If users edit ≥2 chips per parse on average, the parser is too inventive.

---

## 8 · Risks

| Risk | Mitigation |
|---|---|
| **Hallucinated parsing** — parser invents constraints | Confirmation chips are the safety net. 50-input eval before launch. Tight prompt with "NEVER invent" rule. |
| **Cost** — parser + activities + rationales compounds tokens | Track cost-per-activated-user. If >30% above baseline, investigate prompt caching or smaller parser model. |
| **Cold-start UX** — empty textarea is intimidating | Three example-prompt chips below the textarea (one-tap fills). |
| **Voice / multi-turn drift** — users may want to refine | Defer to v2. v1 is single-shot parse + confirmation chips + manual edit. |
| **Free-form-first regression** — structured users feel demoted | Keep "Or step by step →" link visible and friendly. Don't make structured feel like a fallback for the slow. |

---

## 9 · Out of scope (defer to v2 or follow-ups)

- **Voice input.** Tempting but personas mostly want speed + structure. Save for v3.
- **Multi-turn refinement.** v1 = single-shot parse + chip edits. If users want to "make it more romantic" mid-flow, that's a future Q2 ticket.
- **Free-form-as-default for returning users.** v1 ships dual-CTA. Once we see usage data, decide whether to flip the default.
- **Multi-leg activity generation.** Schema (PHI-33) supports legs; v1 of free-form may parse multi-city into the schema but still generate activities for the primary destination only. Multi-leg activity generation is its own follow-up.
- **Localisation.** v1 is English-only. Multilingual parsing is a substantial separate piece.

---

## 10 · Dependencies & sequencing

**Blocked by:**
- PHI-30 (place resolution endpoint — parsed destinations flow through it)
- PHI-33 (legs JSONB schema — parser writes multi-leg trips)

**Blocks:**
- (Q2) Multi-leg activity generation
- (Q2) Voice input
- (Q2) Multi-turn refinement

**Dev sequencing:**
1. Week 1: Parser prompt + JSON schema. Eval harness with 10 inputs (proof). Confirm Sonnet 4.6 + structured-output works as expected.
2. Week 2: Confirmation chip UI. Inline editors per field type.
3. Week 2: Wire to PHI-30 place resolution. Wire to PHI-33 legs schema.
4. Week 3: 50-input eval. Iterate prompt until pass gates met.
5. Week 3: Telemetry. Cost monitoring.
6. Week 3: Soft launch behind feature flag. Watch metrics for 1 week.
7. Week 3–4: Decide promotion to default for new users (if metrics support).

**Estimate:** 10–15 dev-days + 3 days prompt iteration + 2 days Maya design.

---

## 11 · Open questions for sign-off

1. **Default path on first visit:** dual-CTA with free-form primary, or "What's your style?" picker first? Recommend: dual-CTA, free-form primary.
2. **Cost cap:** if cost-per-activated-user spikes >30%, do we (a) revert, (b) optimise, (c) pass through pricing? Recommend: optimise budget for prompt caching first.
3. **Returning users:** structured form and free-form remember the user's last preference?
4. **Parsed-but-unconfirmed trips:** if a user starts free-form, gets to confirmation chips, then bounces — do we save the parsed state in the anonymous session (PHI-31)? Recommend: yes, treat the same as any in-progress trip.
5. **Parser caching:** Anthropic prompt-caching could shave a lot of repeat-token cost. Worth investigating in week 1.

---

**Ready for sign-off when:** Maya signs off on the confirmation-chip pattern; Luca commits to running the 50-input eval before code freeze; Sarah confirms the success metrics with whoever owns growth dashboards. After sign-off, code can begin.

This is the move that makes Rise feel new. Worth doing well.
