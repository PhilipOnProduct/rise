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
- **Onboarding wizard** (`/welcome`) — 6-step flow: Step 0 full-screen landing (destination) → Step 1 destination + dates → Step 2 hotel (Places autocomplete biased to destination) → Step 3 travel preferences (company, style tags, budget tier) → Step 4 AI activity preview (streaming, personalised using Step 3 preferences) → Step 5 account creation. Preferences are written to Supabase via partial upsert when the user advances from Step 3 to Step 4. Saves to Supabase `travelers` table and `localStorage` (`rise_traveler`, `rise_onboarded`).
- **Dashboard** (`/dashboard`) — Shows trip summary (destination, dates, nights, hotel, activities) read from `localStorage`. Links to itinerary, transport, profile, and guides.
- **Day-by-day itinerary** (`/itinerary`) — Day-view timeline with one column per trip day and three time blocks (morning / afternoon / evening). AI pre-populates suggestions on first load via `/api/itinerary/generate`; persisted to `localStorage` (`rise_itinerary`). Users can drag items between time blocks (HTML5 drag-and-drop), dismiss suggestions (×), and add their own items inline.
- **AI activity preview** (`/api/activities-stream`) — Streaming markdown of 5–6 must-do activities shown at step 4 of onboarding. Accepts `travelCompany`, `styleTags`, and `budgetTier` as hard constraints in the Claude prompt. Loading state echoes traveller profile back ("Planning your solo trip to Lisbon…"). All preference inputs logged to `ai_logs`.
- **AI activity suggestions** (`/api/activities`) — POSTs destination to Claude, returns 20 categorised activities as JSON.
- **Airport → Hotel transport** (`/transport`) — Streaming AI advice comparing public transport vs taxi for a given airport/hotel/city.
- **Travel profile & restaurant recommendations** (`/profile`) — Collects traveller type, destination, dates, company, budget, dietary wishes. Streams personalised restaurant picks from Claude.
- **User feedback** (`/feedback`) — Full-page form. Page field auto-filled with current URL (editable). Saves to `user_feedback` Supabase table. Confirmation screen after submit.
- **Floating feedback button** — Fixed bottom-right on every page except `/welcome` and `/team*`. Opens a popup with textarea + send. Auto-captures current pathname. Shows "Thanks!" confirmation then closes.

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
- **User feedback** (`/feedback-admin`) — All `user_feedback` entries ordered by most recent, with page URL, feedback text, and date.

### Product team (`/team`) — four tabs
- **Kanban tab** — Board with four columns (Backlog / Refine / In Progress / Done). Each card shows a truncated title (line-clamp-2), status select, expandable PRD, "Copy Claude Code Prompt" button, delete with confirmation, and "Discuss with team →" link that pre-fills the Product team tab. Cards are sourced from the `objectives` table filtered/grouped by status.
- **Product team tab** — Multi-agent discussion: Sarah (PM) frames the problem, Alex/Maya/Luca/Elena respond in parallel, Sarah synthesises. Generates PRD. If launched from a Kanban card (`pendingObjective`), the generated PRD is saved back to that card's `objectives` row. Sarah's memory persisted in `agent_memory` table. Saves to `team_conversations` (type=`"team"`).
- **PM tab** — 1-on-1 conversation with Sarah (PM). Chat UI with streaming responses. On mount, fetches full CLAUDE.md content from `/api/rise-context` and injects it into the system prompt. Saves conversations to `team_conversations` (type=`"pm"`). Past conversations are browsable via the `PastConversations` component. Objectives panel below chat: manual text input + "Save objective" button; Claude extracts a 1-sentence description, then saves to `objectives` with `status="backlog"`. Sarah's instruction tells her to ask Philip to use the "Save objective" input below the chat — she cannot save objectives herself.
- **Product coach tab** — 1-on-1 with a product coach (Claude Opus 4.6). Full conversation history maintained; saved to `team_conversations` (type=`"coach"`).

### Infrastructure
- **Password protection** — Edge middleware (`middleware.ts`) redirects unauthenticated users to `/api/auth`. GET shows the form; POST sets an `httpOnly` cookie.
- **AI logging** (`lib/ai-logger.ts`) — Wraps every Claude call; logs to Supabase `ai_logs` table.
- **Shared Supabase client** (`lib/supabase.ts`) — Single client instance used everywhere.
- **Rise context API** (`/api/rise-context`) — Server-side GET route that reads and returns `CLAUDE.md` as JSON using Node `fs`. Used by the PM tab to inject the full product context into the system prompt.

---

## Project Structure

```
rise/
├── app/
│   ├── page.tsx                  # Homepage / marketing landing
│   ├── layout.tsx                # Root layout — DM Sans font, Nav, FeedbackButton
│   ├── globals.css               # Dark CSS variables, fadeSlideUp animation, date picker fix
│   ├── welcome/page.tsx          # 6-step onboarding wizard (step 0 = landing, steps 1–5 = wizard)
│   ├── dashboard/page.tsx        # Trip summary dashboard
│   ├── itinerary/page.tsx        # Day-view itinerary — drag/drop, dismiss, add items
│   ├── profile/page.tsx          # Travel profile + restaurant recs
│   ├── transport/page.tsx        # Airport → Hotel advice
│   ├── feedback/page.tsx         # Full-page user feedback form
│   ├── feedback-admin/page.tsx   # Admin view of all user_feedback entries
│   ├── admin/page.tsx            # AI log viewer
│   ├── team/page.tsx             # Product agents — Kanban / Product team / PM / Coach tabs
│   ├── guides/
│   │   ├── page.tsx              # City search
│   │   ├── add/page.tsx          # Submit a tip
│   │   ├── leaderboard/page.tsx  # Points leaderboard
│   │   └── [city]/page.tsx       # Tips for a city
│   ├── api/
│   │   ├── auth/route.ts         # GET: password form  POST: verify password
│   │   ├── activities/route.ts   # POST: AI activity suggestions (JSON)
│   │   ├── activities-stream/route.ts  # POST: streaming activity preview (onboarding step 4)
│   │   ├── itinerary/
│   │   │   └── generate/route.ts # POST: AI day-by-day itinerary as JSON
│   │   ├── travelers/route.ts    # POST: create traveller  PATCH: partial update (preferences, name/email)
│   │   ├── recommendations/route.ts  # POST: streaming restaurant recs
│   │   ├── transport/route.ts    # POST: streaming transport advice
│   │   ├── profile/route.ts      # POST: save profile to Supabase
│   │   ├── feedback/route.ts     # POST: save user_feedback  GET: last 10 entries
│   │   ├── rise-context/route.ts # GET: returns CLAUDE.md content as JSON
│   │   ├── guides/
│   │   │   ├── route.ts          # GET: tips by city  POST: add tip + award points
│   │   │   └── leaderboard/route.ts  # GET: top 10 guides
│   │   ├── tips/[id]/
│   │   │   ├── view/route.ts     # POST: increment view count, award milestone points
│   │   │   └── rate/route.ts     # POST: rate a tip, award guide points
│   │   ├── team/
│   │   │   └── chat/route.ts     # POST: non-streaming Claude call for product agents
│   │   └── admin/logs/
│   │       ├── route.ts          # GET: all AI logs
│   │       └── [id]/route.ts     # PATCH: update rating/notes
│   └── components/
│       ├── Nav.tsx               # Sticky top nav with dropdowns + mobile hamburger
│       ├── FeedbackButton.tsx    # Floating feedback button (hidden on /welcome and /team*)
│       └── PlacesAutocomplete.tsx  # Google Places (New API) autocomplete input
├── lib/
│   ├── supabase.ts               # Shared Supabase client — always import from here
│   ├── ai-logger.ts              # Claude call wrapper with Supabase logging
│   └── guides.ts                 # Shared types (Guide, Tip, Level) and helpers (getLevel, LEVEL_BADGE)
├── middleware.ts                 # Edge middleware — password protection
└── CLAUDE.md                     # This file
```

---

## Supabase Tables

| Table | Purpose |
|---|---|
| `travelers` | Onboarding data — destination, dates, hotel, activities, account |
| `guides` | Local guide profiles — email, name, points |
| `tips` | Guide tips — city, content, view count, guide_id |
| `tip_ratings` | One row per rating event — tip_id, value |
| `ai_logs` | Every Claude API call — prompt, input, output, latency, tokens, rating, notes |
| `team_conversations` | Product agent conversations — type (`team`/`coach`/`pm`), title, messages JSON, prd |
| `agent_memory` | Sarah's rolling memory of past product discussions — id=`"sarah"`, content |
| `prd_feedback` | Feedback on generated PRDs — conversation_id, feedback text |
| `objectives` | PM 1-on-1 agreed objectives — title, description (1-sentence), prd (full PRD text), status (`backlog`/`refine`/`in-progress`/`done`) |
| `user_feedback` | Floating button + /feedback form submissions — page URL, feedback text |

**Required SQL for `objectives` table** (run in Supabase dashboard if not yet created):
```sql
create table objectives (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  prd text,
  status text not null default 'backlog',
  created_at timestamptz default now()
);
```

**Required SQL for `user_feedback` table:**
```sql
create table user_feedback (
  id uuid primary key default gen_random_uuid(),
  page text not null,
  feedback text not null,
  created_at timestamptz default now()
);
```

**Required SQL for `team_conversations` type constraint** (add `pm` if constraint exists):
```sql
alter table team_conversations
  drop constraint if exists team_conversations_type_check;
alter table team_conversations
  add constraint team_conversations_type_check
  check (type in ('team', 'coach', 'pm'));
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
- JSON parse fallback: if primary parse fails, try extracting between `indexOf("{")` and `lastIndexOf("}")` before giving up.

### Supabase error logging
Supabase `PostgrestError` properties are non-enumerable — `console.error(error)` prints `{}`. Use the `dbErr()` helper in `app/team/page.tsx` to extract `.message`, `.code`, `.details`, `.hint`:
```ts
function dbErr(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  return [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") || JSON.stringify(err);
}
```

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
| `rise_traveler` | Full traveller object (name, email, destination, dates, hotel, travelCompany, travelerTypes, budgetTier, activities) |
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
