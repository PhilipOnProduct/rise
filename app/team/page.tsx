"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { CardDetailPanel } from "./CardDetailPanel";
import { KanbanTab } from "./KanbanTab";
import { PMTab } from "./PMTab";
import { ProductCoachTab } from "./ProductCoachTab";
import { ProductTeamTab } from "./ProductTeamTab";
import { updateObjectiveField } from "./team-data";
import type { Discussion, Objective } from "./team-types";

// ── Page ───────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const [activeTab, setActiveTab] = useState<"kanban" | "team" | "pm" | "coach">("kanban");
  const [pendingObjective, setPendingObjective] = useState<{ id: string; problem: string } | null>(null);
  const [cardContext, setCardContext] = useState<Objective | null>(null);
  const [selectedCard, setSelectedCard] = useState<Objective | null>(null);
  const [buildMode, setBuildMode] = useState<boolean>(true);
  const [kanbanRefreshKey, setKanbanRefreshKey] = useState(0);

  // Pre-select tab from ?tab= query param; load persisted build mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "kanban" || tab === "team" || tab === "pm" || tab === "coach") {
      setActiveTab(tab);
    }
    const saved = localStorage.getItem("rise_team_mode");
    if (saved === "research") setBuildMode(false);
  }, []);

  function toggleMode() {
    const next = !buildMode;
    setBuildMode(next);
    localStorage.setItem("rise_team_mode", next ? "build" : "research");
  }

  function handleDiscussionSaved(objectiveId: string, discussion: Discussion, prd: string | null) {
    // Save discussion to the card
    void (async () => {
      const { data } = await supabase
        .from("objectives")
        .select("discussions, prd")
        .eq("id", objectiveId)
        .single();
      const existing: Discussion[] = (data?.discussions as Discussion[]) ?? [];
      const updated = [...existing, discussion];
      const fields: Record<string, unknown> = { discussions: updated };
      if (prd) fields.prd = prd;
      await updateObjectiveField(objectiveId, fields);
      setKanbanRefreshKey((k) => k + 1);
    })();
  }

  function handleCardUpdate(updated: Objective) {
    if (updated.id === "__deleted__") {
      setSelectedCard(null);
      setKanbanRefreshKey((k) => k + 1);
      return;
    }
    setSelectedCard(updated);
    setKanbanRefreshKey((k) => k + 1);
  }

  const tabs = [
    { id: "kanban" as const, label: "Kanban" },
    { id: "team" as const, label: "Product team" },
    { id: "pm" as const, label: "PM" },
    { id: "coach" as const, label: "Product coach" },
  ];

  return (
    <main className="min-h-screen bg-[#f8f6f1] px-6 py-10 overflow-x-hidden">
      <div className={`${activeTab === "kanban" ? "max-w-5xl" : "max-w-3xl"} mx-auto transition-all`}>

        <div className="mb-8 flex items-start justify-between gap-6 flex-wrap">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight mb-2">Product agents</h1>
            <p className="text-[var(--text-secondary)]">AI-powered product thinking for Rise.</p>
          </div>
          {/* Build / Research mode toggle */}
          <button
            onClick={toggleMode}
            className="flex items-center gap-2.5 bg-white border border-[#e8e4de] rounded-2xl px-4 py-2.5 hover:border-[#d4cfc5] transition-colors shrink-0"
          >
            <span className={`w-2 h-2 rounded-full ${buildMode ? "bg-[#1a6b7f]" : "bg-amber-400"}`} />
            <span className="text-sm font-semibold text-[var(--text-primary)]">{buildMode ? "Build mode" : "Research mode"}</span>
            <span className="text-xs text-[var(--text-muted)]">— tap to switch</span>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-white border border-[#e8e4de] rounded-2xl p-1 w-fit mb-10 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-[#1a6b7f] text-white"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "kanban" && (
          <KanbanTab
            onCardClick={(obj) => setSelectedCard(obj)}
            refreshKey={kanbanRefreshKey}
          />
        )}
        {activeTab === "team" && (
          <ProductTeamTab
            pendingObjective={pendingObjective}
            cardContext={cardContext}
            onObjectiveSaved={() => { setPendingObjective(null); setKanbanRefreshKey((k) => k + 1); }}
            onDiscussionSaved={handleDiscussionSaved}
            buildMode={buildMode}
          />
        )}
        {activeTab === "pm" && <PMTab onSwitchToKanban={() => setActiveTab("kanban")} onObjectiveSaved={() => setKanbanRefreshKey((k) => k + 1)} buildMode={buildMode} />}
        {activeTab === "coach" && <ProductCoachTab buildMode={buildMode} />}

      </div>

      {/* Card detail slide-in panel */}
      {selectedCard && (
        <CardDetailPanel
          obj={selectedCard}
          onClose={() => setSelectedCard(null)}
          onUpdate={handleCardUpdate}
          onDiscussionSaved={handleDiscussionSaved}
          buildMode={buildMode}
        />
      )}
    </main>
  );
}
