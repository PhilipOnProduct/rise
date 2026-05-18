/**
 * PHI-118 — Shared site-password auth bootstrap for evals that hit the
 * dev server. Three suites (location, anchors, popular-picks) repeated
 * this code; pulled into one place so a future tweak (e.g. PHI-59
 * cookie-mint pattern) doesn't have to land in three files.
 *
 * Behaviour: when SITE_PASSWORD is unset, returns null and the caller
 * proceeds cookie-less (middleware allows requests through). When set,
 * POSTs the password to /api/auth and returns the `site_auth` cookie
 * pair (`name=value`) suitable for replaying as a `Cookie` header on
 * subsequent fetches.
 */

const SITE_PASSWORD = process.env.SITE_PASSWORD;

export async function bootstrapSiteAuth(baseUrl: string): Promise<string | null> {
  if (!SITE_PASSWORD) return null;

  const body = new URLSearchParams();
  body.set("password", SITE_PASSWORD);
  body.set("redirect_to", "/");

  const res = await fetch(`${baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    // Don't follow the 303 — we just want the Set-Cookie header.
    redirect: "manual",
  });

  // Successful auth: 303 to redirect_to with Set-Cookie: site_auth=...
  // Wrong password: 303 to /api/auth?auth_error=1 with NO site_auth cookie.
  if (res.status !== 303) {
    throw new Error(`Auth bootstrap got unexpected status ${res.status} from /api/auth`);
  }

  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") ?? "").split(/,(?=\s*[a-zA-Z0-9_-]+=)/);

  const siteAuth = setCookies.find((c) => c.trim().startsWith("site_auth="));
  if (!siteAuth) {
    throw new Error(
      "Auth bootstrap: no site_auth cookie in /api/auth response — SITE_PASSWORD likely incorrect.",
    );
  }

  return siteAuth.split(";")[0].trim();
}
