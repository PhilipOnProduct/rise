"use client";

import { useEffect, useState } from "react";

type FeedbackEntry = {
  id: string;
  page: string;
  feedback: string;
  created_at: string;
};

type Log = {
  id: string;
  feature: string;
  model: string;
  input: Record<string, unknown>;
  output: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
  prompt: string;
  rating: "good" | "bad" | null;
  notes: string | null;
};

const FEATURE_COLORS: Record<string, string> = {
  recommendations: "bg-orange-500/20 text-orange-400",
  transport: "bg-blue-500/20 text-blue-400",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function truncate(str: string, n: number) {
  return str.length > n ? str.slice(0, n) + "…" : str;
}

export default function AdminPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);

  useEffect(() => {
    fetch("/api/admin/logs")
      .then((r) => r.json())
      .then((data) => { setLogs(data); setLoading(false); });
    fetch("/api/feedback")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setFeedbackEntries(data); });
  }, []);

  async function updateLog(id: string, patch: Partial<Pick<Log, "rating" | "notes">>) {
    const res = await fetch(`/api/admin/logs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return;
    const updated: Log = await res.json();
    setLogs((prev) => prev.map((l) => (l.id === id ? updated : l)));
  }

  async function handleSaveNotes(id: string) {
    setSavingIds((s) => new Set(s).add(id));
    await updateLog(id, { notes: pendingNotes[id] ?? "" });
    setSavingIds((s) => { const n = new Set(s); n.delete(id); return n; });
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => {
      if (prev === id) return null;
      const log = logs.find((l) => l.id === id);
      if (log && !(id in pendingNotes)) {
        setPendingNotes((p) => ({ ...p, [id]: log.notes ?? "" }));
      }
      return id;
    });
  }

  const inputCls = "w-full bg-[#0a0a0a] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-4 py-3 text-white text-xs placeholder-[#444] transition-colors resize-none font-mono";

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-14">
      <div className="max-w-5xl mx-auto">

        <div className="mb-10">
          <h1 className="text-4xl font-extrabold tracking-tight">AI Logs</h1>
          <p className="text-gray-500 mt-1">{logs.length} interactions logged</p>
        </div>

        {loading && <p className="text-gray-600 text-sm">Loading…</p>}
        {!loading && logs.length === 0 && <p className="text-gray-600 text-sm">No logs yet.</p>}

        <div className="flex flex-col gap-2">
          {logs.map((log) => {
            const isExpanded = expandedId === log.id;
            const notesDirty = pendingNotes[log.id] !== undefined && pendingNotes[log.id] !== (log.notes ?? "");

            return (
              <div key={log.id} className="bg-[#111] border border-[#1e1e1e] rounded-2xl overflow-hidden">

                {/* Row */}
                <button
                  onClick={() => toggleExpand(log.id)}
                  className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-[#161616] transition-colors"
                >
                  <span className={`shrink-0 rounded-lg px-2.5 py-0.5 text-xs font-bold ${FEATURE_COLORS[log.feature] ?? "bg-[#2a2a2a] text-gray-400"}`}>
                    {log.feature}
                  </span>
                  <span className="shrink-0 text-xs text-gray-600 font-mono hidden sm:block">
                    {log.model.replace("claude-", "")}
                  </span>
                  <span className="flex-1 text-sm text-gray-400 truncate">
                    {truncate(log.output, 120)}
                  </span>
                  <span className="shrink-0 text-xs text-gray-600 hidden md:block">{log.latency_ms}ms</span>
                  <span className="shrink-0 text-xs text-gray-600 hidden md:block">{log.input_tokens}↑ {log.output_tokens}↓</span>
                  <span className="shrink-0 text-xs text-gray-600 hidden lg:block">{formatDate(log.created_at)}</span>
                  <span className="shrink-0 text-base">
                    {log.rating === "good" ? "✅" : log.rating === "bad" ? "❌" : "·"}
                  </span>
                  <span className="shrink-0 text-gray-600 text-xs">{isExpanded ? "▲" : "▼"}</span>
                </button>

                {/* Expanded */}
                {isExpanded && (
                  <div className="border-t border-[#1e1e1e] px-5 py-6 flex flex-col gap-6">

                    {/* Meta */}
                    <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                      <span><strong className="text-gray-400">Model:</strong> {log.model}</span>
                      <span><strong className="text-gray-400">Latency:</strong> {log.latency_ms}ms</span>
                      <span><strong className="text-gray-400">Tokens:</strong> {log.input_tokens} in / {log.output_tokens} out</span>
                      <span><strong className="text-gray-400">Date:</strong> {formatDate(log.created_at)}</span>
                    </div>

                    {/* Prompt */}
                    <div>
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Prompt</h3>
                      <pre className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl p-4 text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap font-mono">{log.prompt}</pre>
                    </div>

                    {/* Input */}
                    <div>
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Input</h3>
                      <pre className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl p-4 text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap font-mono">{JSON.stringify(log.input, null, 2)}</pre>
                    </div>

                    {/* Output */}
                    <div>
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Output</h3>
                      <pre className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl p-4 text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap font-mono">{log.output}</pre>
                    </div>

                    {/* Rating */}
                    <div>
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Rating</h3>
                      <div className="flex gap-3">
                        {(["good", "bad"] as const).map((r) => (
                          <button key={r}
                            onClick={() => updateLog(log.id, { rating: r })}
                            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold border transition-colors ${
                              log.rating === r
                                ? r === "good" ? "border-green-500/50 bg-green-500/10 text-green-400" : "border-red-500/50 bg-red-500/10 text-red-400"
                                : "border-[#2a2a2a] text-gray-500 hover:border-[#3a3a3a] hover:text-white"
                            }`}>
                            {r === "good" ? "✅ Good" : "❌ Bad"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Notes</h3>
                      <textarea
                        rows={3}
                        value={pendingNotes[log.id] ?? log.notes ?? ""}
                        onChange={(e) => setPendingNotes((p) => ({ ...p, [log.id]: e.target.value }))}
                        placeholder="Add notes about this response…"
                        className={inputCls}
                      />
                      <button
                        onClick={() => handleSaveNotes(log.id)}
                        disabled={savingIds.has(log.id) || !notesDirty}
                        className="mt-2 rounded-xl bg-[#00D64F] text-black px-5 py-2 text-sm font-bold hover:bg-[#00c248] transition-colors disabled:opacity-30"
                      >
                        {savingIds.has(log.id) ? "Saving…" : "Save notes"}
                      </button>
                    </div>

                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Recent feedback */}
        <div className="mt-16">
          <div className="mb-6">
            <h2 className="text-2xl font-extrabold tracking-tight">Recent feedback</h2>
            <p className="text-gray-500 mt-1">{feedbackEntries.length} entries</p>
          </div>

          {feedbackEntries.length === 0 ? (
            <p className="text-gray-600 text-sm">No feedback yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {feedbackEntries.map((entry) => (
                <div key={entry.id} className="bg-[#111] border border-[#1e1e1e] rounded-2xl px-5 py-4">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <span className="text-xs font-mono text-[#00D64F]/70 truncate">{entry.page}</span>
                    <span className="shrink-0 text-xs text-gray-600">{formatDate(entry.created_at)}</span>
                  </div>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{entry.feedback}</p>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
