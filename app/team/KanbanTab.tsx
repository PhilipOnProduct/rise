"use client";

import { useState, useEffect } from "react";
import { CardTypeBadge, CardTypeSelector } from "./shared";
import { deleteObjective, loadObjectives, saveObjectiveWithDetails, updateObjectiveStatus } from "./team-data";
import type { CardType, Objective, ObjectiveStatus } from "./team-types";

// ── Kanban constants & helpers ─────────────────────────────────────────────────

export const STATUS_STYLES: Record<ObjectiveStatus, string> = {
  backlog:    "bg-[#e8f0f4] text-[#1a6b7f] border border-[#1a6b7f]/20",
  refine:     "bg-[#e8f0fb] text-[#185fa5] border border-[#185fa5]/20",
  implement:  "bg-[#fef3e2] text-[#ba7517] border border-[#ba7517]/20",
  done:       "bg-[#eaf4ee] text-[#2d7a4f] border border-[#2d7a4f]/20",
};

const KANBAN_COLUMNS: Array<{
  status: ObjectiveStatus;
  label: string;
  borderClass: string;
  textClass: string;
}> = [
  { status: "backlog",    label: "Backlog",    borderClass: "border-[#c8c3bb]",  textClass: "text-[var(--text-secondary)]" },
  { status: "refine",     label: "Refine",     borderClass: "border-[#c8c3bb]",  textClass: "text-[var(--text-secondary)]" },
  { status: "implement",  label: "Implement",  borderClass: "border-[#c8c3bb]",  textClass: "text-[var(--text-secondary)]" },
  { status: "done",       label: "Done",       borderClass: "border-[#c8c3bb]",  textClass: "text-[var(--text-secondary)]" },
];

// ── Kanban Card ────────────────────────────────────────────────────────────────

function KanbanCard({
  obj,
  col,
  onClick,
  onDelete,
  onDragStart,
}: {
  obj: Objective;
  col: typeof KANBAN_COLUMNS[number];
  onClick: () => void;
  onDelete: (id: string) => void;
  onDragStart: (id: string, fromStatus: ObjectiveStatus) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDone = obj.status === "done";
  const cleanTitle = obj.title.replace(/\*+/g, "");

  return (
    <div
      draggable={!isDone}
      onDragStart={isDone ? undefined : () => onDragStart(obj.id, obj.status)}
      onClick={onClick}
      className={`bg-white border ${col.borderClass} rounded-2xl p-4 flex flex-col gap-2 cursor-pointer hover:shadow-sm transition-shadow ${!isDone ? "active:cursor-grabbing" : ""}`}
    >
      {/* Type badge + title */}
      <div className="flex items-start gap-2">
        <CardTypeBadge type={obj.card_type} />
        <p className="text-sm font-bold text-[var(--text-primary)] leading-snug line-clamp-2 flex-1" title={cleanTitle}>{cleanTitle}</p>
      </div>
      {obj.description && (
        <p className="text-xs text-[var(--text-muted)] leading-relaxed line-clamp-2 overflow-hidden">{obj.description}</p>
      )}

      {/* Bottom row */}
      <div className="flex items-center justify-between mt-1" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          {obj.prd && <span className="text-xs text-[#1a6b7f]">PRD</span>}
          {obj.discussions.length > 0 && (
            <span className="text-xs text-[var(--text-muted)]">{obj.discussions.length} disc.</span>
          )}
        </div>
        {!isDone && (
          confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)]">Delete?</span>
              <button onClick={() => onDelete(obj.id)} className="text-xs font-semibold text-red-400 hover:text-red-300">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">No</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors"
              title="Delete"
            >
              🗑
            </button>
          )
        )}
      </div>
    </div>
  );
}

// ── Kanban Tab ─────────────────────────────────────────────────────────────────

export function KanbanTab({
  onCardClick,
  refreshKey,
}: {
  onCardClick: (obj: Objective) => void;
  refreshKey: number;
}) {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState<{ id: string; fromStatus: ObjectiveStatus } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ObjectiveStatus | null>(null);
  const [showNewCard, setShowNewCard] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newType, setNewType] = useState<CardType>("objective");
  const [savingNew, setSavingNew] = useState(false);

  useEffect(() => {
    loadObjectives().then((data) => { setObjectives(data); setLoading(false); });
  }, [refreshKey]);

  async function handleDelete(id: string) {
    await deleteObjective(id);
    setObjectives((prev) => prev.filter((o) => o.id !== id));
  }

  function handleDragStart(id: string, fromStatus: ObjectiveStatus) {
    setDragging({ id, fromStatus });
  }

  function handleDragOver(e: React.DragEvent, colStatus: ObjectiveStatus) {
    e.preventDefault();
    setDragOverCol(colStatus);
  }

  function handleDragLeave() {
    setDragOverCol(null);
  }

  async function handleDrop(e: React.DragEvent, toStatus: ObjectiveStatus) {
    e.preventDefault();
    setDragOverCol(null);
    if (!dragging || dragging.fromStatus === toStatus) { setDragging(null); return; }
    const { id } = dragging;
    setDragging(null);
    setObjectives((prev) => prev.map((o) => o.id === id ? { ...o, status: toStatus } : o));
    await updateObjectiveStatus(id, toStatus);
  }

  async function handleCreateCard() {
    if (!newTitle.trim()) return;
    setSavingNew(true);
    const obj = await saveObjectiveWithDetails(newTitle.trim(), newDesc.trim() || null, "backlog", null, newType);
    if (obj) {
      setObjectives((prev) => [obj, ...prev]);
      setNewTitle(""); setNewDesc(""); setNewType("objective"); setShowNewCard(false);
    }
    setSavingNew(false);
  }

  if (loading) return <p className="text-sm text-[var(--text-muted)] py-4">Loading…</p>;

  const newCardForm = showNewCard ? (
    <div className="bg-white border border-[#e8e4de] rounded-2xl p-5 mb-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">New card</span>
        <button onClick={() => setShowNewCard(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm">×</button>
      </div>
      <CardTypeSelector value={newType} onChange={setNewType} />
      <input
        type="text"
        value={newTitle}
        onChange={(e) => setNewTitle(e.target.value)}
        placeholder="Card title…"
        autoFocus
        className="w-full bg-[#f8f6f1] border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder-[#9ca3af] transition-colors text-sm"
      />
      <textarea
        rows={2}
        value={newDesc}
        onChange={(e) => setNewDesc(e.target.value)}
        placeholder="Description (optional)…"
        className="w-full bg-[#f8f6f1] border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder-[#9ca3af] transition-colors text-xs resize-none"
      />
      <button
        onClick={handleCreateCard}
        disabled={!newTitle.trim() || savingNew}
        className="rounded-2xl bg-[#1a6b7f] text-white font-bold px-6 py-3 hover:bg-[#155a6b] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm w-fit"
      >
        {savingNew ? "Creating…" : "Create card →"}
      </button>
    </div>
  ) : (
    <div className="mb-4">
      <button
        onClick={() => setShowNewCard(true)}
        className="text-sm font-semibold text-[#1a6b7f] hover:underline"
      >
        + New card
      </button>
    </div>
  );

  if (objectives.length === 0) {
    return (
      <div>
        {newCardForm}
        <div className="border border-dashed border-[#d4cfc5] rounded-2xl p-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">No cards yet — save objectives from the PM tab or create one above.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
    {newCardForm}
    <div className="grid grid-cols-4 gap-3 pb-4">
      {KANBAN_COLUMNS.map((col) => {
        const cards = objectives.filter((o) => o.status === col.status);
        const isDoneCol = col.status === "done";
        const isOver = dragOverCol === col.status && dragging?.fromStatus !== col.status && !isDoneCol;
        return (
          <div
            key={col.status}
            className="flex flex-col gap-3 min-w-0"
            onDragOver={isDoneCol ? undefined : (e) => handleDragOver(e, col.status)}
            onDragLeave={isDoneCol ? undefined : handleDragLeave}
            onDrop={isDoneCol ? undefined : (e) => handleDrop(e, col.status)}
          >
            <div className="flex items-center justify-between px-1">
              <span className={`text-xs font-bold uppercase tracking-widest ${col.textClass}`}>{col.label}</span>
              <span className="text-xs text-[var(--text-muted)]">{cards.length}</span>
            </div>
            <div
              className={`flex flex-col gap-3 min-h-[80px] rounded-2xl transition-colors ${
                isOver ? "bg-[#1a6b7f]/5 ring-1 ring-[#1a6b7f]/20" : ""
              }`}
            >
              {cards.length === 0 ? (
                <div className={`border ${col.borderClass} rounded-2xl p-4 text-xs text-[var(--text-muted)] text-center`}>
                  Empty
                </div>
              ) : (
                cards.map((obj) => (
                  <KanbanCard
                    key={obj.id}
                    obj={obj}
                    col={col}
                    onClick={() => onCardClick(obj)}
                    onDelete={handleDelete}
                    onDragStart={handleDragStart}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}
