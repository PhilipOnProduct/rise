import { NextRequest, NextResponse } from "next/server";
import { verifySiteAuth } from "@/lib/auth";

const SITE_AUTH_COOKIE = "site_auth";
// PHI-31: anonymous-session cookie that backs the pre-signup itinerary view.
// HttpOnly, SameSite=Lax, Secure. 14-day lifetime (per user sign-off).
const RISE_SESSION_COOKIE = "rise_session_id";
const RISE_SESSION_TTL_SEC = 14 * 24 * 60 * 60; // 14 days
// Primitive UUID v4 detector — we only set the cookie when the value is a
// well-formed UUID, so corrupted cookies don't poison downstream APIs.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function middleware(req: NextRequest) {
  // ── Site-auth gate ────────────────────────────────────────────────────
  // Cookie no longer carries the password directly — it's an HMAC token.
  let res: NextResponse;
  if (process.env.SITE_PASSWORD) {
    const authenticated = await verifySiteAuth(req.cookies.get(SITE_AUTH_COOKIE)?.value);

    if (!authenticated) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/api/auth";
      loginUrl.search = "";
      loginUrl.searchParams.set("redirect_to", req.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }
    res = NextResponse.next();
  } else {
    res = NextResponse.next();
  }

  // ── PHI-31 anonymous-session cookie ────────────────────────────────────
  // Issue a session ID on the response if one isn't already present (or
  // looks corrupt). The actual `anonymous_sessions` row is lazily created
  // by /api/anonymous-session on first PATCH so we don't write to the DB
  // for crawlers, prefetches, etc. Only paths that touch the welcome flow
  // need the row.
  const existing = req.cookies.get(RISE_SESSION_COOKIE)?.value;
  if (!existing || !UUID_RE.test(existing)) {
    // Use the runtime's randomUUID — the Edge runtime has it natively.
    const fresh = crypto.randomUUID();
    res.cookies.set(RISE_SESSION_COOKIE, fresh, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: RISE_SESSION_TTL_SEC,
    });
  }

  return res;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static  (Next.js static files)
     * - _next/image   (Next.js image optimisation)
     * - favicon.ico
     * - /api/auth     (the auth endpoint itself)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api/auth).*)",
  ],
};
