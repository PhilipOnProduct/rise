"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function FeedbackPage() {
  const router = useRouter();
  const [page, setPage] = useState("");
  const [feedback, setFeedback] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");

  useEffect(() => {
    setPage(window.location.href);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!feedback.trim()) return;
    setStatus("sending");
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, feedback: feedback.trim() }),
    });
    setStatus("done");
  }

  if (status === "done") {
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-[#00D64F]/10 border border-[#00D64F]/30 flex items-center justify-center mx-auto mb-6">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="#00D64F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight mb-3">Thanks!</h1>
          <p className="text-gray-400 mb-8">Your feedback has been received.</p>
          <button
            onClick={() => router.back()}
            className="text-sm text-gray-500 hover:text-white transition-colors"
          >
            ← Go back
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-14">
      <div className="max-w-xl mx-auto">

        <div className="mb-10">
          <p className="text-[#00D64F] text-sm font-semibold tracking-widest uppercase mb-3">Rise</p>
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">Send feedback</h1>
          <p className="text-gray-400">Let us know what's working, what isn't, or what you'd like to see.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">
              Page
            </label>
            <input
              type="text"
              value={page}
              onChange={(e) => setPage(e.target.value)}
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white text-sm transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">
              Feedback
            </label>
            <textarea
              autoFocus
              rows={7}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What's on your mind?"
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white placeholder-[#444] resize-none transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={!feedback.trim() || status === "sending"}
            className="w-full bg-[#00D64F] text-black font-bold rounded-2xl py-4 text-base hover:bg-[#00c248] transition-colors disabled:opacity-40"
          >
            {status === "sending" ? "Sending…" : "Send feedback"}
          </button>
        </form>

      </div>
    </main>
  );
}
