/**
 * PHI-59: browser-side Supabase client using @supabase/ssr.
 *
 * Use this from "use client" components when you need the user's auth
 * session in the browser (e.g. show "Sign out" if signed in, or kick off
 * `signInWithOtp`). Reads/writes the same cookie-based session as the
 * server client.
 *
 * The browser client is a singleton per page — the helper memoises it so
 * we don't churn through clients on every render.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Fail loudly with a named cause instead of letting `undefined` flow into
    // createBrowserClient and surface as a cryptic runtime error later.
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  cached = createBrowserClient(url, anonKey);
  return cached;
}
