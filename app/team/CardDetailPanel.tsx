"use client";

import { useState } from "react";
import { ProductTeamTab } from "./ProductTeamTab";
import { STATUS_STYLES } from "./KanbanTab";
import { CardTypeBadge, PrdLine } from "./shared";
import { NEXT_STATUS, STATUS_LABELS } from "./team-constants";
import { deleteObjective, updateObjectiveField, updateObjectiveStatus } from "./team-data";
import type { Discussion, Objective } from "./team-types";

// ── Card Detail Panel ─────────────────────────────────────────────────────────

export function CardDetailPanel({
  obj,
  onClose,
  onUpdate,
  onDiscussionSaved,
  buildMode,
}: {
  obj: Objective;
  onClose: () => void;
  onUpdate: (updated: Objective) => void;
  onDiscussionSaved: (objectiveId: string, discussion: Discussion, prd: string | null) => void;
  buildMode: boolean;
}) {
  const [showDiscussionModal, setShowDiscussionModal] = useState(false);
  const [codeResult, setCodeResult] = useState(obj.claude_code_result ?? "");
  const [savingResult, setSavingResult] = useState(false);
  const [resultSaved, setResultSaved] = useState(false);
  const [expandedDiscIdx, setExpandedDiscIdx] = useState<number | null>(null);
  const [prdOpen, setPrdOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmNoDisc, setConfirmNoDisc] = useState(false);

  const implPrompt = obj.prd ? extractImplementationPrompt(obj.prd) : "";
  const nextStatus = NEXT_STATUS[obj.status];
  const cleanTitle = obj.title.replace(/\*+/g, "");

  function handleCopy() {
    navigator.clipboard.writeText(implPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSaveResult() {
    setSavingResult(true);
    await updateObjectiveField(obj.id, { claude_code_result: codeResult || null });
    onUpdate({ ...obj, claude_code_result: codeResult || null });
    setSavingResult(false);
    setResultSaved(true);
    setTimeout(() => setResultSaved(false), 2000);
  }

  async function handleMoveToNext(force?: boolean) {
    if (!nextStatus) return;
    // Warn when moving refine → implement without any discussions
    if (obj.status === "refine" && nextStatus === "implement" && obj.discussions.length === 0 && !force) {
      setConfirmNoDisc(true);
      return;
    }
    setConfirmNoDisc(false);
    await updateObjectiveStatus(obj.id, nextStatus);
    onUpdate({ ...obj, status: nextStatus });
  }

  async function handleDelete() {
    await deleteObjective(obj.id);
    onUpdate({ ...obj, status: "done", id: "__deleted__" });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-xl bg-[#f8f6f1] border-l border-[#d4cfc5] overflow-y-auto shadow-xl">
        <div className="p-6 flex flex-col gap-6">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <CardTypeBadge type={obj.card_type} />
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLES[obj.status]}`}>
                  {STATUS_LABELS[obj.status]}
                </span>
              </div>
              <h2 className="text-lg font-bold text-[var(--text-primary)] leading-snug">{cleanTitle}</h2>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {new Date(obj.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg shrink-0 p-1">×</button>
          </div>

          {/* Description */}
          {obj.description && (
            <div>
              <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">Description</p>
              <p className="text-sm text-[var(--text-primary)] leading-relaxed">{obj.description}</p>
            </div>
          )}

          {/* PM summary */}
          {obj.pm_summary && (
            <div>
              <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">PM conversation summary</p>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{obj.pm_summary}</p>
            </div>
          )}

          {/* Discussions */}
          {obj.discussions.length > 0 && (
            <div>
              <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">
                Team discussions ({obj.discussions.length})
              </p>
              <div className="flex flex-col gap-2">
                {obj.discussions.map((disc, idx) => (
                  <div key={idx} className="bg-white border border-[#e8e4de] rounded-xl p-3">
                    <button
                      onClick={() => setExpandedDiscIdx(expandedDiscIdx === idx ? null : idx)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--text-muted)]">{disc.date}</span>
                        <span className="text-xs text-[var(--text-muted)]">{expandedDiscIdx === idx ? "▲" : "▼"}</span>
                      </div>
                      <p className="text-sm text-[var(--text-primary)] mt-1 leading-relaxed">{disc.summary}</p>
                    </button>
                    {expandedDiscIdx === idx && (
                      <div className="mt-3 pt-3 border-t border-[#e8e4de] flex flex-col gap-3">
                        {disc.transcript.framing && (
                          <div>
                            <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1">Sarah (Framing)</p>
                            <p className="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">{disc.transcript.framing}</p>
                          </div>
                        )}
                        {disc.transcript.alex && (
                          <div>
                            <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1">Alex (Research)</p>
                            <p className="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">{disc.transcript.alex}</p>
                          </div>
                        )}
                        {disc.transcript.maya && (
                          <div>
                            <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1">Maya (Design)</p>
                            <p className="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">{disc.transcript.maya}</p>
                          </div>
                        )}
                        {disc.transcript.luca && (
                          <div>
                            <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1">Luca (Tech)</p>
                            <p className="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">{disc.transcript.luca}</p>
                          </div>
                        )}
                        {disc.transcript.elena && (
                          <div>
                            <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1">Elena (Travel Expert)</p>
                            <p className="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">{disc.transcript.elena}</p>
                          </div>
                        )}
                        {disc.transcript.synthesis && (
                          <div>
                            <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1">Sarah (Synthesis)</p>
                            <p className="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">{disc.transcript.synthesis}</p>
                          </div>
                        )}
                        {disc.prd && (
                          <div>
                            <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1">PRD</p>
                            <p className="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">{disc.prd}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Start team discussion — visible for refine cards */}
          {obj.status === "refine" && (
            <button
              onClick={() => setShowDiscussionModal(true)}
              className="rounded-2xl bg-[#1a6b7f] text-white font-bold px-6 py-3 hover:bg-[#155a6b] transition-colors text-sm w-fit"
            >
              Start team discussion →
            </button>
          )}

          {/* Full-screen discussion modal */}
          {showDiscussionModal && (
            <div className="fixed inset-0 z-[60] bg-[#f8f6f1] overflow-y-auto">
              <div className="max-w-3xl mx-auto px-6 py-8">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-bold text-[var(--text-primary)]">Team discussion: {cleanTitle}</h2>
                  <button
                    onClick={() => setShowDiscussionModal(false)}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl p-1"
                  >×</button>
                </div>
                <ProductTeamTab
                  pendingObjective={{ id: obj.id, problem: obj.title + (obj.description ? `\n\n${obj.description}` : "") }}
                  cardContext={obj}
                  onObjectiveSaved={() => {}}
                  onDiscussionSaved={(objId, disc, prd) => {
                    onDiscussionSaved(objId, disc, prd);
                    setShowDiscussionModal(false);
                    // Refresh the card with new discussion
                    const updated = { ...obj, discussions: [...obj.discussions, disc], prd: prd || obj.prd };
                    onUpdate(updated);
                  }}
                  buildMode={buildMode}
                />
              </div>
            </div>
          )}

          {/* PRD */}
          {obj.prd && (
            <div>
              <button
                onClick={() => setPrdOpen(!prdOpen)}
                className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2 hover:text-[var(--text-secondary)] transition-colors"
              >
                {prdOpen ? "Hide PRD ▲" : "View PRD ▼"}
              </button>
              {prdOpen && (
                <div className="bg-white border border-[#e8e4de] rounded-xl p-4 max-h-80 overflow-y-auto">
                  <div className="flex flex-col gap-1">
                    {obj.prd.split("\n").map((line, i) => <PrdLine key={i} line={line} i={i} />)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Claude Code prompt */}
          {implPrompt && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Claude Code Prompt</p>
                <button onClick={handleCopy} className="text-xs font-semibold text-[#1a6b7f] hover:underline">
                  {copied ? "Copied!" : "Copy prompt"}
                </button>
              </div>
              <div className="bg-white border border-[#e8e4de] rounded-xl p-4">
                <p className="text-xs text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">{implPrompt}</p>
              </div>
            </div>
          )}

          {/* Claude Code result — only on implement/done */}
          {(obj.status === "implement" || obj.status === "done") && (
            <div>
              <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">Claude Code Result</p>
              <textarea
                rows={5}
                value={codeResult}
                onChange={(e) => { setCodeResult(e.target.value); setResultSaved(false); }}
                placeholder="Paste Claude Code output here…"
                className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder-[#9ca3af] transition-colors text-xs resize-none"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={handleSaveResult}
                  disabled={savingResult}
                  className="text-xs font-semibold bg-[#1a6b7f] text-white rounded-xl px-4 py-2 hover:bg-[#155a6b] transition-colors disabled:opacity-40"
                >
                  {savingResult ? "Saving…" : "Save result"}
                </button>
                {resultSaved && <span className="text-xs text-[#1a6b7f]">Saved</span>}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3 pt-2 border-t border-[#d4cfc5]">
            <div className="flex items-center gap-3 flex-wrap">
            {nextStatus && (
              <button
                onClick={() => handleMoveToNext()}
                className="rounded-2xl bg-[#1a6b7f] text-white font-bold px-6 py-3 hover:bg-[#155a6b] transition-colors text-sm"
              >
                Move to {STATUS_LABELS[nextStatus]} →
              </button>
            )}
            {obj.status !== "done" && (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)]">Delete?</span>
                  <button onClick={handleDelete} className="text-xs font-semibold text-red-400 hover:text-red-300">Yes</button>
                  <button onClick={() => setConfirmDelete(false)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">No</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors"
                >
                  Delete card
                </button>
              )
            )}
            </div>
            {confirmNoDisc && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-xs text-amber-700">No team discussion has been run for this card. Move to Implement anyway?</p>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => handleMoveToNext(true)} className="text-xs font-semibold text-amber-700 hover:text-amber-900">Yes</button>
                  <button onClick={() => setConfirmNoDisc(false)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">No</button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

function extractImplementationPrompt(prd: string): string {
  const marker = "## Claude Code Implementation Prompt";
  const idx = prd.indexOf(marker);
  if (idx === -1) return "";
  return prd.slice(idx + marker.length).trim();
}
