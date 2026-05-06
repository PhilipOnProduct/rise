import { NextRequest, NextResponse } from "next/server";
import { signSiteAuth } from "@/lib/auth";

const COOKIE = "site_auth";

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
      background: #0a0a0a;
      padding: 2rem;
    }
    .card {
      background: #111;
      border: 1px solid #1e1e1e;
      border-radius: 1.25rem;
      box-shadow: 0 1px 3px rgba(0,0,0,.4);
      padding: 2.5rem;
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
    h1 { font-size: 1.5rem; font-weight: 800; color: #00D64F; margin-bottom: .5rem; letter-spacing: -.02em; }
    p  { font-size: .95rem; color: #6b7280; margin-bottom: 2rem; }
    input[type="password"] {
      width: 100%;
      background: #0a0a0a;
      border: 1px solid #2a2a2a;
      border-radius: .75rem;
      padding: .85rem 1.1rem;
      font-size: 1rem;
      color: #fff;
      outline: none;
      margin-bottom: 1rem;
    }
    input[type="password"]:focus { border-color: #00D64F; }
    button {
      width: 100%;
      background: #00D64F;
      color: #000;
      border: none;
      border-radius: 9999px;
      padding: .9rem 1.5rem;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: #00c248; }
    .error {
      background: rgba(239,68,68,.1);
      border: 1px solid rgba(239,68,68,.3);
      color: #f87171;
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
      <button type="submit">Enter →</button>
    </form>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: error ? 401 : 200,
    headers: { "Content-Type": "text/html" },
  });
}

export async function GET(req: NextRequest) {
  const redirectTo = req.nextUrl.searchParams.get("redirect_to") || "/";
  const error = req.nextUrl.searchParams.get("auth_error") === "1";
  return passwordPage(redirectTo, error);
}

export async function POST(req: NextRequest) {
  const body = await req.formData();
  const password = body.get("password") as string | null;
  const redirectTo = (body.get("redirect_to") as string | null) || "/";

  if (password && password === process.env.SITE_PASSWORD) {
    const res = NextResponse.redirect(new URL(redirectTo, req.url), { status: 303 });
    res.cookies.set(COOKIE, await signSiteAuth(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return res;
  }

  // Wrong password — stay on the auth page with an error flag
  const authUrl = new URL("/api/auth", req.url);
  authUrl.searchParams.set("redirect_to", redirectTo);
  authUrl.searchParams.set("auth_error", "1");
  return NextResponse.redirect(authUrl, { status: 303 });
}
