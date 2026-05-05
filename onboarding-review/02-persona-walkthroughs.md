# Persona walkthroughs — Rise onboarding

Each persona below was walked through the live flow at https://rise-fawn.vercel.app
on 2026-05-03. Reactions are written in-character based on persona profile +
observed behavior of the live product.

Symbols: 🟢 = working well · 🟡 = friction · 🔴 = likely drop-off / breaking issue

---

## 1. Mira — The Spontaneous Solo Traveler

**Trip:** Solo, 4 nights in Lisbon

| Screen | Reaction |
|---|---|
| Landing | 🟢 "Thoughtfully planned" feels promising — calm, not gimmicky. Hits CTA fast. |
| Where to? | 🟡 Types "Lisbon" and hits Enter. The field overrode her input to "Cascais, Portugal" once during my testing — if that happens to her, she'll think the app is broken or doesn't trust her. **Critical:** no visible autocomplete dropdown showing what's about to happen. |
| Dates | 🟢 Quick. Date pickers are native — fine. |
| Where staying? | 🟡 "I haven't booked yet" — clicks skip. Wonders why this is a separate step instead of inline on dates. Loses momentum. |
| Tell us about yourself | 🔴 Sets Adults to 1. **Trip Type chips disappear entirely.** She wonders if she missed a step or if the page is broken. There is no "Solo" chip to confirm her choice was understood. Continue is enabled with NO selections — she's not nudged to pick a travel style, which means her itinerary won't be personalized. She's confused: "What did I just tell it?" |
| Activities | 🟢 Cards are good quality. 🟡 Thumb buttons are tiny — she misses on mobile-sized clicks. CTA says "Continue with N rated — more = better results" which feels nudgy in a good way. |
| Save trip | 🟡 Account creation feels like a paywall. She's only just seen the value. Wishes she could see the actual itinerary first. **Duplicated description text** ("Your activity plan, transport advice, and trip summary are ready..." appears twice in different styles) makes it feel unfinished/buggy. |

**Headline issues for Mira:**
1. Solo trip is invisible — no positive confirmation of trip type.
2. Forced signup before seeing the itinerary kills her impulsive vibe.
3. Destination auto-correction without showing options breaks trust.

---

## 2. Anjali Patel — The Family Trip Planner

**Trip:** Family of 4 (2 adults + kids age 7 and 11), 7 nights, Portugal

| Screen | Reaction |
|---|---|
| Landing | 🟢 Likes "thoughtfully planned" — sounds careful. |
| Where to? | 🟡 Types "Portugal" because she's still deciding between Lisbon, Porto, Algarve. Worried the field expects a city, not a country. |
| Dates | 🟢 Fine. |
| Where staying? | 🟡 Hasn't booked. Skips. Notices that the Continue button is also enabled when the field is empty — wonders if the skip link is even necessary, or if she's missing something. |
| Tell us about yourself | 🟡 Adds 2 children. **Per-child age selectors appear** — she's impressed. Picks 5-8 for one and 9-12 for the other. 🔴 She has a 13-year-old niece who might join — there's no teen option. Trip Type chips disappeared again — she half-misses "Family" as confirmation. 🟢 The travel style chips smartly added "Kid-friendly", "Beach", "Educational" which she appreciates. |
| Activities | 🟢 Notices descriptions mention "pram-accessible" and "easy to navigate with a pram" — she's pleasantly surprised the model is actually using the family context. 🟡 But she has no way to flag allergies, mobility, or specific concerns ("we don't do hikes longer than 2km"). |
| Save trip | 🟡 Feels asked to commit before seeing whether the trip is worth saving. Will probably bounce to compare with TripAdvisor before filling in her real email. |

**Headline issues for Anjali:**
1. Age buckets stop at 9-12 — teen families excluded.
2. "Under 2" pre-selected for every child — easy to miss; could mis-personalize trips.
3. No way to express constraints (allergies, mobility, dietary, religious) — high-stakes for families.
4. No trust signals: where do recommendations come from? Reviews? Editorial?

---

## 3. Marco Rinaldi — The Bleisure Business Traveler

**Trip:** Solo, 2 nights bleisure in Lisbon after a conference

| Screen | Reaction |
|---|---|
| Landing | 🟡 Clean, but he's already wondering "how many fields?". Wants speed. |
| Where to? | 🟢 Quick. Solo input field, no overhead. |
| Dates | 🟢 Fast. |
| Where staying? | 🟢 He's already booked — the hotel field is genuinely useful here. Types in his hotel name. Wishes there were autocomplete or recognition (typing free-form text feels old). |
| Tell us about yourself | 🔴 He's irritated. He's a solo professional, just wants 3 great dinner spots and one half-day activity. Why is he picking a "travel style" out of 10 chips? He picks "Food-led" + "Cultural" and clicks budget Flexible. Trip type chip is invisible because he set Adults=1 — again, no confirmation of what was understood. |
| Activities | 🟡 6+ cards, all good — but he wants 3 picks, not a swipe deck. The rating workflow feels casual for a business user. Wishes he could say "just give me your top 3 for tomorrow night." |
| Save trip | 🔴 He doesn't have time. **Drop-off risk is highest here.** He wants to *see* the itinerary before signing up. May abandon. |

**Headline issues for Marco:**
1. Onboarding is too long for short trips. The "5 steps" ratio breaks for a 2-night trip.
2. No "I already know what I want" or "give me your best picks" express path.
3. Forced account creation before payoff.
4. Hotel field is free-text — feels like 2014.

---

## 4. Sam & Chris — The Bucket-List Couple

**Trip:** 14 nights, Portugal + Spain (multi-city), once-in-a-decade

| Screen | Reaction |
|---|---|
| Landing | 🟢 "Thoughtfully planned" reassures Chris. |
| Where to? | 🔴 Multi-city is the obvious need — they're going Lisbon → Porto → Madrid → Barcelona. The single field can't express that. They type "Portugal and Spain" and hit Continue — what happens? Probably a single city interpretation. **This is a potential trip-killer.** |
| Dates | 🟢 OK. 🟡 Visually small text and low contrast — Sam squints. |
| Where staying? | 🔴 They're staying in 4 different hotels. Field is single. They skip but feel the system isn't going to give good advice. |
| Tell us about yourself | 🟢 Couple chip = "us." Picks Cultural + History + Food-led. Comfortable budget. Continue. They appreciate the human-language tags. |
| Activities | 🟢 Cards are impressively curated. 🟡 But — only ~6-8 cards for a 14-night trip? They expect dozens. They're worried they're seeing a small sample, not the real itinerary. The "Found 2 of ~6" loading text undersells the model. |
| Save trip | 🟡 The duplicated body text on this screen is what triggers their fear: "is this AI slop?". They'll Google reviews of "Rise" before entering an email. |

**Headline issues for Sam & Chris:**
1. **No multi-city support** — their core trip is impossible to express.
2. Only 6-ish activities surfaced for a 14-night trip — feels thin.
3. Trust signals are missing — no source attribution, no "curated by", no editorial voice.
4. The duplicate body text bug on the signup screen kills credibility for trust-sensitive users.

---

## 5. Tomás — The Budget Friend-Group Organizer

**Trip:** 4 friends, 3 nights in Lisbon

| Screen | Reaction |
|---|---|
| Landing | 🟢 Clean. He's organizing for the group — his friends will see the output, so quality matters. |
| Where to? | 🟢 Fine. |
| Dates | 🟢 Fine. |
| Where staying? | 🟢 They booked an Airbnb. Types it in. (Probably not recognized — but that's OK to him.) |
| Tell us about yourself | 🟢 Sets Adults to 4, picks "Friend group" — finally sees a chip that matches. Picks Nightlife + Food-led + Off the beaten track. Savvy budget. 🟡 But — chips are "pick up to 3" which feels limiting; nightlife AND beach AND food AND budget-savvy AND photography are all relevant for the trip. |
| Activities | 🟢 Recommendations align — he's pleased. 🔴 But he wants to share these picks with his 3 friends to vote. **No share option.** |
| Save trip | 🟡 Sign-up before share kills him. He's not the one going to use this account most — his 3 friends will. Wants to dump the itinerary into WhatsApp, not create accounts. |

**Headline issues for Tomás:**
1. No social/share path. Group trips are inherently shared.
2. "Pick up to 3" is too restrictive for diverse group interests.
3. Group-vote / collaborative rating could be a killer feature for this segment.

---

## Cross-cutting observations

These came up across multiple personas:

1. **Trip Type chip disappears for Solo and Family** — a confirmation gap. Two of five personas felt the system didn't "see" them.
2. **Forced signup before seeing the itinerary** — every persona except Anjali (most patient) flagged it.
3. **No multi-city, multi-stay, or constraint expression** — Sam, Anjali, and Marco all needed it.
4. **Trust signals missing** — high-trust personas (Anjali, Sam & Chris) want to know where recommendations come from.
5. **Rating UI is ambiguous** — buttons are small; only "Interested / Not for me" without a "skip / not sure" makes users skip cards entirely (which lowers the count).
6. **Duplicate text bug on signup screen** — universally noted as a credibility hit.
7. **Destination auto-correction** — when "Lisbon, Portugal" silently became "Cascais, Portugal" in one walkthrough, that's a major trust break.
