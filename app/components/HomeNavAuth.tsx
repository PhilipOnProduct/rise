"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

// PHI-62: Auth-aware slot for the homepage's bespoke nav. The homepage
// can't use the global Nav (Nav.tsx returns null on "/") and previously
// hard-coded a "Sign in" link that always showed even for signed-in users.
// Mirrors the auth-state subscription and avatar dropdown from Nav.tsx.
export default function HomeNavAuth() {
  const router = useRouter();
  // null = unknown (not yet checked); false = confirmed signed-out;
  // string = signed-in email. Render nothing while null to avoid
  // flashing "Sign in" before the avatar resolves.
  const [userEmail, setUserEmail] = useState<string | null | false>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUserEmail(data.user?.email ?? false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    setAccountOpen(false);
    router.refresh();
    router.push("/");
  }

  if (userEmail === null) return null;

  if (userEmail === false) {
    return (
      <Link
        href="/signin"
        className="text-sm font-medium hover:opacity-70 transition-opacity"
        style={{ color: "#4a6580" }}
      >
        Sign in
      </Link>
    );
  }

  const initial = userEmail.length > 0 ? userEmail[0].toUpperCase() : "";

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setAccountOpen((v) => !v)}
        aria-label="Account menu"
        className="w-9 h-9 rounded-full bg-[#1a6b7f] text-white text-sm font-bold flex items-center justify-center hover:opacity-90 transition-opacity"
      >
        {initial}
      </button>
      {accountOpen && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-white border border-[#d4cfc5] rounded-2xl overflow-hidden shadow-2xl">
          <div className="px-4 py-3 border-b border-[#e8e4de]">
            <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-semibold mb-1">
              Signed in as
            </p>
            <p className="text-sm text-[var(--text-primary)] break-words">
              {userEmail}
            </p>
          </div>
          <Link
            href="/dashboard"
            onClick={() => setAccountOpen(false)}
            className="block w-full text-left px-4 py-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[#f0ede8] transition-colors border-b border-[#e8e4de]"
          >
            My trips
          </Link>
          <button
            onClick={() => void handleSignOut()}
            className="block w-full text-left px-4 py-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[#f0ede8] transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
