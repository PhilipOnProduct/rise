# Rise — Kanban / Issue Tracker

Issue tracking for Rise lives in **Linear**, not in the in-app `/team` kanban any more. Cowork has the Linear connector, so it can create, update, list, and search issues directly when Philip asks.

---

## Workspace

- **Linear team:** `Philip On Product`
- Use this team name (or its ID `41bf5b8f-3194-4ab1-967a-b3d373bba132`) for every `save_issue` / `list_issues` call.

## Workflow states (mapped from Rise)

| Rise column | Linear status | Entry gate (what must be true to move it here) |
|---|---|---|
| Backlog | **Backlog** | Captured. Sarah and Philip agree it's worth considering, but problem and outcome aren't framed yet. |
| Refine | **Todo** | Sarah has framed the problem (one-line problem statement + intended outcome). Team discussion may still be needed; PRD may or may not exist yet. |
| Implement | **In Progress** | PRD is written and contains a `## Hard constraints` and `## Codebase pointers` section. Claude Code (or Philip) has the prompt it needs to start, or is actively writing code. |
| Walk | **In Review** | Claude Code has shipped (`npm run build` clean, `git push origin main`, Vercel deploy fingerprinted to confirm the bundle contains the diff) and filed a closing comment. The card is now awaiting Cowork's archetype walks. **This is the handoff signal** — when a card lands in In Review, Cowork knows it's its turn. See § Archetype testing and § How Cowork knows Claude Code finished. |
| Done | **Done** | The archetype walks defined in § Archetype testing have been run via the Chrome MCP starting from `/`, and Cowork has filed a separate comment with one paragraph per archetype walked. Only Cowork moves a card to Done. |

`Canceled` and `Duplicate` exist in Linear too — use them when literally accurate.

## Card types (labels)

Rise had three card types; Linear has matching labels:

| Rise card type | Linear label | Color | When to use |
|---|---|---|---|
| `objective` (teal) | **Feature** | purple | A new capability or user-facing improvement that came out of a PM conversation with Sarah. |
| `improvement` (amber) | **Improvement** | blue | A polish, performance, or UX upgrade to something that already works. |
| `bug` (red) | **Bug** | red | Something is broken or wrong. |

Every issue should carry exactly one of these labels.

---

## How to file a new card from a Cowork conversation

When Philip and Sarah agree on an objective (Sarah signals with phrases like "Shall we save that as an objective?" or "Want me to add that to the kanban?"):

1. Confirm with Philip in one line: "Filing this as a Feature in Backlog — sound right?"
2. Call `save_issue` on the Linear MCP with:
   - `team`: `Philip On Product`
   - `title`: the agreed objective, max ~10 words, no trailing punctuation
   - `description`: 1–3 sentence problem framing + the agreed outcome. If a PRD exists, paste it under a `## PRD` heading.
   - `state`: `Backlog` (or `Todo` if the PRD is already written and it's ready for engineering)
   - `labels`: `["Feature"]` (or `Improvement` / `Bug`)
3. Reply with the Linear identifier (e.g., "Filed as POP-42") so Philip has a handle.

Same flow applies for improvements and bugs — but those usually skip the PM conversation and get filed directly.

## How to update or move a card

- Status changes: `save_issue` with `id` (or identifier like `POP-42`) and a new `state`.
- Add a PRD later: `save_issue` with `id` and an updated `description`.
- Comments: use `save_comment`.

## How to read the board

- `list_issues` filtered by `team: "Philip On Product"` and `state` to render any column.
- **Walks queue** — `list_issues` with `state: "In Review"` returns cards Claude Code has shipped that are waiting for Cowork's archetype walks. Use this on demand when Philip asks "what's ready to walk?" — see § How Cowork knows Claude Code finished.
- For a "what's on my plate this week" view, filter by `assignee: "me"` and `state: ["Todo", "In Progress", "In Review"]`.
- For a board snapshot, group results by `state.name`.

---

## Handing off to Claude Code

**Linear is the system of record. Cowork is the dispatcher. Claude Code is the worker.** Linear holds the issue, the PRD, the comments, and the history. Cowork is where the prompt is assembled. Claude Code runs in the terminal. The result lands back in Linear as a comment.

**PRD requirements before handoff.** Before an issue can move to In Progress, its description must contain — in addition to the standard `## Why` / `## PRD` / `## Success metrics` sections — these two sections, both of which Sarah is responsible for harvesting from the team discussion:

- **`## Hard constraints`** — load-bearing requirements that must not be broken. Examples: "must not add another Anthropic call to onboarding", "must preserve the existing swap flow's loading state", "must work on a 360px viewport". These are the things that, if missed, force a redo.
- **`## Codebase pointers`** — explicit file paths and the function/component to extend. Example: "Edit `app/itinerary/page.tsx` `TravelConnectorRow` component; new logic in `lib/travel-connectors.ts`; do not duplicate `buildConnectorRow()`." Without this, Claude Code starts cold, greps wrong, and re-implements existing helpers.

**Handoff steps (from Cowork):**

1. `get_issue` to pull the Linear issue (description, comments, labels, status).
2. Assemble the Claude Code prompt: PRD body + hard constraints + codebase pointers + any clarifying comments. Cowork is set up to do this; Linear is not.
3. Hand the prompt to Philip to launch Claude Code from the terminal. (Linear has no "launch Claude Code" button; even if it did, the prompt-assembly in step 2 needs Cowork's context.)

Cowork no longer moves the card to In Progress on handoff — that's now Claude Code's responsibility (see below). This way the kanban reflects when work actually starts, not when the prompt is assembled.

**Claude Code's responsibilities (in the terminal):**

Claude Code owns the **In Progress** transition (on pickup) and ships the diff to production. Cowork owns the **Done** transition (after archetype walks). The Linear MCP is available to Claude Code; use it for state changes within Claude Code's lane.

1. **On pickup — move the card to In Progress.** First action, before grepping or writing any code: `save_issue` with `id: <identifier>` and `state: "In Progress"`. Idempotent — if the card is already In Progress (e.g. handed back after a previous attempt), this is a no-op.
2. Implement the change per the PRD, hard constraints, and codebase pointers in the issue description. Treat hard constraints as load-bearing — they're the things that, if missed, force a redo.
3. Run `npm run build` and confirm it compiles cleanly with no prerender errors. This is non-negotiable — App Router routinely passes `npm run dev` while failing the build.
4. Walk the change end-to-end as the relevant role(s) **on the code path the diff actually runs on**, locally (Claude Code's browser walk, the Cowork Chrome MCP, or the dev server in your own browser) or on the Vercel deploy. **Start from the user's actual entry point**, usually `/`, not the route the fix touched — see TEAM.md "Testing on the live product".
   - **Walking from `/` is necessary but not sufficient.** If the diff is in an authenticated branch, walk signed in. If it's behind a feature flag, walk with the flag on. If it's only reachable from a specific entry point (homepage parser, dashboard switcher, magic-link landing), walk from there. PHI-51 nearly shipped Done before someone caught that the homepage form bypassed the parser entirely.
   - **Confirm the build under test contains the diff before concluding the fix is broken.** Vercel deploys can lag, edge caches can serve previous builds, and the production URL may not point at the latest commit. If a post-merge walk shows pre-fix behaviour, fingerprint the served bundle first — grep for a marker string from the fix or check the deploy SHA. If the bundle does not contain the diff, you're walking stale code; investigate the deploy, do not reopen the issue. PHI-74 was incorrectly reopened on 2026-05-10 because the Vercel deploy still served the pre-fix bundle when walked. For signed-in walks, prefer the cookie-mint approach against local dev (mint `@supabase/ssr` cookies via admin `generate_link` → `verify`, inject into the dev browser).
   - **Defer only what's technically infeasible.** Steps that need a real email round-trip, third-party billing, or external services Claude Code cannot trigger are deferrable to a manual walk by Philip. Steps that are merely inconvenient (signing in, setting up a fixture, walking a longer path) are **not** deferrable. Walk them. If a fixture is missing, build it.
   - **This is Claude Code's smoke walk, not the gate.** The canonical archetype walks happen in Cowork after handoff (see § Archetype testing). The walk here is what catches "did the diff actually run on this path" before push — not the user-facing testing pass.
5. **Commit and push to main.** `git commit` with a short subject in imperative mood referencing the issue (e.g. `PHI-79: render skeleton during Regenerate`), then `git push origin main`. Direct-to-main is the Rise convention; Vercel auto-deploys from main. Without this step, "Done" is a lie — the diff is still in your working tree. If `git push` fails (rejected, conflict, auth, network), `save_comment` with the failure and leave the card In Progress.
6. **Confirm the deployed bundle contains the diff.** After `git push`, wait for the Vercel deploy (~30–90 seconds), then fingerprint the served bundle: fetch the relevant page or `_next/static/` chunk and grep for a marker string from the change (a new function name, a unique copy string, a routing target). Or check the deploy SHA in the Vercel dashboard matches your commit. If the marker is missing after the deploy completes, investigate — do not move to Done with an unverified deploy. Past incident: PHI-79 shipped Done locally with the diff still in the working tree; `git push` was missing entirely. Past incident: PHI-74 was incorrectly reopened because the post-merge walk hit a previous bundle. The fingerprint check guards against both shapes.
7. `save_comment` on the issue with three short paragraphs: **What changed** (one or two sentences on the diff, plus the commit SHA), **What was tested locally** (which role(s) walked it from Claude Code's environment, what they checked, including the bundle fingerprint result), **What's deferred** (known limitations, follow-ups, anything intentionally out of scope). Then **move the card to `In Review`** via `save_issue` (`id: <identifier>`, `state: "In Review"`). The status change *is* the handoff signal — once the card is In Review, Cowork knows to pick it up for archetype walks. Do not move directly to Done; Cowork owns that transition.

**Cowork's responsibilities (after Claude Code hands off):**

When a card lands in **In Review** with Claude Code's closing comment filed, Cowork picks up. Chrome MCP is only available in the Cowork session, so the archetype walks live here, not in the terminal. See § How Cowork knows Claude Code finished for the trigger mechanics.

1. Read the issue, Claude Code's closing comment, and the diff. Determine the archetype set from § Archetype testing — take the union of every scope the diff touches.
2. Run each archetype walk via the Chrome MCP (`mcp__Claude_in_Chrome__*`), starting from `/` on the Vercel bundle (or `localhost:3000` if Vercel is policy-blocked or the deploy hasn't caught up). For signed-in journeys, use the cookie-mint pattern rather than waiting on a real email round-trip.
3. `save_comment` on the issue with **What was walked** — one paragraph per archetype (name, substrate, path walked, what worked, what stumbled, divergences from real-traveller behaviour). Filed as a fresh comment, not edited into Claude Code's, so the audit trail stays clean.
4. Move the issue to **Done** with `save_issue` (`state: "Done"`).

**If an archetype walk surfaces a real regression of this issue:** `save_comment` with the failure and move the card back to **In Progress** with `save_issue` (`state: "In Progress"`). This bounces the work back to Claude Code's lane; the next Claude Code session sees it In Progress and the regression note in the comments. Don't reopen, don't leave it In Review (which would imply the walks are still pending).

**If a walk surfaces something unrelated** (a pre-existing bug, a follow-up idea, a UX-mismatch finding worth tracking): file a new Linear issue, complete this card to Done as normal.

**If Claude Code can't complete the work** — `save_comment` with what was tried and what's blocking, but **leave the card in In Progress** (do not move it back to Todo). Philip decides whether to bounce it back, scope it down, or split it into a new issue.

If something needs a follow-up that's bigger than a comment, file a new Linear issue rather than reopening the original.

---

## How Cowork knows Claude Code finished

Two paths converge on the same handoff:

**1. The status change is the signal.** When Claude Code moves a card to **In Review**, that's the handoff. Cowork can list ready cards on demand:

```
list_issues team="Philip On Product" state="In Review"
```

Use this when Philip asks "what's queued for walks?" or "what's ready?" — the result is the canonical queue. Cowork should not poll this proactively or surface it at session start; it's an on-demand query.

**2. Philip can also ask explicitly.** "Walk PHI-90", "Claude Code just finished PHI-74", or anything that names a specific issue. Cowork reads the card, confirms it's in In Review with a Claude Code closing comment, and runs the walks. If the card isn't yet In Review (e.g. Claude Code crashed before moving it), Cowork should ask Philip rather than guess.

**What about a regression bounce-back?** When a walk fails, Cowork moves the card back to **In Progress** (see Cowork's responsibilities). The next Claude Code session will see it In Progress with the regression note in the comments, exactly as if Philip had bounced it back manually. The In Progress → In Review → Done → (or In Progress on failure) loop can run as many times as needed.

---

## Archetype testing

Every issue passes through a Chrome-based archetype walk before moving to Done. Cards arrive at this gate via **In Review** (Claude Code's last act before handoff). The walk is what catches the bugs that `npm run build` and Claude Code's own loop can't see: the moment Rise's assumption about a traveller diverges from how a real traveller would behave on a tired Tuesday evening with a phone in one hand. Archetypes are defined in TEAM.md — the Bergmans (family with 3yo + 6yo), Priya (solo to Lisbon), Marcus (business-extender), the Okafors (multi-leg honeymoon).

**Substrate.** Walks run via the Chrome MCP (`mcp__Claude_in_Chrome__*`) against the deployed Vercel bundle (`https://rise-fawn.vercel.app/`) once Claude Code's bundle fingerprint check (Claude Code step 6) confirms the diff is live. If Vercel is policy-blocked from the Cowork Chrome MCP, or the deploy hasn't caught up, walk locally against `http://localhost:3000`. Either way, **start from `/`** — not the route the diff touched.

### Mapping — diff scope to archetypes

Pick archetypes from the table below by the surface(s) the diff touches. If a diff crosses scopes, take the **union** — don't trim. The whole point of the gate is to catch the bug that only appears when two archetype assumptions collide (e.g. family-mode + multi-leg pacing).

| Diff scope | Default archetypes |
|---|---|
| Welcome wizard / onboarding (any step) | All 4 — Bergmans, Priya, Marcus, Okafors |
| Itinerary generate / view / day timeline | Bergmans + Marcus + Okafors |
| Itinerary edit (swap / add / remove) | Bergmans + Priya |
| Activity preview / chips / feedback | All 4 |
| Travel connectors (inter-activity travel) | Bergmans + Okafors |
| Magic-link auth / claim flow | Marcus + Priya |
| Profile / restaurant recommendations | Bergmans + Marcus |
| Guides / tips / city pages | Priya + Marcus |
| Dashboard / trip switcher | Marcus + Okafors |
| Admin pages / RLS migrations / eval scripts / pure infra | **None** — Luca smoke only |

For the "None" row: the close comment must include an explicit "no user archetype applies — Luca smoke only" note. Luca walks the admin/infra surface (route loads, no console errors, no failing network calls, data renders, build clean). Skipping the archetype walk on a user-facing change is a process error.

### How to run a walk

For each archetype in scope:

1. Navigate to `/` on the chosen substrate. If the journey is signed-in, mint cookies via the admin `generate_link` → `verify` flow rather than waiting on a real email round-trip (see CLAUDE.md "cookie-mint pattern for testing signed-in flows").
2. Walk the relevant journey end-to-end **as the archetype**, narrating in their voice. Use the archetype's profile from TEAM.md — adults / kids count, travel style, splurge tolerance, jet-lagged or not — to drive the inputs at every step.
3. Screenshot the moments that matter: the destination input, the preferences step that gates AI behaviour, the activity preview, the itinerary, anywhere the diff actually runs. Save them; they're the artefact.
4. Note any place real life would diverge from what Rise did. "The Bergmans would not click that at 6pm with a tired toddler" is a valid finding even when the UI worked technically. So is "Marcus would have closed the tab here." Surface UX-mismatch findings even when they aren't regressions of this issue.

**Pulling in skills during the walk.** The archetype walk is the user-facing lens; it isn't the only lens. When the diff merits it, invoke role-specific skills as part of the same gate:

- **Maya** runs `design:accessibility-review` against the 360px walk for any user-facing change — WCAG 2.1 AA on the surfaces the diff touched. Findings go into Cowork's closing comment alongside the archetype paragraphs.
- **Luca** runs `engineering:code-review` against Claude Code's diff before the card moves to Done. Pull the diff via the GitHub connector (`plugin_engineering_github`) using the commit SHA from the closing comment — that's the only way to verify the diff matches what the comment claims; the closing comment alone is hearsay. For any change touching `/api/*`, `lib/`, or AI prompts, also consider `engineering:testing-strategy` to check whether the existing eval harness (`eval:parser`, `eval:activities`, `eval:anchors`, `eval:country-destination`) covers the new surface — if not, file a follow-up issue rather than block this one.
- Skip both for pure infra / admin / RLS / eval-script diffs (the "None" row in the mapping above) — Luca smoke + a brief code-review is enough; no archetype, no accessibility audit.

### What goes in the closing comment

Claude Code's closing comment (steps 1–3 of its draft) covers **What changed**, **What was tested locally**, and **What's deferred**. Cowork then appends a separate comment with one paragraph per archetype:

- Archetype name (e.g. "The Bergmans")
- Substrate walked (e.g. `Vercel SHA abc1234` or `localhost:3000`)
- Path walked (e.g. `/ → welcome step 1 → step 2 → … → /itinerary`)
- What worked, what stumbled, what diverged from real-traveller behaviour
- Screenshot references if useful

A clean walk is a useful artefact — say so explicitly ("nothing stumbled"). Don't omit clean archetypes.

**If a walk surfaces a real regression of this issue:** `save_comment` with the failure and move the card back to **In Progress** (so it appears in Claude Code's working queue, not Cowork's review queue). Don't reopen, don't leave it In Review. See Cowork's responsibilities above for the canonical handling.

**If a walk surfaces something unrelated:** file a new Linear issue rather than reopening this one, and complete this card to Done normally.

---

## What we left behind in Rise

The in-app `/team` page kept these things alongside cards that Linear doesn't natively track. Decide per case whether to bring them across:

- **PRD content** — paste into the Linear issue description under `## PRD`.
- **Team discussion transcripts** — usually too noisy to paste in full; summarise the conclusion as a comment, or attach a markdown file via `create_attachment` if Philip wants the full record. Pull constraints out into the `## Hard constraints` section above before discarding.
- **PM conversation summary (`pm_summary`)** — paste under `## Why` at the top of the description.
- **Build vs. Research mode flag** — keep this in Cowork (see TEAM.md), not on the Linear card.
- **Claude Code result text** — captured in the closing comment described in "Handing off to Claude Code", not pasted as a fresh artefact.
