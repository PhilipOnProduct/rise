import { NextRequest, NextResponse } from "next/server";

const COOKIE = "site_auth";

function isAuthenticated(req: NextRequest): boolean {
  return req.cookies.get(COOKIE)?.value === process.env.SITE_PASSWORD;
}

function passwordPage(redirectTo: string, error: boolean): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Rise — Enter password</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(to bottom, #eff6ff, #ffffff);
      padding: 2rem;
    }
    .card {
      background: #fff;
      border: 1px solid #dbeafe;
      border-radius: 1.25rem;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
      padding: 2.5rem;
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
    h1 { font-size: 2rem; font-weight: 700; color: #1e3a8a; margin-bottom: .5rem; }
    p  { font-size: .95rem; color: #6b7280; margin-bottom: 2rem; }
    input[type="password"] {
      width: 100%;
      border: 1px solid #e5e7eb;
      border-radius: .6rem;
      padding: .85rem 1.1rem;
      font-size: 1rem;
      color: #111827;
      outline: none;
      margin-bottom: 1rem;
    }
    input[type="password"]:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }
    button {
      width: 100%;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 9999px;
      padding: .9rem 1.5rem;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #1d4ed8; }
    .error {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #b91c1c;
      border-radius: .6rem;
      padding: .65rem 1rem;
      font-size: .875rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Rise</h1>
    <p>Enter the password to continue.</p>
    ${error ? '<div class="error">Incorrect password — please try again.</div>' : ""}
    <form method="POST" action="/api/auth">
      <input type="hidden" name="redirect_to" value="${redirectTo}" />
      <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" />
      <button type="submit">Enter</button>
    </form>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: error ? 401 : 200,
    headers: { "Content-Type": "text/html" },
  });
}

export function proxy(req: NextRequest) {
  if (isAuthenticated(req)) return NextResponse.next();

  const { pathname, searchParams } = req.nextUrl;
  const error = searchParams.get("auth_error") === "1";
  // Pass the original path as redirect target so the user lands there after login
  const redirectTo = pathname === "/" ? "/" : pathname;

  return passwordPage(redirectTo, error);
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static  (Next.js static files)
     * - _next/image   (Next.js image optimisation)
     * - favicon.ico
     * - /api/auth     (password submission endpoint)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api/auth).*)",
  ],
};
