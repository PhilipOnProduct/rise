/**
 * Strip the markdown code fences Claude sometimes wraps around JSON
 * output ("```json\n…\n```"), per the CLAUDE.md parsing convention.
 * Parsing and fallback handling stay at the call site — routes differ in
 * how they recover (extract-between-braces, 500, etc.).
 */
export function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}
