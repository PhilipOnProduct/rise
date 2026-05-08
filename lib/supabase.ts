/**
 * Legacy DB-only Supabase client. Carries no auth context — use it for
 * server-side reads/writes that don't depend on `auth.uid()` (admin
 * tables, anonymous-session writes, AI logs, etc.).
 *
 * For anything that needs the signed-in user (PHI-59 onwards), import
 * `getSupabaseServerClient` from `lib/supabase-server.ts` (route
 * handlers / Server Components) or `getSupabaseBrowserClient` from
 * `lib/supabase-browser.ts` (client components). PHI-C will introduce
 * RLS, at which point most callers will need to migrate off this
 * legacy client.
 */
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
