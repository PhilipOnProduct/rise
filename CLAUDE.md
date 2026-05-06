# Rise — CLAUDE.md

## Project Overview

Rise is an AI-powered trip planning app. It helps travellers plan trips day-by-day (destination, dates, hotel, itinerary), get smart transport advice (airport → hotel), and discover insider local tips from real residents.

**Business model:** B2C SaaS with a freemium layer. Local guides contribute tips to the platform and earn reputation points; travellers pay for personalised AI recommendations and planning tools.

**Current stage:** Early MVP. Core flows are working end-to-end. Being tested with real users on Vercel.

---

## Virtual product team

For persona-based discussion (Sarah PM, Maya Designer, Luca Tech Lead, Elena Travel Expert), see `TEAM.md`. When Philip names a teammate ("ask Maya…", "what would Luca say?") or says "the team", respond in-character per that file. Note: TEAM.md's toolkits reference Cowork plugin skills that aren't installed in Claude Code — the personas and POVs apply, but skip the `product-management:*` / `design:*` / `engineering:*` skill invocations.

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
| Maps | Google Maps JS API (New Places API, Routes API) |

---

## Current Features

### Traveller flows
- **Onboarding wizard** (`/welcome`) — 6-step flow: Step 0 full-screen landing (destination) → Step 1 destination + dates → Step 2 hotel (optional — Places autocomplete biased to destination; "I haven't booked yet — skip →" link skips with null hotel; Continue always enabled) → Step 3 travel preferences (company + traveler count + children's ages + style tags + budget tier) → Step 4 AI activity preview (streaming, personalised using Step 3 preferences) → Step 5 account creation (name/email inputs have explicit `name` and `autoComplete` attributes to prevent browser autofill cross-contamination). Preferences are written to Supabase via partial upsert when the user advances from Step 3 to Step 4. Saves to Supabase `travelers` table and `localStorage` (`rise_traveler`, `rise_onboarded`). Step 3 has four sections: (1) "Who's coming?" — two side-by-side steppers for Adults (default 2, min 1) and Children (default 0, min 0); when children > 0, age range rows appear below (each child gets "Child N" label + four selectable buttons: Under 2, 2–4, 5–8, 9–12). (2) "Trip type" — dynamic company selector derived from composition: 1 adult + no children → auto-set "solo" (hidden); 2 adults + no children → show Couple / Friend group; 3+ adults + no children → show Friend group / Family; any children → auto-set "family" (hidden). Label hidden when only one option or auto-set. Invalid selection cleared on composition change. (3) Travel style tags — personalised by group type: universal core (Cultural, Food-led, Relaxed, Adventure, Off the beaten track, History) plus group-specific tags (e.g. Romantic for couples, Kid-friendly/Beach/Educational for families, Nightlife/Active/Festivals for friends, Budget-savvy/Slow travel for solo). Tags cleared on company change if no longer available. (4) Budget tier. Children input is available for any trip type. State uses `adultCount` and `childrenAges` array; `travelerCount` is computed as `adultCount + childrenAges.length` at save time.
- **Dashboard** (`/dashboard`) — Shows trip summary (destination, dates, nights, hotel, activities) read from `localStorage`. Links to itinerary, transport, profile, and guides.
- **Day-by-day itinerary** (`/itinerary`) — Day-view timeline with one column per trip day, grouped by three time blocks (morning / afternoon / evening) with emoji subheadings and divider lines. AI pre-populates suggestions on first load via `/api/itinerary/generate`; persisted to `localStorage` (`rise_itinerary`). The generate API receives the user's hotel name and injects it into the prompt so activities reference the correct accommodation. Page header shows destination, date range, total days/activities, hotel name, and a "↻ Regenerate" button (with confirmation step). Sticky TripShapeBar highlights the active day via IntersectionObserver. Editing surface: (1) Remove (×) with 5-second undo toast — activity held in state, auto-dismissed after timeout; (2) Swap (⇄) — calls `/api/itinerary/edit` with mode=`swap`, shows new suggestion in place of old item for review ("Looks good ✓" / "Not quite, try again →"), inline error message on API failure; (3) "+ Suggest something" button below each time block and in empty slots — calls `/api/itinerary/edit` with mode=`add`, shows suggestion card for accept/reject review. Action buttons (swap/remove) are always visible on mobile (`opacity-100`), hover-revealed on desktop (`sm:opacity-0 sm:group-hover:opacity-100`). Old item stays visible with loading overlay during API call; new item only committed to state after user confirms. Retry accumulates `rejectedTitles` across attempts. Conflict warning from API shown as amber text. The edit API enforces a hard location constraint — suggestions must be in the destination city, never from another city even if wrong-city items appear in context.
- **Travel connectors** (`/api/itinerary/travel`, `lib/travel-connectors.ts`) — Inter-activity travel time/cost data displayed between every sequential activity pair in the itinerary timeline. User-initiated via "🗺 Calculate travel times" button in the itinerary header. Flow: (1) geocode destination city for location bias; (2) resolve each activity name to coordinates via Google Places Text Search (New); (3) compute walk/transit/drive routes via Google Routes API for each adjacent pair; (4) calculate gap from estimated time positions (block ranges: morning 09:00–12:00, afternoon 13:00–17:00, evening 18:00–21:00, split evenly per activity count); (5) apply family walk-time modifier (1.5× for children Under 2 or 2–4); (6) flag tight connections where fastest travel mode exceeds the gap. All data stored server-side in `travel_connectors` Supabase table, keyed by `traveler_id`. Persists across sessions — loaded on page revisit, only recomputed on explicit trigger. Swap/add/remove trigger targeted refresh of only the affected connectors (1–2 pairs), not the full day. Regenerate clears all connectors. Connector UI: `TravelConnectorRow` component renders between activity cards — compact row showing `🚶 12 min · 🚇 8 min · 🚕 ~2.1 km`. Three visual states: (1) normal — muted text with left-border accent; (2) flagged — amber background with "⚠ Tight connection" heading and flag reason; (3) error — red background, "Travel data unavailable". Zero-duration modes filtered from display. Within-block pairs get a 15-minute minimum gap floor to prevent false flags on short neighbourhood walks. Gap flags stored in DB and logged to `ai_logs` (feature `"travel-connectors"`) for admin visibility as a prompt quality signal — high flag rates across itineraries indicate the AI's neighbourhood-clustering instruction is failing. Admin summary endpoint at `/api/itinerary/travel/admin`. Google API costs: Places Text Search $0.032/req, Routes Compute $0.005/req; full 5-day computation ~$0.70, swap refresh ~$0.06.
- **AI activity preview + feedback** (`/api/activities-stream`, `/api/activity-chips`, `/api/activity-feedback`) — Step 4 of onboarding uses progressive card reveal: the streaming response is parsed incrementally and each complete activity card renders as an `ActivityCard` immediately (no raw markdown shown). Cards show title, category, and description (no "When:" line). Cards are interactive immediately as they stream in — thumbs are not disabled during streaming; a "Found N of ~6 activities..." progress counter shows below the last card while loading. Thumbs up/down are toggleable — tapping the active thumb deselects it (returns to neutral); tapping the other thumb switches. Selected thumbs-up renders with solid teal fill. Chips are pre-generated on card render (not on tap) by calling `/api/activity-chips` — Claude Haiku with tool_use, returns 1 hard-exclusion ("Done it before") + 3 profile-specific soft-signal reasons + 1 static "Not for me" soft-signal appended as fallback. All chips have identical unselected styling (no orange on "Done it before" until selected). FALLBACK_CHIPS (3 static chips + "Not for me") are shown immediately on thumbs-down tap; dynamic chips swap in silently once loaded (guarded by `submittedActivitiesRef` so they never disrupt in-progress interactions). Chip selection is required — a "← Undo" link closes the chip layer and returns the card to neutral (allowing a thumbs-up instead), but no skip path exists. Chip selection: hard-exclusion shows "We'll skip this." and blocks the activity; soft-signal shows "👎 Noted — we'll adjust." with an amber left border on the card. Step 5 shows a "Skipped activities" panel of hard-excluded activities with × removal buttons (logs `exclusion_removed`). All interactions (thumbs_up, chips_shown, chip_selected, exclusion_removed) are logged to `activity_feedback` via `/api/activity-feedback` with `chipsSource` (fallback/dynamic) and `firstChipLabel`. On finish, feedback saved to `rise_activity_feedback` in localStorage and consumed by `/api/itinerary/generate` with two main cases: (1) hard exclusions → "NEVER include" block; (2) soft with reason → "avoid, suggest alternatives". A "N of M rated" counter shows above the cards once the user starts rating. CTA button: disabled until at least one rating; shows "Continue with N rated — more = better results →" when fewer than half are rated, "Continue with N rated →" otherwise. Activity diversity is enforced in the stream prompt — each of the ~6 activities must come from a different category (food & dining, cultural/historic, outdoor/adventure, nightlife/entertainment, relaxation/wellness, shopping/local markets). The prompt also instructs Claude never to reference the traveller's profile or preferences in descriptions.
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
- **AI Logs** (`/admin`) — Table of all Claude API calls with prompt, input, output, latency, token counts, and per-log rating/notes for evaluation. Team discussion titles strip markdown asterisks from display.
- **User feedback** (`/feedback-admin`) — All `user_feedback` entries ordered by most recent, with page URL, feedback text, and date.
- **Evals** (`/admin/evals`) — Three-level evaluation framework for AI output quality. Four tabs: (1) Test cases — lists pre-seeded family prompt scenarios with criteria tags; (2) Run evals — select a test case via `CustomSelect` dropdown, run against `/api/itinerary/generate`, view output, rate 1-5 with notes, "Ask Claude to judge →" for LLM-as-judge scoring with per-criterion pass/fail breakdown; (3) Results — sortable table of all eval results (test case, model, human score, LLM score, date); (4) Model comparison — select test case + Model A/B, run both in parallel, side-by-side output with auto-judging and win/loss summary. All dropdowns use `CustomSelect` (div-based, not native select) to avoid browser event issues. Data stored in `eval_test_cases` and `eval_results` Supabase tables. Judge route at `/api/evals/judge` calls Claude with structured scoring prompt.
- **Usage** (`/admin/usage`) — API usage monitoring and limits dashboard. Two provider cards (Anthropic, Google) each showing: progress bar (spent/limit), warning level indicator (green/amber/red), current month spend, estimated month-end projection. Editable limit fields: monthly limit USD, warning threshold %, hard limit toggle — saves via `PATCH /api/usage/limits`. Recent usage log table (last 50 entries): date, provider, api_type, feature, tokens/requests, cost — sortable by date or cost.

### Product team (`/team`) — four tabs
- **Build / Research mode toggle** — Persistent toggle in the page header (all tabs). Default: Build mode. Stored in `localStorage("rise_team_mode")`. Teal dot = Build mode, amber dot = Research mode. The active mode is injected as an `IMPORTANT:` instruction into every agent system prompt: Sarah (framing, synthesis, PRD), Alex, Maya, Luca, Elena, PM Sarah, and the product coach. Build mode instructs agents to ship complete features without research gates or phased rollouts; Research mode applies standard discovery practices.
- **Card types** — Each objective has a `card_type` field: `objective` (teal), `improvement` (amber), `bug` (red). Type badges shown on kanban cards, detail panel, and PM tab objective list. `CardTypeSelector` component used when creating cards from the kanban "+ New card" form. PM tab always creates `objective` type cards.
- **Kanban tab** — Board with four columns (Backlog / Refine / Implement / Done). Status values: `backlog` | `refine` | `implement` | `done`. "+ New card" button above the board opens an inline form (title + description + type selector) for directly creating Backlog cards — Bugs and Improvements are created here without PM conversation. Cards are sourced from the `objectives` table grouped by status. Each card: type badge + title (line-clamp-2, markdown asterisks stripped), description (line-clamp-2), PRD/discussion count indicators, drag-and-drop to move between columns (HTML5 `draggable`; Done column is read-only), delete with confirmation. Clicking a card opens the Card Detail Panel (slide-in). Column highlights with `bg-[#1a6b7f]/5 ring-1 ring-[#1a6b7f]/20` on dragover. Columns use solid `border-[#c8c3bb]` borders; headers use `text-[#4a6580]`. Container uses `grid grid-cols-4` and `overflow-x-hidden` on `<main>` to prevent horizontal page scroll. `refreshKey` state triggers re-fetch when cards are modified elsewhere.
- **Card detail panel** — Slide-in panel (right side, `fixed z-50`) opened by clicking a kanban card. Shows: card title, type badge, status badge, created date, description, PM conversation summary (`pm_summary`), team discussions list (date + summary, expandable to full transcript), "Start team discussion →" button (visible for refine cards — opens full-screen modal), expandable PRD, copyable Claude Code prompt. Claude Code result textarea only shown on `implement`/`done` cards (hidden on `backlog`/`refine`). "Move to [next status] →" button with inline confirmation when moving Refine → Implement without any discussions ("No team discussion has been run for this card. Move to Implement anyway?" Yes/No). Delete button. `NEXT_STATUS` map: backlog→refine, refine→implement, implement→done.
- **Team discussion flow** — "Start team discussion →" opens a full-screen modal (`fixed inset-0 z-[60]`) containing the complete `ProductTeamTab` with card context. Full card context (`buildCardContext()`) injected into all agent system prompts: title, type, description, pm_summary, previous discussion summaries, PRD, Claude Code result. After discussion + PRD generates, "Save to card →" closes the modal and returns to the card detail panel with the new discussion visible. Discussion stored as summary + full transcript + PRD in the card's `discussions` jsonb array.
- **Alex in Build/Research mode** — In Build mode (`buildMode=true`), Alex (Researcher) is excluded from the parallel specialist calls in team discussions. Only included when `buildMode=false` (Research mode). The team roster display, synthesis prompt, PRD prompt, discussion output rendering, and download conversation contributors line all respect this flag.
- **Markdown rendering** — Agent, coach, and PM chat bubbles use the `MarkdownText` component (defined in `team/page.tsx`) to render markdown: `##`/`###` as bold headings, `**text**` as bold, `---` as horizontal rules, `-`/`*` as bullet lists, numbered lists. Kanban card titles and admin discussion titles strip `**`/`*` via `.replace(/\*+/g, "")`.
- **Product team tab** — Multi-agent discussion: Sarah (PM) frames the problem (2048 tokens), Alex/Maya/Luca/Elena respond in parallel (2048 tokens each), Sarah synthesises (4096 tokens). Generates PRD (8000 tokens). If launched from a card (`cardContext`), shows a card context banner and "Save to card →" button after completion. If launched without card context, "Save to Kanban →" creates a new card. Sarah's memory persisted in `agent_memory` table. Saves to `team_conversations` (type=`"team"`). PRD generation instructs Claude to write a Claude Code Implementation Prompt section: functional description of what to build, hard constraints on sequencing/data flow only — no acceptance criteria, copy templates, animation details, schema details, manual testing instructions, QA steps, or scenario-based testing requirements (Claude Code cannot run these; quality validation is the founder's responsibility). Synthesis and PRD generation both use `sarahSystemWithMemory` (Sarah's base system prompt + build mode instruction + rolling memory). PRD sections: Overview / Problem Statement / User Need / Proposed Solution / User Stories / Success Metrics / Technical Considerations (strategic only — no implementation details) / Risks & Open Questions / Claude Code Implementation Prompt.
- **PM tab** — 1-on-1 conversation with Sarah (PM). Chat UI with streaming responses. On mount, fetches full CLAUDE.md content from `/api/rise-context` and injects it into the system prompt. Saves conversations to `team_conversations` (type=`"pm"`). Past conversations browsable via `PastConversations`. "View Kanban →" button next to the Agreed objectives heading switches to the Kanban tab. Auto-detect objective agreement: `detectObjectiveAgreed()` checks Sarah's last message for trigger phrases ("shall we save that", "want me to add that to the kanban", etc.). When detected, an "Add to Kanban as Objective →" button appears. Clicking it auto-extracts title (max 8 words) and description (1 sentence) from the conversation via Claude, generates a 3-5 sentence `pm_summary`, and saves to `objectives` with `status="backlog"` and `card_type="objective"`. No manual input or type selector — PM conversations always create Objectives. Sarah's system prompt instructs her to use agreement phrases when an objective is agreed.
- **Product coach tab** — 1-on-1 with a product coach (Claude Opus 4.6). Full conversation history maintained; saved to `team_conversations` (type=`"coach"`).
- **Past conversations** (`PastConversations` component, used in all three chat tabs) — Expandable panel listing saved conversations. Each row has a hover-revealed `×` delete button; clicking shows inline "Delete this conversation? Yes / No" confirmation, then deletes from `team_conversations` and removes from local state. The currently active conversation cannot be deleted (no button shown, shows `· Active` label instead). Coach and PM tabs track `conversationId` in both a `useRef` (for in-flight updates) and a `useState` (to pass as `activeConversationId` prop).

### Infrastructure
- **Password protection** — Edge middleware (`middleware.ts`) redirects unauthenticated users to `/api/auth`. GET shows the form; POST sets an `httpOnly` cookie.
- **AI logging** (`lib/ai-logger.ts`) — Wraps every Claude call; logs to Supabase `ai_logs` table.
- **API usage logging** (`lib/log-api-usage.ts`, `lib/api-costs.ts`) — Every API route calls `logApiUsage()` after a successful external API call. Calculates estimated cost from pricing constants (Sonnet $3/$15 per 1M tokens, Opus $15/$75, Haiku $0.80/$4, Google Places $0.017/req, Places Text Search $0.032/req, Routes Compute $0.005/req, Geocoding $0.005/req). Inserts to `api_usage` table. `checkApiLimit(provider)` queries current month spend vs `api_limits` table, returns `{ allowed, warningLevel, percentUsed, spentUsd, limitUsd }`. Hard limit enforcement: every Anthropic route calls `checkApiLimit("anthropic")` before the API call and returns 429 if exceeded and `hard_limit_enabled` is true. The travel connectors endpoint calls `checkApiLimit("google")` before computing. Wired into: itinerary/generate, itinerary/edit, itinerary/travel, activities-stream, recommendations, transport, evals/judge, activity-chips, team/chat.
- **Travel connector logic** (`lib/travel-connectors.ts`) — Server-side functions for coordinate resolution (Google Places Text Search), route computation (Google Routes API), activity time estimation from block positions, family walk-time modifier (1.5× for Under 2 / 2–4 age bands), gap calculation with within-block minimum floor (15 min), and flag determination. `buildConnectorRow()` assembles a complete DB row from route results, gap data, and family modifier. Used exclusively by `/api/itinerary/travel`.
- **API limit banner** (`ApiLimitBanner.tsx`) — Client component in `layout.tsx` above Nav. Fetches `/api/usage/status` on mount. Amber banner at ≥80% spend ("You've used X% of your budget"), red banner when exceeded ("API limit reached. AI features are paused."). Links to `/admin/usage`. Dismissible per session via `sessionStorage`.
- **Shared Supabase client** (`lib/supabase.ts`) — Single client instance used everywhere.
- **Rise context API** (`/api/rise-context`) — Server-side GET route that reads and returns `CLAUDE.md` as JSON using Node `fs`. Used by the PM tab to inject the full product context into the system prompt.
- **Traveler composition** (`lib/composition.ts`) — `buildCompositionSegment(travelerCount, childrenAges)` builds a plain-language context segment injected into every AI prompt. Translates age ranges to behavioural constraints: Under 2 → pram access required, nap windows mid-morning/afternoon, no loud environments; 2–4 → 45-min activity max, outdoor space; 5–8 → 90-min tolerance, interactive; 9–12 → near-adult stamina. Constraints are deduplicated across siblings. Used in activities-stream, itinerary/generate, itinerary/edit, recommendations, and transport routes.
- **Prompt caching** — Static system prompt instructions are separated into a `system` array with `cache_control: { type: "ephemeral" }` on the streaming routes (activities-stream, recommendations, transport). Dynamic per-request context goes in the user message. Caches once the static portion reaches Anthropic's threshold (~1024 tokens).
- **Eval scripts** — `npm run eval:family` runs `scripts/eval-family-prompts.ts`: tests `buildCompositionSegment` against 7 family scenarios (solo, Under 2, 9–12, mixed, beach/city/adventure destinations) with 20 assertions. Exits with code 1 on failure. `npm run eval:recommendations` runs the restaurant recommendations eval. `npm run eval:location` runs `scripts/eval-itinerary-location.ts`: tests `/api/itinerary/edit` location constraint with 5 trap cases (wrong-city items in context — e.g. Eiffel Tower in Amsterdam, Pergamon Museum in Lisbon), uses Claude Sonnet as LLM-as-judge to verify suggestions stay in the destination city. Requires dev server running.

---

## Project Structure

```
rise/
├── app/
│   ├── page.tsx                  # Homepage — 100vh, hero in upper 70%, landmark skyline in bottom 30%
│   ├── layout.tsx                # Root layout — DM Sans font, ApiLimitBanner, Nav, FeedbackButton
│   ├── globals.css               # Light theme CSS variables, fadeSlideUp animation, date picker fix
│   ├── welcome/page.tsx          # 6-step onboarding wizard (step 0 = landing, steps 1–5 = wizard)
│   ├── dashboard/page.tsx        # Trip summary dashboard
│   ├── itinerary/page.tsx        # Day-view itinerary — drag/drop, remove, AI swap/add, conflict banner, travel connectors; passes travelerCount/childrenAges to edit API
│   ├── profile/page.tsx          # Travel profile + restaurant recs
│   ├── transport/page.tsx        # Airport → Hotel advice
│   ├── feedback/page.tsx         # Full-page user feedback form
│   ├── feedback-admin/page.tsx   # Admin view of all user_feedback entries
│   ├── admin/
│   │   ├── page.tsx              # AI log viewer
│   │   ├── evals/page.tsx        # Eval framework — test cases, run evals, results, model comparison
│   │   └── usage/page.tsx        # API usage monitoring, limits, cost tracking
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
│   │   │   ├── generate/route.ts # POST: AI day-by-day itinerary as JSON (includes booking_meta for restaurants)
│   │   │   └── alternative/route.ts # POST: AI restaurant alternative (swap feature, persists to itinerary_items)
│   │   │   ├── generate/route.ts # POST: AI day-by-day itinerary as JSON (receives hotel for prompt context)
│   │   │   ├── edit/route.ts     # POST: AI swap/add for a single itinerary slot (tool_use)
│   │   │   └── travel/
│   │   │       ├── route.ts      # POST: compute/refresh travel connectors  GET: fetch stored connectors
│   │   │       └── admin/route.ts # GET: aggregated flag summary per traveler
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
│   │   ├── evals/
│   │   │   └── judge/route.ts    # POST: LLM-as-judge scoring against criteria
│   │   ├── usage/
│   │   │   ├── status/route.ts   # GET: current month usage + warning levels for both providers
│   │   │   └── limits/route.ts   # PATCH: update api_limits for a provider
│   │   └── admin/logs/
│   │       ├── route.ts          # GET: all AI logs
│   │       └── [id]/route.ts     # PATCH: update rating/notes
│   └── components/
│       ├── Nav.tsx               # Sticky top nav with dropdowns + mobile hamburger (Admin: AI Logs, Evals, Usage, Product, PM, Feedback)
│       ├── ApiLimitBanner.tsx    # Warning/error banner when API spend approaches or exceeds limits
│       ├── FeedbackButton.tsx    # Floating feedback button (hidden on /welcome and /team*)
│       └── PlacesAutocomplete.tsx  # Google Places (New API) autocomplete input
├── lib/
│   ├── supabase.ts               # Shared Supabase client — always import from here
│   ├── ai-logger.ts              # Claude call wrapper with Supabase logging
│   ├── api-costs.ts              # Pricing constants + calculateAnthropicCost/calculateGoogleCost
│   ├── log-api-usage.ts          # logApiUsage() + checkApiLimit() — usage tracking and limit enforcement
│   ├── composition.ts            # buildCompositionSegment() — traveler count + children age constraints for AI prompts
│   ├── travel-connectors.ts      # Travel connector logic — coordinate resolution, Routes API, gap calc, family modifier
│   └── guides.ts                 # Shared types (Guide, Tip, Level) and helpers (getLevel, LEVEL_BADGE)
├── scripts/
│   ├── eval-family-prompts.ts    # Level 1 — prompt inspection: 7 family scenarios, 20 assertions
│   ├── eval-recommendations.ts   # Recommendation eval script
│   └── eval-itinerary-location.ts # Location constraint eval — trap cases for itinerary edit API
├── middleware.ts                 # Edge middleware — password protection
└── CLAUDE.md                     # This file
```

---

## Supabase Tables

| Table | Purpose |
|---|---|
| `travelers` | Onboarding data — destination, dates, hotel, activities, account, traveler_count (int), children_ages (text[]), travel_company (text), style_tags (text[]), budget_tier (text). Name and email are nullable (collected at step 5, after row creation). |
| `guides` | Local guide profiles — email, name, points |
| `tips` | Guide tips — city, content, view count, guide_id |
| `tip_ratings` | One row per rating event — tip_id, value |
| `ai_logs` | Every Claude API call — prompt, input, output, latency, tokens, rating, notes |
| `team_conversations` | Product agent conversations — type (`team`/`coach`/`pm`), title, messages JSON, prd |
| `agent_memory` | Sarah's rolling memory of past product discussions — id=`"sarah"`, content |
| `prd_feedback` | Feedback on generated PRDs — conversation_id, feedback text |
| `objectives` | PM 1-on-1 agreed objectives — title, description (1-sentence), prd (full PRD text), status (`backlog`/`refine`/`implement`/`done`), card_type (`objective`/`improvement`/`bug`), pm_summary (text), claude_code_result (text), discussions (jsonb array of {date, summary, transcript, prd}) |
| `user_feedback` | Floating button + /feedback form submissions — page URL, feedback text |
| `activity_feedback` | Activity preview interaction log — event type, activity name/category, chip label/type |
| `itinerary_items` | Persisted restaurant alternatives from swap feature — item details, booking_meta, replaced_restaurant |
| `activity_feedback` | Activity preview interaction log — event, activity name/category, chip label/type, chips_source (fallback/dynamic), first_chip_label |
| `eval_test_cases` | Eval test scenarios — name, feature, inputs (jsonb), criteria (text[]). Pre-seeded with 7 family prompt scenarios |
| `eval_results` | Eval run results — test_case_id (FK), model, prompt_used, ai_output, human_score (1-5), human_notes, llm_score (1-5), llm_reasoning |
| `api_usage` | API call cost tracking — provider (`anthropic`/`google`), api_type, feature, input_tokens, output_tokens, request_count, estimated_cost_usd |
| `api_limits` | Per-provider monthly limits — provider (unique), monthly_limit_usd, warning_threshold_pct (default 80), hard_limit_enabled (default true) |
| `travel_connectors` | Inter-activity travel data — traveler_id, day_number, sequence_index, from/to activity IDs and names, from/to lat/lng, walk/transit/drive seconds and meters, walk_adjusted_seconds (family modifier), transit_fare, gap_seconds, gap_flagged (bool), flag_reason, error. Indexed on traveler_id. |

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
  card_type text default 'objective',
  pm_summary text,
  claude_code_result text,
  discussions jsonb default '[]',
  created_at timestamptz default now()
);
alter table objectives add constraint objectives_status_check check (status in ('backlog', 'refine', 'implement', 'done'));
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
  metadata jsonb,                -- PHI-45: arbitrary payload from onboarding telemetry events (length, dayCount, hasActivityFeedback, clarifications, destinationCount, hadConstraints, etc.)
  created_at timestamptz default now()
);
```

**PHI-45 migration for existing deployments** (run once, idempotent):
```sql
alter table activity_feedback
  add column if not exists metadata jsonb;
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

**Required SQL for `itinerary_items` table** (persists AI-generated restaurant alternatives):
```sql
create table itinerary_items (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  title text not null,
  description text,
  item_type text not null default 'restaurant',
  time_block text not null,
  status text not null default 'idea',
  source text not null default 'ai_generated',
  cuisine text,
  vibe text,
  price_tier text,
  booking_meta jsonb,
  date text not null,
  day_number integer,
  destination text not null,
  replaced_restaurant text,
  is_alternative boolean default false,
  created_at timestamptz default now()
);
**Required SQL for eval tables:**
```sql
create table eval_test_cases (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  feature text not null default 'itinerary',
  inputs jsonb not null,
  criteria text[] not null,
  created_at timestamptz default now()
);

create table eval_results (
  id uuid primary key default gen_random_uuid(),
  test_case_id uuid references eval_test_cases(id),
  model text not null,
  prompt_used text,
  ai_output text not null,
  human_score integer,
  human_notes text,
  llm_score integer,
  llm_reasoning text,
  created_at timestamptz default now()
);
```

**Required SQL for `api_usage` and `api_limits` tables:**
```sql
create table api_usage (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  api_type text not null,
  feature text,
  input_tokens integer,
  output_tokens integer,
  request_count integer default 1,
  estimated_cost_usd numeric(10,6),
  created_at timestamptz default now()
);

create table api_limits (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  monthly_limit_usd numeric(10,2) not null,
  warning_threshold_pct integer default 80,
  hard_limit_enabled boolean default true,
  updated_at timestamptz default now()
);

insert into api_limits (provider, monthly_limit_usd, warning_threshold_pct, hard_limit_enabled)
values ('anthropic', 20.00, 80, true), ('google', 10.00, 80, true)
on conflict (provider) do nothing;
```

**Required SQL for `team_conversations` type constraint** (add `pm` if constraint exists):
```sql
alter table team_conversations
  drop constraint if exists team_conversations_type_check;
alter table team_conversations
  add constraint team_conversations_type_check
  check (type in ('team', 'coach', 'pm'));
```

**Required SQL for `travel_connectors` table:**
```sql
create table travel_connectors (
  id uuid primary key default gen_random_uuid(),
  traveler_id uuid not null,
  day_number integer not null,
  sequence_index integer not null,
  from_activity_id text not null,
  to_activity_id text not null,
  from_name text not null,
  to_name text not null,
  from_lat double precision,
  from_lng double precision,
  to_lat double precision,
  to_lng double precision,
  walk_seconds integer,
  walk_meters integer,
  walk_adjusted_seconds integer,
  transit_seconds integer,
  transit_fare text,
  drive_seconds integer,
  drive_meters integer,
  gap_seconds integer not null,
  gap_flagged boolean not null default false,
  flag_reason text,
  error text,
  created_at timestamptz default now()
);

create index idx_connectors_traveler on travel_connectors(traveler_id);
```

---

## Coding Conventions

### TypeScript
- Strict mode is on. No `any` unless genuinely unavoidable (e.g. runtime Google Maps types not covered by `@types/google.maps`).
- Use SDK types directly (`NextRequest`, `NextResponse`, Supabase generics). Don't redefine what the libraries already export.

### Design system (light theme)
- **Background:** `#f8f6f1` (page), `white` (cards), `#f0ede8` (subtle fills)
- **Borders:** `#e8e4de` (card borders), `#d4cfc5` (dividers/separators), `#c8c3bb` (kanban column borders)
- **Accent:** `#1a6b7f` (teal) — buttons, active states, focus rings, links
- **Text:** `#0e2a47` (primary), `#4a6580` (secondary/headings), `#6a7f8f` (muted/labels)
- **Border radius:** `rounded-2xl` for cards and primary buttons, `rounded-xl` for inputs
- **Font:** DM Sans — already applied globally via `layout.tsx`. Don't add other fonts.
- Primary buttons: `bg-[#1a6b7f] text-white font-bold rounded-2xl hover:bg-[#155a6b]`
- Status badges (kanban/PM tab): Backlog `bg-[#e8f0f4] text-[#1a6b7f]`, Refine `bg-[#e8f0fb] text-[#185fa5]`, In-Progress `bg-[#fef3e2] text-[#ba7517]`, Done `bg-[#eaf4ee] text-[#2d7a4f]`

### AI / Anthropic
- Default model: `claude-sonnet-4-6`
- **The activity-gen prompt lives in `lib/activity-gen-prompt.ts`.** Both `app/api/activities-stream/route.ts` and `scripts/eval-activities.ts` import `ACTIVITY_GEN_SYSTEM` and `buildActivityGenUserMessage()` from there. Edit there, not in the route or the eval — they're the same string by construction (PHI-43).
- Use streaming (`client.messages.stream()`) for any response displayed progressively (recommendations, transport advice, onboarding activity preview). Use `stream.finalMessage()` to get the complete response afterwards.
- Use non-streaming (`client.messages.create()`) when the response must be parsed as structured JSON (e.g. itinerary generation). Always wrap `JSON.parse()` in try/catch and return a meaningful error.
- Always wrap Claude calls with `logAiInteraction` from `lib/ai-logger.ts` so every interaction is logged to `/admin`. Also call `logApiUsage()` from `lib/log-api-usage.ts` after each successful call for cost tracking. Call `checkApiLimit("anthropic")` at the start of each route and return 429 if exceeded.
- For welcome-flow routes (parse-trip, activities-stream, itinerary-generate), always pass `session_id: req.cookies.get("rise_session_id")?.value ?? null` to `logAiInteraction`. PHI-40 uses this to group calls by trip in the multi-leg cost report.

### Eval harnesses
- `npm run eval:parser` — runs the 50-case free-form parser eval. Run before any prompt edit in `app/api/parse-trip/route.ts`. Pass gate: ≥85% field accuracy, 100% on constraint preservation.
- `npm run eval:activities` — runs the 30-case activity-gen eval (15 single-leg + 15 multi-leg). Run before any prompt edit in `lib/activity-gen-prompt.ts`. Pass gate: ≥85% field accuracy, 0 life-impacting failures.
- Both evals call the live Anthropic API and cost ~$1–2 per run on Sonnet 4.6. Keep `lib/api-costs.ts` rates current.
- **`eval:activities` uses `temperature: 0.2`** (PHI-42). Default temperature gave noisy results on "every card mentions X" checks — same prompt, different runs, different failures. PHI-42 trialled `{0.2, 0.5, default}` × `{strict check, ≥(N−1) loosened check}` — temp 0.2 with the strict check produced the best result (1 life-impacting failure vs 2–3 at other configs). The dominant remaining failure is the 9-card multi-leg-allergy case where Sonnet drops the constraint mention on 1 of 9 cards stochastically; that's a model variance ceiling on this prompt, not a prompt bug. Filed as a known limitation; revisit only if traffic signals it matters in production. The production route at `app/api/activities-stream/route.ts` stays at default temperature so real users still see variation.

### Cost telemetry (PHI-40)
- `npm run report:multi-leg-cost` — reads `ai_logs`, groups by `session_id`, computes per-trip Anthropic cost, splits single-leg vs multi-leg, prints median + p95 + ratio.
- **Decision rule:** if multi-leg / single-leg median cost ratio crosses **2.5×**, revisit prompt caching, smaller-model fallback for low-stakes calls, or per-leg parallel generation. The script flags this automatically; no auto-rollback.
- Run on demand — not wired into CI. Sensible cadence: after any prompt edit in `/api/activities-stream` or `/api/itinerary/generate`, and weekly during multi-leg adoption.
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
