"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

export default function FeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");

  // Hide on /welcome and /team
  if (pathname === "/welcome" || pathname.startsWith("/team")) return null;

  async function handleSend() {
    if (!text.trim()) return;
    setStatus("sending");
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: pathname, feedback: text.trim() }),
    });
    setStatus("done");
    setTimeout(() => {
      setOpen(false);
      setText("");
      setStatus("idle");
    }, 1800);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Give feedback"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-[#00D64F] text-black text-sm font-bold rounded-2xl px-4 py-2.5 shadow-lg hover:bg-[#00c248] transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 2h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5l-3 2V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Feedback
      </button>

      {/* Popup panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Send feedback"
          className="fixed bottom-20 right-6 z-50 w-80 bg-[#111] border border-[#2a2a2a] rounded-2xl shadow-2xl p-5 flex flex-col gap-4"
          onKeyDown={handleKeyDown}
        >
          {status === "done" ? (
            <div className="text-center py-6">
              <div className="text-2xl mb-2">✓</div>
              <p className="text-white font-semibold">Thanks for the feedback!</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Send feedback</p>
                <button
                  onClick={() => setOpen(false)}
                  className="text-gray-500 hover:text-white transition-colors text-lg leading-none"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <textarea
                autoFocus
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What's on your mind?"
                className="w-full bg-[#0a0a0a] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-4 py-3 text-sm text-white placeholder-[#444] resize-none transition-colors"
              />
              <button
                onClick={handleSend}
                disabled={!text.trim() || status === "sending"}
                className="w-full bg-[#00D64F] text-black font-bold rounded-2xl py-2.5 text-sm hover:bg-[#00c248] transition-colors disabled:opacity-40"
              >
                {status === "sending" ? "Sending…" : "Send feedback"}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
