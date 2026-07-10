"use client";

import { memo } from "react";
import { AGENTS, CARD_TYPE_STYLES } from "./team-constants";
import type { AgentId, CardType } from "./team-types";

// ── Markdown renderer ─────────────────────────────────────────────────────────
// Lightweight inline markdown → React for agent/coach/PM chat bubbles.
// Memoised: team discussions re-render the whole tab on every stream chunk,
// and without memo every mounted (non-streaming) bubble re-parses its full
// markdown each time.

export const MarkdownText = memo(function MarkdownText({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  function inlineBold(line: string, key: string): React.ReactNode {
    const parts = line.split(/\*\*(.+?)\*\*/g);
    if (parts.length === 1) return line;
    return (
      <span key={key}>
        {parts.map((part, j) =>
          j % 2 === 1 ? <strong key={j}>{part}</strong> : part
        )}
      </span>
    );
  }

  let i = 0;
  for (const line of lines) {
    const k = String(i++);
    if (line.match(/^---+\s*$/)) {
      elements.push(<hr key={k} className="border-t border-[#d4cfc5] my-3" />);
    } else if (line.startsWith("### ")) {
      elements.push(<p key={k} className="font-semibold text-[var(--text-primary)] text-sm mt-3 mb-1">{inlineBold(line.slice(4), k)}</p>);
    } else if (line.startsWith("## ")) {
      elements.push(<p key={k} className="font-bold text-[var(--text-primary)] text-sm mt-4 mb-1">{inlineBold(line.slice(3), k)}</p>);
    } else if (line.startsWith("# ")) {
      elements.push(<p key={k} className="font-bold text-[var(--text-primary)] text-base mt-4 mb-1">{inlineBold(line.slice(2), k)}</p>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(<p key={k} className="ml-4 before:content-['•'] before:mr-2 before:text-[var(--text-muted)]">{inlineBold(line.slice(2), k)}</p>);
    } else if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+\.)\s(.*)$/);
      if (match) {
        elements.push(<p key={k} className="ml-4"><span className="text-[var(--text-muted)] mr-2">{match[1]}</span>{inlineBold(match[2], k)}</p>);
      } else {
        elements.push(<p key={k}>{inlineBold(line, k)}</p>);
      }
    } else if (line.trim() === "") {
      elements.push(<br key={k} />);
    } else {
      elements.push(<p key={k}>{inlineBold(line, k)}</p>);
    }
  }

  return <div className={className ?? "text-sm text-[var(--text-primary)] leading-relaxed"}>{elements}</div>;
});

// ── Shared sub-components ──────────────────────────────────────────────────────

export function ThinkingDots() {
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-[#1a6b7f] animate-pulse"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

export function CardTypeBadge({ type }: { type: CardType }) {
  const style = CARD_TYPE_STYLES[type];
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${style.className}`}>
      {style.label}
    </span>
  );
}

export function CardTypeSelector({ value, onChange }: { value: CardType; onChange: (v: CardType) => void }) {
  const types: CardType[] = ["objective", "improvement", "bug"];
  return (
    <div className="flex gap-2">
      {types.map((t) => {
        const style = CARD_TYPE_STYLES[t];
        const isActive = value === t;
        return (
          <button
            key={t}
            onClick={() => onChange(t)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              isActive
                ? `${style.className} border-current`
                : "bg-white text-[var(--text-muted)] border-[#d4cfc5] hover:border-[#b8b3a9]"
            }`}
          >
            {style.label}
          </button>
        );
      })}
    </div>
  );
}

export function AgentBubble({
  agentId,
  content,
  thinking,
  roleOverride,
}: {
  agentId: AgentId;
  content: string;
  thinking: boolean;
  roleOverride?: string;
}) {
  const agent = AGENTS[agentId];
  if (!content && !thinking) return null;

  return (
    <div className="flex gap-4">
      <div
        className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${agent.badge}`}
        style={agent.bgColor ? { backgroundColor: agent.bgColor } : undefined}
      >
        {agent.initial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-bold text-[var(--text-primary)]">{agent.name}</span>
          <span className="text-xs text-[var(--text-muted)] bg-[#f0ede8] px-2 py-0.5 rounded-full">
            {roleOverride ?? agent.role}
          </span>
          {thinking && <ThinkingDots />}
        </div>
        {content && (
          <MarkdownText text={content} />
        )}
        {!content && thinking && (
          <div className="text-sm text-[var(--text-muted)] italic">Thinking…</div>
        )}
      </div>
    </div>
  );
}

export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-px bg-[#d4cfc5]" />
      <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-[#d4cfc5]" />
    </div>
  );
}

export function PrdLine({ line, i }: { line: string; i: number }) {
  if (line.startsWith("## ")) {
    return (
      <h3 key={i} className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mt-6 mb-2 first:mt-0">
        {line.slice(3)}
      </h3>
    );
  }
  if (line.trim() === "") return <div key={i} className="h-1" />;
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p key={i} className="text-sm text-[var(--text-primary)] leading-relaxed">
      {parts.map((part, j) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={j} className="text-[var(--text-primary)] font-semibold">{part.slice(2, -2)}</strong>
          : part
      )}
    </p>
  );
}
