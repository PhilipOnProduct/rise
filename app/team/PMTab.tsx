"use client";

import { useState, useRef, useEffect } from "react";
import { STATUS_STYLES } from "./KanbanTab";
import { PastConversations } from "./PastConversations";
import { CardTypeBadge, MarkdownText, ThinkingDots } from "./shared";
import { PM_MODEL, PM_SYSTEM, STATUS_LABELS, getModeInstruction } from "./team-constants";
import { errorMessage, loadObjectives, saveObjectiveWithDetails, streamChat, upsertPMConversation } from "./team-data";
import type { CoachMessage, ConversationRow, Objective } from "./team-types";

// ── PM 1-on-1 Tab ─────────────────────────────────────────────────────────────

// Detect if Sarah's last message suggests saving an objective
function detectObjectiveAgreed(content: string): boolean {
  const lower = content.toLowerCase();
  const patterns = [
    "shall we save", "want me to add", "add that to the kanban", "save that as an objective",
    "add it to the board", "shall we add", "want to save that", "lock that in",
    "add this to the kanban", "save this as", "shall i add", "want to add that",
  ];
  return patterns.some((p) => lower.includes(p));
}

export function PMTab({ onSwitchToKanban, onObjectiveSaved, buildMode }: { onSwitchToKanban: () => void; onObjectiveSaved: () => void; buildMode: boolean }) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pmError, setPmError] = useState("");
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [savingObj, setSavingObj] = useState(false);
  const [savedObj, setSavedObj] = useState(false);
  const [riseContext, setRiseContext] = useState("");
  const conversationIdRef = useRef<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const lastUserMessageRef = useRef<string>("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadObjectives().then(setObjectives);
    fetch("/api/rise-context")
      .then((r) => r.json())
      .then((d) => { if (d.content) setRiseContext(d.content); })
      .catch(() => { /* fall back to base system prompt silently */ });
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string, history: CoachMessage[]) {
    setThinking(true);
    setPmError("");
    let assistantText = "";
    setMessages([...history, { role: "assistant", content: "" }]);

    const pmSystem = riseContext
      ? `${PM_SYSTEM}\n\n${getModeInstruction(buildMode)}\n\nFull Rise product context (CLAUDE.md):\n${riseContext}`
      : `${PM_SYSTEM}\n\n${getModeInstruction(buildMode)}`;

    try {
      await streamChat(
        PM_MODEL,
        pmSystem,
        history,
        1024,
        (chunk) => {
          assistantText += chunk;
          setMessages([...history, { role: "assistant", content: assistantText }]);
        }
      );

      const allMessages: CoachMessage[] = [...history, { role: "assistant", content: assistantText }];
      const firstUserMsg = allMessages.find((m) => m.role === "user")?.content ?? "PM session";
      const id = await upsertPMConversation(conversationIdRef.current, firstUserMsg, allMessages);
      if (id) { conversationIdRef.current = id; setConversationId(id); }

    } catch (err) {
      console.error("PM error:", err);
      setMessages(history);
      setPmError(errorMessage(err));
    }
    setThinking(false);
  }

  async function send() {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    lastUserMessageRef.current = text;
    const history: CoachMessage[] = [...messages, { role: "user", content: text }];
    setMessages(history);
    await sendMessage(text, history);
  }

  async function retry() {
    if (thinking || !lastUserMessageRef.current) return;
    const history = messages.filter((m) => m.role === "user" || m.content !== "");
    const lastUser = history.findLastIndex((m) => m.role === "user");
    const historyUpToUser = history.slice(0, lastUser + 1);
    await sendMessage(lastUserMessageRef.current, historyUpToUser);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  async function handleAddToKanban() {
    setSavingObj(true);
    setSavedObj(false);

    const convoSlice = messages.slice(-10).map((m) => `${m.role === "user" ? "Philip" : "Sarah"}: ${m.content}`).join("\n\n");

    // Extract title and description from the conversation
    let title = "";
    let description: string | null = null;
    try {
      let extracted = "";
      await streamChat(
        PM_MODEL,
        "You extract objective titles. Reply with ONLY the title — max 8 words, no quotes, no punctuation at end.",
        [{
          role: "user",
          content: `Extract the agreed objective from this PM conversation as a concise kanban card title (max 8 words).\n\n${convoSlice}`,
        }],
        30,
        (chunk) => { extracted += chunk; }
      );
      title = extracted.trim().replace(/^["']|["']$/g, "").replace(/\.$/g, "");
    } catch {
      title = "New objective";
    }

    try {
      let desc = "";
      await streamChat(
        PM_MODEL,
        "You extract concise one-sentence descriptions. Reply with ONLY the sentence — no extra text.",
        [{
          role: "user",
          content: `Write a one-sentence description for the agreed objective from this conversation.\n\n${convoSlice}`,
        }],
        80,
        (chunk) => { desc += chunk; }
      );
      const clean = desc.trim().replace(/^["']|["']$/g, "").replace(/\.+$/, "") + ".";
      if (clean.length > 5) description = clean;
    } catch { /* non-fatal */ }

    // Generate PM summary
    let pmSummary: string | null = null;
    try {
      let summary = "";
      await streamChat(
        PM_MODEL,
        "You write concise conversation summaries. Reply with ONLY the summary — 3-5 sentences.",
        [{
          role: "user",
          content: `Summarize this PM conversation in 3-5 sentences. Focus on the key decisions and reasoning.\n\n${convoSlice}`,
        }],
        200,
        (chunk) => { summary += chunk; }
      );
      if (summary.trim().length > 10) pmSummary = summary.trim();
    } catch { /* non-fatal */ }

    const obj = await saveObjectiveWithDetails(title, description, "backlog", null, "objective", pmSummary);
    if (obj) {
      loadObjectives().then(setObjectives);
      setSavedObj(true);
      onObjectiveSaved();
    }
    setSavingObj(false);
  }

  function loadPastConversation(row: ConversationRow) {
    const msgs = row.messages as { history: CoachMessage[] };
    setMessages(msgs.history ?? []);
    conversationIdRef.current = row.id;
    setConversationId(row.id);
    setPmError("");
  }

  return (
    <div className="flex flex-col gap-8">

      {/* Past conversations */}
      <PastConversations type="pm" onLoad={loadPastConversation} activeConversationId={conversationId} />

      {/* Chat */}
      <div className="flex flex-col gap-4">

        {/* Intro */}
        {messages.length === 0 && (
          <div className="bg-white border border-[#e8e4de] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-primary)] font-bold text-sm flex-shrink-0" style={{ background: "#5a4fcf" }}>
                SM
              </div>
              <div>
                <p className="text-sm font-bold text-[var(--text-primary)]">Sarah · PM</p>
                <p className="text-xs text-[var(--text-muted)]">1-on-1 with Philip</p>
              </div>
            </div>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Hey Philip — what's on your mind? We can work through a problem, align on priorities, or agree on what to focus on next.
            </p>
          </div>
        )}

        {/* Messages */}
        {messages.length > 0 && (
          <div className="flex flex-col gap-4">
            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="bg-[#1a6b7f]/10 border border-[#1a6b7f]/20 rounded-2xl rounded-tr-sm px-5 py-3.5 max-w-xl">
                    <p className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ) : (
                <div key={i} className="flex gap-4">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-primary)] font-bold text-xs flex-shrink-0" style={{ background: "#5a4fcf" }}>
                    SM
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-bold text-[var(--text-primary)]">Sarah</span>
                      <span className="text-xs text-[var(--text-muted)] bg-[#f0ede8] px-2 py-0.5 rounded-full">PM</span>
                      {thinking && i === messages.length - 1 && !msg.content && <ThinkingDots />}
                    </div>
                    {msg.content ? (
                      <MarkdownText text={msg.content} />
                    ) : (
                      <div className="text-sm text-[var(--text-muted)] italic">Thinking…</div>
                    )}
                  </div>
                </div>
              )
            )}
            <div ref={endRef} />
          </div>
        )}

        {/* Input */}
        <div className="flex flex-col gap-2 sticky bottom-0 bg-[#f8f6f1] pt-2 pb-4">
          {pmError && (
            <div className="flex items-center justify-between gap-4 bg-red-950/40 border border-red-800/40 rounded-xl px-4 py-3">
              <p className="text-sm text-red-400">{pmError}</p>
              <button
                onClick={retry}
                disabled={thinking}
                className="text-sm font-semibold text-red-300 hover:text-[var(--text-primary)] transition-colors flex-shrink-0 disabled:opacity-50"
              >
                Retry →
              </button>
            </div>
          )}
          <div className="flex gap-3 items-end">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Sarah… (Enter to send, Shift+Enter for newline)"
              disabled={thinking}
              className="flex-1 bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-5 py-4 text-[var(--text-primary)] placeholder-[#9ca3af] transition-colors text-sm resize-none disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={!input.trim() || thinking}
              className="rounded-2xl bg-[#1a6b7f] text-white font-bold px-6 py-4 hover:bg-[#155a6b] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm flex-shrink-0"
            >
              {thinking ? "…" : "Send →"}
            </button>
          </div>
        </div>
      </div>

      {/* Objectives */}
      <div className="border-t border-[#d4cfc5] pt-8 flex flex-col gap-5">

        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-[var(--text-primary)] mb-1">Agreed objectives</h2>
            <p className="text-xs text-[var(--text-muted)]">Objectives saved to the Kanban board as backlog cards.</p>
          </div>
          <button
            onClick={onSwitchToKanban}
            className="text-sm text-[#1a6b7f] hover:opacity-75 transition-opacity whitespace-nowrap shrink-0"
          >
            View Kanban →
          </button>
        </div>

        {/* Add to Kanban button — shown when Sarah suggests saving an objective */}
        {messages.length >= 2 && !thinking && !savedObj && (() => {
          const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
          return lastAssistant && detectObjectiveAgreed(lastAssistant.content);
        })() && (
          <div className="bg-[#e8f4f6] border border-[#1a6b7f]/20 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--text-primary)]">Sarah suggested saving an objective from this conversation.</p>
            <button
              onClick={handleAddToKanban}
              disabled={savingObj}
              className="rounded-2xl bg-[#1a6b7f] text-white font-bold px-5 py-3 hover:bg-[#155a6b] transition-colors disabled:opacity-40 text-sm flex-shrink-0 whitespace-nowrap"
            >
              {savingObj ? "Saving…" : "Add to Kanban as Objective →"}
            </button>
          </div>
        )}
        {savedObj && (
          <p className="text-xs text-[#1a6b7f]">Objective added to Kanban board</p>
        )}

        {/* List */}
        {objectives.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No objectives saved yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {objectives.map((obj) => (
              <div key={obj.id} className="bg-white border border-[#e8e4de] rounded-2xl px-5 py-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <CardTypeBadge type={obj.card_type} />
                    <p className="text-sm text-[var(--text-primary)] leading-relaxed">{obj.title}</p>
                  </div>
                  {obj.description && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">{obj.description}</p>
                  )}
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {new Date(obj.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <span className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full capitalize ${STATUS_STYLES[obj.status]}`}>
                  {STATUS_LABELS[obj.status]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
