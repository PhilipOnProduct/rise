/**
 * Central Anthropic model IDs. API routes import from here instead of
 * hardcoding model strings, so a model upgrade is a one-line change and
 * routes can't silently drift onto stale snapshots (transport and
 * recommendations sat on claude-sonnet-4-20250514 for two upgrades).
 *
 * Keep `lib/api-costs.ts` pricing in sync when changing these.
 */
export const SONNET = "claude-sonnet-4-6";
export const OPUS = "claude-opus-4-6";
export const HAIKU = "claude-haiku-4-5-20251001";

/**
 * Models the /api/team/chat passthrough will forward upstream. The route
 * accepts a client-supplied model name; anything outside this list is
 * rejected with a 400 before spending Anthropic budget.
 */
export const ALLOWED_CHAT_MODELS: ReadonlySet<string> = new Set([SONNET, OPUS, HAIKU]);
