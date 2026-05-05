# Rise — Kanban / Issue Tracker

Issue tracking for Rise lives in **Linear**, not in the in-app `/team` kanban any more. Cowork has the Linear connector, so it can create, update, list, and search issues directly when Philip asks.

---

## Workspace

- **Linear team:** `Philip On Product`
- Use this team name (or its ID `41bf5b8f-3194-4ab1-967a-b3d373bba132`) for every `save_issue` / `list_issues` call.

## Workflow states (mapped from Rise)

| Rise column | Linear status | When a card belongs here |
|---|---|---|
| Backlog | **Backlog** | Captured but not yet refined. Sarah and Philip have agreed it's worth doing, but the shape is fuzzy. |
| Refine | **Todo** | PRD-shaping in progress, or PRD done and ready for engineering to pick up. |
| Implement | **In Progress** | Being built (usually by Claude Code, sometimes by Philip directly). |
| Done | **Done** | Shipped and verified. |

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

## What we left behind in Rise

The in-app `/team` page kept these things alongside cards that Linear doesn't natively track. Decide per case whether to bring them across:

- **PRD content** — paste into the Linear issue description under `## PRD`.
- **Team discussion transcripts** — usually too noisy to paste in full; summarise the conclusion as a comment, or attach a markdown file via `create_attachment` if Philip wants the full record.
- **PM conversation summary (`pm_summary`)** — paste under `## Why` at the top of the description.
- **Build vs. Research mode flag** — keep this in Cowork (see TEAM.md), not on the Linear card.
- **Claude Code result text** — a comment on the issue when the build is done, or just close the issue when shipped.
