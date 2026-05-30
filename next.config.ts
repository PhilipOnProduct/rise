import type { NextConfig } from "next";
import path from "path";

// Conservative, framework-agnostic security headers applied to every response.
// Intentionally NO Content-Security-Policy yet: the app loads Google Maps JS,
// Supabase, the Anthropic stream, and Vercel Analytics, so a CSP must be
// authored and tested against those origins before it's safe to enable — a
// wrong policy silently breaks Maps autocomplete / streaming. Tracked as a
// follow-up.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
