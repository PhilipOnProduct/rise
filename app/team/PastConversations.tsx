"use client";

import { useState, useEffect, useCallback } from "react";
import { deleteConversation, loadConversations, loadPrdFeedback, savePrdFeedback } from "./team-data";
import type { ConversationRow } from "./team-types";

// ── Past conversations panel ───────────────────────────────────────────────────

export function PastConversations({
  type,
  onLoad,
  activeConversationId,
}: {
  type: "team" | "coach" | "pm";
  onLoad: (row: ConversationRow) => void;
  activeConversationId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Feedback state (team only)
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string[]>>({});
  const [draftMap, setDraftMap] = useState<Record<string, string>>({});
  const [openFeedbackId, setOpenFeedbackId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  // Delete state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadConversations(type);
    setRows(data);
    if (type === "team") {
      const prdRows = data.filter((r) => r.prd);
      const results = await Promise.all(prdRows.map((r) => loadPrdFeedback(r.id)));
      const map: Record<string, string[]> = {};
      prdRows.forEach((r, i) => { map[r.id] = results[i].map((f) => f.feedback); });
      setFeedbackMap(map);
    }
    setLoading(false);
  }, [type]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function handleSaveFeedback(rowId: string) {
    const text = (draftMap[rowId] ?? "").trim();
    if (!text) return;
    setSavingId(rowId);
    await savePrdFeedback(rowId, text);
    setFeedbackMap((prev) => ({ ...prev, [rowId]: [...(prev[rowId] ?? []), text] }));
    setDraftMap((prev) => ({ ...prev, [rowId]: "" }));
    setOpenFeedbackId(null);
    setSavingId(null);
  }

  async function handleDelete(rowId: string) {
    setDeletingId(rowId);
    await deleteConversation(rowId);
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    setConfirmDeleteId(null);
    setDeletingId(null);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="self-start text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        Past discussions →
      </button>
    );
  }

  return (
    <div className="bg-white border border-[#e8e4de] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Past discussions</span>
        <button onClick={() => setOpen(false)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          Close
        </button>
      </div>
      {loading && <p className="text-xs text-[var(--text-muted)] py-2">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-xs text-[var(--text-muted)] py-2">No past conversations yet.</p>
      )}
      {!loading && rows.length > 0 && (
        <div className="flex flex-col gap-1">
          {rows.map((row) => {
            const hasPrd = type === "team" && !!row.prd;
            const existingFeedback = feedbackMap[row.id] ?? [];
            const isOpenFeedback = openFeedbackId === row.id;
            const draft = draftMap[row.id] ?? "";

            const isActive = activeConversationId === row.id;
            const isConfirmingDelete = confirmDeleteId === row.id;
            const isDeleting = deletingId === row.id;

            return (
              <div key={row.id}>
                {/* Title row — click to load + delete button */}
                <div className="flex items-start gap-1 group/row rounded-xl hover:bg-[#f0ede8] transition-colors">
                  <button
                    onClick={() => { onLoad(row); setOpen(false); }}
                    className="flex-1 text-left px-3 py-2.5 min-w-0"
                  >
                    <p className="text-sm text-[var(--text-primary)] group-hover/row:text-[var(--text-primary)] break-words">{row.title}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {new Date(row.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      {hasPrd && <span className="ml-2 text-[#1a6b7f]">· PRD</span>}
                      {isActive && <span className="ml-2 text-[var(--text-muted)]">· Active</span>}
                    </p>
                  </button>
                  {!isActive && (
                    <button
                      onClick={() => setConfirmDeleteId(isConfirmingDelete ? null : row.id)}
                      className="shrink-0 mt-2 mr-2 p-1.5 text-[var(--text-muted)] hover:text-red-400 transition-colors opacity-0 group-hover/row:opacity-100"
                      title="Delete"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Inline delete confirmation */}
                {isConfirmingDelete && (
                  <div className="flex items-center gap-2 px-3 pb-2">
                    <span className="text-xs text-[var(--text-muted)]">Delete this conversation?</span>
                    <button
                      onClick={() => handleDelete(row.id)}
                      disabled={isDeleting}
                      className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-40"
                    >
                      {isDeleting ? "Deleting…" : "Yes"}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    >
                      No
                    </button>
                  </div>
                )}

                {/* Feedback section — team rows with PRD only */}
                {hasPrd && (
                  <div className="px-3 pb-3">
                    {/* Existing feedback items */}
                    {existingFeedback.length > 0 && (
                      <div className="flex flex-col gap-2 mb-2">
                        {existingFeedback.map((fb, i) => (
                          <div key={i} className="border-l-2 border-[#1a6b7f] pl-3 py-0.5">
                            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-1">Your feedback</p>
                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{fb}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Feedback form or trigger */}
                    {isOpenFeedback ? (
                      <div className="flex flex-col gap-2 mt-1">
                        <textarea
                          rows={3}
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraftMap((prev) => ({ ...prev, [row.id]: e.target.value }))}
                          placeholder="What would you improve or change about this PRD?"
                          className="w-full bg-[#f8f6f1] border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder-[#9ca3af] transition-colors text-xs resize-none"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSaveFeedback(row.id)}
                            disabled={!draft.trim() || savingId === row.id}
                            className="text-xs font-semibold bg-[#1a6b7f] text-white rounded-xl px-4 py-2 hover:bg-[#155a6b] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {savingId === row.id ? "Saving…" : "Save feedback"}
                          </button>
                          <button
                            onClick={() => { setOpenFeedbackId(null); setDraftMap((prev) => ({ ...prev, [row.id]: "" })); }}
                            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setOpenFeedbackId(row.id)}
                        className="text-xs text-[var(--text-muted)] hover:text-[#1a6b7f] transition-colors"
                      >
                        + Add feedback
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
