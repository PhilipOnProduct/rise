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
- **Onboarding wizard** (`/welcome`) — 6-step flow: Step 0 full-screen landing (destination) → Step 1 destination + dates → Step 2 hotel (optional — Places autocomplete biased to destination; "I haven't booked yet — skip →" link skips with null hotel; Continue always enabled) → Step 3 travel preferences (company + traveler count + children's ages + style tags + budget tier) → Step 4 AI activity preview (streaming, personalised using Step 3 preferences) → Step 5 account creation. Preferences are written to Supabase via partial upsert when the user advances from Step 3 to Step 4. Saves to Supabase `travelers` table and `localStorage` (`rise_traveler`, `rise_onboarded`). Step 3 has four sections: (1) "Who's coming?" — two side-by-side steppers for Adults (default 2, min 1) and Children (default 0, min 0); when children > 0, age range rows appear below (each child gets "Child N" label + four selectable buttons: Under 2, 2–4, 5–8, 9–12). (2) "Trip type" — dynamic company selector derived from composition: 1 adult + no children → auto-set "solo" (hidden); 2 adults + no children → show Couple / Friend group; 3+ adults + no children → show Friend group / Family; any children → auto-set "family" (hidden). Label hidden when only one option or auto-set. Invalid selection cleared on composition change. (3) Travel style tags. (4) Budget tier. Children input is available for any trip type. State uses `adultCount` and `childrenAges` array; `travelerCount` is computed as `adultCount + childrenAges.length` at save time.
- **Dashboard** (`/dashboard`) — Shows trip summary (destination, dates, nights, hotel, activities) read from `localStorage`. Links to itinerary, transport, profile, and guides.
- **Day-by-day itinerary** (`/itinerary`) — Day-view timeline with one column per trip day and three time blocks (morning / afternoon / evening). AI pre-populates suggestions on first load via `/api/itinerary/generate`; persisted to `localStorage` (`rise_itinerary`). Editing surface: (1) Remove (×, hover-revealed); (2) Swap (⇄, hover-revealed) — calls `/api/itinerary/edit` with mode=`swap`, shows new suggestion in place of old item for review ("Looks good ✓" / "Not quite, try again →"); (3) AI add for empty slots ("Suggest something →") — calls `/api/itinerary/edit` with mode=`add`, shows loading placeholder then suggestion for review. Old item stays visible with loading overlay during API call; new item only committed to state after user confirms. Retry accumulates `rejectedTitles` across attempts. Conflict warning from API shown as dismissible amber banner. Users can also drag items between time blocks (HTML5 drag-and-drop) and add their own items inline.
- **AI activity preview + feedback** (`/api/activities-stream`, `/api/activity-chips`, `/api/activity-feedback`) — Step 4 of onboarding uses progressive card reveal: the streaming response is parsed incrementally and each complete activity card renders as an `ActivityCard` immediately (no raw markdown shown). Cards show title, category, and description (no "When:" line). While streaming, cards are read-only (thumbs hidden); a "Finding more ideas..." indicator shows below the last card. Once streaming completes, all cards become interactive simultaneously. Thumbs up/down are toggleable — tapping the active thumb deselects it (returns to neutral); tapping the other thumb switches. Chips are pre-generated on card render (not on tap) by calling `/api/activity-chips` — Claude Haiku with tool_use, returns 1 hard-exclusion ("Done it before") + 3 profile-specific soft-signal reasons + 1 static "Not for me" soft-signal appended as fallback. All chips have identical unselected styling (no orange on "Done it before" until selected). FALLBACK_CHIPS (3 static chips + "Not for me") are shown immediately on thumbs-down tap; dynamic chips swap in silently once loaded (guarded by `submittedActivitiesRef` so they never disrupt in-progress interactions). Chip selection is optional — a "Skip →" button submits thumbs-down with no chip (`thumbs_down_no_chip` state). Chip selection: hard-exclusion shows "We'll skip this." and blocks the activity; soft-signal shows "Noted." and adds a deprioritisation hint. Step 5 shows a "Skipped activities" panel of hard-excluded activities with × removal buttons (logs `exclusion_removed`). All interactions (thumbs_up, chips_shown, chip_selected, thumbs_down_no_chip, exclusion_removed) are logged to `activity_feedback` via `/api/activity-feedback` with `chipsSource` (fallback/dynamic) and `firstChipLabel`. On finish, feedback saved to `rise_activity_feedback` in localStorage and consumed by `/api/itinerary/generate` with three distinct cases: (1) hard exclusions → "NEVER include" block; (2) soft with reason → "avoid, suggest alternatives"; (3) thumbs-down no chip → "soft signal only — deprioritise but do not exclude".
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
- **Build / Research mode toggle** — Persistent toggle in the page header (all tabs). Default: Build mode. Stored in `localStorage("rise_team_mode")`. Green dot = Build mode, amber dot = Research mode. The active mode is injected as an `IMPORTANT:` instruction into every agent system prompt: Sarah (framing, synthesis, PRD), Alex, Maya, Luca, Elena, PM Sarah, and the product coach. Build mode instructs agents to ship complete features without research gates or phased rollouts; Research mode applies standard discovery practices.
- **Kanban tab** — Board with four columns (Backlog / Refine / In Progress / Done). Cards are sourced from the `objectives` table grouped by status. Each card: title (line-clamp-2 with tooltip), description (line-clamp-3), drag-and-drop to move between columns (HTML5 `draggable`; Done column is read-only), expandable PRD, "Copy Claude Code Prompt" button, delete with confirmation, and "Discuss with team →" link that pre-fills the Product team tab. Column highlights with `bg-white/5 ring-1 ring-white/20` on dragover. Container uses `grid grid-cols-4` and `overflow-x-hidden` on `<main>` to prevent horizontal page scroll.
- **Product team tab** — Multi-agent discussion: Sarah (PM) frames the problem (2048 tokens), Alex/Maya/Luca/Elena respond in parallel (2048 tokens each), Sarah synthesises (4096 tokens). Generates PRD (8000 tokens). If launched from a Kanban card (`pendingObjective`), the generated PRD is saved back to that card's `objectives` row. Sarah's memory persisted in `agent_memory` table. Saves to `team_conversations` (type=`"team"`). PRD generation instructs Claude to write a Claude Code Implementation Prompt section: functional description of what to build, hard constraints on sequencing/data flow only — no acceptance criteria, copy templates, animation details, schema details, manual testing instructions, QA steps, or scenario-based testing requirements (Claude Code cannot run these; quality validation is the founder's responsibility). Synthesis and PRD generation both use `sarahSystemWithMemory` (Sarah's base system prompt + build mode instruction + rolling memory). "Regenerate PRD →" button uses subtle outline style. "Download PRD" button removed — only "Download conversation ↓" remains. PRD sections: Overview / Problem Statement / User Need / Proposed Solution / User Stories / Success Metrics / Technical Considerations (strategic only — no implementation details) / Risks & Open Questions / Claude Code Implementation Prompt.
- **PM tab** — 1-on-1 conversation with Sarah (PM). Chat UI with streaming responses. On mount, fetches full CLAUDE.md content from `/api/rise-context` and injects it into the system prompt. Saves conversations to `team_conversations` (type=`"pm"`). Past conversations browsable via `PastConversations`. "View Kanban →" button next to the Agreed objectives heading switches to the Kanban tab. Objectives panel: manual text input + "Save objective" button; Claude extracts a 1-sentence description, then saves to `objectives` with `status="backlog"`. Sarah's instruction tells her to ask Philip to use the "Save objective" input — she cannot save objectives herself.
- **Product coach tab** — 1-on-1 with a product coach (Claude Opus 4.6). Full conversation history maintained; saved to `team_conversations` (type=`"coach"`).
- **Past conversations** (`PastConversations` component, used in all three chat tabs) — Expandable panel listing saved conversations. Each row has a hover-revealed `×` delete button; clicking shows inline "Delete this conversation? Yes / No" confirmation, then deletes from `team_conversations` and removes from local state. The currently active conversation cannot be deleted (no button shown, shows `· Active` label instead). Coach and PM tabs track `conversationId` in both a `useRef` (for in-flight updates) and a `useState` (to pass as `activeConversationId` prop).

### Infrastructure
- **Password protection** — Edge middleware (`middleware.ts`) redirects unauthenticated users to `/api/auth`. GET shows the form; POST sets an `httpOnly` cookie.
- **AI logging** (`lib/ai-logger.ts`) — Wraps every Claude call; logs to Supabase `ai_logs` table.
- **Shared Supabase client** (`lib/supabase.ts`) — Single client instance used everywhere.
- **Rise context API** (`/api/rise-context`) — Server-side GET route that reads and returns `CLAUDE.md` as JSON using Node `fs`. Used by the PM tab to inject the full product context into the system prompt.
- **Traveler composition** (`lib/composition.ts`) — `buildCompositionSegment(travelerCount, childrenAges)` builds a plain-language context segment injected into every AI prompt. Translates age ranges to behavioural constraints: Under 2 → pram access required, nap windows mid-morning/afternoon, no loud environments; 2–4 → 45-min activity max, outdoor space; 5–8 → 90-min tolerance, interactive; 9–12 → near-adult stamina. Constraints are deduplicated across siblings. Used in activities-stream, itinerary/generate, itinerary/edit, recommendations, and transport routes.
- **Prompt caching** — Static system prompt instructions are separated into a `system` array with `cache_control: { type: "ephemeral" }` on the streaming routes (activities-stream, recommendations, transport). Dynamic per-request context goes in the user message. Caches once the static portion reaches Anthropic's threshold (~1024 tokens).

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
│   ├── itinerary/page.tsx        # Day-view itinerary — drag/drop, remove, AI swap/add, conflict banner; passes travelerCount/childrenAges to edit API
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
│   │   ├── activity-chips/route.ts     # POST: generate rejection chips for an activity (Claude Haiku, tool_use)
│   │   ├── activity-feedback/route.ts  # POST: log activity preview interactions (thumbs, chips, removals)
│   │   ├── itinerary/
│   │   │   ├── generate/route.ts # POST: AI day-by-day itinerary as JSON
│   │   │   └── edit/route.ts     # POST: AI swap/add for a single itinerary slot (tool_use)
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
│   ├── composition.ts            # buildCompositionSegment() — traveler count + children age constraints for AI prompts
│   └── guides.ts                 # Shared types (Guide, Tip, Level) and helpers (getLevel, LEVEL_BADGE)
├── middleware.ts                 # Edge middleware — password protection
└── CLAUDE.md                     # This file
```

---

## Supabase Tables

| Table | Purpose |
|---|---|
| `travelers` | Onboarding data — destination, dates, hotel, activities, account, traveler_count (int), children_ages (text[]) |
| `guides` | Local guide profiles — email, name, points |
| `tips` | Guide tips — city, content, view count, guide_id |
| `tip_ratings` | One row per rating event — tip_id, value |
| `ai_logs` | Every Claude API call — prompt, input, output, latency, tokens, rating, notes |
| `team_conversations` | Product agent conversations — type (`team`/`coach`/`pm`), title, messages JSON, prd |
| `agent_memory` | Sarah's rolling memory of past product discussions — id=`"sarah"`, content |
| `prd_feedback` | Feedback on generated PRDs — conversation_id, feedback text |
| `objectives` | PM 1-on-1 agreed objectives — title, description (1-sentence), prd (full PRD text), status (`backlog`/`refine`/`in-progress`/`done`) |
| `user_feedback` | Floating button + /feedback form submissions — page URL, feedback text |
| `activity_feedback` | Activity preview interaction log — event, activity name/category, chip label/type, chips_source (fallback/dynamic), first_chip_label |

**Required SQL to add composition columns to `travelers` table:**
```sql
alter table travelers
  add column if not exists traveler_count integer,
  add column if not exists children_ages text[];
```

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

**Required SQL for `activity_feedback` table:**
```sql
create table activity_feedback (
  id uuid primary key default gen_random_uuid(),
  event text not null,           -- thumbs_up | chips_shown | chip_selected | thumbs_down_no_chip | exclusion_removed
  activity_id text,
  activity_name text,
  activity_category text,
  chip_label text,               -- populated for chip_selected events
  chip_type text,                -- hard_exclusion | soft_signal
  chips_source text,             -- fallback | dynamic — which chips were showing at submission
  first_chip_label text,         -- label of the first chip in the row at submission time
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
| `rise_traveler` | Full traveller object (name, email, destination, dates, hotel, travelCompany, travelerCount, childrenAges, travelerTypes, budgetTier, activities) |
| `rise_onboarded` | `"true"` — gates redirect from `/welcome` to `/dashboard` |
| `rise_itinerary` | Cached `ItineraryDay[]` array — cleared and regenerated when user clicks Regenerate |
| `rise_team_mode` | `"build"` or `"research"` — persists the Build/Research mode toggle on `/team` |
| `rise_activity_feedback` | `ActivityFeedbackEntry[]` — thumbs-ups and chip selections from the activity preview; consumed by itinerary generation |

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
