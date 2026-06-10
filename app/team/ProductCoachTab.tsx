"use client";

import { useState, useRef, useEffect } from "react";
import { PastConversations } from "./PastConversations";
import { MarkdownText, ThinkingDots } from "./shared";
import { COACH_MODEL, COACH_SYSTEM, getModeInstruction } from "./team-constants";
import { errorMessage, streamChat, upsertCoachConversation } from "./team-data";
import type { CoachMessage, ConversationRow } from "./team-types";

// ── Product Coach Tab ──────────────────────────────────────────────────────────

export function ProductCoachTab({ buildMode }: { buildMode: boolean }) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [coachError, setCoachError] = useState("");
  const lastUserMessageRef = useRef<string>("");
  const conversationIdRef = useRef<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function loadPastConversation(row: ConversationRow) {
    const msgs = row.messages as { history: CoachMessage[] };
    setMessages(msgs.history ?? []);
    conversationIdRef.current = row.id;
    setConversationId(row.id);
    setCoachError("");
  }

  async function sendMessage(text: string, history: CoachMessage[]) {
    setThinking(true);
    setCoachError("");
    let assistantText = "";
    setMessages([...history, { role: "assistant", content: "" }]);

    try {
      await streamChat(
        COACH_MODEL,
        `${COACH_SYSTEM}\n\n${getModeInstruction(buildMode)}`,
        history,
        2048,
        (chunk) => {
          assistantText += chunk;
          setMessages([...history, { role: "assistant", content: assistantText }]);
        }
      );

      // Save to Supabase after successful response
      const allMessages: CoachMessage[] = [...history, { role: "assistant", content: assistantText }];
      const firstUserMsg = allMessages.find((m) => m.role === "user")?.content ?? "Coach session";
      const id = await upsertCoachConversation(conversationIdRef.current, firstUserMsg, allMessages);
      if (id) { conversationIdRef.current = id; setConversationId(id); }

    } catch (err) {
      console.error("Coach error:", err);
      setMessages(history);
      setCoachError(errorMessage(err));
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Past conversations */}
      <PastConversations type="coach" onLoad={loadPastConversation} activeConversationId={conversationId} />

      {/* Intro */}
      {messages.length === 0 && (
        <div className="bg-white border border-[#e8e4de] rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-[#1a6b7f] flex items-center justify-center text-white font-bold text-sm">C</div>
            <div>
              <p className="text-sm font-bold text-[var(--text-primary)]">Product Coach</p>
              <p className="text-xs text-[var(--text-muted)]">Powered by Claude Opus 4</p>
            </div>
          </div>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Ask me anything about product management — strategy, prioritisation, discovery, metrics, stakeholders. I&apos;ll challenge your thinking and help you grow. Try: <em className="text-[var(--text-primary)]">&quot;How should I think about prioritising our roadmap as an early MVP?&quot;</em>
          </p>
        </div>
      )}

      {/* Messages */}
      {messages.length > 0 && (
        <div className="flex flex-col gap-4">
          {messages.map((msg, i) => (
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="bg-[#1a6b7f]/10 border border-[#1a6b7f]/20 rounded-2xl rounded-tr-sm px-5 py-3.5 max-w-xl">
                  <p className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-4">
                <div className="w-9 h-9 rounded-full bg-[#1a6b7f] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">C</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold text-[var(--text-primary)]">Coach</span>
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
          ))}
          <div ref={endRef} />
        </div>
      )}

      {/* Input */}
      <div className="flex flex-col gap-2 sticky bottom-0 bg-[#f8f6f1] pt-2 pb-4">
        {coachError && (
          <div className="flex items-center justify-between gap-4 bg-red-950/40 border border-red-800/40 rounded-xl px-4 py-3">
            <p className="text-sm text-red-400">{coachError}</p>
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
            placeholder="Ask your coach… (Enter to send, Shift+Enter for newline)"
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
  );
}
