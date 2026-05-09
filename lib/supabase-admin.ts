/**
 * PHI-61: server-only Supabase admin client backed by the service-role key.
 *
 * Bypasses RLS — use it for:
 *  - System writes that have no user context (ai_logs, api_usage, anonymous
 *    sessions, activity_feedback telemetry, public form writes).
 *  - Routes that must read/write a user-owned row but where ownership is
 *    enforced explicitly in code (e.g. the welcome flow before sign-in,
 *    where the traveler row exists but `auth_user_id` is still null).
 *  - Admin-gated reads from system tables (ai_logs admin viewer, api_limits
 *    editor, etc.).
 *
 * Anything that should run as the signed-in user (so RLS scopes the result
 * to their rows) belongs on `getSupabaseServerClient()` from
 * `lib/supabase-server.ts`, not here.
 *
 * The `SUPABASE_SERVICE_ROLE_KEY` env var is required at runtime — calling
 * the helper without it throws so misconfiguration is loud. The module
 * itself is safe to import at build time (no top-level env reads).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseAdminClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "supabase-admin: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set."
    );
  }
  cached = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}
