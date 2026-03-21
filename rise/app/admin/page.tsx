"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type TeamDiscussion = {
  id: string;
  title: string;
  created_at: string;
  prd: string | null;
  messages: {
    problem: string;
    framing: string;
    alex: string;
    maya: string;
    luca: string;
    elena: string;
    synthesis: string;
  };
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

  const [discussions, setDiscussions] = useState<TeamDiscussion[]>([]);
  const [discussionsLoading, setDiscussionsLoading] = useState(true);
  const [expandedDiscussionId, setExpandedDiscussionId] = useState<string | null>(null);
  const [expandedPrdId, setExpandedPrdId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/logs")
      .then((r) => r.json())
      .then((data) => { setLogs(data); setLoading(false); });

    supabase
      .from("team_conversations")
      .select("id, title, created_at, prd, messages")
      .eq("type", "team")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setDiscussions(data as TeamDiscussion[]);
        setDiscussionsLoading(false);
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

        {/* ── Team discussions ───────────────────────────────────────────── */}
        <div className="mb-14">
          <div className="mb-6">
            <h1 className="text-4xl font-extrabold tracking-tight">Team discussions</h1>
            <p className="text-gray-500 mt-1">{discussions.length} discussions</p>
          </div>

          {discussionsLoading && <p className="text-gray-600 text-sm">Loading…</p>}
          {!discussionsLoading && discussions.length === 0 && (
            <p className="text-gray-600 text-sm">No team discussions yet.</p>
          )}

          <div className="flex flex-col gap-2">
            {discussions.map((disc) => {
              const isOpen = expandedDiscussionId === disc.id;
              const isPrdOpen = expandedPrdId === disc.id;
              const msgs = disc.messages;
              return (
                <div key={disc.id} className="bg-[#111] border border-[#1e1e1e] rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setExpandedDiscussionId(isOpen ? null : disc.id)}
                    className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-[#161616] transition-colors"
                  >
                    <span className="flex-1 text-sm text-gray-300 truncate font-medium">{disc.title}</span>
                    <span className="shrink-0 text-xs text-gray-600">5 agents</span>
                    {disc.prd && <span className="shrink-0 text-xs text-[#00D64F]">PRD</span>}
                    <span className="shrink-0 text-xs text-gray-600 hidden md:block">
                      {new Date(disc.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                    <span className="shrink-0 text-gray-600 text-xs">{isOpen ? "▲" : "▼"}</span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-[#1e1e1e] px-5 py-6 flex flex-col gap-6">
                      {[
                        { label: "Sarah — Framing", content: msgs.framing },
                        { label: "Alex — Research", content: msgs.alex },
                        { label: "Maya — Design", content: msgs.maya },
                        { label: "Luca — Tech", content: msgs.luca },
                        { label: "Elena — Travel Expert", content: msgs.elena },
                        { label: "Sarah — Synthesis", content: msgs.synthesis },
                      ].map(({ label, content }) => (
                        <div key={label}>
                          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">{label}</h3>
                          <pre className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl p-4 text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap font-mono">{content || <span className="italic text-gray-700">empty</span>}</pre>
                        </div>
                      ))}

                      {disc.prd && (
                        <div>
                          <button
                            onClick={() => setExpandedPrdId(isPrdOpen ? null : disc.id)}
                            className="text-xs font-bold text-gray-500 uppercase tracking-widest hover:text-gray-300 transition-colors mb-2 flex items-center gap-2"
                          >
                            Sarah — PRD {isPrdOpen ? "▲" : "▼"}
                          </button>
                          {isPrdOpen && (
                            <pre className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl p-4 text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap font-mono">{disc.prd}</pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── AI Logs ────────────────────────────────────────────────────── */}
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

      </div>
    </main>
  );
}
