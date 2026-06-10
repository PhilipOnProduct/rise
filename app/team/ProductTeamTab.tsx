"use client";

import { useState, useEffect } from "react";
import { PastConversations } from "./PastConversations";
import { AgentBubble, PrdLine, SectionDivider, ThinkingDots } from "./shared";
import { AGENTS, TEAM_MODEL, getModeInstruction } from "./team-constants";
import {
  errorMessage,
  loadSarahMemory,
  saveObjectiveWithDetails,
  saveSarahMemory,
  saveTeamConversation,
  streamChat,
  updateObjectivePrd,
  updateTeamPrd,
} from "./team-data";
import { buildCardContext, downloadConversationFile, fetchKanbanTitle, fetchPrdSlug } from "./team-download";
import type { AgentId, ConversationRow, Discussion, Objective, Phase, TeamMessages } from "./team-types";

// ── Product Team Tab ───────────────────────────────────────────────────────────

export function ProductTeamTab({
  pendingObjective,
  cardContext,
  onObjectiveSaved,
  onDiscussionSaved,
  buildMode,
}: {
  pendingObjective?: { id: string; problem: string } | null;
  cardContext?: Objective | null;
  onObjectiveSaved?: () => void;
  onDiscussionSaved?: (objectiveId: string, discussion: Discussion, prd: string | null) => void;
  buildMode: boolean;
}) {
  const [problem, setProblem] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [thinking, setThinking] = useState<Partial<Record<AgentId, boolean>>>({});
  const [sarahFrame, setSarahFrame] = useState("");
  const [alexContent, setAlexContent] = useState("");
  const [mayaContent, setMayaContent] = useState("");
  const [lucaContent, setLucaContent] = useState("");
  const [elenaContent, setElenaContent] = useState("");
  const [synthesis, setSynthesis] = useState("");
  const [prd, setPrd] = useState("");
  const [teamError, setTeamError] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [prdSlug, setPrdSlug] = useState("");

  const [sarahMemory, setSarahMemory] = useState("");
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [updatingMemory, setUpdatingMemory] = useState(false);
  const [activeObjectiveId, setActiveObjectiveId] = useState<string | null>(null);
  const [savingToKanban, setSavingToKanban] = useState(false);
  const [kanbanSaved, setKanbanSaved] = useState(false);
  const [scopeAdditions, setScopeAdditions] = useState("");
  const [savingToCard, setSavingToCard] = useState(false);
  const [savedToCard, setSavedToCard] = useState(false);

  useEffect(() => {
    loadSarahMemory().then((mem) => {
      setSarahMemory(mem);
      setMemoryLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!pendingObjective) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets discussion state when a pending objective is injected; pre-existing pattern
    setProblem(pendingObjective.problem);
    setActiveObjectiveId(pendingObjective.id);
    setSarahFrame(""); setAlexContent(""); setMayaContent("");
    setLucaContent(""); setElenaContent(""); setSynthesis(""); setPrd("");
    setPhase("idle"); setTeamError(""); setPrdSlug("");
    setKanbanSaved(false); setSavedToCard(false);
  }, [pendingObjective]);

  const isRunning = phase !== "idle" && phase !== "done";

  function loadPastConversation(row: ConversationRow) {
    const msgs = row.messages as TeamMessages;
    setProblem(msgs.problem ?? row.title);
    setSarahFrame(msgs.framing ?? "");
    setAlexContent(msgs.alex ?? "");
    setMayaContent(msgs.maya ?? "");
    setLucaContent(msgs.luca ?? "");
    setElenaContent(msgs.elena ?? "");
    setSynthesis(msgs.synthesis ?? "");
    setPrd(row.prd ?? "");
    setConversationId(row.id);
    setPhase("done");
    setTeamError("");
    setPrdSlug("");
    setActiveObjectiveId(null);
    setKanbanSaved(false);
    setSavedToCard(false);
  }

  async function runDiscussion() {
    if (!problem.trim() || isRunning) return;

    setSarahFrame(""); setAlexContent(""); setMayaContent("");
    setLucaContent(""); setElenaContent(""); setSynthesis(""); setPrd("");
    setTeamError(""); setConversationId(null); setPrdSlug("");
    setKanbanSaved(false); setSavedToCard(false);

    // Build card context injection if available
    const cardCtx = cardContext ? `\n\nCard context:\n${buildCardContext(cardContext)}` : "";

    try {
      // ── Step 1: Sarah frames (with memory) ───────────────────────────────
      setPhase("framing");
      setThinking({ sarah: true });
      const modeInstruction = getModeInstruction(buildMode);
      const sarahSystemWithMemory = sarahMemory
        ? `${AGENTS.sarah.system}\n\n${modeInstruction}\n\nHere is your memory of past product discussions for Rise:\n${sarahMemory}\n\nUse this to inform your framing — reference relevant past decisions, avoid repeating ground already covered, and build on what the team has already learned.`
        : `${AGENTS.sarah.system}\n\n${modeInstruction}`;
      let frameText = "";
      await streamChat(
        TEAM_MODEL, sarahSystemWithMemory,
        [{ role: "user", content: `Frame this problem for the product team:\n\n${problem}${cardCtx}` }],
        2048, (chunk) => { frameText += chunk; setSarahFrame(frameText); }
      );
      setThinking({});

      // ── Step 2: Specialists in parallel (Alex excluded in Build mode) ──
      const includeAlex = !buildMode;
      setPhase("specialists");
      setThinking({ ...(includeAlex ? { alex: true } : {}), maya: true, luca: true, elena: true });
      const specialistPrompt = `Problem: ${problem}\n\nSarah's framing: ${frameText}\n\nShare your expert perspective.${cardCtx}`;
      let alexText = "", mayaText = "", lucaText = "", elenaText = "";

      const specialistCalls: Promise<void>[] = [
        streamChat(TEAM_MODEL, `${AGENTS.maya.system}\n\n${modeInstruction}`,
          [{ role: "user", content: specialistPrompt }], 2048,
          (chunk) => { mayaText += chunk; setMayaContent(mayaText); }
        ).then(() => setThinking((p) => { const n = { ...p }; delete n.maya; return n; })),

        streamChat(TEAM_MODEL, `${AGENTS.luca.system}\n\n${modeInstruction}`,
          [{ role: "user", content: specialistPrompt }], 2048,
          (chunk) => { lucaText += chunk; setLucaContent(lucaText); }
        ).then(() => setThinking((p) => { const n = { ...p }; delete n.luca; return n; })),

        streamChat(TEAM_MODEL, `${AGENTS.elena.system}\n\n${modeInstruction}`,
          [{ role: "user", content: specialistPrompt }], 2048,
          (chunk) => { elenaText += chunk; setElenaContent(elenaText); }
        ).then(() => setThinking((p) => { const n = { ...p }; delete n.elena; return n; })),
      ];

      if (includeAlex) {
        specialistCalls.push(
          streamChat(TEAM_MODEL, `${AGENTS.alex.system}\n\n${modeInstruction}`,
            [{ role: "user", content: specialistPrompt }], 2048,
            (chunk) => { alexText += chunk; setAlexContent(alexText); }
          ).then(() => setThinking((p) => { const n = { ...p }; delete n.alex; return n; }))
        );
      }

      await Promise.all(specialistCalls);

      // ── Step 3: Sarah synthesizes ─────────────────────────────────────────
      setPhase("synthesis");
      setThinking({ sarah: true });
      let synthesisText = "";
      await streamChat(
        TEAM_MODEL, sarahSystemWithMemory,
        [{
          role: "user",
          content: `Problem: ${problem}\n\nYour framing:\n${frameText}\n\nTeam input:\n${includeAlex ? `Alex (Research): ${alexText}\n` : ""}Maya (Design): ${mayaText}\nLuca (Tech): ${lucaText}\nElena (Travel Expert): ${elenaText}\n\nSynthesize the key insights and give a clear product recommendation.`,
        }],
        4096, (chunk) => { synthesisText += chunk; setSynthesis(synthesisText); }
      );
      setThinking({});

      // ── Save to Supabase ──────────────────────────────────────────────────
      const id = await saveTeamConversation(problem, {
        problem, framing: frameText, alex: alexText, maya: mayaText,
        luca: lucaText, elena: elenaText, synthesis: synthesisText,
      });
      setConversationId(id);

      // ── Update Sarah's memory (fire-and-forget) ───────────────────────────
      void (async () => {
        setUpdatingMemory(true);
        try {
          let newMemory = "";
          await streamChat(
            TEAM_MODEL, AGENTS.sarah.system,
            [{
              role: "user",
              content:
                `Based on this discussion, update your memory document.\n\n` +
                `Your current memory is:\n${sarahMemory || "(empty — this is your first discussion)"}\n\n` +
                `The discussion was about: ${problem}\n\n` +
                `Key decisions and insights:\n${synthesisText}\n\n` +
                `Update the memory to include this discussion — keep it concise, max 500 words, running summary format.`,
            }],
            2000,
            (chunk) => { newMemory += chunk; }
          );
          if (newMemory.trim()) {
            await saveSarahMemory(newMemory.trim());
            setSarahMemory(newMemory.trim());
          }
        } catch (memErr) {
          console.error("[memory] update error", memErr);
        }
        setUpdatingMemory(false);
      })();

      // ── Step 4: Auto-generate PRD ─────────────────────────────────────────
      setPhase("prd");
      setThinking({ sarah: true });
      setScopeAdditions("");

      let prdText = "";
      try {
        await streamChat(
          TEAM_MODEL, sarahSystemWithMemory,
          [{
            role: "user",
            content:
              `Based on this product discussion, write a structured PRD.\n\n` +
              `Problem: ${problem}\nFraming: ${frameText}\n` +
              `${includeAlex ? `Research (Alex): ${alexText}\n` : ""}Design (Maya): ${mayaText}\nTech (Luca): ${lucaText}\nTravel Expert (Elena): ${elenaText}\n` +
              `Synthesis: ${synthesisText}\n\n` +
              `Use these sections exactly:\n` +
              `## Overview\n## Problem Statement\n## User Need\n## Proposed Solution\n` +
              `## User Stories\n## Success Metrics\n## Technical Considerations (strategic only — no implementation details)\n## Risks & Open Questions\n## Claude Code Implementation Prompt\n\n` +
              `For the Claude Code Implementation Prompt section: write a prompt the way a senior PM would brief a capable engineer verbally. Describe what to build and why it matters in plain language. Mention any hard constraints that affect how it must work. Do not describe how to implement it — no function names, no data structures, no component names, no step-by-step instructions. Write it the way you would explain the feature to someone who will figure out the implementation themselves. Do not include manual testing instructions, QA steps, or scenario-based testing requirements — Claude Code cannot run these. Quality validation is the founder's responsibility after the build is complete.`,
          }],
          8000, (chunk) => { prdText += chunk; setPrd(prdText); }
        );
        if (id) await updateTeamPrd(id, prdText);
        const slug = await fetchPrdSlug(problem, prdText);
        setPrdSlug(slug);

        // Scope delta — non-blocking
        try {
          let additions = "";
          await streamChat(
            TEAM_MODEL,
            "You are a concise scope analyst. Respond in plain text only — no markdown, no bullet symbols, no headers.",
            [{
              role: "user",
              content:
                `Original problem statement: "${problem}"\n\n` +
                `PRD proposed solution:\n${prdText}\n\n` +
                `List only the items in the proposed solution that go beyond the original problem statement — scope that the team added during discussion. ` +
                `If nothing meaningful was added, respond with exactly: "No scope additions."\n` +
                `Be specific and brief. Three items maximum, one sentence each.`,
            }],
            300,
            (chunk) => { additions += chunk; }
          );
          setScopeAdditions(additions.trim());
        } catch { /* non-critical */ }

        // Save PRD back to the active Kanban card if one was pre-loaded
        if (activeObjectiveId) {
          await updateObjectivePrd(activeObjectiveId, prdText);
          setKanbanSaved(true);
          onObjectiveSaved?.();
        }
      } catch (prdErr) {
        console.error("PRD error:", prdErr);
        setTeamError(errorMessage(prdErr));
      }
      setThinking({});
      setPhase("done");

    } catch (err) {
      console.error("Discussion error:", err);
      setThinking({});
      setPhase("idle");
      setTeamError(errorMessage(err));
    }
  }

  async function regeneratePrd() {
    if (phase !== "done") return;
    const modeInstruction = getModeInstruction(buildMode);
    const sarahSystem = sarahMemory
      ? `${AGENTS.sarah.system}\n\n${modeInstruction}\n\nHere is your memory of past product discussions for Rise:\n${sarahMemory}\n\nUse this to inform your framing — reference relevant past decisions, avoid repeating ground already covered, and build on what the team has already learned.`
      : `${AGENTS.sarah.system}\n\n${modeInstruction}`;
    setPhase("prd");
    setThinking({ sarah: true });
    setTeamError("");
    setScopeAdditions("");
    let prdText = "";
    try {
      await streamChat(
        TEAM_MODEL, sarahSystem,
        [{
          role: "user",
          content:
            `Based on this product discussion, write a structured PRD.\n\n` +
            `Problem: ${problem}\nFraming: ${sarahFrame}\n` +
            `Research (Alex): ${alexContent}\nDesign (Maya): ${mayaContent}\nTech (Luca): ${lucaContent}\nTravel Expert (Elena): ${elenaContent}\n` +
            `Synthesis: ${synthesis}\n\n` +
            `Use these sections exactly:\n` +
            `## Overview\n## Problem Statement\n## User Need\n## Proposed Solution\n` +
            `## User Stories\n## Success Metrics\n## Technical Considerations (strategic only — no implementation details)\n## Risks & Open Questions\n## Claude Code Implementation Prompt\n\n` +
            `For the Claude Code Implementation Prompt section: write a prompt the way a senior PM would brief a capable engineer verbally. Describe what to build and why it matters in plain language. Mention any hard constraints that affect how it must work. Do not describe how to implement it — no function names, no data structures, no component names, no step-by-step instructions. Write it the way you would explain the feature to someone who will figure out the implementation themselves. Do not include manual testing instructions, QA steps, or scenario-based testing requirements — Claude Code cannot run these. Quality validation is the founder's responsibility after the build is complete.`,
        }],
        8000, (chunk) => { prdText += chunk; setPrd(prdText); }
      );
      if (conversationId) await updateTeamPrd(conversationId, prdText);
      const slug = await fetchPrdSlug(problem, prdText);
      setPrdSlug(slug);
      if (activeObjectiveId) {
        await updateObjectivePrd(activeObjectiveId, prdText);
        setKanbanSaved(true);
        onObjectiveSaved?.();
      }
    } catch (err) {
      console.error("PRD error:", err);
      setTeamError(errorMessage(err));
    }
    setThinking({});
    setPhase("done");
  }

  async function handleSaveToKanban() {
    setSavingToKanban(true);
    const title = await fetchKanbanTitle(problem, prd);
    const obj = await saveObjectiveWithDetails(title, null, "refine", prd);
    if (obj) {
      setActiveObjectiveId(obj.id);
      setKanbanSaved(true);
      onObjectiveSaved?.();
    }
    setSavingToKanban(false);
  }

  async function handleSaveToCard() {
    if (!cardContext || !onDiscussionSaved) return;
    setSavingToCard(true);

    // Generate a 3-5 sentence summary from Sarah
    let summaryText = "";
    try {
      await streamChat(
        TEAM_MODEL,
        "You write concise discussion summaries. Reply with ONLY the summary — 3-5 sentences.",
        [{
          role: "user",
          content:
            `Summarize this product team discussion in 3-5 sentences.\n\n` +
            `Problem: ${problem}\nFraming: ${sarahFrame}\nSynthesis: ${synthesis}\n` +
            `PRD available: ${prd ? "yes" : "no"}`,
        }],
        200,
        (chunk) => { summaryText += chunk; }
      );
    } catch {
      summaryText = `Discussion about: ${problem.slice(0, 200)}`;
    }

    const discussion: Discussion = {
      date: new Date().toISOString().slice(0, 10),
      summary: summaryText.trim(),
      transcript: {
        problem,
        framing: sarahFrame,
        alex: alexContent,
        maya: mayaContent,
        luca: lucaContent,
        elena: elenaContent,
        synthesis,
      },
      prd: prd || null,
    };

    onDiscussionSaved(cardContext.id, discussion, prd || null);
    setSavingToCard(false);
    setSavedToCard(true);
  }


  return (
    <div className="flex flex-col gap-8">

      {/* Past conversations */}
      <PastConversations type="team" onLoad={loadPastConversation} activeConversationId={conversationId} />

      {/* Team roster + memory status */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-3 flex-wrap">
          {(Object.entries(AGENTS) as [AgentId, typeof AGENTS[AgentId]][]).filter(([id]) => id !== "alex" || !buildMode).map(([id, a]) => (
            <div key={id} className="flex items-center gap-2 bg-white border border-[#e8e4de] rounded-xl px-3 py-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${a.badge}`}
                style={a.bgColor ? { backgroundColor: a.bgColor } : undefined}
              >
                {a.initial}
              </div>
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)] leading-none">{a.name}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{a.role}</p>
              </div>
            </div>
          ))}
        </div>
        {memoryLoading && (
          <p className="text-xs text-[var(--text-muted)] italic">Sarah is remembering…</p>
        )}
        {updatingMemory && (
          <p className="text-xs text-[var(--text-muted)] italic">Updating Sarah&apos;s memory…</p>
        )}
      </div>

      {/* Card context banner */}
      {cardContext && (
        <div className="bg-[#e8f4f6] border border-[#1a6b7f]/20 rounded-xl px-4 py-3">
          <p className="text-xs font-bold text-[#1a6b7f] uppercase tracking-widest mb-1">Discussing card</p>
          <p className="text-sm text-[var(--text-primary)] font-semibold">{cardContext.title.replace(/\*+/g, "")}</p>
          {cardContext.description && <p className="text-xs text-[var(--text-secondary)] mt-1">{cardContext.description}</p>}
        </div>
      )}

      {/* Input */}
      <div>
        <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">
          Describe the problem
        </label>
        <textarea
          rows={4}
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          placeholder="e.g. Users drop off at step 3 of the onboarding flow. We don't know why."
          disabled={isRunning}
          className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-5 py-4 text-[var(--text-primary)] placeholder-[#9ca3af] transition-colors text-sm resize-none disabled:opacity-50"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={runDiscussion}
            disabled={!problem.trim() || isRunning}
            className="rounded-2xl bg-[#1a6b7f] text-white font-bold px-8 py-4 hover:bg-[#155a6b] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm"
          >
            {isRunning ? "Discussing…" : "Start discussion →"}
          </button>
          {teamError && !isRunning && (
            <button
              onClick={runDiscussion}
              className="rounded-2xl border border-[#333] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[#555] font-semibold px-6 py-4 transition-colors text-sm"
            >
              Retry →
            </button>
          )}
        </div>
        {teamError && !isRunning && (
          <p className="mt-2 text-sm text-red-400">{teamError}</p>
        )}
      </div>

      {/* Discussion output */}
      {(sarahFrame || thinking.sarah) && (
        <div className="flex flex-col gap-6">

          <SectionDivider label="Problem framing" />
          <AgentBubble agentId="sarah" content={sarahFrame} thinking={!!thinking.sarah && phase === "framing"} roleOverride="Framing" />

          {(alexContent || mayaContent || lucaContent || elenaContent || phase === "specialists") && (
            <>
              <SectionDivider label="Team response" />
              {(alexContent || thinking.alex) && <AgentBubble agentId="alex" content={alexContent} thinking={!!thinking.alex} />}
              <AgentBubble agentId="maya" content={mayaContent} thinking={!!thinking.maya} />
              <AgentBubble agentId="luca" content={lucaContent} thinking={!!thinking.luca} />
              <AgentBubble agentId="elena" content={elenaContent} thinking={!!thinking.elena} />
            </>
          )}

          {(synthesis || (phase === "synthesis" && thinking.sarah)) && (
            <>
              <SectionDivider label="Synthesis" />
              <AgentBubble agentId="sarah" content={synthesis} thinking={!!thinking.sarah && phase === "synthesis"} roleOverride="Synthesis" />
            </>
          )}

          {phase === "done" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => downloadConversationFile(problem, AGENTS, buildMode, sarahMemory, sarahFrame, alexContent, mayaContent, lucaContent, elenaContent, synthesis, prd)}
                  className="rounded-2xl border border-[#d4cfc5] text-[var(--text-primary)] hover:text-[var(--text-primary)] hover:border-[#b8b3a9] font-semibold px-6 py-3 transition-colors text-sm"
                >
                  Download conversation ↓
                </button>
                {prd && (
                  <button
                    onClick={regeneratePrd}
                    className="rounded-2xl border border-[#d4cfc5] text-[var(--text-primary)] hover:text-[var(--text-primary)] hover:border-[#b8b3a9] font-semibold px-6 py-3 transition-colors text-sm"
                  >
                    Regenerate PRD →
                  </button>
                )}
                {prd && !kanbanSaved && !cardContext && (
                  <button
                    onClick={handleSaveToKanban}
                    disabled={savingToKanban}
                    className="rounded-2xl border border-[#d4cfc5] text-[var(--text-primary)] hover:text-[var(--text-primary)] hover:border-[#b8b3a9] font-semibold px-6 py-3 transition-colors text-sm disabled:opacity-40"
                  >
                    {savingToKanban ? "Saving…" : "Save to Kanban →"}
                  </button>
                )}
                {cardContext && !savedToCard && (
                  <button
                    onClick={handleSaveToCard}
                    disabled={savingToCard}
                    className="rounded-2xl bg-[#1a6b7f] text-white font-bold px-6 py-3 hover:bg-[#155a6b] transition-colors text-sm disabled:opacity-40"
                  >
                    {savingToCard ? "Saving…" : "Save to card →"}
                  </button>
                )}
              </div>
              {scopeAdditions && scopeAdditions !== "No scope additions." && !kanbanSaved && (
                <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl px-4 py-3">
                  <p className="text-xs font-bold text-amber-500/60 uppercase tracking-widest mb-1.5">Team additions</p>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">{scopeAdditions}</p>
                </div>
              )}
              {kanbanSaved && (
                <p className="text-xs text-[#1a6b7f]">{activeObjectiveId ? "PRD saved to Kanban card" : "Saved to Kanban"}</p>
              )}
              {savedToCard && (
                <p className="text-xs text-[#1a6b7f]">Discussion saved to card</p>
              )}
            </div>
          )}

          {(prd || (phase === "prd" && thinking.sarah)) && (
            <>
              <SectionDivider label="Product requirements document" />
              <div className="flex gap-4">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${AGENTS.sarah.badge}`}>
                  {AGENTS.sarah.initial}
                </div>
                <div className="flex-1 bg-white border border-[#e8e4de] rounded-2xl p-6">
                  {phase === "prd" && thinking.sarah && !prd && (
                    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] italic">
                      <ThinkingDots /> Writing PRD…
                    </div>
                  )}
                  {prd && (
                    <div className="flex flex-col gap-1">
                      {(() => {
                        const lines = prd.split("\n");
                        const blocks: ReturnType<typeof PrdLine>[] = [];
                        let i = 0;
                        while (i < lines.length) {
                          if (lines[i].startsWith("```")) {
                            const codeLines: string[] = [];
                            i++;
                            while (i < lines.length && !lines[i].startsWith("```")) {
                              codeLines.push(lines[i]);
                              i++;
                            }
                            i++; // skip closing ```
                            blocks.push(
                              <pre key={i} className="mt-2 mb-2 bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl p-4 text-xs text-gray-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
                                {codeLines.join("\n")}
                              </pre>
                            );
                          } else {
                            blocks.push(<PrdLine key={i} line={lines[i]} i={i} />);
                            i++;
                          }
                        }
                        return blocks;
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
