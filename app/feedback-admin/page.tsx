"use client";

import { useEffect, useState } from "react";

type FeedbackEntry = {
  id: string;
  page: string;
  feedback: string;
  created_at: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function FeedbackAdminPage() {
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/feedback")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setEntries(data); setLoading(false); });
  }, []);

  return (
    <main className="min-h-screen bg-[#f8f6f1] px-6 py-14">
      <div className="max-w-5xl mx-auto">

        <div className="mb-10">
          <h1 className="text-4xl font-extrabold tracking-tight">User feedback</h1>
          <p className="text-[#6a7f8f] mt-1">{loading ? "Loading…" : `${entries.length} entries`}</p>
        </div>

        {!loading && entries.length === 0 && (
          <p className="text-[#6a7f8f] text-sm">No feedback yet.</p>
        )}

        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <div key={entry.id} className="bg-white border border-[#e8e4de] rounded-2xl px-5 py-4">
              <div className="flex items-start justify-between gap-4 mb-2">
                <span className="text-xs font-mono text-[#1a6b7f]/70 truncate">{entry.page}</span>
                <span className="shrink-0 text-xs text-[#6a7f8f]">{formatDate(entry.created_at)}</span>
              </div>
              <p className="text-sm text-[#0e2a47] whitespace-pre-wrap">{entry.feedback}</p>
            </div>
          ))}
        </div>

      </div>
    </main>
  );
}
