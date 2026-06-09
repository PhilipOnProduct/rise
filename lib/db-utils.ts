/**
 * Small shared DB/validation helpers used across API routes.
 */

/**
 * Supabase `PostgrestError` properties are non-enumerable —
 * `console.error(error)` prints `{}`. Extract the useful fields instead.
 */
export function dbErr(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  return [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") || JSON.stringify(err);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value is a well-formed UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
