/**
 * PHI-59: server-side Supabase client using @supabase/ssr.
 *
 * Use this from Server Components, Route Handlers, and Server Actions when
 * you need to read or set the user's auth session. Sessions are stored in
 * httpOnly cookies and refresh-rotate transparently.
 *
 * Do NOT import this from client components — it pulls `next/headers`,
 * which is server-only. Use `lib/supabase-browser.ts` from the client.
 *
 * The legacy DB-only client at `lib/supabase.ts` is still fine for routes
 * that don't need an auth context (admin reads, anonymous writes, etc.).
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Server Components are read-only for cookies; the call throws
          // when invoked from one. Route Handlers / middleware / Server
          // Actions can write — we swallow the error from the SC path so
          // session-refresh on read pages still works.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Read-only cookie store — no-op.
          }
        },
      },
    }
  );
}
