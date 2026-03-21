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

type ObjectiveStatus = "backlog" | "refine" | "in-progress" | "done";
type Objective = {
  id: string;
  title: string;
  description: string | null;
  status: ObjectiveStatus;
  prd: string | null;
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
  "When you and Philip agree on an objective, summarize it clearly and tell him to save it using the 'Save objective' input below the chat. You cannot save it yourself. " +
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
    badge: "bg-[#00D64F] text-black",
    system: `You are Sarah, the Product Manager at Rise — a travel assistant app. ${RISE_CONTEXT}\nFrame problems clearly, identify the core user need, and make decisive product recommendations. Be concise and strategic. Use short paragraphs.`,
  },
  alex: {
    name: "Alex",
    role: "Researcher",
    initial: "A",
    badge: "bg-blue-600 text-white",
    system: `You are Alex, the User Researcher at Rise — a travel assistant app. ${RISE_CONTEXT}\nAnalyze user behavior, identify research gaps, suggest validation methods. Be evidence-based and specific. Use short paragraphs.`,
  },
  maya: {
    name: "Maya",
    role: "Designer",
    initial: "M",
    badge: "bg-purple-600 text-white",
    system: `You are Maya, the Product Designer at Rise — a travel assistant app with a dark Uber-inspired design (#0a0a0a background, #00D64F green accent, DM Sans font, rounded-2xl cards). ${RISE_CONTEXT}\nFocus on UX flows, user journeys, visual hierarchy, and interaction patterns. Be specific about design decisions. Use short paragraphs.`,
  },
  luca: {
    name: "Luca",
    role: "Tech Lead",
    initial: "L",
    badge: "bg-orange-500 text-white",
    system: `You are Luca, the Tech Lead at Rise — a travel assistant app. ${RISE_CONTEXT} Architecture: Next.js App Router, API routes for AI calls, Supabase Postgres, Vercel edge.\nAssess feasibility, flag complexity, suggest the simplest viable approach. Use short paragraphs.`,
  },
  elena: {
    name: "Elena",
    role: "Travel Expert",
    initial: "ET",
    badge: "text-white",
    bgColor: "#185fa5",
    system: `You are Elena, a Senior Travel Planner with 15 years of experience creating personalised luxury and independent travel itineraries. You are part of the Rise product team. When asked for your perspective, you evaluate product decisions through the lens of real travel expertise: what actually makes trips memorable, what travellers struggle with in reality, how destinations differ in character, and what separates generic recommendations from genuinely personalised ones. You know that good travel planning is about pacing, geography, energy management, and local knowledge — not just listing attractions. Be direct and opinionated. If an AI recommendation would steer a traveller wrong, say so clearly. Rise context: AI-powered travel concierge app with onboarding wizard, restaurant recommendations, transport advice, local guides system, and day-view itinerary planner.`,
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
    .select("id, title, description, status, prd, created_at")
    .order("created_at", { ascending: false });
  if (error) { console.error("[objectives] load error", dbErr(error)); return []; }
  return data as Objective[];
}

async function saveObjectiveWithDetails(
  title: string,
  description: string | null,
  status: ObjectiveStatus,
  prd?: string | null
): Promise<Objective | null> {
  const { data, error } = await supabase
    .from("objectives")
    .insert({ title, description: description ?? null, status, prd: prd ?? null })
    .select("id, title, description, status, prd, created_at")
    .single();
  if (error) { console.error("[objectives] save error", dbErr(error)); return null; }
  return data as Objective;
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

function downloadPrdFile(problem: string, prdContent: string, slug: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const md = [
    `# ${problem}`,
    ``,
    `_Generated by Rise Product Agents · ${date}_`,
    ``,
    `**Contributors:** Sarah (PM), Alex (Researcher), Maya (Designer), Luca (Tech Lead)`,
    ``,
    `---`,
    ``,
    prdContent,
  ].join("\n");
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${date}-${slug}.md`;
  a.click();
  URL.revokeObjectURL(url);
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
    `_${date} · Contributors: Sarah (PM), Alex (Researcher), Maya (Designer), Luca (Tech Lead), Elena (Travel Expert)_`,
    ``,
    `---`,
    ``,
    section("Sarah", "Framing", sarahSystem, `Frame this problem for the product team:\n\n${problem}`, sarahFrame),
    ``, `---`, ``,
    section("Alex", "Research", `${agents.alex.system}\n\n${mode}`, specialistInput, alexContent),
    ``, `---`, ``,
    section("Maya", "Design", `${agents.maya.system}\n\n${mode}`, specialistInput, mayaContent),
    ``, `---`, ``,
    section("Luca", "Tech", `${agents.luca.system}\n\n${mode}`, specialistInput, lucaContent),
    ``, `---`, ``,
    section("Elena", "Travel Expert", `${agents.elena.system}\n\n${mode}`, specialistInput, elenaContent),
    ``, `---`, ``,
    section("Sarah", "Synthesis", `${agents.sarah.system}\n\n${mode}`, synthesisInput, synthesis),
  ];

  if (prd) {
    parts.push(``, `---`, ``, section("Sarah", "PRD", `${agents.sarah.system}\n\n${mode}`, prdInput, prd));
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

// ── Shared sub-components ──────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-[#00D64F] animate-pulse"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
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
          <span className="text-sm font-bold text-white">{agent.name}</span>
          <span className="text-xs text-gray-600 bg-[#1a1a1a] px-2 py-0.5 rounded-full">
            {roleOverride ?? agent.role}
          </span>
          {thinking && <ThinkingDots />}
        </div>
        {content && (
          <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{content}</div>
        )}
        {!content && thinking && (
          <div className="text-sm text-gray-600 italic">Thinking…</div>
        )}
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-px bg-[#1e1e1e]" />
      <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-[#1e1e1e]" />
    </div>
  );
}

function PrdLine({ line, i }: { line: string; i: number }) {
  if (line.startsWith("## ")) {
    return (
      <h3 key={i} className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-6 mb-2 first:mt-0">
        {line.slice(3)}
      </h3>
    );
  }
  if (line.trim() === "") return <div key={i} className="h-1" />;
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p key={i} className="text-sm text-gray-300 leading-relaxed">
      {parts.map((part, j) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={j} className="text-white font-semibold">{part.slice(2, -2)}</strong>
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
        className="self-start text-xs text-gray-600 hover:text-gray-300 transition-colors"
      >
        Past discussions →
      </button>
    );
  }

  return (
    <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Past discussions</span>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-600 hover:text-gray-300 transition-colors">
          Close
        </button>
      </div>
      {loading && <p className="text-xs text-gray-600 py-2">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-xs text-gray-600 py-2">No past conversations yet.</p>
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
                <div className="flex items-start gap-1 group/row rounded-xl hover:bg-[#1a1a1a] transition-colors">
                  <button
                    onClick={() => { onLoad(row); setOpen(false); }}
                    className="flex-1 text-left px-3 py-2.5 min-w-0"
                  >
                    <p className="text-sm text-gray-300 group-hover/row:text-white break-words">{row.title}</p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {new Date(row.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      {hasPrd && <span className="ml-2 text-[#00D64F]">· PRD</span>}
                      {isActive && <span className="ml-2 text-gray-600">· Active</span>}
                    </p>
                  </button>
                  {!isActive && (
                    <button
                      onClick={() => setConfirmDeleteId(isConfirmingDelete ? null : row.id)}
                      className="shrink-0 mt-2 mr-2 p-1.5 text-gray-700 hover:text-red-400 transition-colors opacity-0 group-hover/row:opacity-100"
                      title="Delete"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Inline delete confirmation */}
                {isConfirmingDelete && (
                  <div className="flex items-center gap-2 px-3 pb-2">
                    <span className="text-xs text-gray-500">Delete this conversation?</span>
                    <button
                      onClick={() => handleDelete(row.id)}
                      disabled={isDeleting}
                      className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-40"
                    >
                      {isDeleting ? "Deleting…" : "Yes"}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-gray-600 hover:text-gray-400"
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
                          <div key={i} className="border-l-2 border-[#00D64F] pl-3 py-0.5">
                            <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-1">Your feedback</p>
                            <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">{fb}</p>
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
                          className="w-full bg-[#0a0a0a] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-4 py-3 text-white placeholder-[#444] transition-colors text-xs resize-none"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSaveFeedback(row.id)}
                            disabled={!draft.trim() || savingId === row.id}
                            className="text-xs font-semibold bg-[#00D64F] text-black rounded-xl px-4 py-2 hover:bg-[#00c248] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {savingId === row.id ? "Saving…" : "Save feedback"}
                          </button>
                          <button
                            onClick={() => { setOpenFeedbackId(null); setDraftMap((prev) => ({ ...prev, [row.id]: "" })); }}
                            className="text-xs text-gray-600 hover:text-gray-300 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setOpenFeedbackId(row.id)}
                        className="text-xs text-gray-600 hover:text-[#00D64F] transition-colors"
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

// ── Product Team Tab ───────────────────────────────────────────────────────────

function ProductTeamTab({
  pendingObjective,
  onObjectiveSaved,
  buildMode,
}: {
  pendingObjective?: { id: string; problem: string } | null;
  onObjectiveSaved?: () => void;
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
  const [prdDownloaded, setPrdDownloaded] = useState(false);
  const [sarahMemory, setSarahMemory] = useState("");
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [updatingMemory, setUpdatingMemory] = useState(false);
  const [activeObjectiveId, setActiveObjectiveId] = useState<string | null>(null);
  const [savingToKanban, setSavingToKanban] = useState(false);
  const [kanbanSaved, setKanbanSaved] = useState(false);

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
    setPhase("idle"); setTeamError(""); setPrdSlug(""); setPrdDownloaded(false);
    setKanbanSaved(false);
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
    setPrdDownloaded(false);
    setActiveObjectiveId(null);
    setKanbanSaved(false);
  }

  async function runDiscussion() {
    if (!problem.trim() || isRunning) return;

    setSarahFrame(""); setAlexContent(""); setMayaContent("");
    setLucaContent(""); setElenaContent(""); setSynthesis(""); setPrd("");
    setTeamError(""); setConversationId(null); setPrdSlug(""); setPrdDownloaded(false);
    setKanbanSaved(false);

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
        [{ role: "user", content: `Frame this problem for the product team:\n\n${problem}` }],
        2048, (chunk) => { frameText += chunk; setSarahFrame(frameText); }
      );
      setThinking({});

      // ── Step 2: Specialists in parallel ──────────────────────────────────
      setPhase("specialists");
      setThinking({ alex: true, maya: true, luca: true, elena: true });
      const specialistPrompt = `Problem: ${problem}\n\nSarah's framing: ${frameText}\n\nShare your expert perspective.`;
      let alexText = "", mayaText = "", lucaText = "", elenaText = "";

      await Promise.all([
        streamChat(TEAM_MODEL, `${AGENTS.alex.system}\n\n${modeInstruction}`,
          [{ role: "user", content: specialistPrompt }], 2048,
          (chunk) => { alexText += chunk; setAlexContent(alexText); }
        ).then(() => setThinking((p) => { const n = { ...p }; delete n.alex; return n; })),

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
      ]);

      // ── Step 3: Sarah synthesizes ─────────────────────────────────────────
      setPhase("synthesis");
      setThinking({ sarah: true });
      let synthesisText = "";
      await streamChat(
        TEAM_MODEL, `${AGENTS.sarah.system}\n\n${modeInstruction}`,
        [{
          role: "user",
          content: `Problem: ${problem}\n\nYour framing:\n${frameText}\n\nTeam input:\nAlex (Research): ${alexText}\nMaya (Design): ${mayaText}\nLuca (Tech): ${lucaText}\nElena (Travel Expert): ${elenaText}\n\nSynthesize the key insights and give a clear product recommendation.`,
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
      setPhase("done");

      // ── Update Sarah's memory (non-blocking) ─────────────────────────────
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
          700,
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

    } catch (err) {
      console.error("Discussion error:", err);
      setThinking({});
      setPhase("idle");
      setTeamError(errorMessage(err));
    }
  }

  async function generatePrd() {
    if (phase !== "done") return;
    setPhase("prd");
    setThinking({ sarah: true });
    setTeamError("");
    setPrdDownloaded(false);
    let prdText = "";
    try {
      await streamChat(
        TEAM_MODEL, `${AGENTS.sarah.system}\n\n${getModeInstruction(buildMode)}`,
        [{
          role: "user",
          content:
            `Based on this product discussion, write a structured PRD.\n\n` +
            `Problem: ${problem}\nFraming: ${sarahFrame}\n` +
            `Research (Alex): ${alexContent}\nDesign (Maya): ${mayaContent}\nTech (Luca): ${lucaContent}\nTravel Expert (Elena): ${elenaContent}\n` +
            `Synthesis: ${synthesis}\n\n` +
            `Use these sections exactly:\n` +
            `## Overview\n## Problem Statement\n## User Need\n## Proposed Solution\n` +
            `## User Stories\n## Success Metrics\n## Technical Considerations\n## Risks & Open Questions\n## Claude Code Implementation Prompt\n\n` +
            `For the Claude Code Implementation Prompt section: write a functional description of what to build. This prompt will be copied directly into Claude Code. Describe what to build clearly and completely in functional terms. Include hard constraints on sequencing or data flow if they affect implementation. Do not include copy templates, animation details, visual state descriptions, prompt wording, or instructions on how to write code. Do not re-state acceptance criteria.`,
        }],
        8000, (chunk) => { prdText += chunk; setPrd(prdText); }
      );
      if (conversationId) await updateTeamPrd(conversationId, prdText);
      const slug = await fetchPrdSlug(problem, prdText);
      setPrdSlug(slug);
      // Save PRD back to the active Kanban card if one was pre-loaded
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

  async function handleDownloadPrd() {
    const slug = prdSlug || await fetchPrdSlug(problem, prd);
    if (!prdSlug) setPrdSlug(slug);
    downloadPrdFile(problem, prd, slug);
    setPrdDownloaded(true);
  }

  return (
    <div className="flex flex-col gap-8">

      {/* Past conversations */}
      <PastConversations type="team" onLoad={loadPastConversation} activeConversationId={conversationId} />

      {/* Team roster + memory status */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-3 flex-wrap">
          {(Object.entries(AGENTS) as [AgentId, typeof AGENTS[AgentId]][]).map(([id, a]) => (
            <div key={id} className="flex items-center gap-2 bg-[#111] border border-[#1e1e1e] rounded-xl px-3 py-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${a.badge}`}
                style={a.bgColor ? { backgroundColor: a.bgColor } : undefined}
              >
                {a.initial}
              </div>
              <div>
                <p className="text-xs font-semibold text-white leading-none">{a.name}</p>
                <p className="text-xs text-gray-600 mt-0.5">{a.role}</p>
              </div>
            </div>
          ))}
        </div>
        {memoryLoading && (
          <p className="text-xs text-gray-600 italic">Sarah is remembering…</p>
        )}
        {updatingMemory && (
          <p className="text-xs text-gray-600 italic">Updating Sarah's memory…</p>
        )}
      </div>

      {/* Input */}
      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
          Describe the problem
        </label>
        <textarea
          rows={4}
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          placeholder="e.g. Users drop off at step 3 of the onboarding flow. We don't know why."
          disabled={isRunning}
          className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white placeholder-[#444] transition-colors text-sm resize-none disabled:opacity-50"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={runDiscussion}
            disabled={!problem.trim() || isRunning}
            className="rounded-2xl bg-[#00D64F] text-black font-bold px-8 py-4 hover:bg-[#00c248] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm"
          >
            {isRunning ? "Discussing…" : "Start discussion →"}
          </button>
          {teamError && !isRunning && (
            <button
              onClick={runDiscussion}
              className="rounded-2xl border border-[#333] text-gray-400 hover:text-white hover:border-[#555] font-semibold px-6 py-4 transition-colors text-sm"
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
              <AgentBubble agentId="alex" content={alexContent} thinking={!!thinking.alex} />
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
                  onClick={generatePrd}
                  className="rounded-2xl border border-[#00D64F] text-[#00D64F] font-bold px-6 py-3 hover:bg-[#00D64F]/10 transition-colors text-sm"
                >
                  {prd ? "Regenerate PRD →" : "Generate PRD →"}
                </button>
                <button
                  onClick={() => downloadConversationFile(problem, AGENTS, buildMode, sarahMemory, sarahFrame, alexContent, mayaContent, lucaContent, elenaContent, synthesis, prd)}
                  className="rounded-2xl border border-[#2a2a2a] text-gray-300 hover:text-white hover:border-[#444] font-semibold px-6 py-3 transition-colors text-sm"
                >
                  Download conversation ↓
                </button>
                {prd && (
                  <button
                    onClick={handleDownloadPrd}
                    className="rounded-2xl border border-[#2a2a2a] text-gray-300 hover:text-white hover:border-[#444] font-semibold px-6 py-3 transition-colors text-sm"
                  >
                    Download PRD ↓
                  </button>
                )}
                {prd && !kanbanSaved && (
                  <button
                    onClick={handleSaveToKanban}
                    disabled={savingToKanban}
                    className="rounded-2xl border border-[#2a2a2a] text-gray-300 hover:text-white hover:border-[#444] font-semibold px-6 py-3 transition-colors text-sm disabled:opacity-40"
                  >
                    {savingToKanban ? "Saving…" : "Save to Kanban →"}
                  </button>
                )}
              </div>
              {(prdDownloaded || kanbanSaved) && (
                <div className="flex flex-col gap-1">
                  {prdDownloaded && <p className="text-xs text-[#00D64F]">PRD downloaded</p>}
                  {kanbanSaved && <p className="text-xs text-[#00D64F]">{activeObjectiveId ? "PRD saved to Kanban card" : "Saved to Kanban"}</p>}
                </div>
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
                <div className="flex-1 bg-[#111] border border-[#1e1e1e] rounded-2xl p-6">
                  {phase === "prd" && thinking.sarah && !prd && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 italic">
                      <ThinkingDots /> Writing PRD…
                    </div>
                  )}
                  {prd && (
                    <div className="flex flex-col gap-1">
                      {prd.split("\n").map((line, i) => <PrdLine key={i} line={line} i={i} />)}
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
        <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-[#00D64F] flex items-center justify-center text-black font-bold text-sm">C</div>
            <div>
              <p className="text-sm font-bold text-white">Product Coach</p>
              <p className="text-xs text-gray-600">Powered by Claude Opus 4</p>
            </div>
          </div>
          <p className="text-sm text-gray-400 leading-relaxed">
            Ask me anything about product management — strategy, prioritisation, discovery, metrics, stakeholders. I'll challenge your thinking and help you grow. Try: <em className="text-gray-300">"How should I think about prioritising our roadmap as an early MVP?"</em>
          </p>
        </div>
      )}

      {/* Messages */}
      {messages.length > 0 && (
        <div className="flex flex-col gap-4">
          {messages.map((msg, i) => (
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="bg-[#00D64F]/10 border border-[#00D64F]/20 rounded-2xl rounded-tr-sm px-5 py-3.5 max-w-xl">
                  <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-4">
                <div className="w-9 h-9 rounded-full bg-[#00D64F] flex items-center justify-center text-black font-bold text-sm flex-shrink-0">C</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold text-white">Coach</span>
                    {thinking && i === messages.length - 1 && !msg.content && <ThinkingDots />}
                  </div>
                  {msg.content ? (
                    <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                  ) : (
                    <div className="text-sm text-gray-600 italic">Thinking…</div>
                  )}
                </div>
              </div>
            )
          ))}
          <div ref={endRef} />
        </div>
      )}

      {/* Input */}
      <div className="flex flex-col gap-2 sticky bottom-0 bg-[#0a0a0a] pt-2 pb-4">
        {coachError && (
          <div className="flex items-center justify-between gap-4 bg-red-950/40 border border-red-800/40 rounded-xl px-4 py-3">
            <p className="text-sm text-red-400">{coachError}</p>
            <button
              onClick={retry}
              disabled={thinking}
              className="text-sm font-semibold text-red-300 hover:text-white transition-colors flex-shrink-0 disabled:opacity-50"
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
            className="flex-1 bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white placeholder-[#444] transition-colors text-sm resize-none disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!input.trim() || thinking}
            className="rounded-2xl bg-[#00D64F] text-black font-bold px-6 py-4 hover:bg-[#00c248] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm flex-shrink-0"
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
  backlog:       "bg-gray-500/10 text-gray-400 border border-gray-700",
  refine:        "bg-[#185fa5]/15 text-[#185fa5] border border-[#185fa5]/40",
  "in-progress": "bg-[#ba7517]/15 text-[#ba7517] border border-[#ba7517]/40",
  done:          "bg-[#00D64F]/15 text-[#00D64F] border border-[#00D64F]/30",
};

const KANBAN_COLUMNS: Array<{
  status: ObjectiveStatus;
  label: string;
  borderClass: string;
  textClass: string;
}> = [
  { status: "backlog",     label: "Backlog",     borderClass: "border-gray-700",   textClass: "text-gray-400" },
  { status: "refine",      label: "Refine",      borderClass: "border-[#185fa5]",  textClass: "text-[#185fa5]" },
  { status: "in-progress", label: "In Progress", borderClass: "border-[#ba7517]",  textClass: "text-[#ba7517]" },
  { status: "done",        label: "Done",        borderClass: "border-[#00D64F]",  textClass: "text-[#00D64F]" },
];

function extractImplementationPrompt(prd: string): string {
  const marker = "## Claude Code Implementation Prompt";
  const idx = prd.indexOf(marker);
  if (idx === -1) return "";
  return prd.slice(idx + marker.length).trim();
}

// ── Kanban Card ────────────────────────────────────────────────────────────────

function KanbanCard({
  obj,
  col,
  onDiscuss,
  onDelete,
  onDragStart,
}: {
  obj: Objective;
  col: typeof KANBAN_COLUMNS[number];
  onDiscuss: (id: string, problem: string) => void;
  onDelete: (id: string) => void;
  onDragStart: (id: string, fromStatus: ObjectiveStatus) => void;
}) {
  const [prdOpen, setPrdOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDone = obj.status === "done";
  const implPrompt = obj.prd ? extractImplementationPrompt(obj.prd) : "";
  const discussProblem = obj.title + (obj.description ? `\n\n${obj.description}` : "");

  function handleCopy() {
    navigator.clipboard.writeText(implPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      draggable={!isDone}
      onDragStart={isDone ? undefined : () => onDragStart(obj.id, obj.status)}
      className={`bg-[#111] border ${col.borderClass} rounded-2xl p-4 flex flex-col gap-3 ${!isDone ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      {/* Title */}
      <div>
        <p className="text-sm font-bold text-white leading-snug line-clamp-2" title={obj.title}>{obj.title}</p>
        {obj.description && (
          <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-3 overflow-hidden">{obj.description}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        {!isDone && (obj.status === "backlog" || obj.status === "refine") && (
          <button
            onClick={() => onDiscuss(obj.id, discussProblem)}
            className="text-xs font-semibold text-[#00D64F] hover:underline"
          >
            Discuss with team →
          </button>
        )}
        {obj.prd && (
          <button
            onClick={() => setPrdOpen(!prdOpen)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {prdOpen ? "Hide PRD" : "View PRD"}
          </button>
        )}
        {!isDone && (
          confirmDelete ? (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-gray-500">Delete?</span>
              <button onClick={() => onDelete(obj.id)} className="text-xs font-semibold text-red-400 hover:text-red-300">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-600 hover:text-gray-400">No</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-gray-600 hover:text-red-400 transition-colors ml-auto"
              title="Delete"
            >
              🗑
            </button>
          )
        )}
      </div>

      {/* Expanded PRD */}
      {prdOpen && obj.prd && (
        <div className="border-t border-[#1e1e1e] pt-3 flex flex-col gap-3">
          <div className="text-xs text-gray-400 leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">
            {obj.prd}
          </div>
          {implPrompt && (
            <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Claude Code Prompt</span>
                <button onClick={handleCopy} className="text-xs font-semibold text-[#00D64F] hover:underline">
                  {copied ? "Copied!" : "Copy prompt"}
                </button>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{implPrompt}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Kanban Tab ─────────────────────────────────────────────────────────────────

function KanbanTab({ onDiscuss }: { onDiscuss: (objectiveId: string, problem: string) => void }) {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState<{ id: string; fromStatus: ObjectiveStatus } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ObjectiveStatus | null>(null);

  useEffect(() => {
    loadObjectives().then((data) => { setObjectives(data); setLoading(false); });
  }, []);

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

  if (loading) return <p className="text-sm text-gray-600 py-4">Loading…</p>;

  if (objectives.length === 0) {
    return (
      <div className="border border-dashed border-[#2a2a2a] rounded-2xl p-10 text-center">
        <p className="text-sm text-gray-600">No cards yet — save objectives from the PM tab to populate the board.</p>
      </div>
    );
  }

  return (
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
              <span className="text-xs text-gray-700">{cards.length}</span>
            </div>
            <div
              className={`flex flex-col gap-3 min-h-[80px] rounded-2xl transition-colors ${
                isOver ? "bg-white/5 ring-1 ring-white/20" : ""
              }`}
            >
              {cards.length === 0 ? (
                <div className={`border ${col.borderClass} border-dashed rounded-2xl p-4 text-xs text-gray-700 text-center`}>
                  Empty
                </div>
              ) : (
                cards.map((obj) => (
                  <KanbanCard
                    key={obj.id}
                    obj={obj}
                    col={col}
                    onDiscuss={onDiscuss}
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
  );
}

// ── PM 1-on-1 Tab ─────────────────────────────────────────────────────────────

function PMTab({ onSwitchToKanban, buildMode }: { onSwitchToKanban: () => void; buildMode: boolean }) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pmError, setPmError] = useState("");
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [objInput, setObjInput] = useState("");
  const [savingObj, setSavingObj] = useState(false);
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

  async function handleSaveObjective() {
    const title = objInput.trim();
    if (!title) return;
    setSavingObj(true);

    // Extract a one-sentence description from Sarah's last message
    let description: string | null = null;
    const lastSarahMsg = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
    if (lastSarahMsg) {
      try {
        let desc = "";
        await streamChat(
          PM_MODEL,
          "You extract concise one-sentence descriptions. Reply with ONLY the sentence — no extra text.",
          [{
            role: "user",
            content:
              `Write a one-sentence description for this product objective based on the conversation context.\n\n` +
              `Objective: "${title}"\n\nContext (last message):\n${lastSarahMsg.slice(0, 600)}`,
          }],
          80,
          (chunk) => { desc += chunk; }
        );
        const clean = desc.trim().replace(/^["']|["']$/g, "").replace(/\.+$/, "") + ".";
        if (clean.length > 5) description = clean;
      } catch { /* non-fatal */ }
    }

    const obj = await saveObjectiveWithDetails(title, description, "backlog");
    if (obj) {
      setObjInput("");
      loadObjectives().then(setObjectives);
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
          <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ background: "#5a4fcf" }}>
                SM
              </div>
              <div>
                <p className="text-sm font-bold text-white">Sarah · PM</p>
                <p className="text-xs text-gray-600">1-on-1 with Philip</p>
              </div>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed">
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
                  <div className="bg-[#00D64F]/10 border border-[#00D64F]/20 rounded-2xl rounded-tr-sm px-5 py-3.5 max-w-xl">
                    <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ) : (
                <div key={i} className="flex gap-4">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0" style={{ background: "#5a4fcf" }}>
                    SM
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-bold text-white">Sarah</span>
                      <span className="text-xs text-gray-600 bg-[#1a1a1a] px-2 py-0.5 rounded-full">PM</span>
                      {thinking && i === messages.length - 1 && !msg.content && <ThinkingDots />}
                    </div>
                    {msg.content ? (
                      <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                    ) : (
                      <div className="text-sm text-gray-600 italic">Thinking…</div>
                    )}
                  </div>
                </div>
              )
            )}
            <div ref={endRef} />
          </div>
        )}

        {/* Input */}
        <div className="flex flex-col gap-2 sticky bottom-0 bg-[#0a0a0a] pt-2 pb-4">
          {pmError && (
            <div className="flex items-center justify-between gap-4 bg-red-950/40 border border-red-800/40 rounded-xl px-4 py-3">
              <p className="text-sm text-red-400">{pmError}</p>
              <button
                onClick={retry}
                disabled={thinking}
                className="text-sm font-semibold text-red-300 hover:text-white transition-colors flex-shrink-0 disabled:opacity-50"
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
              className="flex-1 bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-4 text-white placeholder-[#444] transition-colors text-sm resize-none disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={!input.trim() || thinking}
              className="rounded-2xl bg-[#00D64F] text-black font-bold px-6 py-4 hover:bg-[#00c248] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm flex-shrink-0"
            >
              {thinking ? "…" : "Send →"}
            </button>
          </div>
        </div>
      </div>

      {/* Objectives */}
      <div className="border-t border-[#1a1a1a] pt-8 flex flex-col gap-5">

        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white mb-1">Agreed objectives</h2>
            <p className="text-xs text-gray-600">Objectives saved to the Kanban board as backlog cards.</p>
          </div>
          <button
            onClick={onSwitchToKanban}
            className="text-sm text-[#00D64F] hover:opacity-75 transition-opacity whitespace-nowrap shrink-0"
          >
            View Kanban →
          </button>
        </div>

        {/* Save input */}
        <div className="flex gap-3 items-end">
          <input
            type="text"
            value={objInput}
            onChange={(e) => setObjInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveObjective(); }}
            placeholder="Add an agreed objective…"
            className="flex-1 bg-[#111] border border-[#2a2a2a] focus:border-[#00D64F] outline-none rounded-xl px-5 py-3.5 text-white placeholder-[#444] transition-colors text-sm"
          />
          <button
            onClick={handleSaveObjective}
            disabled={!objInput.trim() || savingObj}
            className="rounded-2xl bg-[#00D64F] text-black font-bold px-5 py-3.5 hover:bg-[#00c248] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm flex-shrink-0"
          >
            {savingObj ? "Saving…" : "Save objective"}
          </button>
        </div>

        {/* List */}
        {objectives.length === 0 ? (
          <p className="text-sm text-gray-600">No objectives saved yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {objectives.map((obj) => (
              <div key={obj.id} className="bg-[#111] border border-[#1e1e1e] rounded-2xl px-5 py-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white leading-relaxed">{obj.title}</p>
                  {obj.description && (
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{obj.description}</p>
                  )}
                  <p className="text-xs text-gray-600 mt-1">
                    {new Date(obj.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <span className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full capitalize ${STATUS_STYLES[obj.status]}`}>
                  {obj.status}
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
  const [buildMode, setBuildMode] = useState<boolean>(true);

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

  function handleDiscuss(objectiveId: string, problem: string) {
    setPendingObjective({ id: objectiveId, problem });
    setActiveTab("team");
  }

  const tabs = [
    { id: "kanban" as const, label: "Kanban" },
    { id: "team" as const, label: "Product team" },
    { id: "pm" as const, label: "PM" },
    { id: "coach" as const, label: "Product coach" },
  ];

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-10 overflow-x-hidden">
      <div className={`${activeTab === "kanban" ? "max-w-5xl" : "max-w-3xl"} mx-auto transition-all`}>

        <div className="mb-8 flex items-start justify-between gap-6 flex-wrap">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight mb-2">Product agents</h1>
            <p className="text-gray-400">AI-powered product thinking for Rise.</p>
          </div>
          {/* Build / Research mode toggle */}
          <button
            onClick={toggleMode}
            className="flex items-center gap-2.5 bg-[#111] border border-[#1e1e1e] rounded-2xl px-4 py-2.5 hover:border-[#2a2a2a] transition-colors shrink-0"
          >
            <span className={`w-2 h-2 rounded-full ${buildMode ? "bg-[#00D64F]" : "bg-amber-400"}`} />
            <span className="text-sm font-semibold text-white">{buildMode ? "Build mode" : "Research mode"}</span>
            <span className="text-xs text-gray-600">— tap to switch</span>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-[#111] border border-[#1e1e1e] rounded-2xl p-1 w-fit mb-10 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-[#00D64F] text-black"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "kanban" && <KanbanTab onDiscuss={handleDiscuss} />}
        {activeTab === "team" && (
          <ProductTeamTab
            pendingObjective={pendingObjective}
            onObjectiveSaved={() => setPendingObjective(null)}
            buildMode={buildMode}
          />
        )}
        {activeTab === "pm" && <PMTab onSwitchToKanban={() => setActiveTab("kanban")} buildMode={buildMode} />}
        {activeTab === "coach" && <ProductCoachTab buildMode={buildMode} />}

      </div>
    </main>
  );
}
