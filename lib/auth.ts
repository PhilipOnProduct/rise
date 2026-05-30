/**
 * Site auth + admin gate.
 *
 * The site_auth cookie no longer holds SITE_PASSWORD itself. Instead it
 * holds `<token>.<hmac>` where hmac = HMAC-SHA256(SITE_PASSWORD, token)
 * truncated to base64url. A leaked cookie no longer discloses the
 * password, and is invalidated by changing SITE_PASSWORD.
 *
 * We use Web Crypto so the same code runs on the Edge runtime
 * (middleware) and Node (route handlers).
 */

const enc = new TextEncoder();

/**
 * Normalise a user-supplied post-auth redirect target to a safe, same-origin
 * relative path. Defends against open redirects (`//evil.com`,
 * `https://evil.com`, backslash tricks) by parsing against a throwaway origin
 * and rejecting anything that escapes it. Returns a path that always begins
 * with a single "/". Used by the site-password gate (`/api/auth`) and the
 * magic-link callback (`/auth/callback`) before they redirect or reflect the
 * value into HTML.
 */
export function safeRelativePath(
  value: string | null | undefined,
  fallback = "/"
): string {
  if (!value || typeof value !== "string") return fallback;
  // Must be a path, not protocol-relative, and free of backslash variants
  // some browsers fold into "//".
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  try {
    const u = new URL(value, "http://localhost");
    if (u.origin !== "http://localhost") return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function bytesToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Sign a fresh site_auth cookie value. Returns "<token>.<mac>". */
export async function signSiteAuth(): Promise<string> {
  const secret = process.env.SITE_PASSWORD;
  if (!secret) throw new Error("SITE_PASSWORD not set");
  const tokenBytes = new Uint8Array(16);
  crypto.getRandomValues(tokenBytes);
  const token = bytesToBase64Url(tokenBytes.buffer);
  const key = await importHmacKey(secret);
  const macBuf = await crypto.subtle.sign("HMAC", key, enc.encode(token));
  return `${token}.${bytesToBase64Url(macBuf)}`;
}

/** Verify a site_auth cookie value against SITE_PASSWORD. */
export async function verifySiteAuth(cookieValue: string | undefined): Promise<boolean> {
  const secret = process.env.SITE_PASSWORD;
  if (!secret || !cookieValue) return false;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0) return false;
  const token = cookieValue.slice(0, dot);
  const presented = cookieValue.slice(dot + 1);
  const key = await importHmacKey(secret);
  const expectedBuf = await crypto.subtle.sign("HMAC", key, enc.encode(token));
  const expected = bytesToBase64Url(expectedBuf);
  // Constant-time string compare.
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Admin gate. Returns true when the request carries a `rise_admin` cookie
 * matching ADMIN_PASSWORD. When ADMIN_PASSWORD is unset, the gate is OPEN
 * (preserves dev workflows where the env var isn't configured), but a
 * console warning is emitted so misconfiguration is visible.
 */
export function isAdminRequest(req: Request): boolean {
  const adminPw = process.env.ADMIN_PASSWORD;
  if (!adminPw) {
    // Fail CLOSED in production: a missing env var must not silently expose
    // admin data (AI logs, usage, evals, team conversations). Dev stays open
    // so local workflows don't need the var set.
    if (process.env.NODE_ENV === "production") {
      console.error("[auth] ADMIN_PASSWORD is unset in production — denying admin access. Set ADMIN_PASSWORD.");
      return false;
    }
    return true;
  }
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)rise_admin=([^;]+)/.exec(cookieHeader);
  if (!match) return false;
  const presented = decodeURIComponent(match[1]);
  if (presented.length !== adminPw.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ adminPw.charCodeAt(i);
  }
  return diff === 0;
}

/** 403 JSON response when admin check fails. */
export function adminForbiddenResponse(): Response {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Server-side admin check for Server Components (e.g. layout) where there
 * is no Request object — reads cookies via `next/headers`. Mirrors
 * `isAdminRequest`'s semantics: open in dev when ADMIN_PASSWORD is unset,
 * constant-time match against the cookie otherwise. Fail-safe to false on
 * any error.
 */
export async function isAdminFromCookies(): Promise<boolean> {
  try {
    const adminPw = process.env.ADMIN_PASSWORD;
    if (!adminPw) {
      // Fail CLOSED in production (see isAdminRequest); dev stays open.
      if (process.env.NODE_ENV === "production") {
        console.error("[auth] ADMIN_PASSWORD is unset in production — denying admin access. Set ADMIN_PASSWORD.");
        return false;
      }
      return true;
    }
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const presented = cookieStore.get("rise_admin")?.value;
    if (!presented || presented.length !== adminPw.length) return false;
    let diff = 0;
    for (let i = 0; i < presented.length; i++) {
      diff |= presented.charCodeAt(i) ^ adminPw.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}
