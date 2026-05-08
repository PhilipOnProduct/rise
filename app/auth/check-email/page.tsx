"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const RESEND_COOLDOWN_SEC = 30;

function CheckEmailInner() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const travelerId = params.get("travelerId");

  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SEC);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function resend() {
    if (!email || cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setResent(false);
    const supabase = getSupabaseBrowserClient();
    const redirect = travelerId
      ? `${window.location.origin}/auth/callback?next=/dashboard&travelerId=${encodeURIComponent(travelerId)}`
      : `${window.location.origin}/auth/callback?next=/dashboard`;
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: email.toLowerCase(),
      options: { emailRedirectTo: redirect },
    });
    setResending(false);
    if (otpErr) {
      console.error("[check-email] resend error:", otpErr.message);
      setError("Couldn't resend just now. Try again in a moment.");
      return;
    }
    setResent(true);
    setCooldown(RESEND_COOLDOWN_SEC);
  }

  return (
    <main className="min-h-screen bg-[#f8f6f1] flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        <Link
          href="/"
          className="block text-[#1a6b7f] font-extrabold text-lg tracking-tight mb-10"
        >
          Rise
        </Link>

        <div className="text-5xl mb-6">✉️</div>

        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--text-primary)] mb-3">
          Check your email
        </h1>
        <p className="text-[var(--text-secondary)] mb-8">
          We sent a link to{" "}
          <span className="font-semibold text-[var(--text-primary)] break-words">
            {email || "your inbox"}
          </span>
          . Click it to finish signing in.
        </p>

        <div className="rounded-2xl border border-[#e8e4de] bg-white p-5 text-left mb-6">
          <p className="text-sm text-[var(--text-secondary)] mb-2">
            Didn&apos;t get it?
          </p>
          <ul className="text-xs text-[var(--text-muted)] list-disc pl-4 space-y-1">
            <li>Check your spam or promotions folder.</li>
            <li>Confirm the email is spelled right.</li>
            <li>The link expires in 1 hour.</li>
          </ul>
        </div>

        {resent && (
          <p className="text-sm text-[#1a6b7f] mb-4" role="status">
            Sent. Check your inbox again.
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600 mb-4" role="alert">
            {error}
          </p>
        )}

        <button
          onClick={() => void resend()}
          disabled={cooldown > 0 || resending || !email}
          className="text-sm text-[#1a6b7f] font-semibold hover:underline disabled:text-[var(--text-muted)] disabled:no-underline disabled:cursor-not-allowed"
        >
          {resending
            ? "Resending…"
            : cooldown > 0
            ? `Resend in ${cooldown}s`
            : "Resend magic link →"}
        </button>

        <p className="text-xs text-[var(--text-muted)] mt-8">
          Wrong email?{" "}
          <Link href="/signin" className="text-[#1a6b7f] hover:underline">
            Try again
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense fallback={null}>
      <CheckEmailInner />
    </Suspense>
  );
}
