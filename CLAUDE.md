# Rise — CLAUDE.md

## Project Overview

Rise is an AI-powered trip planning app. It helps travellers plan trips day-by-day (destination, dates, hotel, itinerary), get smart transport advice (airport → hotel), and discover insider local tips from real residents.

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
- **Onboarding wizard** (`/welcome`) — 6-step flow: Step 0 full-screen landing (destination) → Step 1 destination + dates → Step 2 hotel (Places autocomplete biased to destination) → Step 3 AI activity preview (streaming) → Step 4 travel preferences (company + style tags) → Step 5 account creation. Saves to Supabase `travelers` table and `localStorage` (`rise_traveler`, `rise_onboarded`).
- **Dashboard** (`/dashboard`) — Shows trip summary (destination, dates, nights, hotel, activities) read from `localStorage`. Links to itinerary, transport, profile, and guides.
- **Day-by-day itinerary** (`/itinerary`) — Day-view timeline with one column per trip day and three time blocks (morning / afternoon / evening). AI pre-populates suggestions on first load via `/api/itinerary/generate`; persisted to `localStorage` (`rise_itinerary`). Users can drag items between time blocks (HTML5 drag-and-drop), dismiss suggestions (×), and add their own items inline.
- **AI activity preview** (`/api/activities-stream`) — Streaming markdown of 5–6 must-do activities shown at step 3 of onboarding. Uses trip duration in the prompt.
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
│   ├── globals.css               # Dark CSS variables, fadeSlideUp animation, date picker fix
│   ├── welcome/page.tsx          # 6-step onboarding wizard (step 0 = landing, steps 1–5 = wizard)
│   ├── dashboard/page.tsx        # Trip summary dashboard
│   ├── itinerary/page.tsx        # Day-view itinerary — drag/drop, dismiss, add items
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
│   │   ├── activities/route.ts   # POST: AI activity suggestions (JSON)
│   │   ├── activities-stream/route.ts  # POST: streaming activity preview (onboarding step 3)
│   │   ├── itinerary/
│   │   │   └── generate/route.ts # POST: AI day-by-day itinerary as JSON
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
- Date inputs: calendar picker icon is inverted via `input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1) }` in `globals.css`

### AI / Anthropic
- Default model: `claude-sonnet-4-6`
- Use streaming (`client.messages.stream()`) for any response displayed progressively (recommendations, transport advice, onboarding activity preview). Use `stream.finalMessage()` to get the complete response afterwards.
- Use non-streaming (`client.messages.create()`) when the response must be parsed as structured JSON (e.g. itinerary generation). Always wrap `JSON.parse()` in try/catch and return a meaningful error.
- Always wrap Claude calls with `logAiInteraction` from `lib/ai-logger.ts` so every interaction is logged to `/admin`.
- When Claude returns JSON, strip markdown code fences before parsing: `.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()`
- Set `max_tokens` generously for structured JSON responses — truncated JSON causes parse failures. Use 8000+ for multi-day itineraries.

### PlacesAutocomplete
- `hasTypedRef` — prevents the dropdown from opening on mount when a pre-filled value is passed in. Only flips `true` on the input's own `onChange`.
- `justSelectedRef` — suppresses the suggestions effect for one cycle after a selection is made, preventing the dropdown from reopening when `onSelect` updates the controlled value.

### Supabase
- Always import the client from `lib/supabase.ts`. Never create a new client inline.
- Use `.single()` when expecting one row; check the `error` field before using `data`.
- Points are incremented with a read-then-write pattern (read current `points`, add, write back). Good enough for MVP; migrate to Supabase RPC for production.

### Next.js / React
- Prefer Server Components by default. Add `"use client"` only when the component needs `useState`, `useEffect`, browser APIs, or event handlers.
- Page-level data fetching goes in the route handler (`/api/...`), not directly in Server Components calling Supabase.
- Use `next/link` (`Link`) for internal navigation, not `<a href>`.
- Step animations: `key={animKey}` on the container + `animate-step` CSS class triggers `fadeSlideUp` keyframe defined in `globals.css`.
- Use `AbortController` + `signal` for streaming fetch calls inside `useEffect` so the stream is cancelled cleanly on unmount or dependency change.

### localStorage keys
| Key | Contents |
|---|---|
| `rise_traveler` | Full traveller object (name, email, destination, dates, hotel, travelCompany, travelerTypes, activities) |
| `rise_onboarded` | `"true"` — gates redirect from `/welcome` to `/dashboard` |
| `rise_itinerary` | Cached `ItineraryDay[]` array — cleared and regenerated when user clicks Regenerate |

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
