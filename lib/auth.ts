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
    if (process.env.NODE_ENV === "production") {
      console.warn("[auth] ADMIN_PASSWORD is unset in production — admin endpoints are unguarded.");
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
