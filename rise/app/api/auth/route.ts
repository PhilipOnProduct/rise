import { NextRequest, NextResponse } from "next/server";

const COOKIE = "site_auth";

export async function POST(req: NextRequest) {
  const body = await req.formData();
  const password = body.get("password") as string | null;
  const redirectTo = (body.get("redirect_to") as string | null) || "/";

  if (password === process.env.SITE_PASSWORD) {
    const res = NextResponse.redirect(new URL(redirectTo, req.url));
    res.cookies.set(COOKIE, process.env.SITE_PASSWORD!, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // secure: true should be added when deploying to production over HTTPS
    });
    return res;
  }

  // Wrong password — redirect back to the original page with an error flag
  const url = new URL(redirectTo, req.url);
  url.searchParams.set("auth_error", "1");
  return NextResponse.redirect(url);
}
