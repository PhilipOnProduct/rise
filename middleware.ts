import { NextRequest, NextResponse } from "next/server";

const COOKIE = "site_auth";

export function middleware(req: NextRequest) {
  // If no password is configured, let everything through
  if (!process.env.SITE_PASSWORD) return NextResponse.next();

  const authenticated =
    req.cookies.get(COOKIE)?.value === process.env.SITE_PASSWORD;

  if (authenticated) return NextResponse.next();

  // Redirect unauthenticated users to the auth page
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/api/auth";
  loginUrl.search = "";
  loginUrl.searchParams.set("redirect_to", req.nextUrl.pathname);

  return NextResponse.redirect(loginUrl);
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
