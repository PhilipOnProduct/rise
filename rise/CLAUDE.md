# Rise — CLAUDE.md

## Project Overview

Rise is an AI-powered personal travel concierge app. It helps travellers plan trips (destination, dates, hotel, activities), get smart transport advice (airport → hotel), and discover insider local tips from real residents.

**Business model:** B2C SaaS with a freemium layer. Local guides contribute tips to the platform and earn reputation points; travellers pay for personalised AI recommendations and planning tools.

**Current stage:** Early MVP. Core flows are working end-to-end. Being tested with real users on Vercel.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| Database | Supabase (Postgres + JS client) |
| AI | Anthropic API — `claude-sonnet-4-6` for most features |
| Hosting | Vercel (Edge middleware for password protection) |
| Font | DM Sans via `next/font/google` |
| Maps | Google Maps JS API (New Places API) |

---

## Current Features

### Traveller flows
- **Onboarding wizard** (`/welcome`) — 5-step flow: destination (Google Places autocomplete) → travel dates → hotel (Places autocomplete biased to destination) → activity selection (AI-generated) → account creation. Saves to Supabase `travelers` table and `localStorage`.
- **Dashboard** (`/dashboard`) — Shows trip summary (destination, dates, nights, hotel, activities) read from `localStorage`. Links to transport, profile, and guides.
- **AI activity suggestions** (`/api/activities`) — POSTs destination to Claude, returns 20 categorised activities as JSON.
- **Airport → Hotel transport** (`/transport`) — Streaming AI advice comparing public transport vs taxi for a given airport/hotel/city.
- **Travel profile & restaurant recommendations** (`/profile`) — Collects traveller type, destination, dates, company, budget, dietary wishes. Streams personalised restaurant picks from Claude.

### Local guide flows
- **Browse guides** (`/guides`) — City search landing page.
- **City tips** (`/guides/[city]`) — Lists all tips for a city with guide name, reputation badge, and star rating button. Increments view count on load; awards 15 points at 10 views.
- **Submit a tip** (`/guides/add`) — Form to add a local tip. Find-or-creates guide by email in `guides` table, inserts tip with `guide_id`, awards 10 points.
- **Rate a tip** (`/api/tips/[id]/rate`) — POST inserts into `tip_ratings`, awards 25 points to the guide. Duplicate prevention via `localStorage`.
- **Leaderboard** (`/guides/leaderboard`) — Top 10 guides ranked by points with level badges.

### Reputation / points system
- Levels: 🌱 Explorer (0–49 pts) · 📍 Local (50–199) · 🔑 Insider (200–499) · ⭐ Legend (500+)
- Events: submit tip (+10), tip reaches 10 views (+15), traveller rates tip (+25)

### Admin
- **AI Logs** (`/admin`) — Table of all Claude API calls with prompt, input, output, latency, token counts, and per-log rating/notes for evaluation.

### Infrastructure
- **Password protection** — Edge middleware (`middleware.ts`) redirects unauthenticated users to `/api/auth`. GET shows the form; POST sets an `httpOnly` cookie.
- **AI logging** (`lib/ai-logger.ts`) — Wraps every Claude call; logs to Supabase `ai_logs` table.
- **Shared Supabase client** (`lib/supabase.ts`) — Single client instance used everywhere.

---

## Project Structure

```
rise/
├── app/
│   ├── page.tsx                  # Homepage / marketing landing
│   ├── layout.tsx                # Root layout — DM Sans font, Nav component
│   ├── globals.css               # Dark CSS variables, fadeSlideUp animation
│   ├── welcome/page.tsx          # 5-step onboarding wizard
│   ├── dashboard/page.tsx        # Trip summary dashboard
│   ├── profile/page.tsx          # Travel profile + restaurant recs
│   ├── transport/page.tsx        # Airport → Hotel advice
│   ├── admin/page.tsx            # AI log viewer
│   ├── guides/
│   │   ├── page.tsx              # City search
│   │   ├── add/page.tsx          # Submit a tip
│   │   ├── leaderboard/page.tsx  # Points leaderboard
│   │   └── [city]/page.tsx       # Tips for a city
│   ├── api/
│   │   ├── auth/route.ts         # GET: password form  POST: verify password
│   │   ├── activities/route.ts   # POST: AI activity suggestions
│   │   ├── travelers/route.ts    # POST: save traveller to Supabase
│   │   ├── recommendations/route.ts  # POST: streaming restaurant recs
│   │   ├── transport/route.ts    # POST: streaming transport advice
│   │   ├── profile/route.ts      # POST: save profile to Supabase
│   │   ├── guides/
│   │   │   ├── route.ts          # GET: tips by city  POST: add tip + award points
│   │   │   └── leaderboard/route.ts  # GET: top 10 guides
│   │   ├── tips/[id]/
│   │   │   ├── view/route.ts     # POST: increment view count, award milestone points
│   │   │   └── rate/route.ts     # POST: rate a tip, award guide points
│   │   └── admin/logs/
│   │       ├── route.ts          # GET: all AI logs
│   │       └── [id]/route.ts     # PATCH: update rating/notes
│   └── components/
│       ├── Nav.tsx               # Sticky top nav with dropdowns + mobile hamburger
│       └── PlacesAutocomplete.tsx  # Google Places (New API) autocomplete input
├── lib/
│   ├── supabase.ts               # Shared Supabase client — always import from here
│   ├── ai-logger.ts              # Claude call wrapper with Supabase logging
│   └── guides.ts                 # Shared types (Guide, Tip, Level) and helpers (getLevel, LEVEL_BADGE)
├── middleware.ts                 # Edge middleware — password protection
├── proxy.ts                      # Legacy (unused) — can be deleted
└── CLAUDE.md                     # This file
```

---

## Coding Conventions

### TypeScript
- Strict mode is on. No `any` unless genuinely unavoidable (e.g. runtime Google Maps types not covered by `@types/google.maps`).
- Use SDK types directly (`NextRequest`, `NextResponse`, Supabase generics). Don't redefine what the libraries already export.

### Design system
- **Background:** `#0a0a0a` (page), `#111` (cards/inputs), `#1a1a1a`–`#2a2a2a` (borders)
- **Accent:** `#00D64F` (green) — buttons, active states, focus rings, highlights
- **Text:** `text-white` primary, `text-gray-400` secondary, `text-gray-600` muted
- **Border radius:** `rounded-2xl` for cards and primary buttons, `rounded-xl` for inputs
- **Font:** DM Sans — already applied globally via `layout.tsx`. Don't add other fonts.
- All inputs: `bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white`
- Primary buttons: `bg-[#00D64F] text-black font-bold rounded-2xl hover:bg-[#00c248]`

### AI / Anthropic
- Default model: `claude-sonnet-4-6`
- Use streaming (`client.messages.stream()`) for any response that will be displayed progressively (recommendations, transport advice). Use `stream.finalMessage()` to get the complete response if needed afterwards.
- Always wrap Claude calls with `logAICall` from `lib/ai-logger.ts` so every interaction is logged to `/admin`.
- Never hardcode prompts inline in route files — keep them readable at the top of the function.

### Supabase
- Always import the client from `lib/supabase.ts`. Never create a new client inline.
- Use `.single()` when expecting one row; check the `error` field before using `data`.
- Points are incremented with a read-then-write pattern (read current `points`, add, write back). Good enough for MVP; migrate to Supabase RPC for production.

### Next.js / React
- Prefer Server Components by default. Add `"use client"` only when the component needs `useState`, `useEffect`, browser APIs, or event handlers.
- Page-level data fetching goes in the route handler (`/api/...`), not directly in Server Components calling Supabase.
- Use `next/link` (`Link`) for internal navigation, not `<a href>`.
- Step animations: `key={animKey}` on the container + `animate-step` CSS class triggers `fadeSlideUp` keyframe defined in `globals.css`.

### Auth / middleware
- Password protection is handled entirely in `middleware.ts` + `app/api/auth/route.ts`.
- The auth cookie is `site_auth`; its value equals `SITE_PASSWORD`.
- The matcher excludes `_next/static`, `_next/image`, `favicon.ico`, and `api/auth` so the auth endpoint is always reachable.

---

## Environment Variables

These must be set in `.env.local` (development) and Vercel project settings (production):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
NEXT_PUBLIC_GOOGLE_PLACES_KEY=
SITE_PASSWORD=
```

- `NEXT_PUBLIC_*` variables are exposed to the browser. Keep API keys that should stay server-side without the prefix.
- `SITE_PASSWORD` — the password for the whole-site access gate. Leave unset to disable password protection entirely.

---

## Active PRDs

# I'm still working on a first version, without any users. I think we should focus on the onboarding proces. When a users visits the site for the first, we should guide them through process of creating their travel plans

_Generated by Rise Product Agents · 2026-03-18_

**Contributors:** Sarah (PM), Alex (Researcher), Maya (Designer), Luca (Tech Lead)

---

# Rise — First-Time User Experience PRD

**Author:** Sarah Chen, Product Manager
**Status:** Draft v1.0
**Date:** 2025-01-27
**Scope:** First-time visitor onboarding flow (MVP)

---

## Overview

Rise is an AI-powered travel concierge app at MVP stage with zero paying users. This PRD defines the first-time user experience: how a visitor who arrives with no context becomes a user with a saved trip plan. The scope is the onboarding wizard and the entry point that precedes it. Everything else — retention, returning user experience, inspiration-mode browsing — is explicitly out of scope until we have real usage data.

---

## Problem Statement

First-time visitors arrive at Rise and face a blank slate with no clear pull forward. They don't understand what Rise does differently, they don't know what action to take first, and the AI features that differentiate the product are invisible until after account creation. The result is predictable: visitors leave before experiencing any value.

The 5-step wizard exists in the stack but is currently treated as a data collection form, not a value demonstration. Users have no reason to complete it because they haven't seen what completing it gets them.

---

## User Need

A first-time visitor needs three things before they'll commit to a multi-step flow: comprehension (what is this?), desire (why do I want it?), and momentum (I've already started). The current experience provides none of them.

The core job-to-be-done at the moment of arrival is assumed to be active trip planning — destination in mind, dates roughly known, looking for help executing. We are making this assumption deliberately and will validate or invalidate it with real session data post-launch.

---

## Proposed Solution

Restructure the onboarding wizard into a 6-step flow (Step 0 through Step 5) that leads with action, demonstrates AI value before asking for commitment, and treats account creation as the reward for seeing something compelling — not the toll to access it.

**Step 0 — Landing Input**
A single full-screen component. One headline. One destination input. No navigation, no feature list, no sign-up prompt. The action is the pitch. Typing a destination is the psychological opt-in.

**Step 1 — Destination + Dates**
Combined into one step. These are cognitively the same question. Reduces perceived wizard length.

**Step 2 — Hotel Preferences**
Contextualised by what's coming. Brief, focused.

**Step 3 — AI Preview (new)**
After capturing destination, dates, and hotel context, fire a real Anthropic streaming call and show the user two or three live restaurant recommendations for their destination. This is the value moment. It must feel real because it is real. Streaming presentation makes the AI visible and impressive.

**Step 4 — Travel Preferences**
Replaces the activities checkbox list. Captures travel style to personalise the full plan.

**Step 5 — Account Creation**
Positioned as unlocking the full plan, not as a registration form. The user has already seen something valuable. Creating an account now feels like saving progress, not paying a toll.

Wizard state is held in component state or localStorage for steps 0–4. Persisted to Supabase only at step 5 on account creation. No authentication required before that point.

---

## User Stories

**As a first-time visitor,** I want to understand immediately what action to take so I don't leave before seeing what Rise can do.

**As a user entering the wizard,** I want the steps to feel like progress toward something real, not a form I'm filling out for someone else's benefit.

**As a user mid-wizard,** I want to see an actual AI recommendation before I'm asked to create an account, so I can judge whether Rise is worth committing to.

**As a user completing onboarding,** I want account creation to feel like saving something valuable I've already built, not a prerequisite for accessing the product.

**As a returning user,** I want to land on my saved trip so I can continue where I left off. *(Temporary implementation — to be revisited at 30 days with real data.)*

---

## Success Metrics

**Primary metric:** Wizard completion rate — percentage of users who reach Step 5 (account creation) having started at Step 0. Target: establish a baseline in the first 50 sessions; optimise from there. We have no benchmark yet and won't invent one.

**Secondary metrics:**
- Drop-off rate per step — identify where users exit and treat that as the next problem to solve
- Time-to-AI-Preview — how long from first visit to seeing the streaming recommendation
- Step 3 to Step 5 conversion — specifically measures whether the AI Preview creates forward momentum
- Session recording coverage — 100% of early sessions should be recorded for qualitative review

**What we are not measuring yet:** retention, return visit rate, or revenue. These matter but are premature optimisation at zero users.

---

## Technical Considerations

The streaming infrastructure for AI recommendations already exists and is in production for the restaurant recs feature. The AI Preview at Step 3 is a single API route call reusing that infrastructure. Engineering estimate: half a day of implementation work.

Step 0 is a single React component — full-screen, no layout chrome, one controlled input. Two days maximum, likely less.

Combining destination and dates into Step 1 is a UI change, not an architectural one. No new data model required.

Wizard state management: localStorage is acceptable for MVP. No auth dependency for steps 0–4. Supabase write happens once, at account creation. If a user abandons before Step 5, state is lost — this is an acceptable tradeoff at this stage and should be revisited when we have abandonment data to quantify the cost.

No new infrastructure is required to ship this. The entire change set sits on top of the existing Next.js + Supabase + Anthropic stack.

---

## Risks & Open Questions

**Risk: We're assuming planning mode.** If a meaningful portion of first-time visitors arrive in inspiration mode — no destination, no dates, browsing loosely — the wizard will feel like the wrong tool and they'll exit at Step 0. Mitigation: watch Step 0 drop-off closely. If it's high, an inspiration-mode entry path becomes the next feature.

**Risk: Restaurant recs may not be the right AI Preview.** We've chosen restaurants because they're tangible, emotionally resonant, and immediately useful. Transport advice is more functional and less exciting at first encounter. This is a hypothesis. If Step 3 → Step 5 conversion is weak, test transport advice or a neighbourhood snapshot as the preview content.

**Risk: The AI Preview feels slow.** Streaming helps but a poorly framed loading state will kill the moment. The presentation of the streaming call is as important as the call itself. This is a design execution risk, not a technical one.

**Open question: What does a returning user see?** Temporary answer: their saved trip dashboard. This is good enough to ship. It becomes a real product question the moment we have users who return more than once. Scheduled for review at 30 days post-launch.

**Open question: What is the right wizard completion rate to aim for?** We don't know. We need 50 real sessions before we can set a meaningful target. Do not invent a benchmark before we have data.

**Deliberately deferred:** inspiration-mode browsing flow, returning user retention loops, social sharing of trip plans, wizard A/B testing. None of these should be built before the baseline flow is live and instrumented.

---

**Next step:** Ship it. Put five real people through it. Watch the recordings. The data from those five sessions is worth more than any further discussion about what we think will happen.
