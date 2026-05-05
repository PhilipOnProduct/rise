# Rise onboarding — Sprint board (one-page summary)

A condensed view of all three sprints. For sharing, standups, or pinning above the
desk.

---

## Sprint 1 · Quick Wins · Week 1–2

| ID | Ticket | Effort | Lens | Status |
|---|---|---|---|---|
| RISE-101 | Fix duplicate body text on signup screen | XS | Designer | □ |
| RISE-102 | Persistent trip-type confirmation label | S | Designer + PM | □ |
| RISE-103 | Add 13–17 age bucket; remove "Under 2" default | XS | Designer | □ |
| RISE-104 | Larger rating buttons + "Skip" affordance | S | Designer | □ |
| RISE-105 | Step counter cleanup | XS | Designer | □ |

**Goal:** ship 5 visible improvements that build trust and close confirmation gaps.
**Total:** ~4–5 dev-days.
**Done when:** all 5 shipped, baseline conversion measured before & after.

---

## Sprint 2 · Trust + Activation · Week 3–6

| ID | Ticket | Effort | Lens | Status | Depends on |
|---|---|---|---|---|---|
| RISE-201 | Destination disambiguation dropdown | M | PM + Design + Tech | □ | — |
| RISE-202 | Pre-signup itinerary view (anonymous session) | M-L | PM + Tech | □ | — |
| RISE-203 | Per-activity "Why this" rationale | S-M | PM + Tech | □ | — |

**Goal:** activation lift + trust foundations. Architecture change in RISE-202.
**Total:** ~10–17 dev-days.
**Done when:** all 3 shipped; pre-signup itinerary view rate measurable; LLM cost
monitoring in place (RISE-203 adds tokens per session).

---

## Sprint 3 · Differentiation · Week 7–14

| ID | Ticket | Effort | Lens | Status | Depends on |
|---|---|---|---|---|---|
| RISE-303 | Combined trip-details step (schema-touching) | M | Designer + Tech | □ | RISE-201 |
| RISE-301 | Free-form trip description as lead path | L | PM + Tech + Design | □ | RISE-201, RISE-303 |
| RISE-302 | Constraint expression (allergies, mobility) | M | PM | □ | RISE-301 (subset) |

**Goal:** make Rise feel like a 2026-grade AI product, not a structured form with
an LLM behind it.
**Total:** ~17–26 dev-days.
**Done when:** all 3 shipped; free-form vs. structured choice rate measured for
≥30 days.

---

## Cross-sprint dependency map

```
RISE-101 ──┐
RISE-102 ──┤
RISE-103 ──┼─ Sprint 1 (independent, ship in any order)
RISE-104 ──┤
RISE-105 ──┘

RISE-201 ──┐
RISE-202 ──┼─ Sprint 2 (independent of each other; 201 enables 301)
RISE-203 ──┘

RISE-303 ─────────┐
                  ├─ RISE-301 ── RISE-302 (subset of 301 logic)
RISE-201 (S2) ────┘

Q2 (parked):
RISE-401 Share/collaborate
RISE-402 Multi-city in itinerary view
```

---

## Metrics to instrument across all sprints

Set these up before Sprint 1 ships so you have a baseline:

1. **Onboarding completion rate** (overall + by party type: solo / couple /
   family / friend group). Today, expect Solo and Family to underperform.
2. **Drop-off by step** — count of users entering each step vs. completing.
   Today, expect step 5 (signup wall) to be the largest drop.
3. **Pre-signup itinerary view rate** (post RISE-202 only).
4. **Destination disambiguation acceptance rate** (post RISE-201): % of typed
   queries where user accepts a suggested place vs. uses "anyway" escape.
5. **Free-form vs. structured choice rate** (post RISE-301).
6. **"Why this" expansion rate** (post RISE-203).
7. **Time-to-first-activity-rating** as an onboarding-friction proxy.
8. **LLM cost per activated user** — grows across sprints; track for unit
   economics sanity.

---

## Open decisions to make (founder/PM)

These came up in the synthesis and the answer shapes Sprints 3+:

1. **Lead persona for v1:** Marco-style speed/efficiency, or Sam & Chris-style
   depth/trust? Pick one; serve the other as a secondary path.
2. **Activation thesis:** confirmed by Sprint 2 (free preview pre-signup).
   Don't waver mid-sprint.
3. **Lead input pattern:** structured 5-step (improved in Sprint 1+2) vs.
   free-form-first (Sprint 3). Today's recommendation: dual-path with
   structured as fallback. Reassess after Sprint 3 data lands.
4. **Group / collaboration story:** Q2 work but worth a discovery doc now —
   if friend-group + family travelers are big segments, this is real.

---

## Document index

All deliverables in `C:\Users\Philip\Rise\onboarding-review\`:

1. `01-personas.md` — five persona profiles
2. `02-persona-walkthroughs.md` — screen-by-screen reactions
3. `03-synthesis.md` — PM, Designer, Tech Lead lenses
4. `04-prioritized-shortlist.md` — Implement / Consider / Park
5. `05-sprint-1-tickets.md` — quick wins
6. `06-sprint-2-tickets.md` — trust + activation
7. `07-sprint-3-tickets.md` — differentiation
8. `08-sprint-board.md` — this document
