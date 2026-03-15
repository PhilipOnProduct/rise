"use client";

import { useEffect, useState } from "react";

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
  recommendations: "bg-orange-100 text-orange-700",
  transport: "bg-blue-100 text-blue-700",
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

  useEffect(() => {
    fetch("/api/admin/logs")
      .then((r) => r.json())
      .then((data) => {
        setLogs(data);
        setLoading(false);
      });
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

  async function handleRating(id: string, rating: "good" | "bad") {
    await updateLog(id, { rating });
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

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-12">
      <div className="max-w-5xl mx-auto">

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">AI Logs</h1>
          <p className="text-gray-500 mt-1">{logs.length} interactions logged</p>
        </div>

        {loading && <p className="text-gray-400 text-sm">Loading…</p>}

        {!loading && logs.length === 0 && (
          <p className="text-gray-400 text-sm">No logs yet.</p>
        )}

        <div className="flex flex-col gap-3">
          {logs.map((log) => {
            const isExpanded = expandedId === log.id;
            const notesDirty = pendingNotes[log.id] !== undefined &&
              pendingNotes[log.id] !== (log.notes ?? "");

            return (
              <div
                key={log.id}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden"
              >
                {/* Row — always visible */}
                <button
                  onClick={() => toggleExpand(log.id)}
                  className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors"
                >
                  {/* Feature badge */}
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${FEATURE_COLORS[log.feature] ?? "bg-gray-100 text-gray-600"}`}>
                    {log.feature}
                  </span>

                  {/* Model */}
                  <span className="shrink-0 text-xs text-gray-400 font-mono hidden sm:block">
                    {log.model.replace("claude-", "")}
                  </span>

                  {/* Output preview */}
                  <span className="flex-1 text-sm text-gray-600 truncate">
                    {truncate(log.output, 120)}
                  </span>

                  {/* Stats */}
                  <span className="shrink-0 text-xs text-gray-400 hidden md:block">
                    {log.latency_ms}ms
                  </span>
                  <span className="shrink-0 text-xs text-gray-400 hidden md:block">
                    {log.input_tokens}↑ {log.output_tokens}↓
                  </span>

                  {/* Date */}
                  <span className="shrink-0 text-xs text-gray-400 hidden lg:block">
                    {formatDate(log.created_at)}
                  </span>

                  {/* Rating */}
                  <span className="shrink-0 text-base">
                    {log.rating === "good" ? "✅" : log.rating === "bad" ? "❌" : "·"}
                  </span>

                  {/* Chevron */}
                  <span className="shrink-0 text-gray-300 text-sm">
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </button>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 py-5 flex flex-col gap-6">

                    {/* Meta row */}
                    <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                      <span><strong>Model:</strong> {log.model}</span>
                      <span><strong>Latency:</strong> {log.latency_ms}ms</span>
                      <span><strong>Tokens:</strong> {log.input_tokens} in / {log.output_tokens} out</span>
                      <span><strong>Date:</strong> {formatDate(log.created_at)}</span>
                    </div>

                    {/* Prompt */}
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Prompt</h3>
                      <pre className="bg-gray-50 border border-gray-100 rounded-lg p-4 text-xs text-gray-700 overflow-x-auto whitespace-pre-wrap">
                        {log.prompt}
                      </pre>
                    </div>

                    {/* Input */}
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Input</h3>
                      <pre className="bg-gray-50 border border-gray-100 rounded-lg p-4 text-xs text-gray-700 overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(log.input, null, 2)}
                      </pre>
                    </div>

                    {/* Output */}
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Output</h3>
                      <pre className="bg-gray-50 border border-gray-100 rounded-lg p-4 text-xs text-gray-700 overflow-x-auto whitespace-pre-wrap">
                        {log.output}
                      </pre>
                    </div>

                    {/* Rating */}
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Rating</h3>
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleRating(log.id, "good")}
                          className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium border transition-colors ${
                            log.rating === "good"
                              ? "bg-green-100 border-green-300 text-green-800"
                              : "border-gray-200 text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          ✅ Good
                        </button>
                        <button
                          onClick={() => handleRating(log.id, "bad")}
                          className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium border transition-colors ${
                            log.rating === "bad"
                              ? "bg-red-100 border-red-300 text-red-800"
                              : "border-gray-200 text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          ❌ Bad
                        </button>
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</h3>
                      <textarea
                        rows={3}
                        value={pendingNotes[log.id] ?? log.notes ?? ""}
                        onChange={(e) =>
                          setPendingNotes((p) => ({ ...p, [log.id]: e.target.value }))
                        }
                        placeholder="Add notes about this response…"
                        className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      />
                      <button
                        onClick={() => handleSaveNotes(log.id)}
                        disabled={savingIds.has(log.id) || !notesDirty}
                        className="mt-2 rounded-full bg-blue-600 px-5 py-2 text-sm text-white font-medium hover:bg-blue-700 transition-colors disabled:opacity-40"
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
      </div>
    </main>
  );
}
