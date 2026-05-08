"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SignInPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const errorParam = params.get("error");

  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(
    errorParam === "expired"
      ? "That link expired. Send a new one →"
      : errorParam === "missing_code"
      ? "Something went wrong. Try again?"
      : null
  );

  const valid = EMAIL_RE.test(email.trim());

  async function send() {
    if (!valid || sending) return;
    setSending(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });
    if (otpErr) {
      console.error("[signin] otp error:", otpErr.message);
      setError("Something went wrong. Try again?");
      setSending(false);
      return;
    }
    router.push(`/auth/check-email?email=${encodeURIComponent(email.trim())}`);
  }

  return (
    <main className="min-h-screen bg-[#f8f6f1] flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="block text-[#1a6b7f] font-extrabold text-lg tracking-tight mb-10 text-center"
        >
          Rise
        </Link>

        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--text-primary)] mb-2">
          Sign in
        </h1>
        <p className="text-[var(--text-secondary)] mb-8">
          We&apos;ll email you a magic link. No password needed.
        </p>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="signin-email"
              className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest"
            >
              Email
            </label>
            <input
              id="signin-email"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
              aria-invalid={touched && email.length > 0 && !valid}
              className="w-full bg-white border border-[#b8b3a9] focus:border-[#1a6b7f] outline-none rounded-xl px-5 py-4 text-[var(--text-primary)] text-lg placeholder-[#9ca3af] transition-colors"
            />
            {touched && email.length > 0 && !valid && (
              <p className="text-xs text-red-500" role="alert">
                That doesn&apos;t look like a valid email.
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            onClick={() => void send()}
            disabled={!valid || sending}
            className="w-full rounded-2xl bg-[#1a6b7f] text-white font-bold text-lg py-4 hover:bg-[#155a6b] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {sending ? "Sending…" : "Send magic link →"}
          </button>

          <p className="text-xs text-[var(--text-muted)] text-center mt-2">
            New here?{" "}
            <Link href="/welcome" className="text-[#1a6b7f] hover:underline">
              Plan a trip first →
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInPageInner />
    </Suspense>
  );
}
