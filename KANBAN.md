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
| Implement | **In Progress** | PRD is written and contains a `## Hard constraints` and `## Codebase pointers` section. Claude Code (or Philip) has the prompt it needs to start. |
| Done | **Done** | Shipped to Vercel **and** walked on the live deploy by the relevant role(s) — see TEAM.md "Testing on the live product". A closing comment records what was tested and what's deferred. |

Linear also has `In Review`, `Canceled`, and `Duplicate` — use them when literally accurate; don't force a card into them just because they exist.

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
- For a "what's on my plate this week" view, filter by `assignee: "me"` and `state: ["Todo", "In Progress"]`.
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
3. Move the issue to **In Progress** with `save_issue`.
4. Hand the prompt to Philip to launch Claude Code from the terminal. (Linear has no "launch Claude Code" button; even if it did, the prompt-assembly in step 2 needs Cowork's context.)

**Closing the loop (when Claude Code finishes):**

1. Walk the change on the live Vercel deploy as the relevant role(s) — see TEAM.md "Testing on the live product".
2. `save_comment` on the issue with three short paragraphs: **What changed** (one or two sentences on the diff), **What was tested** (which role(s) walked it on the live deploy and what they checked), **What's deferred** (known limitations, follow-ups, anything intentionally out of scope).
3. Move the issue to **Done** with `save_issue`.

If something needs a follow-up that's bigger than a comment, file a new Linear issue rather than reopening the original.

---

## What we left behind in Rise

The in-app `/team` page kept these things alongside cards that Linear doesn't natively track. Decide per case whether to bring them across:

- **PRD content** — paste into the Linear issue description under `## PRD`.
- **Team discussion transcripts** — usually too noisy to paste in full; summarise the conclusion as a comment, or attach a markdown file via `create_attachment` if Philip wants the full record. Pull constraints out into the `## Hard constraints` section above before discarding.
- **PM conversation summary (`pm_summary`)** — paste under `## Why` at the top of the description.
- **Build vs. Research mode flag** — keep this in Cowork (see TEAM.md), not on the Linear card.
- **Claude Code result text** — captured in the closing comment described in "Handing off to Claude Code", not pasted as a fresh artefact.
