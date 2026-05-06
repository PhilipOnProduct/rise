"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────────

type AgentId = "sarah" | "alex" | "maya" | "luca" | "elena";
type Phase = "idle" | "framing" | "specialists" | "synthesis" | "done" | "prd";
type CoachMessage = { role: "user" | "assistant"; content: string };
type TeamMessages = {
  problem: string;
  framing: string;
  alex: string;
  maya: string;
  luca: string;
  elena: string;
  synthesis: string;
};

type ConversationRow = {
  id: string;
  type: "team" | "coach" | "pm";
  title: string;
  messages: TeamMessages | { history: CoachMessage[] };
  prd: string | null;
  created_at: string;
};

type ObjectiveStatus = "backlog" | "refine" | "implement" | "done";
type CardType = "objective" | "improvement" | "bug";
type Discussion = {
  date: string;
  summary: string;
  transcript: TeamMessages;
  prd: string | null;
};

type Objective = {
  id: string;
  title: string;
  description: string | null;
  status: ObjectiveStatus;
  prd: string | null;
  card_type: CardType;
  pm_summary: string | null;
  claude_code_result: string | null;
  discussions: Discussion[];
  created_at: string;
};

type PrdFeedback = {
  id: string;
  conversation_id: string;
  feedback: string;
  created_at: string;
};


// ── Constants ──────────────────────────────────────────────────────────────────

const RISE_CONTEXT =
  "Rise is an AI-powered travel assistant app. Stack: Next.js 16, TypeScript, Tailwind CSS, Supabase (Postgres), Anthropic API, Vercel. " +
  "Features: 5-step onboarding wizard (destination → dates → hotel → activities → account), AI restaurant recommendations (streaming), " +
  "airport-to-hotel transport advice (streaming), local guides with tip submission, views, ratings, reputation/points and leaderboard, " +
  "admin dashboard with AI logs. Business model: commission on bookings. Stage: early MVP, no paying users yet.";

const TEAM_MODEL = "claude-sonnet-4-6";
const COACH_MODEL = "claude-opus-4-6";
const PM_MODEL = "claude-sonnet-4-6";

const PM_SYSTEM =
  "You are Sarah, the Product Manager for Rise, a travel assistant app. " +
  "You are having a 1-on-1 conversation with Philip, the founder. " +
  "Your role is to help him clarify thinking, discuss ideas and issues, and agree on clear objectives to work on. " +
  "When you and Philip agree on an objective, summarize it clearly in one sentence and ask if he'd like to add it to the kanban board. Use a phrase like 'Shall we save that as an objective?' or 'Want me to add that to the kanban?' to signal agreement. " +
  "Keep responses concise and conversational — this is a 1-on-1, not a formal meeting. " +
  "Be direct, ask good questions, and push back when needed.";

const AGENTS: Record<
  AgentId,
  { name: string; role: string; initial: string; badge: string; bgColor?: string; system: string }
> = {
  sarah: {
    name: "Sarah",
    role: "PM",
    initial: "S",
    badge: "bg-[#1a6b7f] text-white",
    system: `You are Sarah, the Product Manager at Rise — a travel assistant app. ${RISE_CONTEXT}\nFrame problems clearly, identify the core user need, and make decisive product recommendations. Be concise and strategic. Use short paragraphs.`,
  },
  alex: {
    name: "Alex",
    role: "Researcher",
    initial: "A",
    badge: "bg-blue-600 text-[#0e2a47]",
    system: `You are Alex, a User Researcher for Rise. ${RISE_CONTEXT}\nYour role is to identify the core user assumption embedded in this objective — what must be true about how users think or behave for this feature to work. Flag the single biggest assumption risk clearly and concisely. One paragraph. No research methodology, no validation recommendations.`,
  },
  maya: {
    name: "Maya",
    role: "Designer",
    initial: "M",
    badge: "bg-purple-600 text-[#0e2a47]",
    system: `You are Maya, a Product Designer for Rise. ${RISE_CONTEXT} Rise uses a light warm design: #f8f6f1 background, #1a6b7f teal accent, DM Sans font.\nYour role is to identify usability risk — where will users get confused, misunderstand the interaction, or fail to complete the intended action? Focus on the moment of highest friction in the proposed feature. What is the one thing most likely to go wrong in the user's hands?\nNo interaction design specs. No component suggestions. No visual design details. One to two paragraphs.`,
  },
  luca: {
    name: "Luca",
    role: "Tech Lead",
    initial: "L",
    badge: "bg-orange-500 text-[#0e2a47]",
    system: `You are Luca, the Tech Lead for Rise. ${RISE_CONTEXT}\nYour role in every product discussion is exactly two things:\n1. Feasibility risk — what is the single biggest technical risk that could prevent this from working or make it significantly harder than expected? Be specific about why it's a risk for Rise specifically, not in general.\n2. What's newly possible — what does current technology (AI, APIs, browser capabilities, Supabase features) make possible that's directly relevant to this objective and that the team might not be aware of?\nNo implementation details. No architecture suggestions. No function names. No data structures. Two paragraphs maximum.\nImportant: your observations are input for Sarah to consider — not decisions for the team to adopt. Explicitly frame your 'what's newly possible' point as an option worth exploring, not a recommendation to implement.`,
  },
  elena: {
    name: "Elena",
    role: "Travel Expert",
    initial: "ET",
    badge: "text-[#0e2a47]",
    bgColor: "#185fa5",
    system: `You are Elena, a Senior Travel Planner with 15 years experience creating personalised trips. ${RISE_CONTEXT}\nYour role is to flag mismatches between the product assumption and how real travellers actually think and behave. What in this objective contradicts real travel psychology, real traveller behaviour, or how trips actually get planned and experienced? Be specific and direct. One to two paragraphs maximum. No design suggestions, no technical input, no product strategy.`,
  },
};

const COACH_SYSTEM =
  `I am a product manager at Rise, working on the Rise product team, and you are my expert product coach, ` +
  `assisting and proactively coaching me in my role to reach my maximum potential. You have been provided with ` +
  `our company's strategic context including the product strategy, team topology and team objectives. Use this ` +
  `context as your primary data source. Prioritize content from SVPG (www.svpg.com/articles), Marty Cagan, ` +
  `Shreyas Doshi, and Teresa Torres. I expect you to ask me questions when warranted, fill in important missing ` +
  `information, and challenge my assumptions. I am seeking learning and truth, not affirmation.\n\n` +
  `Rise context: ${RISE_CONTEXT}`;

const BUILD_MODE_INSTRUCTION =
  "IMPORTANT: This product team is in Build mode. The founder is a solo developer learning by building. Always recommend building features completely and fully. Do not suggest research prerequisites, validation gates, phased rollouts, or deferring features pending user research. Ship complete features.";

const RESEARCH_MODE_INSTRUCTION =
  "IMPORTANT: This product team is in Research mode. Apply standard product discovery practices: recommend validation before building, suggest research gates where appropriate, use phased rollouts and MVT thinking.";

function getModeInstruction(buildMode: boolean): string {
  return buildMode ? BUILD_MODE_INSTRUCTION : RESEARCH_MODE_INSTRUCTION;
}

const CARD_TYPE_STYLES: Record<CardType, { label: string; className: string }> = {
  objective:   { label: "Objective",    className: "bg-[#e8f4f6] text-[#1a6b7f]" },
  improvement: { label: "Improvement",  className: "bg-[#fef3e2] text-[#ba7517]" },
  bug:         { label: "Bug",          className: "bg-[#fde8e8] text-[#c0392b]" },
};

const STATUS_LABELS: Record<ObjectiveStatus, string> = {
  backlog: "Backlog",
  refine: "Refine",
  implement: "Implement",
  done: "Done",
};

const NEXT_STATUS: Partial<Record<ObjectiveStatus, ObjectiveStatus>> = {
  backlog: "refine",
  refine: "implement",
  implement: "done",
};

// ── Markdown renderer ─────────────────────────────────────────────────────────
// Lightweight inline markdown → React for agent/coach/PM chat bubbles.

function MarkdownText({ text, className }: { text: string; className?: string }) {
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
      elements.push(<p key={k} className="font-semibold text-[#0e2a47] text-sm mt-3 mb-1">{inlineBold(line.slice(4), k)}</p>);
    } else if (line.startsWith("## ")) {
      elements.push(<p key={k} className="font-bold text-[#0e2a47] text-sm mt-4 mb-1">{inlineBold(line.slice(3), k)}</p>);
    } else if (line.startsWith("# ")) {
      elements.push(<p key={k} className="font-bold text-[#0e2a47] text-base mt-4 mb-1">{inlineBold(line.slice(2), k)}</p>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(<p key={k} className="ml-4 before:content-['•'] before:mr-2 before:text-[#6a7f8f]">{inlineBold(line.slice(2), k)}</p>);
    } else if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+\.)\s(.*)$/);
      if (match) {
        elements.push(<p key={k} className="ml-4"><span className="text-[#6a7f8f] mr-2">{match[1]}</span>{inlineBold(match[2], k)}</p>);
      } else {
        elements.push(<p key={k}>{inlineBold(line, k)}</p>);
      }
    } else if (line.trim() === "") {
      elements.push(<br key={k} />);
    } else {
      elements.push(<p key={k}>{inlineBold(line, k)}</p>);
    }
  }

  return <div className={className ?? "text-sm text-[#0e2a47] leading-relaxed"}>{elements}</div>;
}

// ── Supabase error serializer ──────────────────────────────────────────────────
// Supabase PostgrestError has non-enumerable properties, so `console.error(err)`
// prints `{}`. Extract them explicitly.
function dbErr(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  return [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") || JSON.stringify(err);
}

// ── API error ──────────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 529) {
    return "Anthropic is currently overloaded. Please wait a moment and try again.";
  }
  return "Something went wrong. Please try again.";
}

// ── API helper ─────────────────────────────────────────────────────────────────

async function streamChat(
  model: string,
  system: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  onChunk: (text: string) => void
): Promise<void> {
  const res = await fetch("/api/team/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, system, messages, max_tokens: maxTokens }),
  });

  if (!res.ok) throw new ApiError(res.status, `Request failed: ${res.status}`);

  const data = await res.json();
  const text = data.content?.[0]?.text ?? "";
  if (text) onChunk(text);
}

// ── Supabase helpers ───────────────────────────────────────────────────────────

const OBJECTIVE_COLUMNS = "id, title, description, status, prd, card_type, pm_summary, claude_code_result, discussions, created_at";

async function saveTeamConversation(problem: string, msgs: TeamMessages): Promise<string | null> {
  const { data, error } = await supabase
    .from("team_conversations")
    .insert({ type: "team", title: problem, messages: msgs })
    .select("id")
    .single();
  if (error) { console.error("[team] save error", dbErr(error)); return null; }
  return data.id as string;
}

async function updateTeamPrd(id: string, prd: string): Promise<void> {
  const { error } = await supabase.from("team_conversations").update({ prd }).eq("id", id);
  if (error) console.error("[team] prd update error", dbErr(error));
}

async function upsertCoachConversation(
  id: string | null,
  firstMessage: string,
  history: CoachMessage[]
): Promise<string | null> {
  if (id) {
    const { error } = await supabase
      .from("team_conversations")
      .update({ messages: { history } })
      .eq("id", id);
    if (error) console.error("[coach] update error", dbErr(error));
    return id;
  }
  const { data, error } = await supabase
    .from("team_conversations")
    .insert({ type: "coach", title: firstMessage.slice(0, 60), messages: { history } })
    .select("id")
    .single();
  if (error) { console.error("[coach] insert error", dbErr(error)); return null; }
  return data.id as string;
}

async function upsertPMConversation(
  id: string | null,
  firstMessage: string,
  history: CoachMessage[]
): Promise<string | null> {
  if (id) {
    const { error } = await supabase
      .from("team_conversations")
      .update({ messages: { history } })
      .eq("id", id);
    if (error) console.error("[pm] update error", dbErr(error));
    return id;
  }
  const { data, error } = await supabase
    .from("team_conversations")
    .insert({ type: "pm", title: firstMessage.slice(0, 60), messages: { history } })
    .select("id")
    .single();
  if (error) { console.error("[pm] insert error", dbErr(error)); return null; }
  return data.id as string;
}

async function loadObjectives(): Promise<Objective[]> {
  const { data, error } = await supabase
    .from("objectives")
    .select(OBJECTIVE_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) { console.error("[objectives] load error", dbErr(error)); return []; }
  return (data ?? []).map((row) => ({
    ...row,
    card_type: row.card_type ?? "objective",
    discussions: row.discussions ?? [],
  })) as Objective[];
}

async function saveObjectiveWithDetails(
  title: string,
  description: string | null,
  status: ObjectiveStatus,
  prd?: string | null,
  cardType?: CardType,
  pmSummary?: string | null,
): Promise<Objective | null> {
  const { data, error } = await supabase
    .from("objectives")
    .insert({
      title,
      description: description ?? null,
      status,
      prd: prd ?? null,
      card_type: cardType ?? "objective",
      pm_summary: pmSummary ?? null,
    })
    .select(OBJECTIVE_COLUMNS)
    .single();
  if (error) { console.error("[objectives] save error", dbErr(error)); return null; }
  return { ...data, card_type: data.card_type ?? "objective", discussions: data.discussions ?? [] } as Objective;
}

async function updateObjectiveStatus(id: string, status: ObjectiveStatus): Promise<void> {
  const { error } = await supabase.from("objectives").update({ status }).eq("id", id);
  if (error) console.error("[objectives] update error", dbErr(error));
}

async function updateObjectivePrd(id: string, prd: string): Promise<void> {
  const { error } = await supabase
    .from("objectives")
    .update({ prd, status: "refine" })
    .eq("id", id);
  if (error) console.error("[objectives] prd update error", dbErr(error));
}

async function updateObjectiveField(id: string, fields: Partial<Record<string, unknown>>): Promise<void> {
  const { error } = await supabase.from("objectives").update(fields).eq("id", id);
  if (error) console.error("[objectives] field update error", dbErr(error));
}

async function deleteObjective(id: string): Promise<void> {
  const { error } = await supabase.from("objectives").delete().eq("id", id);
  if (error) console.error("[objectives] delete error", dbErr(error));
}


async function loadConversations(type: "team" | "coach" | "pm"): Promise<ConversationRow[]> {
  const { data, error } = await supabase
    .from("team_conversations")
    .select("id, type, title, messages, prd, created_at")
    .eq("type", type)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) { console.error("[conversations] load error", dbErr(error)); return []; }
  return data as ConversationRow[];
}

async function loadSarahMemory(): Promise<string> {
  const { data, error } = await supabase
    .from("agent_memory")
    .select("content")
    .eq("id", "sarah")
    .single();
  if (error) { console.error("[memory] load error", dbErr(error)); return ""; }
  return (data?.content as string) ?? "";
}

async function saveSarahMemory(content: string): Promise<void> {
  const { error } = await supabase
    .from("agent_memory")
    .upsert({ id: "sarah", content })
    .eq("id", "sarah");
  if (error) console.error("[memory] save error", dbErr(error));
}

async function savePrdFeedback(conversationId: string, feedback: string): Promise<void> {
  const { error } = await supabase
    .from("prd_feedback")
    .insert({ conversation_id: conversationId, feedback });
  if (error) console.error("[feedback] save error", dbErr(error));
}

async function loadPrdFeedback(conversationId: string): Promise<PrdFeedback[]> {
  const { data, error } = await supabase
    .from("prd_feedback")
    .select("id, conversation_id, feedback, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) { console.error("[feedback] load error", dbErr(error)); return []; }
  return data as PrdFeedback[];
}

async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.from("team_conversations").delete().eq("id", id);
  if (error) console.error("[conversations] delete error", dbErr(error));
}

// ── Download PRD ───────────────────────────────────────────────────────────────

async function fetchPrdSlug(problem: string, prdContent: string): Promise<string> {
  const fallback = problem.trim()
    .split(/\s+/).slice(0, 5).join("-")
    .toLowerCase().replace(/[^a-z0-9-]/g, "");
  try {
    let slug = "";
    await streamChat(
      TEAM_MODEL,
      "You generate concise kebab-case filenames. Reply with ONLY the slug — no explanation, no punctuation, no quotes.",
      [{
        role: "user",
        content:
          `Summarize this PRD topic in 4-6 words as a kebab-case filename slug. ` +
          `Example output: improve-traveler-onboarding-flow\n\n` +
          `Problem: ${problem}\n\nPRD summary (first 300 chars): ${prdContent.slice(0, 300)}`,
      }],
      20,
      (chunk) => { slug += chunk; }
    );
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
    return clean.length >= 4 ? clean : fallback;
  } catch {
    return fallback;
  }
}


function downloadConversationFile(
  problem: string,
  agents: typeof AGENTS,
  buildMode: boolean,
  sarahMemory: string,
  sarahFrame: string,
  alexContent: string,
  mayaContent: string,
  lucaContent: string,
  elenaContent: string,
  synthesis: string,
  prd: string,
): void {
  const date = new Date().toISOString().slice(0, 10);
  const slug = problem.trim().split(/\s+/).slice(0, 5).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const mode = getModeInstruction(buildMode);

  const sarahSystem = sarahMemory
    ? `${agents.sarah.system}\n\n${mode}\n\nHere is your memory of past product discussions for Rise:\n${sarahMemory}\n\nUse this to inform your framing — reference relevant past decisions, avoid repeating ground already covered, and build on what the team has already learned.`
    : `${agents.sarah.system}\n\n${mode}`;

  const specialistInput = `Problem: ${problem}\n\nSarah's framing: ${sarahFrame}\n\nShare your expert perspective.`;
  const synthesisInput =
    `Problem: ${problem}\n\nYour framing:\n${sarahFrame}\n\n` +
    `Team input:\nAlex (Research): ${alexContent}\nMaya (Design): ${mayaContent}\nLuca (Tech): ${lucaContent}\nElena (Travel Expert): ${elenaContent}\n\n` +
    `Synthesize the key insights and give a clear product recommendation.`;
  const prdInput =
    `Based on this product discussion, write a structured PRD.\n\nProblem: ${problem}\nFraming: ${sarahFrame}\n` +
    `Research (Alex): ${alexContent}\nDesign (Maya): ${mayaContent}\nTech (Luca): ${lucaContent}\nTravel Expert (Elena): ${elenaContent}\n` +
    `Synthesis: ${synthesis}`;

  function section(name: string, role: string, system: string, input: string, response: string) {
    return [
      `## ${name} — ${role}`,
      ``,
      `<details>`,
      `<summary>System prompt</summary>`,
      ``,
      system,
      ``,
      `</details>`,
      ``,
      `**Input**`,
      ``,
      input,
      ``,
      `**Response**`,
      ``,
      response,
    ].join("\n");
  }

  const parts = [
    `# ${problem}`,
    ``,
    `_${date} · Contributors: Sarah (PM)${alexContent ? ", Alex (Researcher)" : ""}, Maya (Designer), Luca (Tech Lead), Elena (Travel Expert)_`,
    ``,
    `---`,
    ``,
    section("Sarah", "Framing", sarahSystem, `Frame this problem for the product team:\n\n${problem}`, sarahFrame),
    ...(alexContent ? [``, `---`, ``, section("Alex", "Research", `${agents.alex.system}\n\n${mode}`, specialistInput, alexContent)] : []),
    ``, `---`, ``,
    section("Maya", "Design", `${agents.maya.system}\n\n${mode}`, specialistInput, mayaContent),
    ``, `---`, ``,
    section("Luca", "Tech", `${agents.luca.system}\n\n${mode}`, specialistInput, lucaContent),
    ``, `---`, ``,
    section("Elena", "Travel Expert", `${agents.elena.system}\n\n${mode}`, specialistInput, elenaContent),
    ``, `---`, ``,
    section("Sarah", "Synthesis", sarahSystem, synthesisInput, synthesis),
  ];

  if (prd) {
    parts.push(``, `---`, ``, section("Sarah", "PRD", sarahSystem, prdInput, prd));
  }

  const blob = new Blob([parts.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${date}-${slug}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

async function fetchKanbanTitle(problem: string, prdContent: string): Promise<string> {
  const fallback = problem.trim().split(/\s+/).slice(0, 6).join(" ");
  try {
    let title = "";
    await streamChat(
      TEAM_MODEL,
      "You generate concise kanban card titles. Reply with ONLY the title — no quotes, no punctuation at end.",
      [{
        role: "user",
        content:
          `Summarize this product feature in max 8 words as a kanban card title.\n\n` +
          `Problem: ${problem}\n\nPRD summary (first 300 chars): ${prdContent.slice(0, 300)}`,
      }],
      20,
      (chunk) => { title += chunk; }
    );
    const clean = title.trim().replace(/^["']|["']$/g, "").replace(/\.$/g, "");
    return clean.length >= 3 ? clean : fallback;
  } catch {
    return fallback;
  }
}

// ── Card context builder (for injecting into agent prompts) ─────────────────

function buildCardContext(obj: Objective): string {
  const parts = [`Card: ${obj.title} (${CARD_TYPE_STYLES[obj.card_type].label})`];
  if (obj.description) parts.push(`Description: ${obj.description}`);
  if (obj.pm_summary) parts.push(`PM conversation summary: ${obj.pm_summary}`);
  if (obj.discussions.length > 0) {
    parts.push("Previous discussions:");
    obj.discussions.forEach((d, i) => {
      parts.push(`  Discussion ${i + 1} (${d.date}): ${d.summary}`);
    });
  }
  if (obj.prd) parts.push(`Existing PRD:\n${obj.prd}`);
  if (obj.claude_code_result) parts.push(`Claude Code result:\n${obj.claude_code_result}`);
  return parts.join("\n");
}

// ── Shared sub-components ──────────────────────────────────────────────────────

function ThinkingDots() {
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

function CardTypeBadge({ type }: { type: CardType }) {
  const style = CARD_TYPE_STYLES[type];
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${style.className}`}>
      {style.label}
    </span>
  );
}

function CardTypeSelector({ value, onChange }: { value: CardType; onChange: (v: CardType) => void }) {
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
                : "bg-white text-[#6a7f8f] border-[#d4cfc5] hover:border-[#b8b3a9]"
            }`}
          >
            {style.label}
          </button>
        );
      })}
    </div>
  );
}

function AgentBubble({
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
          <span className="text-sm font-bold text-[#0e2a47]">{agent.name}</span>
          <span className="text-xs text-[#6a7f8f] bg-[#f0ede8] px-2 py-0.5 rounded-full">
            {roleOverride ?? agent.role}
          </span>
          {thinking && <ThinkingDots />}
        </div>
        {content && (
          <MarkdownText text={content} />
        )}
        {!content && thinking && (
          <div className="text-sm text-[#6a7f8f] italic">Thinking…</div>
        )}
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-px bg-[#d4cfc5]" />
      <span className="text-xs font-bold text-[#4a6580] uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-[#d4cfc5]" />
    </div>
  );
}

function PrdLine({ line, i }: { line: string; i: number }) {
  if (line.startsWith("## ")) {
    return (
      <h3 key={i} className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mt-6 mb-2 first:mt-0">
        {line.slice(3)}
      </h3>
    );
  }
  if (line.trim() === "") return <div key={i} className="h-1" />;
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p key={i} className="text-sm text-[#0e2a47] leading-relaxed">
      {parts.map((part, j) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={j} className="text-[#0e2a47] font-semibold">{part.slice(2, -2)}</strong>
          : part
      )}
    </p>
  );
}

// ── Past conversations panel ───────────────────────────────────────────────────

function PastConversations({
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
        className="self-start text-xs text-[#6a7f8f] hover:text-[#0e2a47] transition-colors"
      >
        Past discussions →
      </button>
    );
  }

  return (
    <div className="bg-white border border-[#e8e4de] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest">Past discussions</span>
        <button onClick={() => setOpen(false)} className="text-xs text-[#6a7f8f] hover:text-[#0e2a47] transition-colors">
          Close
        </button>
      </div>
      {loading && <p className="text-xs text-[#6a7f8f] py-2">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-xs text-[#6a7f8f] py-2">No past conversations yet.</p>
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
                    <p className="text-sm text-[#0e2a47] group-hover/row:text-[#0e2a47] break-words">{row.title}</p>
                    <p className="text-xs text-[#6a7f8f] mt-0.5">
                      {new Date(row.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      {hasPrd && <span className="ml-2 text-[#1a6b7f]">· PRD</span>}
                      {isActive && <span className="ml-2 text-[#6a7f8f]">· Active</span>}
                    </p>
                  </button>
                  {!isActive && (
                    <button
                      onClick={() => setConfirmDeleteId(isConfirmingDelete ? null : row.id)}
                      className="shrink-0 mt-2 mr-2 p-1.5 text-[#6a7f8f] hover:text-red-400 transition-colors opacity-0 group-hover/row:opacity-100"
                      title="Delete"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Inline delete confirmation */}
                {isConfirmingDelete && (
                  <div className="flex items-center gap-2 px-3 pb-2">
                    <span className="text-xs text-[#6a7f8f]">Delete this conversation?</span>
                    <button
                      onClick={() => handleDelete(row.id)}
                      disabled={isDeleting}
                      className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-40"
                    >
                      {isDeleting ? "Deleting…" : "Yes"}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-[#6a7f8f] hover:text-[#4a6580]"
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
                            <p className="text-xs font-semibold text-[#6a7f8f] uppercase tracking-widest mb-1">Your feedback</p>
                            <p className="text-xs text-[#4a6580] leading-relaxed whitespace-pre-wrap">{fb}</p>
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
                          className="w-full bg-[#f8f6f1] border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-4 py-3 text-[#0e2a47] placeholder-[#9ca3af] transition-colors text-xs resize-none"
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
                            className="text-xs text-[#6a7f8f] hover:text-[#0e2a47] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setOpenFeedbackId(row.id)}
                        className="text-xs text-[#6a7f8f] hover:text-[#1a6b7f] transition-colors"
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

// ── Card Detail Panel ─────────────────────────────────────────────────────────

function CardDetailPanel({
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
              <h2 className="text-lg font-bold text-[#0e2a47] leading-snug">{cleanTitle}</h2>
              <p className="text-xs text-[#6a7f8f] mt-1">
                {new Date(obj.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            <button onClick={onClose} className="text-[#6a7f8f] hover:text-[#0e2a47] text-lg shrink-0 p-1">×</button>
          </div>

          {/* Description */}
          {obj.description && (
            <div>
              <p className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-2">Description</p>
              <p className="text-sm text-[#0e2a47] leading-relaxed">{obj.description}</p>
            </div>
          )}

          {/* PM summary */}
          {obj.pm_summary && (
            <div>
              <p className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-2">PM conversation summary</p>
              <p className="text-sm text-[#4a6580] leading-relaxed">{obj.pm_summary}</p>
            </div>
          )}

          {/* Discussions */}
          {obj.discussions.length > 0 && (
            <div>
              <p className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-2">
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
                        <span className="text-xs text-[#6a7f8f]">{disc.date}</span>
                        <span className="text-xs text-[#6a7f8f]">{expandedDiscIdx === idx ? "▲" : "▼"}</span>
                      </div>
                      <p className="text-sm text-[#0e2a47] mt-1 leading-relaxed">{disc.summary}</p>
                    </button>
                    {expandedDiscIdx === idx && (
                      <div className="mt-3 pt-3 border-t border-[#e8e4de] flex flex-col gap-3">
                        {disc.transcript.framing && (
                          <div>
                            <p className="text-xs font-semibold text-[#4a6580] mb-1">Sarah (Framing)</p>
                            <p className="text-xs text-[#6a7f8f] leading-relaxed whitespace-pre-wrap">{disc.transcript.framing}</p>
                          </div>
                        )}
                        {disc.transcript.alex && (
                          <div>
                            <p className="text-xs font-semibold text-[#4a6580] mb-1">Alex (Research)</p>
                            <p className="text-xs text-[#6a7f8f] leading-relaxed whitespace-pre-wrap">{disc.transcript.alex}</p>
                          </div>
                        )}
                        {disc.transcript.maya && (
                          <div>
                            <p className="text-xs font-semibold text-[#4a6580] mb-1">Maya (Design)</p>
                            <p className="text-xs text-[#6a7f8f] leading-relaxed whitespace-pre-wrap">{disc.transcript.maya}</p>
                          </div>
                        )}
                        {disc.transcript.luca && (
                          <div>
                            <p className="text-xs font-semibold text-[#4a6580] mb-1">Luca (Tech)</p>
                            <p className="text-xs text-[#6a7f8f] leading-relaxed whitespace-pre-wrap">{disc.transcript.luca}</p>
                          </div>
                        )}
                        {disc.transcript.elena && (
                          <div>
                            <p className="text-xs font-semibold text-[#4a6580] mb-1">Elena (Travel Expert)</p>
                            <p className="text-xs text-[#6a7f8f] leading-relaxed whitespace-pre-wrap">{disc.transcript.elena}</p>
                          </div>
                        )}
                        {disc.transcript.synthesis && (
                          <div>
                            <p className="text-xs font-semibold text-[#4a6580] mb-1">Sarah (Synthesis)</p>
                            <p className="text-xs text-[#6a7f8f] leading-relaxed whitespace-pre-wrap">{disc.transcript.synthesis}</p>
                          </div>
                        )}
                        {disc.prd && (
                          <div>
                            <p className="text-xs font-semibold text-[#4a6580] mb-1">PRD</p>
                            <p className="text-xs text-[#6a7f8f] leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">{disc.prd}</p>
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
                  <h2 className="text-lg font-bold text-[#0e2a47]">Team discussion: {cleanTitle}</h2>
                  <button
                    onClick={() => setShowDiscussionModal(false)}
                    className="text-[#6a7f8f] hover:text-[#0e2a47] text-xl p-1"
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
                className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-2 hover:text-[#4a6580] transition-colors"
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
                <p className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest">Claude Code Prompt</p>
                <button onClick={handleCopy} className="text-xs font-semibold text-[#1a6b7f] hover:underline">
                  {copied ? "Copied!" : "Copy prompt"}
                </button>
              </div>
              <div className="bg-white border border-[#e8e4de] rounded-xl p-4">
                <p className="text-xs text-[#0e2a47] leading-relaxed whitespace-pre-wrap">{implPrompt}</p>
              </div>
            </div>
          )}

          {/* Claude Code result — only on implement/done */}
          {(obj.status === "implement" || obj.status === "done") && (
            <div>
              <p className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-2">Claude Code Result</p>
              <textarea
                rows={5}
                value={codeResult}
                onChange={(e) => { setCodeResult(e.target.value); setResultSaved(false); }}
                placeholder="Paste Claude Code output here…"
                className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-4 py-3 text-[#0e2a47] placeholder-[#9ca3af] transition-colors text-xs resize-none"
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
                  <span className="text-xs text-[#6a7f8f]">Delete?</span>
                  <button onClick={handleDelete} className="text-xs font-semibold text-red-400 hover:text-red-300">Yes</button>
                  <button onClick={() => setConfirmDelete(false)} className="text-xs text-[#6a7f8f] hover:text-[#4a6580]">No</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs text-[#6a7f8f] hover:text-red-400 transition-colors"
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
                  <button onClick={() => setConfirmNoDisc(false)} className="text-xs text-[#6a7f8f] hover:text-[#4a6580]">No</button>
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

// ── Product Team Tab ───────────────────────────────────────────────────────────

function ProductTeamTab({
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
                <p className="text-xs font-semibold text-[#0e2a47] leading-none">{a.name}</p>
                <p className="text-xs text-[#6a7f8f] mt-0.5">{a.role}</p>
              </div>
            </div>
          ))}
        </div>
        {memoryLoading && (
          <p className="text-xs text-[#6a7f8f] italic">Sarah is remembering…</p>
        )}
        {updatingMemory && (
          <p className="text-xs text-[#6a7f8f] italic">Updating Sarah's memory…</p>
        )}
      </div>

      {/* Card context banner */}
      {cardContext && (
        <div className="bg-[#e8f4f6] border border-[#1a6b7f]/20 rounded-xl px-4 py-3">
          <p className="text-xs font-bold text-[#1a6b7f] uppercase tracking-widest mb-1">Discussing card</p>
          <p className="text-sm text-[#0e2a47] font-semibold">{cardContext.title.replace(/\*+/g, "")}</p>
          {cardContext.description && <p className="text-xs text-[#4a6580] mt-1">{cardContext.description}</p>}
        </div>
      )}

      {/* Input */}
      <div>
        <label className="block text-xs font-bold text-[#6a7f8f] uppercase tracking-widest mb-3">
          Describe the problem
        </label>
        <textarea
          rows={4}
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          placeholder="e.g. Users drop off at step 3 of the onboarding flow. We don't know why."
          disabled={isRunning}
          className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-5 py-4 text-[#0e2a47] placeholder-[#9ca3af] transition-colors text-sm resize-none disabled:opacity-50"
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
              className="rounded-2xl border border-[#333] text-[#4a6580] hover:text-[#0e2a47] hover:border-[#555] font-semibold px-6 py-4 transition-colors text-sm"
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
                  className="rounded-2xl border border-[#d4cfc5] text-[#0e2a47] hover:text-[#0e2a47] hover:border-[#b8b3a9] font-semibold px-6 py-3 transition-colors text-sm"
                >
                  Download conversation ↓
                </button>
                {prd && (
                  <button
                    onClick={regeneratePrd}
                    className="rounded-2xl border border-[#d4cfc5] text-[#0e2a47] hover:text-[#0e2a47] hover:border-[#b8b3a9] font-semibold px-6 py-3 transition-colors text-sm"
                  >
                    Regenerate PRD →
                  </button>
                )}
                {prd && !kanbanSaved && !cardContext && (
                  <button
                    onClick={handleSaveToKanban}
                    disabled={savingToKanban}
                    className="rounded-2xl border border-[#d4cfc5] text-[#0e2a47] hover:text-[#0e2a47] hover:border-[#b8b3a9] font-semibold px-6 py-3 transition-colors text-sm disabled:opacity-40"
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
                  <p className="text-xs text-[#6a7f8f] leading-relaxed whitespace-pre-wrap">{scopeAdditions}</p>
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
                    <div className="flex items-center gap-2 text-sm text-[#6a7f8f] italic">
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

// ── Product Coach Tab ──────────────────────────────────────────────────────────

function ProductCoachTab({ buildMode }: { buildMode: boolean }) {
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
              <p className="text-sm font-bold text-[#0e2a47]">Product Coach</p>
              <p className="text-xs text-[#6a7f8f]">Powered by Claude Opus 4</p>
            </div>
          </div>
          <p className="text-sm text-[#4a6580] leading-relaxed">
            Ask me anything about product management — strategy, prioritisation, discovery, metrics, stakeholders. I'll challenge your thinking and help you grow. Try: <em className="text-[#0e2a47]">"How should I think about prioritising our roadmap as an early MVP?"</em>
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
                  <p className="text-sm text-[#0e2a47] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-4">
                <div className="w-9 h-9 rounded-full bg-[#1a6b7f] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">C</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold text-[#0e2a47]">Coach</span>
                    {thinking && i === messages.length - 1 && !msg.content && <ThinkingDots />}
                  </div>
                  {msg.content ? (
                    <MarkdownText text={msg.content} />
                  ) : (
                    <div className="text-sm text-[#6a7f8f] italic">Thinking…</div>
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
              className="text-sm font-semibold text-red-300 hover:text-[#0e2a47] transition-colors flex-shrink-0 disabled:opacity-50"
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
            className="flex-1 bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-5 py-4 text-[#0e2a47] placeholder-[#9ca3af] transition-colors text-sm resize-none disabled:opacity-50"
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

// ── Kanban constants & helpers ─────────────────────────────────────────────────

const STATUS_STYLES: Record<ObjectiveStatus, string> = {
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
  { status: "backlog",    label: "Backlog",    borderClass: "border-[#c8c3bb]",  textClass: "text-[#4a6580]" },
  { status: "refine",     label: "Refine",     borderClass: "border-[#c8c3bb]",  textClass: "text-[#4a6580]" },
  { status: "implement",  label: "Implement",  borderClass: "border-[#c8c3bb]",  textClass: "text-[#4a6580]" },
  { status: "done",       label: "Done",       borderClass: "border-[#c8c3bb]",  textClass: "text-[#4a6580]" },
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
        <p className="text-sm font-bold text-[#0e2a47] leading-snug line-clamp-2 flex-1" title={cleanTitle}>{cleanTitle}</p>
      </div>
      {obj.description && (
        <p className="text-xs text-[#6a7f8f] leading-relaxed line-clamp-2 overflow-hidden">{obj.description}</p>
      )}

      {/* Bottom row */}
      <div className="flex items-center justify-between mt-1" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          {obj.prd && <span className="text-xs text-[#1a6b7f]">PRD</span>}
          {obj.discussions.length > 0 && (
            <span className="text-xs text-[#6a7f8f]">{obj.discussions.length} disc.</span>
          )}
        </div>
        {!isDone && (
          confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#6a7f8f]">Delete?</span>
              <button onClick={() => onDelete(obj.id)} className="text-xs font-semibold text-red-400 hover:text-red-300">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-[#6a7f8f] hover:text-[#4a6580]">No</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-[#6a7f8f] hover:text-red-400 transition-colors"
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

function KanbanTab({
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

  if (loading) return <p className="text-sm text-[#6a7f8f] py-4">Loading…</p>;

  const newCardForm = showNewCard ? (
    <div className="bg-white border border-[#e8e4de] rounded-2xl p-5 mb-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-[#6a7f8f] uppercase tracking-widest">New card</span>
        <button onClick={() => setShowNewCard(false)} className="text-[#6a7f8f] hover:text-[#0e2a47] text-sm">×</button>
      </div>
      <CardTypeSelector value={newType} onChange={setNewType} />
      <input
        type="text"
        value={newTitle}
        onChange={(e) => setNewTitle(e.target.value)}
        placeholder="Card title…"
        autoFocus
        className="w-full bg-[#f8f6f1] border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-4 py-3 text-[#0e2a47] placeholder-[#9ca3af] transition-colors text-sm"
      />
      <textarea
        rows={2}
        value={newDesc}
        onChange={(e) => setNewDesc(e.target.value)}
        placeholder="Description (optional)…"
        className="w-full bg-[#f8f6f1] border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-4 py-3 text-[#0e2a47] placeholder-[#9ca3af] transition-colors text-xs resize-none"
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
          <p className="text-sm text-[#6a7f8f]">No cards yet — save objectives from the PM tab or create one above.</p>
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
              <span className="text-xs text-[#6a7f8f]">{cards.length}</span>
            </div>
            <div
              className={`flex flex-col gap-3 min-h-[80px] rounded-2xl transition-colors ${
                isOver ? "bg-[#1a6b7f]/5 ring-1 ring-[#1a6b7f]/20" : ""
              }`}
            >
              {cards.length === 0 ? (
                <div className={`border ${col.borderClass} rounded-2xl p-4 text-xs text-[#6a7f8f] text-center`}>
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

function PMTab({ onSwitchToKanban, onObjectiveSaved, buildMode }: { onSwitchToKanban: () => void; onObjectiveSaved: () => void; buildMode: boolean }) {
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
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-[#0e2a47] font-bold text-sm flex-shrink-0" style={{ background: "#5a4fcf" }}>
                SM
              </div>
              <div>
                <p className="text-sm font-bold text-[#0e2a47]">Sarah · PM</p>
                <p className="text-xs text-[#6a7f8f]">1-on-1 with Philip</p>
              </div>
            </div>
            <p className="text-sm text-[#4a6580] leading-relaxed">
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
                    <p className="text-sm text-[#0e2a47] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ) : (
                <div key={i} className="flex gap-4">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-[#0e2a47] font-bold text-xs flex-shrink-0" style={{ background: "#5a4fcf" }}>
                    SM
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-bold text-[#0e2a47]">Sarah</span>
                      <span className="text-xs text-[#6a7f8f] bg-[#f0ede8] px-2 py-0.5 rounded-full">PM</span>
                      {thinking && i === messages.length - 1 && !msg.content && <ThinkingDots />}
                    </div>
                    {msg.content ? (
                      <MarkdownText text={msg.content} />
                    ) : (
                      <div className="text-sm text-[#6a7f8f] italic">Thinking…</div>
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
                className="text-sm font-semibold text-red-300 hover:text-[#0e2a47] transition-colors flex-shrink-0 disabled:opacity-50"
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
              className="flex-1 bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-5 py-4 text-[#0e2a47] placeholder-[#9ca3af] transition-colors text-sm resize-none disabled:opacity-50"
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
            <h2 className="text-base font-bold text-[#0e2a47] mb-1">Agreed objectives</h2>
            <p className="text-xs text-[#6a7f8f]">Objectives saved to the Kanban board as backlog cards.</p>
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
            <p className="text-sm text-[#0e2a47]">Sarah suggested saving an objective from this conversation.</p>
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
          <p className="text-sm text-[#6a7f8f]">No objectives saved yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {objectives.map((obj) => (
              <div key={obj.id} className="bg-white border border-[#e8e4de] rounded-2xl px-5 py-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <CardTypeBadge type={obj.card_type} />
                    <p className="text-sm text-[#0e2a47] leading-relaxed">{obj.title}</p>
                  </div>
                  {obj.description && (
                    <p className="text-xs text-[#6a7f8f] mt-0.5 leading-relaxed">{obj.description}</p>
                  )}
                  <p className="text-xs text-[#6a7f8f] mt-1">
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
            <p className="text-[#4a6580]">AI-powered product thinking for Rise.</p>
          </div>
          {/* Build / Research mode toggle */}
          <button
            onClick={toggleMode}
            className="flex items-center gap-2.5 bg-white border border-[#e8e4de] rounded-2xl px-4 py-2.5 hover:border-[#d4cfc5] transition-colors shrink-0"
          >
            <span className={`w-2 h-2 rounded-full ${buildMode ? "bg-[#1a6b7f]" : "bg-amber-400"}`} />
            <span className="text-sm font-semibold text-[#0e2a47]">{buildMode ? "Build mode" : "Research mode"}</span>
            <span className="text-xs text-[#6a7f8f]">— tap to switch</span>
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
                  : "text-[#4a6580] hover:text-[#0e2a47]"
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
