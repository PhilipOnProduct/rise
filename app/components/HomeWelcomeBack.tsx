"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

// PHI-65: Subtle welcome-back pill shown on the homepage to signed-in
// users who have at least one saved trip. Renders nothing for
// signed-out users or signed-in users with no trips, so the homepage
// keeps working as a landing page for new trips.
export default function HomeWelcomeBack() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    async function check() {
      const { data } = await supabase.auth.getUser();
      if (cancelled || !data.user) return;
      try {
        const res = await fetch("/api/travelers/list", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { travelers?: unknown[] };
        if (cancelled) return;
        if (Array.isArray(body.travelers) && body.travelers.length > 0) {
          setShow(true);
        }
      } catch {
        // Network errors aren't worth surfacing here — the dropdown
        // still gives signed-in users a route to /dashboard.
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  return (
    <div className="w-full flex justify-center px-6 pt-2">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm bg-white border border-[#e8e4de] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[#d4cfc5] transition-colors"
      >
        <span>Welcome back — pick up where you left off</span>
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
